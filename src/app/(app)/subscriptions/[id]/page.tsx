// Day 22 / §3.3.5 — subscription detail page (MVP-minimal scope).
//
// Server component. Composes:
//   - getSubscription            — header + rule summary data
//   - getConsignee               — consignee name + address fields for header link
//   - getRecentExceptionsForSubscription — last 10 events per §3.3.5 line 536
//
// Pause/Resume CTAs are rendered via PauseResumeActions, imported
// from the /edit subroute (single source of truth — both surfaces
// share the same client component + server actions).
//
// MVP-minimal scope per Day-22 PM §3.22 B6 ruling:
//   - Header (consignee link, plan, status, window, days remaining)
//   - Rule summary (weekday grid, delivery window, primary address)
//   - Pause/Resume CTA
//   - Recent exceptions (read-only)
//
// Deferred per ruling:
//   - Skip workflow (canonical surface is the calendar popover)
//   - Skip override workflow (same reasoning)
//   - Address rotation editor (Phase 2 per brief v1.11)
//   - Inline edit (operators navigate to /edit subroute)

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DetailHeader, DetailSection, DetailView } from "@/components/DetailView";
import { FieldRow } from "@/components/FieldRow";
import { StatusBadge } from "@/components/StatusBadge";
import { getConsignee } from "@/modules/consignees";
import { requirePermission } from "@/modules/identity";
import { getRecentExceptionsForSubscription } from "@/modules/subscription-exceptions";
import { getSubscription, type Subscription } from "@/modules/subscriptions";
import { getTasksForSubscription } from "@/modules/tasks";
import { ForbiddenError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Permission, Uuid } from "@/shared/types";

import { PauseResumeActions } from "./edit/_components/PauseResumeActions";
import { RecentExceptions } from "./_components/RecentExceptions";
import { SubscriptionRuleSummary } from "./_components/SubscriptionRuleSummary";
import { SubscriptionTasksList } from "./_components/SubscriptionTasksList";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function SubscriptionDetailPage({ params }: PageProps) {
  const { id } = await params;
  const requestId = randomUUID();

  const ctx = await tryBuildContext(id, requestId);
  if (ctx === null) return null; // redirect already issued

  try {
    requirePermission(ctx.ctx, "subscription:read");
  } catch (err) {
    if (err instanceof ForbiddenError) redirect("/subscriptions");
    throw err;
  }

  const subscription = await getSubscription(ctx.ctx, id as Uuid);
  if (!subscription) notFound();

  // Three follow-up fetches in parallel — consignee for header link +
  // address fields, exceptions for the recent-exceptions panel, tasks
  // for the materialised-tasks panel.
  const [consignee, exceptions, tasks] = await Promise.all([
    getConsignee(ctx.ctx, subscription.consigneeId),
    getRecentExceptionsForSubscription(ctx.ctx, subscription.id, 10),
    getTasksForSubscription(ctx.ctx, subscription.id, 30),
  ]);
  if (!consignee) notFound();

  // Edit permission gate — controls visibility of the "Edit" CTA on
  // the header strip. The /edit subroute itself re-checks at page-level.
  let canEdit = false;
  if (ctx.ctx.actor.kind === "user") {
    const perms = ctx.ctx.actor.permissions as ReadonlySet<Permission>;
    canEdit = perms.has("subscription:update");
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy">
      <div className="mx-auto max-w-4xl px-12 py-12">
        <Link
          href="/subscriptions"
          className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:text-navy"
        >
          ← Subscriptions
        </Link>

        <div className="mt-6">
          <DetailView
            header={
              <DetailHeader
                eyebrow="Subscription"
                title={subscription.mealPlanName ?? "Unnamed plan"}
                status={
                  <StatusBadge domain="subscription" status={subscription.status} size="lg" />
                }
                actions={
                  canEdit ? (
                    <Link
                      href={`/subscriptions/${subscription.id}/edit`}
                      className="inline-flex items-center justify-center rounded-sm border border-navy bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
                    >
                      Edit
                    </Link>
                  ) : undefined
                }
              />
            }
          >
            <DetailSection label="Recipient">
              <FieldRow
                label="Consignee"
                value={
                  <Link
                    href={`/consignees/${consignee.id}`}
                    className="text-navy underline decoration-stone-300 underline-offset-4 transition-colors duration-[120ms] ease-out hover:decoration-navy"
                  >
                    {consignee.name}
                  </Link>
                }
              />
            </DetailSection>
            <DetailSection label="Term">
              <FieldRow label="Start" value={subscription.startDate} mono />
              <FieldRow label="End" value={subscription.endDate ?? "Open-ended"} mono />
              <FieldRow label="Days remaining" value={daysRemainingLabel(subscription)} mono />
            </DetailSection>
          </DetailView>
        </div>

        <SubscriptionRuleSummary
          subscription={subscription}
          addressLine={consignee.addressLine}
          district={consignee.district}
          emirate={consignee.emirateOrRegion}
        />

        <section className="mt-12">
          <h2 className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
            Lifecycle
          </h2>
          <div className="mt-6">
            <PauseResumeActions
              subscriptionId={subscription.id}
              status={subscription.status}
            />
          </div>
        </section>

        <SubscriptionTasksList tasks={tasks} consigneeId={consignee.id} />

        <RecentExceptions exceptions={exceptions} />
      </div>
    </main>
  );
}

/**
 * Wraps buildRequestContext + the unauthorised redirect. Returning
 * `null` signals the caller that redirect() has been invoked (Next
 * unwinds the request); the page body short-circuits.
 */
async function tryBuildContext(
  id: string,
  requestId: string,
): Promise<{ ctx: Awaited<ReturnType<typeof buildRequestContext>> } | null> {
  try {
    return { ctx: await buildRequestContext(`/subscriptions/${id}`, requestId) };
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent(`/subscriptions/${id}`));
    }
    throw err;
  }
}

/**
 * Days-remaining label for the subscription term. Open-ended → "—",
 * past end → "Ended", otherwise the day count. UTC ISO date math (kept
 * local to the page rather than coupling to the shared
 * SubscriptionDetailHeader, which the consignee Subscription tab also uses).
 */
function daysRemainingLabel(sub: Subscription): string {
  if (sub.endDate === null) return "—";
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  if (sub.endDate < todayIso) return "Ended";
  const startMs = Date.parse(`${todayIso}T00:00:00Z`);
  const endMs = Date.parse(`${sub.endDate}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "—";
  const days = Math.round((endMs - startMs) / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"}`;
}

// Day 22 / Phase 1 forms lane — /subscriptions/[id]/edit page.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import type { Weekday } from "@/components/forms/WeekdaySelector";
import { requirePermission } from "@/modules/identity";
import { getSubscription } from "@/modules/subscriptions";
import { ForbiddenError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { EditSubscriptionForm } from "./_components/EditSubscriptionForm";
import { PauseResumeActions } from "./_components/PauseResumeActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
}

const ISO_WEEKDAY_TO_KEY: Readonly<Record<number, Weekday>> = {
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
  7: "sun",
};

export default async function EditSubscriptionPage({ params }: PageProps) {
  const { id } = await params;
  const requestId = randomUUID();

  let subscription;
  try {
    const ctx = await buildRequestContext(`/subscriptions/${id}/edit`, requestId);
    requirePermission(ctx, "subscription:update");
    subscription = await getSubscription(ctx, id as Uuid);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent(`/subscriptions/${id}/edit`));
    }
    if (err instanceof ForbiddenError) {
      redirect("/subscriptions");
    }
    throw err;
  }

  if (!subscription) {
    notFound();
  }

  // Map ISO 1..7 to Weekday keys for the WeekdaySelector default.
  const weekdayDefaults: ReadonlyArray<Weekday> = subscription.daysOfWeek
    .map((iso) => ISO_WEEKDAY_TO_KEY[iso])
    .filter((w): w is Weekday => w !== undefined);

  // Trim seconds from HH:MM:SS for the time inputs.
  const windowStart = subscription.deliveryWindowStart.slice(0, 5);
  const windowEnd = subscription.deliveryWindowEnd.slice(0, 5);

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-3xl px-12 py-16">
        <Link
          href="/subscriptions"
          className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:text-navy"
        >
          ← Subscriptions
        </Link>

        <header className="mb-12 mt-6">
          <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
            Subscription · Edit
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">
            Edit subscription
          </h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Status:{" "}
            <span className="font-medium text-navy">{subscription.status}</span> ·
            consignee{" "}
            <Link
              href={`/consignees/${subscription.consigneeId}`}
              className="text-navy underline-offset-2 hover:underline"
            >
              detail
            </Link>
          </p>
        </header>

        <div className="space-y-10">
          <EditSubscriptionForm
            subscriptionId={subscription.id}
            defaults={{
              startDate: subscription.startDate,
              endDate: subscription.endDate,
              daysOfWeek: weekdayDefaults,
              deliveryWindowStart: windowStart,
              deliveryWindowEnd: windowEnd,
              mealPlanName: subscription.mealPlanName,
              externalRef: subscription.externalRef,
              notesInternal: subscription.notesInternal,
            }}
          />

          <PauseResumeActions
            subscriptionId={subscription.id}
            status={subscription.status}
          />
        </div>
      </div>
    </main>
  );
}

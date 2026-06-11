// Day 22 / §3.3.5 — subscription detail page header card.
//
// Server component. Renders consignee link, plan name, subscription
// window (start–end), status badge, and days-remaining counter per
// brief §3.3.5 line 530. Pure presentation; the page-level fetch
// owns data shaping.

import Link from "next/link";

import type { Subscription } from "@/modules/subscriptions";

interface SubscriptionDetailHeaderProps {
  readonly subscription: Subscription;
  readonly consigneeName: string;
  readonly consigneeId: string;
}

export function SubscriptionDetailHeader({
  subscription,
  consigneeName,
  consigneeId,
}: SubscriptionDetailHeaderProps) {
  const planLabel = subscription.mealPlanName ?? "Unnamed plan";
  return (
    <header className="border-b border-stone-200 pb-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
            Subscription
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-navy">
            {planLabel}
          </h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            For{" "}
            <Link
              href={`/consignees/${consigneeId}`}
              className="text-navy underline decoration-stone-300 underline-offset-4 transition-colors duration-[120ms] ease-out hover:decoration-navy"
            >
              {consigneeName}
            </Link>
          </p>
          <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                Start
              </dt>
              <dd className="mt-1 tabular-nums text-navy">{subscription.startDate}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                End
              </dt>
              <dd className="mt-1 tabular-nums text-navy">
                {subscription.endDate ?? "Open-ended"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                Days remaining
              </dt>
              <dd className="mt-1 tabular-nums text-navy">{daysRemainingLabel(subscription)}</dd>
            </div>
          </dl>
        </div>
        <div className="flex-shrink-0">
          <StatusBadge status={subscription.status} />
        </div>
      </div>
    </header>
  );
}

function daysRemainingLabel(sub: Subscription): string {
  if (sub.endDate === null) return "—";
  // ISO YYYY-MM-DD math against today's date (UTC). Negative values
  // (subscription has ended) collapse to "Ended"; the lifecycle
  // sweep converts those to status='ended' on the daily cron.
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  if (sub.endDate < todayIso) return "Ended";
  const startMs = Date.parse(`${todayIso}T00:00:00Z`);
  const endMs = Date.parse(`${sub.endDate}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "—";
  const days = Math.round((endMs - startMs) / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function StatusBadge({ status }: { readonly status: Subscription["status"] }) {
  switch (status) {
    case "active":
      return (
        <span className="inline-flex items-center gap-2 rounded-sm border border-green/30 px-3 py-1 text-xs font-medium uppercase tracking-[0.15em] text-green">
          <span className="h-1.5 w-1.5 rounded-full bg-green" aria-hidden />
          Active
        </span>
      );
    case "paused":
      return (
        <span className="inline-flex items-center gap-2 rounded-sm border border-amber/30 px-3 py-1 text-xs font-medium uppercase tracking-[0.15em] text-amber">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden />
          Paused
        </span>
      );
    case "ended":
      return (
        <span className="inline-flex items-center gap-2 rounded-sm border border-stone-200 px-3 py-1 text-xs font-medium uppercase tracking-[0.15em] text-[color:var(--color-text-tertiary)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-text-tertiary)]" aria-hidden />
          Ended
        </span>
      );
  }
}

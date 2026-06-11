// Day-23 §3.3.2 — Consignee detail Subscription tab.
//
// Replaces the Day-17 PlaceholderTab with an inline composition of the
// 4 subscription-detail server components that already exist at
// /subscriptions/[id]/_components/* (Day-22 PR #238 forms lane):
//
//   - SubscriptionDetailHeader  — header strip (plan, status, dates)
//   - SubscriptionRuleSummary   — weekday + window + primary address
//   - SubscriptionTasksList     — materialised tasks (LIMIT 30)
//   - RecentExceptions          — last 10 events
//
// Each subscription renders as its own SubscriptionDetailBlock; if the
// consignee has multiple active subscriptions, they stack with a
// hairline divider between blocks. If zero, an empty state copy renders
// pointing operators to the New-subscription CTA on the header.
//
// The component is pure presentational — data (tasks + exceptions per
// subscription) is pre-fetched by the page server component and passed
// through as `groups`. This keeps the cross-route component reuse
// simple (no `ctx` plumbing through props) and lets the page parallelise
// all per-subscription fetches with one Promise.all on the server.
//
// Cross-route imports from /subscriptions/[id]/_components/ are
// intentional — those components are self-contained server primitives
// with stable prop shapes. If a second consumer materialises beyond
// this tab, lift to a shared location.

import type { SubscriptionException } from "@/modules/subscription-exceptions";
import type { Subscription } from "@/modules/subscriptions";
import type { Task } from "@/modules/tasks/types";

import { RecentExceptions } from "@/app/(app)/subscriptions/[id]/_components/RecentExceptions";
import { SubscriptionDetailHeader } from "@/app/(app)/subscriptions/[id]/_components/SubscriptionDetailHeader";
import { SubscriptionRuleSummary } from "@/app/(app)/subscriptions/[id]/_components/SubscriptionRuleSummary";
import { SubscriptionTasksList } from "@/app/(app)/subscriptions/[id]/_components/SubscriptionTasksList";

export interface SubscriptionDetailGroup {
  readonly subscription: Subscription;
  readonly tasks: readonly Task[];
  readonly exceptions: readonly SubscriptionException[];
}

export interface SubscriptionTabProps {
  readonly groups: readonly SubscriptionDetailGroup[];
  readonly consigneeId: string;
  readonly consigneeName: string;
  readonly addressLine: string;
  readonly district: string;
  readonly emirate: string;
}

export function SubscriptionTab({
  groups,
  consigneeId,
  consigneeName,
  addressLine,
  district,
  emirate,
}: SubscriptionTabProps) {
  if (groups.length === 0) {
    return (
      <div className="border-t border-stone-200 py-12 text-center">
        <p className="text-sm text-[color:var(--color-text-secondary)]">
          No active subscriptions for this consignee.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-12">
      {groups.map((group, index) => (
        <SubscriptionDetailBlock
          key={group.subscription.id}
          group={group}
          consigneeId={consigneeId}
          consigneeName={consigneeName}
          addressLine={addressLine}
          district={district}
          emirate={emirate}
          isFirst={index === 0}
        />
      ))}
    </div>
  );
}

interface SubscriptionDetailBlockProps {
  readonly group: SubscriptionDetailGroup;
  readonly consigneeId: string;
  readonly consigneeName: string;
  readonly addressLine: string;
  readonly district: string;
  readonly emirate: string;
  readonly isFirst: boolean;
}

function SubscriptionDetailBlock({
  group,
  consigneeId,
  consigneeName,
  addressLine,
  district,
  emirate,
  isFirst,
}: SubscriptionDetailBlockProps) {
  return (
    <article className={isFirst ? "pt-0" : "border-t border-stone-200 pt-12"}>
      <SubscriptionDetailHeader
        subscription={group.subscription}
        consigneeName={consigneeName}
        consigneeId={consigneeId}
      />
      <SubscriptionRuleSummary
        subscription={group.subscription}
        addressLine={addressLine}
        district={district}
        emirate={emirate}
      />
      <SubscriptionTasksList tasks={group.tasks} consigneeId={consigneeId} />
      <RecentExceptions exceptions={group.exceptions} />
    </article>
  );
}

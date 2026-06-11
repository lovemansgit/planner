// Day 22 / Phase 1 forms lane — subscription preview card.
//
// Hero-numeral preview per Day-19 §J-3 ruling. Atmosphere primitive
// `--color-tint-navy-subtle` (2.5% navy wash) per
// src/styles/brand-tokens.css:39-47. Inline below cadence section
// (subscription mode) or below date-range picker (single-task mode).
//
// Hero numeral derives via the count helpers in ../_helpers.ts —
// pure client-side calculation matching the cron's eligible-day walk
// (no DB round-trip; preview must update live as the operator edits
// dates / weekdays).

"use client";

import {
  countSingleTaskRange,
  countSubscriptionTasks,
  formatDateRange,
} from "../_helpers";

export type PreviewMode = "subscription" | "single-task";

interface SubscriptionPreviewCardProps {
  readonly mode: PreviewMode;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly isoWeekdays?: ReadonlySet<number>; // subscription mode only
}

export function SubscriptionPreviewCard({
  mode,
  startDate,
  endDate,
  isoWeekdays,
}: SubscriptionPreviewCardProps) {
  const isValidStart = /^\d{4}-\d{2}-\d{2}$/.test(startDate);

  // Empty state — operator hasn't filled enough fields for a preview.
  if (!isValidStart) {
    return (
      <div className="rounded-sm border border-stone-200 bg-paper p-6">
        <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Preview
        </p>
        <p className="mt-2 text-sm text-[color:var(--color-text-secondary)]">
          Pick a start date {mode === "subscription" ? "and at least one delivery day " : ""}
          to see how many deliveries will generate.
        </p>
      </div>
    );
  }

  let count = 0;
  let kindLabel = "";
  let detailLabel = "";

  if (mode === "subscription") {
    if (!isoWeekdays || isoWeekdays.size === 0) {
      return (
        <div className="rounded-sm border border-stone-200 bg-paper p-6">
          <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
            Preview
          </p>
          <p className="mt-2 text-sm text-[color:var(--color-text-secondary)]">
            Pick at least one delivery day to see the projected count.
          </p>
        </div>
      );
    }
    count = countSubscriptionTasks(startDate, endDate, isoWeekdays);
    kindLabel = count === 1 ? "delivery" : "deliveries";
    detailLabel =
      endDate === null
        ? `over the next 31 days (from ${formatDateRange(startDate, null)})`
        : `across ${formatDateRange(startDate, endDate)}`;
  } else {
    count = countSingleTaskRange(startDate, endDate);
    kindLabel = count === 1 ? "ad-hoc task" : "ad-hoc tasks";
    detailLabel = `across ${formatDateRange(startDate, endDate)}`;
  }

  return (
    <div
      className="rounded-sm border border-stone-200 p-6"
      style={{ backgroundColor: "var(--color-tint-navy-subtle)" }}
    >
      <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
        Preview
      </p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        Will create
      </p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-5xl font-semibold tabular-nums tracking-tight text-navy">
          {count}
        </span>
        <span className="text-sm text-navy">{kindLabel}</span>
      </p>
      <p className="mt-1 text-sm text-[color:var(--color-text-secondary)]">
        {detailLabel}.
      </p>
      {mode === "subscription" && endDate === null ? (
        <p className="mt-3 text-xs text-[color:var(--color-text-tertiary)]">
          Open-ended subscription. Showing the cron-decoupled materialisation horizon (next 31
          days). Ongoing days continue to generate at cron tick.
        </p>
      ) : null}
    </div>
  );
}

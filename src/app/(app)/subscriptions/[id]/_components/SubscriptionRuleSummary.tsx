// Day 22 / §3.3.5 — subscription rule summary card.
//
// Renders the weekday-grid (Mon-Sun chips, active days filled),
// delivery window, and primary address per brief §3.3.5 line 531.
// Single-address MVP per brief v1.11 amendment §3.3.1 — multi-address
// rotation is Phase 2 (followup_multi_address_rotation_phase_2.md).

import type { Subscription } from "@/modules/subscriptions";

interface SubscriptionRuleSummaryProps {
  readonly subscription: Subscription;
  /** Primary delivery address. Sourced from the consignees row's
   *  inline columns (Phase-2 deprecation target per migration 0014). */
  readonly addressLine: string;
  readonly district: string;
  readonly emirate: string;
}

const WEEKDAYS: ReadonlyArray<{ iso: number; label: string }> = [
  { iso: 1, label: "Mon" },
  { iso: 2, label: "Tue" },
  { iso: 3, label: "Wed" },
  { iso: 4, label: "Thu" },
  { iso: 5, label: "Fri" },
  { iso: 6, label: "Sat" },
  { iso: 7, label: "Sun" },
];

export function SubscriptionRuleSummary({
  subscription,
  addressLine,
  district,
  emirate,
}: SubscriptionRuleSummaryProps) {
  const activeDays = new Set(subscription.daysOfWeek);
  return (
    <section className="mt-10">
      <h2 className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
        Rule
      </h2>
      <div className="mt-6 grid grid-cols-1 gap-8 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
            Delivery days
          </p>
          <div
            role="list"
            aria-label="Delivery weekdays"
            className="mt-3 flex flex-wrap gap-2"
          >
            {WEEKDAYS.map((d) => {
              const active = activeDays.has(d.iso);
              return (
                <span
                  key={d.iso}
                  role="listitem"
                  data-active={active ? "true" : "false"}
                  className={
                    active
                      ? "rounded-sm border border-navy bg-navy px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-paper"
                      : "rounded-sm border border-stone-200 bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]"
                  }
                >
                  {active ? <span className="sr-only">Active delivery day: </span> : null}
                  {d.label}
                </span>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
            Delivery window
          </p>
          <p className="mt-3 tabular-nums text-sm text-navy">
            {subscription.deliveryWindowStart.slice(0, 5)} – {subscription.deliveryWindowEnd.slice(0, 5)}
          </p>
        </div>
      </div>

      <div className="mt-8">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Primary address
        </p>
        <p className="mt-3 max-w-prose text-sm text-navy">
          {addressLine}
        </p>
        <p className="mt-1 text-sm text-[color:var(--color-text-secondary)]">
          {district} · {emirate}
        </p>
        <p className="mt-2 text-xs text-[color:var(--color-text-tertiary)]">
          Single-address MVP. Multi-address rotation per weekday ships in Phase 2.
        </p>
      </div>
    </section>
  );
}

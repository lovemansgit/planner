// Day-22n PR-C-B — MetricCard primitive (server component).
//
// One of five renderings in the /calendar + /admin/calendar header per
// brief §3.3.4: Active consignees, Today's deliveries, Delivered (today),
// Out for delivery, Failed/at-risk.
//
// Phase 10 · Batch B5 — reskinned onto the shipped B+ metric-card recipe
// (`src/components/metric-card-recipe.ts`) so the calendar metric strip
// reads as the same floating warm-white card with a MONO tabular value as
// every other B+ dashboard metric. The recipe's class constants are reused
// verbatim (no re-derivation); this surface's tone vocabulary
// (`default | risk`) maps onto the recipe's (`default | alert`) — `risk` is
// the reserved attention tone for the failed/at-risk card (reviewer Q2
// ruling), which is the recipe's `alert`. The component's own prop API
// (`label | value | context | tone`) is preserved so every call site is
// untouched.
//
// Pure-logic extraction: `getMetricCardToneClasses(tone)` exposed for spec
// coverage per the codebase's no-render-test convention
// (memory/followup_client_component_test_infra.md).

import {
  METRIC_CARD,
  METRIC_LABEL,
  METRIC_SUBLABEL,
  METRIC_VALUE,
  metricToneClass,
  type MetricTone,
} from "@/components/metric-card-recipe";

export type MetricCardTone = "default" | "risk";

export interface MetricCardProps {
  readonly label: string;
  readonly value: number | string;
  readonly context?: string;
  readonly tone?: MetricCardTone;
}

interface MetricCardToneClasses {
  readonly card: string;
  readonly numeral: string;
}

/**
 * Map the calendar-local tone vocabulary onto the shipped B+ recipe tones:
 * `risk` (the failed/at-risk attention card) === the recipe's `alert`.
 */
function toRecipeTone(tone: MetricCardTone | undefined): MetricTone {
  return tone === "risk" ? "alert" : "default";
}

export function getMetricCardToneClasses(
  tone: MetricCardTone | undefined,
): MetricCardToneClasses {
  const recipe = metricToneClass(toRecipeTone(tone));
  return { card: recipe.card, numeral: recipe.value };
}

export function MetricCard({ label, value, context, tone }: MetricCardProps) {
  const classes = getMetricCardToneClasses(tone);
  return (
    // Phase 12.2 Batch B / Item 4 — fixed 3-zone structure so the numerals sit
    // on ONE horizontal line across the whole metric row regardless of label
    // length. The owner's authed walk flagged that "Total deliveries today"
    // wraps to 2 lines while siblings are 1, dropping its big number below the
    // others. The label zone reserves up to 2 lines (top), the numeral is
    // centered in the middle, and the context reserves up to 2 lines (bottom),
    // so every card is equal height and the numbers align. `line-clamp-2` caps
    // each text zone at 2 lines; `min-h` reserves that height even for 1-line
    // text. h-full + my-auto centre the numeral if the grid stretches a card.
    <article className={`${METRIC_CARD} ${classes.card} h-full`}>
      <p className={`${METRIC_LABEL} line-clamp-2 min-h-[2.5em] leading-[1.25]`}>{label}</p>
      <p className={`${METRIC_VALUE} ${classes.numeral} my-auto`}>{value}</p>
      <p className={`${METRIC_SUBLABEL} line-clamp-2 min-h-[2.4em] leading-[1.2]`}>{context}</p>
    </article>
  );
}

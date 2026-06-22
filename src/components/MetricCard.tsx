// <MetricCard> + <MetricGrid> (Phase 9 · Step 3.6 — Gap F).
//
// The dashboard metric unit, skinned to B+: a floating warm-white card with a
// mono tabular value, an uppercase mono eyebrow label, and an optional sublabel.
// `tone="alert"` tints the "Failed / at-risk" card red. Lay them out in a
// <MetricGrid>. Distinct from HeroCount (the big list-count strip), which Gap F
// deliberately keeps separate.

import type { ReactNode } from "react";

import {
  METRIC_CARD,
  METRIC_GRID,
  METRIC_LABEL,
  METRIC_SUBLABEL,
  METRIC_VALUE,
  metricToneClass,
  type MetricTone,
} from "./metric-card-recipe";

interface MetricCardProps {
  readonly label: string;
  readonly value: number | string;
  readonly sublabel?: string;
  readonly tone?: MetricTone;
}

export function MetricCard({ label, value, sublabel, tone }: MetricCardProps) {
  const t = metricToneClass(tone);
  return (
    <article className={`${METRIC_CARD} ${t.card}`}>
      <p className={METRIC_LABEL}>{label}</p>
      <p className={`${METRIC_VALUE} ${t.value}`}>{value}</p>
      {sublabel ? <p className={METRIC_SUBLABEL}>{sublabel}</p> : null}
    </article>
  );
}

export function MetricGrid({ children }: { readonly children: ReactNode }) {
  return <div className={METRIC_GRID}>{children}</div>;
}

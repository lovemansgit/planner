// Day-22n PR-C-B — MetricCard primitive (server component).
//
// One of five renderings in the /calendar header per brief §3.3.4:
// Active consignees, Today's deliveries, Delivered (today), Out for
// delivery, Failed/at-risk. Default-tone cards render with the paper
// surface + hairline stone border + navy hero numeral. `tone="risk"`
// (reserved for the failedAtRisk card per reviewer Q2 ruling) applies
// a subtle red-tinted backdrop + red numeral to draw attention.
//
// Eyebrow / hero / context typography mirrors the brand-canon
// pattern established in consignees-detail headers (sentence-case
// label rendered uppercase via CSS, font-display hero numeral with
// tabular-nums, secondary-text context line). No shadows; hairline
// 1px stone-200 border; 120ms ease-out hover preserved for future
// click-through composability (not wired tonight).
//
// Pure-logic extraction: `getMetricCardToneClasses(tone)` exposed
// for spec coverage per the codebase's no-render-test convention
// (memory/followup_client_component_test_infra.md).

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

const TONE_CLASSES: Readonly<Record<MetricCardTone, MetricCardToneClasses>> = {
  default: {
    card: "border-stone-200 bg-surface-primary",
    numeral: "text-navy",
  },
  risk: {
    card: "border-red/30 bg-red/[0.04]",
    numeral: "text-red",
  },
};

export function getMetricCardToneClasses(
  tone: MetricCardTone | undefined,
): MetricCardToneClasses {
  return TONE_CLASSES[tone ?? "default"];
}

export function MetricCard({ label, value, context, tone }: MetricCardProps) {
  const classes = getMetricCardToneClasses(tone);
  return (
    <article
      className={`flex flex-col gap-2 rounded-sm border px-4 py-3 transition-colors duration-[120ms] ease-out ${classes.card}`}
    >
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
        {label}
      </p>
      <p
        className={`font-display text-4xl font-semibold tabular-nums leading-none ${classes.numeral}`}
      >
        {value}
      </p>
      {context ? (
        <p className="text-xs text-[color:var(--color-text-secondary)]">
          {context}
        </p>
      ) : null}
    </article>
  );
}

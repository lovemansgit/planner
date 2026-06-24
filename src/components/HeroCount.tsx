// Day-53 Tier-2 #5 — shared hero-count card. Phase 12 · Batch H reskin.
//
// The canonical "big number" treatment used across operator list pages.
// Reskinned onto the approved B+ metric language (see
// `src/components/metric-card-recipe.ts` / the Operations-overview cards):
// a floating warm-white card (`--color-b-card` + `shadow-b-card`, hairline
// ring) carrying a sentence-case label over a MONO tabular figure. This
// replaces the old grey navy-tinted ruled band, which read as pre-B+
// branding and left a dead gap between a far-left numeral and a far-right
// eyebrow. Label sits over the numeral (label → value, left-aligned) so
// the two read as one unit; the optional trailing control (e.g. the
// page-size dropdown on /tasks) stays on the right.
//
// One shared component → all five consumers (subscriptions, consignees,
// tasks, failed-pushes, failed-pushes/resolved) adopt the new treatment at
// once; the per-page recipe can't drift (audit finding H1 / 4b). The
// hero-numeral size is locked here at text-5xl — the one place to change it.

import type { ReactNode } from "react";

export function HeroCount({
  count,
  label,
  trailing,
}: {
  readonly count: number;
  readonly label: string;
  /** Optional control rendered next to the label (e.g. a page-size dropdown). */
  readonly trailing?: ReactNode;
}) {
  return (
    <section className="mb-8 flex items-center justify-between gap-6 rounded-2xl bg-[color:var(--color-b-card)] px-6 py-5 shadow-b-card ring-1 ring-[color:var(--color-border-default)]">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-[color:var(--color-text-secondary)]">{label}</p>
        <p className="font-b-mono text-5xl font-medium tabular-nums leading-none text-navy">
          {count}
        </p>
      </div>
      {trailing ? <div className="flex items-center">{trailing}</div> : null}
    </section>
  );
}

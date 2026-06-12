// Day-53 Tier-2 #5 — shared hero-count strip.
//
// The canonical "big number" treatment used across operator list pages:
// a tinted top/bottom-ruled strip with the count (font-serif, text-5xl,
// tabular-nums) on the left and an eyebrow label on the right, plus an
// optional trailing control slot (e.g. the page-size dropdown on /tasks).
//
// Extracting it makes the treatment a single source of truth so the
// per-page recipe can't drift (audit finding H1 / 4b). The hero-numeral
// size is locked here at text-5xl — the one place to change it.

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
    <section className="mb-8 flex items-baseline justify-between border-t border-b border-[color:var(--color-border-strong)] bg-[color:var(--color-tint-navy-subtle)] px-6 py-6">
      <p className="font-serif text-5xl font-light tabular-nums leading-none">{count}</p>
      <div className="flex items-center gap-6">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          {label}
        </p>
        {trailing}
      </div>
    </section>
  );
}

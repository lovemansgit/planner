// Day-53 Tier-2 H4 — RGB-channel color token guard.
//
// Finding 14 root cause: every Tailwind `colors` entry mapped to a HEX
// custom property (`var(--color-navy)` = `#252d60`), so an opacity
// modifier like `bg-navy/40` compiled to `rgb(#252d60 / 0.4)` — invalid,
// alpha silently dropped, the element rendered fully transparent. That's
// why modal backdrops, alert pills (`border-red/40 bg-red/10`), tints and
// translucent badges all rendered as bare colour across the app.
//
// H4 fix: each base colour resolves through an RGB *channel* token
// (`--color-navy-rgb: 37 45 96`) via `rgb(var(--color-navy-rgb) /
// <alpha-value>)`, so Tailwind substitutes the opacity (or 1 for solids).
//
// This guard locks the mechanism in: a future revert to a hex `var()`
// would silently re-break every opacity modifier with no visible test
// failure otherwise.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import config from "../../../tailwind.config";

// Every Tailwind base colour that must support `/NN` opacity modifiers.
// `scrim` is deliberately excluded — it is an intentionally alpha-baked
// rgba token (the Tier-1 surgical backdrop fix), not a base colour.
const CHANNEL_COLORS = [
  "navy",
  "green",
  "surface-primary",
  "surface-secondary",
  "amber",
  "red",
  "ocean-blue",
  "amber-100",
  "amber-300",
  "amber-600",
  "amber-deep",
  "paper",
  "ivory",
  "stone-200",
  "stone-600",
  "ink",
];

const colors = ((config.theme?.extend?.colors ?? {}) as Record<string, string>);

const brandTokensCss = readFileSync(
  path.resolve(__dirname, "../brand-tokens.css"),
  "utf8",
);

describe("H4 — RGB-channel color tokens", () => {
  it.each(CHANNEL_COLORS)(
    "maps `%s` through rgb(var(--color-*-rgb) / <alpha-value>) so opacity renders",
    (name) => {
      expect(colors[name]).toBe(`rgb(var(--color-${name}-rgb) / <alpha-value>)`);
    },
  );

  it.each(CHANNEL_COLORS)(
    "defines an integer-triplet --color-%s-rgb channel token",
    (name) => {
      const re = new RegExp(
        `--color-${name}-rgb:\\s*\\d{1,3}\\s+\\d{1,3}\\s+\\d{1,3}\\s*;`,
      );
      expect(brandTokensCss).toMatch(re);
    },
  );

  it("keeps scrim as an alpha-baked token (not channel-remapped)", () => {
    expect(colors["scrim"]).toBe("var(--color-scrim)");
  });
});

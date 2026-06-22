# Day-57 EOD — Phase 9 design-system: proposal locked + Foundations merged

State of the design-system lane at end of Day-57. Two PRs landed on `main`; the
adoption work is parked awaiting Love's word.

## Locked: D1–D4 token contract (#558 merged)
The Phase 9 Step 2 **design-system proposal merged** (#558). Its four token
decisions are now the **LOCKED contract** for all of Step 3 (Love: "follow the
designer's recommendations"):

- **D1** — Green primary (`#3e7c4b`); navy secondary.
- **D2** — Sentence-case for human-facing text; UPPERCASE only on tiny eyebrows.
- **D3** — Two-column detail fill inside one shared max-width.
- **D4** — Adopt the humanise layer; canonical entity noun = **"consignee"**
  (retire "subscriber" / "merchant subscriber").

The contract lives in the merged #558 proposal doc:
`memory/plans/day-57-phase9-step2-design-system.md` (+ the three static mockups
under `memory/plans/day-57-phase9-step2-mockups/`).

## Merged: Step 3.1 Foundations (#560)
**Step 3.1 Foundations — MERGED at `aaed7aef4c3bacf2621b44ee3c6b3945acbb1310`.**
Pure-additive (+334 / −0); **NO screen migrated** (10 new files + a one-line
re-export in `identity/index.ts`). Shipped:

- **`PageShell`** + **`DetailGrid`** (`src/components/PageShell.tsx`,
  `page-shell-recipe.ts`) — one shared content width (75rem) and the two-column
  detail grid. (Gap E / **D3**.)
- **`Text`** + typography (`src/components/Text.tsx`, `text-recipe.ts`) —
  Display/Heading/Body/Caption/Eyebrow encoding **D2** (sentence-case default;
  uppercase = Eyebrow only).
- **Humanise formatters** (Gap J / **D4**): `src/shared/humanize.ts`
  (`formatPhone`, `statusLabel`, `toTitleCase`, `CONSIGNEE` noun) and
  `src/modules/identity/role-label.ts` (`roleLabel`, reuses the ROLES catalogue
  `name`; re-exported from the identity barrel).

RED-first on the formatters; full suite green (2,418 unit tests + typecheck +
ESLint + Prettier). Not promoted to prod — code-only foundation, no visible
change yet.

## Next: Step 3.2 — Button unification (NOT STARTED)
**Awaiting Love's word.** Next in the proposal's §4 sequence, and the **first
bundle that ADOPTS the foundations onto real screens** (one green primary,
fixed button sizes + nowrap — fixes the Reset/Refresh/New-X wraps and the
green-vs-navy split). Do not start until Love says go.

## Boundaries — still holding for ALL design lanes
Carry these into every Step-3 bundle:

- Do **NOT** touch `/tasks` or `/admin/tasks` status rendering or filters — the
  fast-follow lane owns task-status (it landed #557 on main independently).
- Do **NOT** touch the genuine-tenant fence / admin overview-calendar queries
  (#555).
- Do **NOT** touch the admin-subscriptions consignee-name render (#556).
- **No migrations.**

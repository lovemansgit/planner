---
name: Brief v1.4 amendment — corporate brand palette + typography + logo guidance
description: Day-17 morning brand audit reconciliation. Brings PLANNER_PRODUCT_BRIEF.md §3.3.11 into alignment with corporate-locked brand spec already shipped in `src/styles/brand-tokens.css`. Brief was the source of staleness, not code.
type: project
---

# Brief v1.4 amendment — corporate brand palette + typography + logo guidance

**Filed:** Day 17 (7 May 2026) morning, post-PR-#163 merge.
**Tier:** T1 (brief amendment via `decision_*.md` filing per brief amendment protocol).
**Brief version bump:** v1.3 → v1.4.

---

## §1 Trigger

Day-17 morning brand audit (per Day-17 reviewer turn) surfaced two material drifts between the brief and the codebase:

1. **§3.3.11 hex values contradicted corporate-locked palette.** The brief listed `#0B1B2B` for navy, `#F5F4F0` for surface, `#D4D1C8` for borders, plus a per-status palette (`#3F6B3F` / `#3A5F8F` / `#A14040` / `#8B8780` / `#5F6A7A`). The codebase at `src/styles/brand-tokens.css` already used the corporate-correct values: `#0F2A5C` (navy), `#FAF8F4` (Snow White / surface), `#2E8B4A` (Grass Green), `#E8A33C` (Signal Amber), `#D93A2B` (Bright Red), `#1F6FA8` (Ocean Blue), with `rgba(15, 42, 92, 0.1)` as derived border tokens. The "pre-Day-14 action: brand-team confirmation against Figma/Adobe source" comment in `brand-tokens.css` lines 6-7 was the standing flag that the brief text had drifted from corporate spec; that confirmation has now happened externally and brief reconciliation is the closing action.

2. **Brief was silent on green, amber, full type system, and logo.**
   - **Green** (`#2E8B4A` Grass Green): not in brief; in codebase tokens (`--color-green`) and corporate spec.
   - **Amber** (`#E8A33C` Signal Amber + 5-step ladder): not in brief; in codebase tokens (`--color-amber`) and corporate spec as the lead accent.
   - **Type system**: brief mentioned only "Mulish + Sanchez typography (Mulish for body/UI, Sanchez or Inter for hero numerals)" — incomplete (no Manrope display face, no scale, no typesetting rules, no Arabic pair, no fallback stack). Codebase loads Mulish + Sanchez via `next/font/google` at `src/app/layout.tsx:17-29` but the third corporate face (Manrope display) is not yet loaded — implementation-side gap separately tracked.
   - **Logo**: brief was silent. Two assets exist at `public/brand/transcorp-logo-full.jpeg` (1280×1280) and `public/brand/transcorp-logo-white.png` (2500×1200; actually JPEG-encoded despite `.png` extension — implementation-side cleanup item separately tracked). Both currently un-rendered — zero references in `src/`.

---

## §2 Reconciliation

The codebase brand-tokens.css already carries the corporate-correct values; the brief has been the source of staleness since at least Day 6 (when `decision_brand_guidelines_v2.md` was filed and codebase tokens were established but the brief text was not updated).

This amendment brings the brief into alignment with the corporate spec the codebase already implements. Direction of authority: where brief and codebase tokens conflicted, codebase tokens were correct; brief is being amended to match.

The amendment is **descriptive** of the corporate-locked spec, not **prescriptive** of new design choices. Corporate brand guidelines authored the palette + type system + logo spec; the brief is the design-intent mirror that operator-experience reviewers consult; the codebase brand-tokens.css is the implementation source of truth. All three must match. Drift between them is a v1.x bug.

---

## §3 What changes

### §3.1 Brief §3.3.11 — rewritten in full

Replaces the prior 6-bullet section with a structured spec:
- **Palette (3 primary + 3 accent + 5-step amber ladder + 5 neutrals)** with named tokens and intended use per token.
- **Composition ratio** (Snow White 58% · Navy 22% · Green 12% · Amber 8%) anchoring the typical Transcorp surface.
- **Three-face type system** (Manrope display + Mulish body + Sanchez editorial) with weights, mono discipline (Mulish caps with letter-spacing — no separate mono face), and Phase-2 Arabic pair (IBM Plex Sans Arabic + Amiri).
- **8-token type scale** (Display XL / L / M / S + Body L / M + Caption + Eyebrow) with size/line/weight/tracking per token.
- **Typesetting rules** (minimums, line-length, line-height, tracking, numerals, italics discipline, no-substitution rule).
- **Web font fallback stack** for all five faces.
- **Logo asset reference** — primary lockup spec, placement rule, minimum clear space, prohibitions, file paths.
- **Reference** preserved: `transcorp-lofi-v2.vercel.app` for spacing + hairline-border discipline + editorial cadence.
- **State-semantic color usage** for the six CRM states, replacing the prior generic per-status palette and aligning with the CRM state UI plan PR #163's §3.1 visual treatments.

### §3.2 Brief front matter

- `Version:` bumped from `v1.3` to `v1.4`.
- `Filed:` line appended with `; v1.4 amendment filed Day 17 (7 May 2026) morning.`

### §3.3 Brief §9 amendment log

New v1.4 row added with the full amendment summary.

### §3.4 No other brief sections change

- **§4 Phase 2 deferral table** — unchanged. Arabic / i18n UI toggle was already deferred there; the v1.4 Arabic pair guidance is forward-looking design intent for when i18n ships.
- **§6 Day-by-day plan** — unchanged. Day 18 brand-pass scope is now better-specified by the v1.4 §3.3.11 detail but the day-by-day work envelope is the same.

---

## §4 What does NOT change

- **Service contracts.** All Day-13/Day-14/Day-16 service-layer surfaces (subscription exceptions, lifecycle, CRM state, merchant management, addresses) untouched. PR #160 service code is canonical.
- **Audit registrations.** All 9 audit events at `src/modules/audit/event-types.ts` untouched.
- **Permissions catalogue.** All 10 part-2 permissions at `src/modules/identity/permissions.ts` untouched.
- **RBAC enforcement layers.** The three-layer middleware → service → RLS pattern per brief §3.4 untouched.
- **Day-17 substantive scope.** CRM state UI plan PR #163 (`ed61f35`) is the canonical Day-17 #1 plan; address change workflows + per-task timeline + consignee timeline are downstream Day-17 substantives unaffected by this brief amendment.
- **Demo posture.** May 12 demo + 5.1 narrative arc + 5.4 Q&A rehearsal untouched.
- **Phase 2 deferrals (§4 table).** Unchanged.
- **`src/styles/brand-tokens.css`** — already carries corporate-correct values; no code change in this PR. The "pre-Day-14 action" comment at lines 6-7 should be retired in a follow-up implementation-side cleanup PR (separately tracked, not in this T1 amendment scope).

---

## §5 Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` (this amendment lands here; v1.3 → v1.4)
- `memory/decision_brand_guidelines_v2.md` — Day-6 brand-tokens-v2 filing (predecessor decision; v1.4 amendment closes its "pre-Day-14 brand-team confirmation" loop at the brief layer)
- `src/styles/brand-tokens.css` — implementation source of truth; already corporate-aligned (the codebase has been ahead of the brief since Day 6)
- `src/app/layout.tsx:17-29` — `next/font/google` registers Mulish + Sanchez today; Manrope display face is the implementation-side gap
- `tailwind.config.ts:7-19` — Tailwind theme extension consumes the brand-tokens.css custom properties via `var(--color-*)` indirection
- `public/brand/transcorp-logo-full.jpeg` — 1280×1280 primary lockup (currently un-rendered; logo introduction is implementation-side)
- `public/brand/transcorp-logo-white.png` — 2500×1200 white variant (extension/content mismatch — actually JPEG)
- `memory/plans/day-17-crm-state-ui.md` (merged PR #163 `ed61f35`) — CRM state UI plan §3.1 visual treatments will reference v1.4 §3.3.11 state-semantic color section after this amendment lands

## §6 Follow-up items (separate PRs; not in this T1 amendment)

1. **T1 #2 — logo asset cleanup.** Rename `transcorp-logo-white.png` to `.jpeg` (or re-export as actual PNG with transparency), and add primary-lockup app-shell rendering at top-left.
2. **T1 #3 — Manrope display face load.** Add `Manrope` to `next/font/google` imports at `src/app/layout.tsx`; register `--font-manrope` CSS variable; extend `brand-tokens.css` with `--font-display: var(--font-manrope), ...` mapping; update `tailwind.config.ts` `fontFamily.display` token.
3. **T1 #4 — CRM plan §3 visual treatment amendment.** Update `memory/plans/day-17-crm-state-ui.md` §3.1 + §3.2 visual treatments to cite the v1.4 §3.3.11 state-semantic color section directly (currently references brief §8.5 + §3.3.2 generically). Plan-sync bundle candidate.
4. **Implementation-side cleanup** — retire the "pre-Day-14 action: brand-team confirmation" stale comment at `src/styles/brand-tokens.css:6-7`.

All four are tracked here for the Day-17 / Day-18 sequence; not in scope for this brief amendment PR.

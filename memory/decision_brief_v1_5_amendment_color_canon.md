---
name: Brief v1.5 amendment — color hex reconciliation to corporate SVG asset
description: Day-17 PR #168 visual refinement surfaced that the corporate SVG vector logo (transcorp-logo-color.svg) uses fill values #252d60 (navy) and #3e7c4b (green) — different from brief v1.4 §3.3.11 hex values (#0F2A5C navy, #2E8B4A green). Reviewer + Love decision: SVG is the corporate source of truth; brief amends to match the asset, and CSS variable values follow.
type: project
---

# Brief v1.5 amendment — color hex reconciliation to corporate SVG asset

**Filed:** Day 17 (7 May 2026), morning, post-PR-#168 visual refinement amendment.
**Tier:** T1 (memory + token-value updates only — no logic, no schema, no behavior change).
**Brief version bump:** v1.4 → v1.5.

---

## §1 Trigger

Day-17 PR #168 visual refinement (logo 64×64 + green go-signal accents on active nav tab + active filter chip) increased the rendered surface area of the green primary token. Side-by-side with the corporate SVG vector logo, the codebase green (`#2E8B4A`) read as a noticeably warmer / brighter shade than the SVG mark's accent fill (`#3e7c4b`).

The same audit on the navy primary surfaced a parallel drift: brief v1.4 documented `#0F2A5C` (codebase token + brief text aligned at v1.4); the corporate SVG mark uses `#252d60` (cooler, very slightly more saturated).

The corporate SVG (`transcorp-logo-color.svg`, 657.8×227.2 viewBox aspect ratio 2.895:1) was supplied by the brand team as the authoritative vector source for the rendered logo + wordmark lockup. Its fill values are the corporate canon; the brief and CSS tokens carry derived values that must match.

## §2 Reconciliation

Direction of authority: **SVG is corporate source of truth; brief amends to match the asset; CSS variables in `src/styles/brand-tokens.css` update to keep the rendered system color-coherent with the logo asset.**

This amendment is **descriptive** of the corporate-locked spec (closed-loop after the new asset arrived), not **prescriptive** of new design choices. Same posture as the v1.4 amendment that reconciled with corporate (April 2026) brand spec: brief follows asset, asset follows brand-team source.

The codebase tokens at `src/styles/brand-tokens.css` were aligned with brief v1.4 hex values; they now align with brief v1.5 hex values. Tailwind `var(--color-navy)` + `var(--color-green)` indirection means consumer surfaces re-render automatically — no per-component changes needed.

## §3 Affected tokens

| Token | v1.4 (deprecated) | v1.5 (corporate-asset canon) | Source |
|---|---|---|---|
| Night Sky Navy | `#0F2A5C` | `#252d60` | SVG `<path fill="#252d60">` |
| Grass Green | `#3E7C4B` derived from SVG previously / `#2E8B4A` per brief v1.4 | `#3e7c4b` | SVG `<path fill="#3e7c4b">` |

All other v1.4 §3.3.11 entries unchanged:
- Snow White `#FAF8F4` — primary palette, unchanged
- Signal Amber `#E8A33C` — accent, unchanged
- Bright Red `#D93A2B` — accent, unchanged
- Ocean Blue `#1F6FA8` — accent, unchanged
- 5-step Signal Amber ladder (`#FBE4BD` / `#F1BF6B` / Signal Amber / `#C98726` / `#8E5A14`) — unchanged
- Neutrals (Paper / Ivory / Stone 200 / Stone 600 / Ink) — unchanged
- Composition ratio 58/22/12/8 — unchanged
- Type system (Manrope display + Mulish body + Sanchez editorial + Mulish-caps mono discipline) — unchanged

## §4 Propagation surface

The shipped indirection (Tailwind utility → CSS variable → hex value) means a single value change in `brand-tokens.css` propagates everywhere automatically. Consumer surfaces affected without code change:

- `bg-navy` / `text-navy` / `border-navy` / `bg-green` / `text-green` / `border-green` Tailwind utilities — every existing consumer
- `var(--color-navy)` / `var(--color-green)` direct-reference styles in component files — every existing consumer
- Derived tokens `--color-border-default` / `--color-border-strong` / `--color-text-primary` / `--color-text-secondary` / `--color-text-tertiary` — these were defined as `rgba(15, 42, 92, ...)` literals in v1.4 (using the v1.4 navy hex as RGB constituents). Update to `rgba(37, 45, 96, ...)` to track the new navy. This is the only cascade beyond the two primary tokens.

PR #168's rendered surfaces (logo lockup, active nav tab, active filter chip, user-menu signature hairline) — all reference `border-green` / `var(--color-green)` indirectly. Token update lands → those surfaces immediately render at the corrected SVG-canon hex.

## §5 What does NOT change

- Service contracts, audit registrations, permissions catalogue, RBAC enforcement layers — all unchanged.
- Day-17 substantive scope (CRM state UI, address change, timelines, app-shell PR #168) — unchanged.
- Demo posture (May 12), §5.1 narrative arc, §5.4 Q&A rehearsal — unchanged.
- Phase 2 deferral table (§4) — unchanged.
- Brief v1.4 type system, composition ratio, logo asset reference (path, dimensions, placement rule), state-semantic color usage section — all preserved structurally.

## §6 Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` v1.4 § 3.3.11 (this amendment lands here; v1.4 → v1.5)
- `memory/decision_brief_v1_4_amendment_brand_tokens.md` — predecessor amendment that introduced the v1.4 palette + type system structure
- `src/styles/brand-tokens.css` — implementation source of truth; updated in this PR alongside the brief
- `tailwind.config.ts` — Tailwind theme extension consumes the brand-tokens.css custom properties via `var(--color-*)` indirection; no edit needed
- PR #168 — Day-17 T2 #1 app-shell brand pass that surfaced the SVG-vs-brief drift via increased rendered green surface area
- `public/brand/transcorp-logo.png` — the rasterized 3840×3840 RGBA master that was committed in PR #165; Day-18 brand pass may follow up to commit the corporate SVG vector source as a sibling asset for production rendering at arbitrary sizes

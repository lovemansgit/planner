---
name: Frontend style audit — prototype-vs-production gap surfaced Day-17 smoke; Day-18 PM brand pass scope
description: Day-17 production smoke (Love) surfaced "prototype looks more modern than what we built." Brief v1.5 brand canon shipped via PR #168 app-shell + UserMenu, but per-page surfaces (consignee detail, tasks page, popover, list views) have not been brand-passed. Day-18 PM brand pass scope includes audit + migration of remaining hardcoded styles to brand tokens. Audit may also surface design-language gap between prototype "modern" feel and current Transcorp brand canon.
type: project
---

# Frontend style audit — Day-18 PM brand pass scope

## §1 Surfaced

Day-17 production smoke (Love): "I quite like the front-end style of the prototype — more than what we have built — it looks more modern — the icons, the layout, the style — but it should be in our brand colors and guidelines."

Reference prototype: `subplanner.vercel.app/consignee/c_001` (Love's pre-sprint conceptual prototype, predates brief v1.5 brand canon).

## §2 Two diagnostic possibilities

### §2.1 Per-page brand-pass implementation gap (likely)

PR #168 shipped app-shell + UserMenu brand pass. Per brief §6 Day-18 PM plan: per-page surfaces (consignees list page hardcoded hex `#0B1F3A` `#FAF7F2` migration to brand-tokens) explicitly deferred. Production currently has app-shell branded but:

- Consignees list page — confirm hex hardcodes, migrate to `var(--brand-*)` tokens
- Tasks page — same audit
- Consignee detail page (#174 scaffolding) — confirm token usage
- Calendar Week view (#177) — confirm token usage
- DayActionPopover (#177) — confirm token usage
- CrmStateModal (#174) — confirm token usage

**Action:** full per-page audit Day-18 PM. List every hardcoded hex / off-token color / off-token font in `src/app/(app)/`. Migrate to CSS variables.

### §2.2 Design-language gap (possible)

If §2.1 audit + migration completes and Love still feels "prototype looks more modern than production," then there's a deeper design-language gap. Prototype may use:

- Different icon library / icon style (lucide-react vs custom SVG glyphs)
- Different spacing rhythm (looser whitespace, larger type scale)
- Different layout density (more cards, more visual hierarchy)
- Different chrome treatment (rounded corners, shadows, hover states)

These are NOT covered by brand canon (which specifies colors + fonts + 0.5px borders + sentence case). Brand canon is necessary but not sufficient for "modern" aesthetic.

If §2.2 surfaces, decision needed: Day-19 morning design refinement work (within brand canon) OR demo with current production aesthetic and treat prototype as future Phase 2 design refresh.

## §3 Sequencing for Day-18 PM

1. Per-page audit (~1 hr) — list every hardcoded color, off-token font, off-token spacing in `src/app/(app)/`
2. Migration to brand tokens (~1.5 hr) — replace hardcoded hex with `var()` references; preserve current layout
3. Visual diff vs prototype (~30 min) — Love walks production after migration; compare subjective "modern" feel
4. **Decision point:** if production feels modern enough → ship; if still gap → escalate §2.2 to Day-19 morning scope

## §4 Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` v1.6 §6 Day 18 plan (brand pass on per-page surfaces)
- `memory/decision_brief_v1_5_amendment_color_canon.md` (`#252d60` navy, `#3e7c4b` green canon)
- `src/styles/brand-tokens.css` (CSS variable source of truth)
- `subplanner.vercel.app/consignee/c_001` (Love's reference prototype)
- PR #168 (app-shell brand pass — what shipped)
- PR #177 (calendar Week view — pre-brand-pass per-page)
- PR #174 (consignee detail page scaffolding — pre-brand-pass per-page)

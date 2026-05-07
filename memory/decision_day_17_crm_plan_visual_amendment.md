---
name: Day-17 CRM state UI plan — visual treatment amendment (v1.0 → v1.1)
description: Amends merged Day-17 CRM state UI plan §3.1 visual treatment table to reference brief v1.4 §3.3.11 state-semantic colors directly. Replaces placeholder treatment language used at plan-draft time when brief was silent on green/amber semantic usage.
type: project
---

# Day-17 CRM state UI plan — visual treatment amendment

**Filed:** Day 17 (7 May 2026), morning, post brief v1.4 + brand-tokens + Manrope load
**Subject of amendment:** `memory/plans/day-17-crm-state-ui.md` (merged Day-17 morning via PR #163, SHA `ed61f35`)

## §1 Trigger

Plan PR #163 was drafted Day-17 morning before the brand-spec drift surfacing. The plan's §3.1 visual treatment column for CRM state badges used placeholder language ("Default styling; no row tint; default badge color") because brief §3.3.11 at plan-draft time was silent on green and amber semantic usage.

Brief v1.4 (PR #164, merged Day-17) added explicit state-semantic color usage at the end of §3.3.11. Brand tokens + Manrope load (PR #166, merged Day-17) made the canonical token names available in code.

This amendment closes the loop — the plan now references v1.4 §3.3.11 state-semantic colors directly instead of placeholder treatment language.

## §2 Reconciliation direction

Plan content is authoritative for UI flow + structure + service contract composition; brief is authoritative for visual tokens. Visual treatment in §3.1 + §3.2 should defer to brief tokens, not duplicate them.

## §3 What changes in plan

§3.1 — six-row visual treatment table replaced. New treatments map directly to v1.4 §3.3.11 state-semantic colors:

| State | Treatment per brief v1.4 §3.3.11 |
|---|---|
| ACTIVE | Grass Green (`var(--color-green)` = `#2E8B4A`) — go-signal semantics. Badge: green text on Snow White. Row: default styling. |
| ON_HOLD | Stone 600 (`var(--color-stone-600)` = `#4E4A42`) on Ivory (`var(--color-ivory)` = `#F2EEE6`). Badge: muted stone. Row: subtle ivory tint. |
| HIGH_RISK | Bright Red (`var(--color-red)` = `#D93A2B`). Badge: red text on Snow White. Row: subtle red tint at low opacity (~5%). |
| INACTIVE | Stone 600 muted. Badge + row: muted text, no row tint. |
| CHURNED | Stone 600 with strikethrough. Badge label: "Churned". Row: muted text, no row tint. |
| SUBSCRIPTION_ENDED | Stone 600 with "Ended" label. Badge: stone with terminal-state framing. Row: muted text, no row tint. |

§3.2 — modal "Current state" badge + "New state" dropdown selected option both render with the per-state token from §3.1 above.

§3.3 — History tab transition rows (badge → arrow → badge) each render in per-state tokens.

§4 — no change. Data flow unaffected by visual amendment.

## §4 What does NOT change

- Plan §1 purpose + lineage
- Plan §2 service contract reference
- Plan §3.0 detail page scaffolding (header card + tabs)
- Plan §3.1 column placement, row click behavior, permission gate
- Plan §3.2 modal structure, submit flow, error handling, server-action pattern
- Plan §3.3 history surface structure, pagination, initial-create row handling
- Plan §5 net-new service fn signature
- Plan §6 permission rendering matrix
- Plan §7 ten edge-case scenarios
- Plan §8 out-of-scope
- Plan §9 implementation PR sequencing + test coverage spec
- Plan §10 open questions (both LOCKED)

## §5 Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` v1.4 §3.3.11 — state-semantic color section (canonical source)
- `memory/plans/day-17-crm-state-ui.md` — plan being amended
- `src/styles/brand-tokens.css` — implementation source of truth for color tokens
- PR #164 — brief v1.4 amendment (merge SHA `5cb6e34`)
- PR #166 — brand tokens + Manrope (merge SHA `53ab411`)

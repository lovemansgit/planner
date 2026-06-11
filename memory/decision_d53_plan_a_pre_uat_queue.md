---
name: Plan A — entire post-UAT queue pulled PRE-UAT (Love's ruling, Day-53)
description: Love's Day-53 ruling (Plan A) to build the entire post-UAT queue BEFORE UAT, with UAT running after final assembly, three builder pairs in parallel under the scaling-rules memo. Records the verbatim ruling, the per-item gates, the firing-as-clearance amendment, and the brief-version assignments for this wave (R6 carries no bump).
type: reference
---

# Plan A — the entire post-UAT queue, pulled PRE-UAT

**Love's ruling (verbatim, 2026-06-11):**

> "Love rules the entire post-UAT queue pre-UAT (Plan A, 2026-06-11): R16 resume
> re-sync, R12 resolved-rows page, add-a-second-address (Session C lane), durable
> photo storage (direction ruled yes; monthly cost number parks with the plan),
> the five-race triage (after the mutating lanes settle), merchant secret-method
> switches (gated on the Demo Bistro proof), and the Tier-2 redesign (gated on
> Love's item-by-item ruling session). UAT runs after final assembly. Three
> builder pairs run in parallel under the scaling rules memo. Confirmed by Love."

**Headline:** the work previously deferred to *after* UAT now runs *before* it.
**UAT runs after final assembly**, not now — this supersedes the "run the
sandbox UAT now" timing in `memory/handoffs/day-53-uat-green.md` (UAT GREEN
stands as a fact; only the *when* moves). The build is structured as **three
builder pairs in parallel under the scaling-rules memo** (see "Dependencies").

## The queue items + their gates

| Item | What it is | Gate / precondition |
|---|---|---|
| **R16 resume re-sync** | On subscription resume, re-activate the paused deliveries on SuiteFleet (sibling of R2 cancel fan-out). | None new — sibling of R2. Spec: `memory/followup_r16_resume_sf_reactivation.md`. |
| **R12 resolved-rows page** | A page for resolved rows (failed-push / DLQ resolution view). | None new. |
| **add-a-second-address** | UI to give a consignee a 2nd address (the Phase-2 gap surfaced Day-53). | **Session C lane** (its own builder pair). Context: `memory/followup_no_ui_second_consignee_address.md`. |
| **durable photo storage** | Persist POD photos durably (vs the 7-day SF S3 pre-signed links that expire). | **Direction ruled YES.** The **monthly cost number PARKS with the plan** — a new recurring spend = Love-trigger #4; the $ figure needs Love's explicit conversational ruling (NOT firing-cleared). |
| **five-race triage** | Triage of the five identified race conditions. | **Runs AFTER the mutating lanes settle** (sequenced last among the build work so it triages a stable surface). |
| **merchant secret-method switches** | Per-merchant SF auth-method override (api_key vs oauth) — the override model already built+parked (#387/#388, migration 0030). | **Gated on the Demo Bistro proof** (the api_key wire-proof on the Demo Bistro merchant). Runbook: `memory/runbooks/day-54-demo-bistro-apikey-proof.md`. |
| **Tier-2 redesign** | The Tier-2 UI/UX structural recommendations from the audit. | **Gated on Love's item-by-item ruling session** — Love rules each Tier-2 item before it's built. Source: `memory/uiux_audit_day53.md` (Tier-2 split). |

> **Forward-note (Day-53 PM, append-only):** the Tier-2 ruling session above
> has happened — Love ruled all Tier-2 items build PRE-UAT except 8a proper
> (responsive-nav, post-UAT), with click-reduction flows still parking
> per-flow; H3 moves to the durable-photo-storage lane; Tier-2 UI runs in
> Session B's lane after R6. Ruling of record:
> `memory/decision_d53_tier2_pre_uat_ruling.md`. The original gate row is
> unchanged above.

## Clearance mechanic in force (Love's amendment, 2026-06-11)

> "Love's amendment, 2026-06-11: firing a dispatch prompt constitutes Love's
> clearance of the items that prompt explicitly names as cleared-by-firing.
> Explicit conversational rulings remain required for: live DB changes and
> production SQL (named authorization), new spend, and genuine open decisions
> the reviewer surfaces as questions. Confirmed by Love."

Folded into the orchestration runbook's clearance section — **PR #400** (parked
`parked-t3`; `scripts/orchestration/RUNBOOK.md` is off the path-gate allowlist,
so it cannot auto-merge and clears on Love's next dispatch firing that names it).

**Consequences for Plan A's gates:** three items carry clears that the
firing-mechanic does NOT cover and that still need an explicit conversational
ruling — (1) durable-photo-storage **monthly cost** (new spend), (2) any **live
DB / production SQL** the lanes need (named authorization, per Love-trigger #1),
and (3) **Tier-2 items** (Love's per-item ruling session).

## Brief-version assignments — this wave

- **R6 carries no bump.** (Love's instruction, this wave: R6's work does not
  bump the product-brief version.)
- Other items: brief bumps assigned per-item as they land, per the existing
  append-only amendment-log discipline (`memory/feedback_brief_amendment_log_append_only`).

## Dependencies / open references

- **Scaling-rules memo** — Love's ruling references "three builder pairs run in
  parallel under the scaling rules memo." Filed at
  `memory/decision_d53_three_pair_scaling.md` (landed on main via the parallel
  lane); the three-pair parallel orchestration runs under it.

## Cross-references

- `memory/handoffs/day-53-uat-green.md` — UAT GREEN (timing now: UAT after final assembly, per this ruling).
- `memory/followup_r16_resume_sf_reactivation.md` — R16.
- `memory/followup_no_ui_second_consignee_address.md` — the second-address gap (Session C lane).
- `memory/uiux_audit_day53.md` — the Tier-2 redesign source list.
- `memory/runbooks/day-54-demo-bistro-apikey-proof.md` — the Demo Bistro proof gating the secret-method switches.
- `scripts/orchestration/RUNBOOK.md` (via PR #400) — the firing-as-clearance amendment.
- `memory/decision_d53_three_pair_scaling.md` — the scaling-rules memo (three builder pairs in parallel).

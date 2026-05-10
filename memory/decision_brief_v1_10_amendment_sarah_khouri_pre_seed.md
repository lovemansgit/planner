---
name: Brief v1.10 amendment — Sarah Khouri demo-persona pre-seed reconciliation
description: Resolves §5.1/§5.2/§5.3 internal inconsistency on whether Sarah Khouri's HIGH_RISK CRM state is pre-seeded at demo start or live-flipped during the demo flow. §5.1 live-flip narrative wins; §5.2 + §5.3 Gate 8 amended to match.
type: project
---

# Brief v1.10 amendment — Sarah Khouri demo-persona pre-seed reconciliation

**Filed:** Day 21 (10 May 2026), evening, post Session B Day-21 PR-A2 (#230) data-check overnight prep work
**Decided by:** Reviewer Block 2 ruling on Session A's overnight LANE 3 finding
**Source:** §5.1 demo narrative arc + Session B's empirical Sarah-state capture during PR-A2 review
**Brief version:** v1.9 → v1.10

---

## §1 The contradiction

Three brief sections disagreed on Sarah Khouri's CRM state at demo start:

### §1.1 §5.1 demo narrative arc (Step 5) — implies LIVE-FLIP

> "Click `/calendar` → shows all consignees' deliveries today across Demo Bistro → metric cards (Active / Today's deliveries / Delivered / Failed) → filter to High Risk consignees → Sarah Khouri appears (red row) → drill into Sarah → consignee timeline shows pattern of failed deliveries → click Change CRM state → mark High Risk."

The phrase "**click Change CRM state → mark High Risk**" is the live-demo step that flips Sarah from her pre-demo state to HIGH_RISK on stage. For this narrative to play correctly, Sarah must NOT already be HIGH_RISK at demo start — otherwise the "filter to High Risk → Sarah appears" line is satisfied by pre-seed state and the narrated flip becomes a no-op. The "click Change CRM state" beat lands flat.

### §1.2 §5.2 demo data state — implies PRE-SEED HIGH_RISK

Pre-amendment text (v1.9):

> "Sarah Khouri pre-configured with High Risk CRM state and history of failed deliveries"

This implied the live demo would show Sarah ALREADY at HIGH_RISK from the moment the operator opens the consignee list, with no in-demo flip needed.

### §1.3 §5.3 Gate 8 — implies PRE-SEED HIGH_RISK

Pre-amendment text (v1.9):

> "Sarah Khouri has CRM state=HIGH_RISK with ≥2 failed deliveries in history"

Demo-preflight Gate 8 enforced this state pre-demo. If §5.1 was the intended narrative (live-flip), Gate 8 would block the demo by failing on a state that's deliberately ACTIVE-with-failures.

---

## §2 Empirical capture — Day-21 evening

Session A's overnight LANE 3 data check (after Session B's PR-A2 work for the day landed) queried the Sarah Khouri row directly:

```
=== Sarah Khouri identity ===
[
  {
    "id": "e6f6c33a-75e0-417c-a040-60cc3c40bd20",
    "name": "Sarah Khouri",
    "crm_state": "ACTIVE",
    "tenant_id": "4d53221c-7681-406b-8e46-224cd75a5c5b"
  }
]

=== task counts by status (all-time) ===
  FAILED         3

=== sample of recent FAILED tasks ===
  2026-05-07 MPL-DEMO-FAIL-003
  2026-05-05 MPL-DEMO-FAIL-002
  2026-05-02 MPL-DEMO-FAIL-001
```

Empirical state at Day 21 evening:
- `crm_state = 'ACTIVE'` (NOT HIGH_RISK)
- 3 FAILED tasks across May 2 / 5 / 7 2026
- Demo-prefixed customer_order_numbers (`MPL-DEMO-FAIL-001/002/003`) — already pre-seeded as a demo persona
- Zero DELIVERED / SKIPPED / other states

The on-disk state matches the **§5.1 live-flip** narrative cleanly: pre-seeded ACTIVE with ≥2 FAILED deliveries, ready for the live HIGH_RISK transition step. It does NOT match the §5.2/§5.3 pre-seed assumption.

---

## §3 Decision — §5.1 live-flip wins

The demo narrative is the source of demo intent; §5.2 and §5.3 are derivative invariants that ought to align with the narrative. Where the three contradict, §5.1 is canonical.

Three reasons:

1. **Demo storytelling weight** — the live HIGH_RISK transition is a teaching moment ("Operations Manager identified a problem subscriber and reclassified them; the system audit-logs the transition with reason"). Pre-seeding HIGH_RISK skips that entire beat.

2. **CAIO panel signal** — for a "we built this in 14 days" pitch, demonstrating an in-demo state transition (not just static rendering) is materially more compelling. The transition exercises permission gating, audit emit, and the CRM-events table all in one click.

3. **Empirical alignment** — the current sandbox state already matches the §5.1 reading (ACTIVE + 3 FAILED). No data changes are required to honor §5.1; §5.2/§5.3 are the outliers that need the language fix.

---

## §4 Amendments

### §4.1 §5.2 demo data state

Replace:

> Sarah Khouri pre-configured with High Risk CRM state and history of failed deliveries

With:

> Sarah Khouri pre-configured with ACTIVE CRM state and ≥2 FAILED deliveries to enable HIGH_RISK transition during demo

### §4.2 §5.3 Gate 8

Replace:

> Sarah Khouri has CRM state=HIGH_RISK with ≥2 failed deliveries in history

With:

> Sarah Khouri has ≥2 FAILED deliveries in history; CRM state=ACTIVE pre-demo

`scripts/demo-preflight.mjs` Gate 8 implementation (`gate8SarahHighRiskFailedDeliveries`) needs an inversion of its `crm_state === "HIGH_RISK"` check — that's a Day-22+ trivial follow-up patch landing alongside the Day-22 morning Vercel promote runbook. Not blocking the v1.10 brief filing.

### §4.3 §5.1 demo narrative arc

UNCHANGED — the canonical reading.

### §4.4 §9 amendment log

New v1.10 row added:

> v1.10 | 10 May 2026 (Day 21, evening, post Session B Day-21 data-check) | **Sarah Khouri demo-persona pre-seed reconciliation.** §5.1 Step 5 narrative ("drill into Sarah → consignee timeline shows pattern of failed deliveries → click Change CRM state → mark High Risk") implies a **live-flip during the demo**. §5.2 (pre-seeded HIGH_RISK) and §5.3 Gate 8 (HIGH_RISK + ≥2 failures) implied a **pre-seed HIGH_RISK** state. Internal contradiction surfaced during Day-21 overnight prep when Session A's data-check found Sarah at `crm_state=ACTIVE` with 3 FAILED deliveries (May 2/5/7 2026) — empirical state matches the §5.1 live-flip narrative, NOT the §5.2/§5.3 pre-seed assumption. **Resolution: §5.1 wins.** §5.2 amended to "Sarah Khouri pre-configured with ACTIVE CRM state and ≥2 FAILED deliveries to enable HIGH_RISK transition during demo." §5.3 Gate 8 amended to "Sarah Khouri has ≥2 FAILED deliveries in history; CRM state=ACTIVE pre-demo." No data changes required — current sandbox state already matches the new pre-demo invariant. Filed at `memory/decision_brief_v1_10_amendment_sarah_khouri_pre_seed.md`.

### §4.5 Version bump

`v1.9 → v1.10` in the brief header + footer.

---

## §5 Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §5.1 (canonical) + §5.2 (amended) + §5.3 (Gate 8 amended) + §9 (amendment log row)
- Session B PR-A2 (#230) — landed during Day-21 evening; carries the calendar-detail surface that depends on Sarah's pre-demo ACTIVE state for the demo's HIGH_RISK transition step
- Session A overnight LANE 3 finding — empirical Sarah state captured at Day 21 evening; surfaced in this thread as the trigger for the v1.10 reconciliation
- `scripts/demo-preflight.mjs` `gate8SarahHighRiskFailedDeliveries` — Day-22+ follow-up to invert the `crm_state` check per the new Gate 8 wording

---

## §6 What this does NOT change

- **Fatima Al Mansouri persona** — pre-seed posture (ACTIVE, address rotation configured) is unchanged.
- **Other §5.3 gates** — only Gate 8 is amended.
- **Demo narrative arc beyond §5.1 Step 5** — Steps 1-4 + 6-8 are unchanged.
- **CRM state machine** — `consignees.crm_state` enum + transition rules + audit event registration are unchanged. The `consignee.crm_state.changed` audit event remains the load-bearing forensic record for the HIGH_RISK transition.
- **Phase 2 deferrals** — none of the Phase 2 backlog rows in §4 shift as a result of this amendment.

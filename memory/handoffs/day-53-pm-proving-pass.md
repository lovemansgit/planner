---
name: Day-53 PM — R4/R5 address-override real-wire proving pass
description: R4 (one-off) and R5 (forward) address overrides proven end-to-end on real SuiteFleet wire through the production UI on the mpl sandbox tenant. Closes the last "deaf integration" leg (task-UPDATE push, uat §5 item 4). Surfaces a UAT-readiness gap — v1 has no UI to give a consignee a second address.
type: handoff
---

# Day-53 PM — R4/R5 address-override proving pass (2026-06-11)

**Anchor:** Day-36 = 2026-05-25 → today = Day-53. Run against production
`planner-olive-sigma.vercel.app` as the UAT operator (`mpl-admin@planner.test`,
tenant Meal Plan Scheduler — sandbox OAuth, the proven path). Same evidence bar
as Day-52 §C. Both legs **PASS on real SuiteFleet wire.**

Promotion preceding the pass: #368 (R5) merged `167f940` (Phase-1 close,
R1–R5); production promoted via #375 `e1b18ea`; smoke `/`→307, `/login`→200;
demo-preflight 10/10 (SF auth 200 in 495ms).

## Subject set-up (intentional, authorized proving-pass write)

The override needs a consignee with **≥2 addresses AND materialized pushed
tasks**. No such consignee existed:
- **Roudy M** (Day-52 subject) has pushed tasks but only **one** address.
- **Fatima Al Mansouri** (`efa97a08-4bd9-4fa3-8608-6cfb336b6ad8`) has **two**
  seeded addresses (home · Villa 12 Jumeirah / office · Bay Square Tower 5,
  Business Bay) but **zero** materialized tasks.

So I created a probe subscription for Fatima **through the production UI**
(New subscription → Mon–Fri, 16:00–18:00, start 2026-06-11, plan "UAT R4/R5
address-override probe (Day-53)"). `createSubscription` materialises the
horizon synchronously + enqueues the SF push post-commit — yielding **16 tasks
(2026-06-11 … 2026-07-02), all pushed to SF with AWBs**. The two addresses then
appear in the Change-address panel (home = default/primary; office = override
target). This is the lever the dispatch anticipated ("fresh AWBs as needed") —
see the **finding** below for why it was necessary.

## R4 — one-off address override ✅ PROVEN

Overrode **two** future pushed tasks home→office, one delivery each:

| Day | AWB | Audit (History tab, UTC) | SF wire (task timeline, Dubai +4) |
|---|---|---|---|
| 2026-06-18 | `MPL-46009060` | "One-off address override on 2026-06-18" — 03:55 | task timeline carries the post-override `Updated · SUITEFLEET WEBHOOK` echo |
| 2026-06-19 | `MPL-21097704` | "One-off address override on 2026-06-19" — 03:56 | Created 07:49 (SYSTEM) → Updated/Ordered 07:49 (initial push) → **Updated 07:56 · SUITEFLEET WEBHOOK** (the override echo) |

- **Badge lifecycle:** the override sets `outbound_sync_state='pending_update'`
  ("Sending to SuiteFleet" badge) then converges to `synced` on SF ack. The
  sandbox round-trip is **sub-1.5s** — faster than a screenshot-after-reload, so
  the cleared (synced, no badge) state + the **SF webhook echo** at 07:56 are the
  durable proof the badge appeared and cleared. (Day-52 noted the same: SF
  task-activities logs status changes only — the webhook echo is the proof. SF's
  task-detail GET returns 500; task-activities GET returns 200 with `CREATE` only.)

## R5 — forward address override ✅ PROVEN

Overrode **from 2026-06-25 forward**, home→office, subscription-scoped:

- **Confirm popup copy renders VERBATIM** (screenshot + DOM read):
  > "Are you sure you want to update the address for all future tasks on this subscription?"
  Buttons: "Yes, update address" / "Cancel". Matches `FORWARD_OVERRIDE_CONFIRM_COPY`.
- **Audit:** History tab "Forward address override from 2026-06-25" — 03:58 UTC.
- **Fan-out (SF wire):** affected in-horizon tasks each carry a fresh
  `Updated · 07:58 Dubai · SUITEFLEET WEBHOOK` echo —
  **day 25 (`MPL-61377363`) ✓, day 30 (`MPL-50803723`) ✓** (and 26/29/Jul-1/Jul-2
  in horizon). Every pushed task from the start date forward re-pointed + fanned
  an SF update.
- **Boundary correct:** **day 24** (`MPL-44913455`, before the 06-25 start) shows
  only its original 07:49 events — **no 07:58 echo**. The forward scope did not
  reach back. Days before the start date are untouched.

## What this closes

`uat_mvp_scope_definition.md` §5 item 4 (**Task UPDATE push** — "shape
doc-verified but no live SF update round-trip on record") is now **proven on real
wire**. With R2 (pause-cancel fan-out), R3 (note push), and skip→cancel proven
Day-52, the only remaining §5 unproven leg is **item 5 (POD ingestion post-fix)**
— Session A's POD broken-image lane.

## FINDING — no UI to give a consignee a second address (UAT-readiness)

R4/R5 are merged, promoted, and proven on the wire — **but a real operator
cannot reach them for a UI-onboarded consignee.** v1 has no surface to add a
second address to a consignee:
- `createConsigneeWithSubscription` (new-consignee form) inserts exactly **one**
  primary address — the form itself says *"Single primary address for v1. Add
  more from the consignee detail page after onboarding."*
- The consignee **edit** form has no address fields; `src/modules/addresses/service.ts`
  documents `createAddress`/`updateAddress`/`setPrimaryAddress`/`deleteAddress`
  as **NOT in v1 (Phase 2)**. The subscription page says *"Single-address MVP.
  Multi-address rotation per weekday ships in Phase 2."*
- The override panel instructs *"Add a second address from the consignee form
  first"* — but no such capability exists.

So the only multi-address consignees are **direct-seeded demo personas**, and
those ship with no materialised tasks (hence the probe-subscription bootstrap
above). **Implication for UAT/demo:** to demo R4/R5 you must pre-seed a
2-address consignee **with** a materialised+pushed subscription (or wait for the
Phase-2 add-address UI, or for addresses to arrive via SF inbound sync). Filed:
`memory/followup_no_ui_second_consignee_address.md`. Not a merge blocker; a
demo-prep / Phase-2 sequencing item for Love.

## Sandbox residue (intentional, Love-authorized, logged)

On the **meal-plan-scheduler sandbox** tenant, consignee Fatima Al Mansouri:
- 1 probe subscription (Mon–Fri 16:00–18:00, ext-ref prefix `SUB-ab11efb43dd5`),
  open-ended from 2026-06-11.
- 16 materialised tasks (2026-06-11 … 2026-07-02) **pushed to the SF sandbox**
  (AWBs `MPL-55650912`, `MPL-40595232`, `MPL-29076085`, `MPL-02794368`,
  `MPL-57636904`, `MPL-46009060`, `MPL-21097704`, `MPL-56814394`, `MPL-91222760`,
  `MPL-44913455`, `MPL-61377363`, `MPL-18478931`, `MPL-68786339`, `MPL-50803723`,
  `MPL-83276121`, `MPL-81672654`).
- Address overrides: one-off on 06-18 + 06-19; forward from 06-25. Net address
  state: 06-18, 06-19, and 06-25→07-02 point at the office address; the rest at
  home.

Cleanup (cancel the 16 SF sandbox tasks / end the probe subscription) is
available on request — left in place as low-risk sandbox data unless Love wants
it removed. New read-only proving tooling added under `scripts/`
(`uat-address-override.mjs`, `uat-create-subscription.mjs`, `uat-sf-activities.mjs`).

## Cross-references

- `memory/decision_d53_pm_uat_calls.md` — the PM rulings this pass executes under.
- `memory/handoffs/day-52-eod.md` §C — the Day-52 proving pass (same bar/pattern).
- `memory/uat_mvp_scope_definition.md` §5 — the deaf-integration list this burns down.

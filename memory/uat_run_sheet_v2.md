---
name: UAT run sheet v2 — scripted operator flows, rewritten for the Day-54 assembly build
description: Supersedes uat_run_sheet_v1.md for the first Ops UAT. Folds in the Day-54 assembly tree — assignment lock (R-A), churn hard-stop cascade with warning popup (R-E), R16 bounded + open-ended resume, pagination determinism (F-2), popover-first click reduction, component-library visuals — plus the fired SF assigned-cancel probe verdict (403 refusal branch is the expected churn-recall outcome for driver-assigned tasks).
type: reference
---

# UAT run sheet v2 — first Ops UAT (Day-54 assembly build)

**Supersedes:** `memory/uat_run_sheet_v1.md` (Day-53 EVE). Same demo data, same
order discipline; rewritten against the Day-54 assembly tree promoted to
production (#489, prod `3045982`, deployment `dpl_6S7UWVEZd8zeGcnZCqZw8aQDsqK8`).

**Verification status: UAT GREEN v2 — UNCONDITIONAL.** Every flow below is
shipped, reviewer-verified at pinned SHAs, CI-green, wire-proven where it
touches SuiteFleet (Day-52/53 proving passes + the Day-54 assigned-cancel
probe), **and live-UI walked on the promoted production tree** (Day-54 PM —
the §END contingency is satisfied; per-leg verdicts there). The
operator-session blocker was resolved by the Floor-7 login ruling (Love types
on the product's real login page; the agent captures only the session).

---

## 0. Before you start

| | |
|---|---|
| **Where** | https://planner-olive-sigma.vercel.app |
| **Sign in as** | the UAT operator account (ask Love for the credentials — not in this doc) |
| **Tenant** | Meal Plan Scheduler (`mpl-admin`) |
| **What "SuiteFleet" means here** | the live delivery system — real integration, not a mock |

### Pre-seeded people (unchanged from v1)

| Consignee | For | Notes |
|---|---|---|
| **Fatima Al Mansouri** | main demo — calendar, skip, move, pause/**resume**, note, address change | Two addresses (Home / Office); probe subscription 16:00–18:00 Mon–Fri through 2 Jul |
| **Sarah Khouri** | history / failed-delivery story | 3 failed deliveries on record (verified Day-54, consignee `e6f6c33a…`); single address |
| **Roudy M** | single-address consignee | notes/skips |
| **POD photo rows** | proof-of-delivery | `MPL-80355079`, `MPL-38610276`, `MPL-02403404`, `MPL-53512916` (May — expired-placeholder demo) |
| **`MPL-40595232`** ⭐ new | **the ASSIGNED task** — assignment-lock demo + churn-refusal expectations | Staged to a driver fleet-side 12 Jun; survived the cancel probe intact (403, no state change) |

> **Find a consignee:** top nav → **Consignees** → search → click the name.

### ⭐ NEW RULE the operator will see everywhere — the assignment lock (R-A, brief v1.25)

Once SuiteFleet assigns a **driver** to a delivery, Planner **locks that
delivery's editability**: the day-popover actions (skip, move, address change,
note edits that push) are **disabled with a plain explanation** ("locked —
driver assigned"). The cutoff rule is now **creation-only**: post-18:00 no NEW
tasks for tomorrow, but editing an existing UNASSIGNED task still works at any
hour. Script implication: **steps E–J only work on UNASSIGNED deliveries** —
if a row is locked, that's the feature, not a bug. Demo it deliberately on
`MPL-40595232` (Tasks → search the AWB → open it → everything disabled with
the explanation), then do the action steps on Fatima's future (unassigned)
deliveries.

---

## The flows

Order discipline unchanged: **A–E** read-only/additive → **F–H** reversible →
**I–K** consume state → **L** (churn hard stop) **dead last** — it ends
subscriptions for real.

### A. Onboarding view (read-only) — unchanged from v1

Consignees → Fatima → Overview: name/phone/email, Home address, **Active**
pill, Edit / New subscription / Add ad-hoc task / Change state buttons.
*(Visuals ride the shared component library now — badges/buttons/hero counts
are uniform across pages; zero behavior change.)*

### B. Calendar (read-only) — unchanged

Fatima → Calendar → Month/June 2026: "Scheduled 16:00–18:00" weekdays.
Click a delivery → the day panel shows Status, Window, Task ID + actions.

### C. History drawer (read-only) — one delta

As v1 (task timeline + account History tab; Sarah for the failed-deliveries
story). **Delta:** the timeline drawer opens from the day-popover's relocated
entry point (Day-54 drawer relocation) — same content, fewer clicks.

### D. POD photo view (read-only) — unchanged

Tasks → filter Delivered, May 2026 → `MPL-80355079` (or siblings) → POD icon →
**styled "Photo expired at the delivery vendor" placeholder** (H3) — honest,
branded, no vendor URL. **Live-render leg stays UAT-opportunistic:** first
fresh delivered-with-photo order → its POD renders the real photo AND Planner
captures a durable copy (post-Day-53 EVE wiring; 75 delivered tasks already
carry captured photos in the DB as of Day-54 preflight).

### E. Driver note (additive) — assignment-lock caveat added

As v1 (future Fatima delivery → Add note → timeline shows the SF push). Pick
an **unassigned** delivery — on a locked one the action is correctly disabled.

### F. One-off address change ⭐ — unchanged mechanics, lock caveat

As v1: future unassigned delivery on Home → Change address (this delivery
only) → Office → "Sending to SuiteFleet" marker → timeline shows
**Updated · SUITEFLEET WEBHOOK**. Reversible (pick Home again).

### G. Forward address change ⭐ — unchanged

As v1: Change address (from this delivery onwards) → Office → confirmation
popup → every future delivery re-points; spot-check 2–3 timelines for the
fan-out echo; earlier deliveries untouched.

### H. Pause / RESUME — ⭐ resume is now a first-class demo (R16)

v1 flagged "resume may not be surfaced" — **resolved**; both halves now ship:

- **Pause:** as v1 — window deliveries flip to Canceled; SF told to cancel;
  end date extends.
- **Resume (bounded sub):** resume early → the cancelled window deliveries
  **restore** and SF gets **fresh re-created tasks** (new AWBs — the old SF
  cancels are terminal by design; that's the R16 model, vendor-confirmed).
- **Resume (open-ended sub — no end date):** **same behavior** (Day-54 fix
  #470): restore + SF re-creation fires for every early manual resume. Before
  Day-54 this case silently did nothing — if Ops saw that on an earlier build,
  it's fixed.
- **Should see:** restored deliveries back as Created; timeline shows the
  re-push; the make-up arithmetic only applies where an end date exists.

### I. Skip — ⚠️ consumes a delivery — unchanged + lock caveat

As v1 (skip → make-up appended → SF cancel). Unassigned rows only.

### J. Move (skip with override) — ⚠️ consumes — unchanged + lock caveat

As v1. Last of the per-delivery actions.

### K. Subscription cancel — the SOFT stop (verify the contrast with L)

- **Do:** Fatima (or a spare subscription) → end/cancel the subscription
  normally.
- **Should see:** the subscription ends (status flip) but **already-scheduled
  pending deliveries CONTINUE** — no recall, no vendor cancels. This softness
  is **by design** (R-E §0 verification: endSubscription touches no tasks);
  the operator story is "stop renewing, honor what's booked."

### L. Churn hard stop — ⭐ NEW, dead last, consumes everything it touches (R-E, brief v1.26)

- **Do:** open a **churning consignee** (use a spare/seeded one, NOT Fatima
  unless she's done for the day) → **Change state → churn/hard-stop**.
- **Should see FIRST:** the **mandatory warning popup** (wording per Love's
  ruling) spelling out that this ends ALL subscriptions and attempts to recall
  every not-yet-delivered delivery. Confirm.
- **Then the cascade:** all the consignee's subscriptions end in one
  transaction; never-pushed deliveries cancel locally; pushed ones go to
  recall (`pending_cancel`) and flip **only on vendor confirmation** (honesty
  rule: local state never lies about vendor state).
- **The two vendor branches — set Ops expectations out loud (probe-calibrated Day-54):**
  - **Pre-assignment deliveries (Created/Ordered):** SF **accepts** the cancel
    (Q2 precedent) → rows flip Canceled on the webhook echo.
  - **Driver-assigned deliveries:** SF **REFUSES** — verbatim wire evidence
    from the Day-54 probe on `MPL-40595232`: `403 FORBIDDEN — "User not
    allowed to do such action."` → Planner keeps honest state and shows the
    **"vendor refused recall — final delivery"** flag (+ DLQ row + audit
    entry). **This is the expected branch, not an error** — the delivery is in
    a driver's hands; it will complete.
- **Why it matters:** churn is honest end-to-end — one warning, one cascade,
  and the UI never claims a cancel the vendor didn't confirm.

---

## Click-reduction deltas an operator returning from v1 will notice

1. **Popover-first actions** — common per-delivery actions complete inside
   the day popover (fewer page hops); the timeline drawer opens from the
   popover directly.
2. **Tasks page** (R6) — task list + drawer handle the AWB-search flows
   (use it to find `MPL-40595232` for the lock demo).
3. **Admin nav** — "Calendar" renamed **"Overview"**.
4. **Admin list pagination is deterministic** (F-2) — same-timestamp rows
   no longer reshuffle across pages 1/2.
5. **Uniform badges/buttons/hero counts** (component library) — cosmetic
   consistency only.

---

## Alignment vs `memory/uat_mvp_scope_definition.md` (Day-52) — drift flags

The scope doc's §5 "accepted controlled-UAT risk" list is now **stale in our
favor** — four of its races closed in the Day-53/54 waves:

| Scope-doc §5 risk | Status now |
|---|---|
| Assigned-before-cutoff dispatch race | **Closed** — R-A assignment lock (#472, v1.25) |
| Auto-pause vs bounded-pause divergence (stranded subs) | **Closed** — R-B/R-C (#438/#445) |
| Reconcile recovered-local-write failure (no-DLQ path) | **Closed** — R-D DLQ visibility (#475) |
| Consignee deactivation doesn't cascade-cancel (mp_13) | **Closed** — R-E churn cascade (#480, v1.26) |
| Webhook row lost on update rollback | **Still open** — remains accepted controlled-UAT risk |

No scope creep the other way: nothing in this sheet exercises a surface outside
the scope doc's Flow A/B definitions; the churn hard stop replaces the mp_13
gap the doc already carried. POD live-render remains the one UAT-opportunistic
sub-leg. Option-B (production-merchant) items stay out of this UAT —
unchanged.

---

## §END — gate status: **UAT GREEN v2 (declared Day-54 PM, contingency satisfied)**

- Probe verdict: **in** (refusal branch calibrated, above).
- Preflight: **10/10 on the invariants** (the demo Sarah `e6f6c33a…` is
  ACTIVE with 3 FAILED — verified directly). The gate-8 QUERY defect found
  Day-54 AM (fixture-name collision) has its fix **built, APPROVE r1, and
  parked as #493** (tenant scope + exact name + deterministic order;
  RED 9/10 → GREEN 10/10 proven on the branch run). The mechanical score
  reads 10/10 once #493 lands; the defect was never an invariant failure
  and does not gate this GREEN.
- Production: assembly promote live (`3045982`, `dpl_6S7UWVEZd8zeGcnZCqZw8aQDsqK8`),
  rollback anchor `dpl_DxCdkX1z` @ `bbefc1a`.
- **The live-UI re-walk: DONE, all legs PASS** (Day-54 PM, operator session
  via the Floor-7 login ruling — Love typed on the real login page; only the
  session state was captured):
  1. **Assignment lock** on `MPL-40595232` — popover shows the explanation
     verbatim ("Assigned to a driver — this delivery is locked. No edits or
     cancellations once assigned; notes to the driver still go through.");
     edit-family actions absent, note + timeline remain. ✓
  2. **Unassigned delivery** — full action set enabled (both address changes,
     skip ×2, pause, cancel, note, timeline). ✓ (Post-18:00 live check not
     possible at walk hour; creation-only cutoff is integration-proven.)
  3. **H3/POD** — styled "Photo expired at the delivery vendor" placeholder
     rendered through the same-origin proxy; no vendor URL, no broken glyph. ✓
  4. **Click-reduction** — popover-first actions + drawer-from-popover
     (operator), "Overview" nav label + F-2 deterministic pagination (admin:
     page 1 stable across reloads, zero page-1/page-2 overlap). ✓
  5. **R16 pause/resume** — pause 23–24 Jun → Canceled + "SF cancel pending"
     → SF acks; **Resume now** → both days restored to Scheduled with the SF
     re-creation fan-out. ✓ (Open-ended variant integration-proven #470;
     Fatima also carries an open-ended "5-day veggie box" if Ops wants it
     live at UAT.)
  6. **Churn hard stop** (spare seed consignee `MPL Customer 0032`) — the
     mandatory warning popup wording captured verbatim in §L above (hard
     stop + recall attempt + refusal branch + irreversibility), confirm
     label "Churn — stop everything"; cascade verified: subscription
     `ended`, stale local tasks CANCELED with per-task history entries,
     CRM Active→Churned with reason, `consignee.churn_cascade` audit event
     at 11:24:08Z. ✓ The live vendor-recall leg was deliberately NOT fired
     (the only recall-bearing rows are Fatima's protected UAT demo data);
     that branch is wire-calibrated by the probe + covered by
     `churn-cascade.spec.ts`, and UAT step L exercises it live.
- **Walk findings (non-blocking, filed):** the `/tasks` LIST ROW still
  renders enabled Cancel/Edit affordances on an ASSIGNED task — the popover
  (primary surface) locks correctly and the server gate rejects, so this is
  a UI-affordance inconsistency on the secondary surface; small follow-up to
  mirror the lock there.

## After the UAT — unchanged from v1

Tear down the Day-53 probe data after UAT (not mid-UAT). The
`MPL-40595232` assignment is live fleet-side — let it deliver normally (the
probe proved recall is refused anyway).

## Cross-references

- `memory/uat_run_sheet_v1.md` — superseded base.
- `memory/probe_sf_assigned_cancel_blocked.md` — the fired probe record (403).
- `memory/uat_mvp_scope_definition.md` — scope line + the drift table above.
- `memory/decision_d53_five_race_triage.md`, brief §3.1.4 v1.25/v1.26 — the
  assignment-lock + churn rulings this sheet scripts.

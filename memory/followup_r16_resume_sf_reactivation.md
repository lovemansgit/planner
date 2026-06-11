---
name: R16 — resume re-activates paused deliveries on SuiteFleet (outbound leg)
description: When a paused subscription resumes, Planner restores the schedule locally but does NOT re-activate the previously-cancelled deliveries on SuiteFleet. R16 is the outbound re-sync — the sibling of R2's pause→cancel fan-out, running in reverse. First build after the first Ops UAT, ahead of the Tier-2 UI redesign lane.
type: followup
---

# The gap

R2 (brief v1.17) made **pause** fan out SF cancels: paused in-window pushed
tasks flip to `outbound_sync_state='pending_cancel'` and are cancelled on
SuiteFleet via `enqueueBulkCancelTasks`. **Resume is not yet symmetric.** On
resume:

- **Planner side (works today):** the schedule is restored locally — the
  manual/auto resume path reconciles the safe-state half
  (`pending_cancel` → `synced`) and the calendar shows the deliveries back.
- **SuiteFleet side (missing):** deliveries that were already **cancelled on
  SuiteFleet** during the pause are **not re-activated**. SuiteFleet still holds
  them cancelled, so a driver won't be dispatched for a resumed delivery until
  the next create/push path happens to re-materialise it.

This is the known limitation called out in the UAT run sheet (step H) and the
brief v1.17 amendment ("active SF re-activation on resume is filed as the R16
follow-on").

# Fix shape (sibling of R2, in reverse)

On resume, for the deliveries that were SF-cancelled during the pause window:
- Re-push / re-activate them on SuiteFleet (re-create or un-cancel, per SF's
  supported semantics — probe whether SF exposes an un-cancel or whether a fresh
  create with the same AWB/order ref is the path).
- Mirror R2's posture: a `pending_*` outbound marker, a bulk fan-out
  (`enqueue…`), a paired audit event (e.g. `subscription.resume_reactivations_pushed`),
  and emit-then-re-throw on partial fan-out failure so the operator sees
  "restored locally; SF re-activation pending".
- Reconcile via the webhook convergence path like the other outbound legs.

Open question for the build: SuiteFleet's cancel may be terminal (no un-cancel).
If so, resume re-activation = re-create with a new AWB, and the calendar/AWB
mapping must update. Probe SF first (same discipline as R2's bulk-cancel-shape
probe).

# Sequencing

- **First build after the first Ops UAT.** Queued **ahead of** the Tier-2 UI
  redesign lane (`memory/uiux_audit_day53.md` Tier-2).
- Not UAT-blocking: the run sheet demos resume honestly with the known-limitation
  note, so UAT proceeds without it.

# Cross-references

- Brief v1.17 §9 row (R2 pause fan-out) — the pattern this mirrors.
- `memory/uat_run_sheet_v1.md` step H — the operator-facing known-limitation note.
- `memory/uiux_audit_day53.md` — the Day-53/54 lane this was filed alongside; R16 is queued ahead of that doc's Tier-2 lane.

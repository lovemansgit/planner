---
name: R16 open-ended resume gap — early resume restores NOTHING on subscriptions without an end date
description: Found live by the D54 post-promote smoke. resumeSubscription's entire restore block (incl. R16 SF re-activation) is guarded by `earlyManual && subscription.endDate !== null` — an OPEN-ENDED subscription resumed early leaves its in-window tasks stranded CANCELED locally AND cancelled at SF, with no restore, no re-push, no reactivation event. Inherited from the original #160 service layer (NOT an R16 regression); R16 nested its fan-out inside the pre-existing guard. Fix shape = split the restore out of the end-date-shrink arithmetic.
type: reference
---

# R16 open-ended resume gap

**Found:** Day-54 (2026-06-12) post-promote smoke, live on production (sandbox tenant
Meal Plan Scheduler), deployment `dpl_Cb69RScg7xF5wcUxrgAgSVBxHAkN` (= main `f4825c9`).

## The evidence (live, first smoke pass)

Subscription `ab11efb4` (open-ended at the time), paused 2026-06-15→17 with 3
PUSHED tasks. Pause behaved perfectly: 3 tasks CANCELED, SF cancel fan-out
converged (`pending_cancel`→`synced`), `subscription.pause_cancels_pushed`
emitted. **Early manual resume then restored NOTHING**:
`subscription.resumed` carried `restored_task_count: 0`, no
`subscription.resume_reactivations_pushed` was emitted, and the 3 tasks stayed
CANCELED locally + cancelled at the vendor. The materializer cannot heal them
(rows exist; `ON CONFLICT DO NOTHING`). Operator-invisible stranding.

## Root cause

`src/modules/subscriptions/service.ts` (`resumeSubscription`): the early-manual
branch is

```ts
if (earlyManual && subscription.endDate !== null) {
  // end-date shrink arithmetic …
  // markTasksRestoredInWindow(…)  ← restore + R16 reactivation BOTH live here
}
```

The `endDate !== null` guard exists for the end-date-shrink arithmetic (you
cannot shrink an end date that does not exist) — but the task RESTORE was
nested inside it, so open-ended subscriptions skip restore entirely. The guard
shape ships in PR #160 (the original lifecycle service layer) and is unchanged
since — **pre-existing gap, NOT an R16 regression**. R16 (#410) nested its
reactivation fan-out at the existing restore call site, faithfully inheriting
the hole. All R16 integration cases used end-dated subscriptions, so it never
surfaced.

## Second smoke pass (proves the shipped path + repaired the strands)

Same subscription given `end_date = 2026-07-02` via the Edit UI, then
pause(06-15→17) → resume-now: **everything worked** — end date extended
07-02→07-07 on pause and shrunk back on resume; all 3 tasks restored
CREATED/`synced` with NEW AWBs (`MPL-29076085→MPL-37048381`,
`MPL-02794368→MPL-94228287`, `MPL-57636904→MPL-78962881`);
`subscription.resumed` `restored_task_count: 3`;
`subscription.resume_reactivations_pushed` with all 3 `previous_awbs`,
`failed_chunks: 0`. The rerun also un-stranded the first pass's casualties —
no manual data repair was needed.

## Fix shape (build on a dispatch — nothing built yet)

Split the guard: end-date-shrink stays under `endDate !== null`; the
restore + R16 fan-out runs for EVERY early manual resume:

```ts
if (earlyManual) {
  if (subscription.endDate !== null) { /* shrink arithmetic */ }
  const restoredRows = await markTasksRestoredInWindow(…)
  /* reactivation fan-out as shipped */
}
```

RED case: the existing `resume-sf-reactivation.spec.ts` happy case duplicated
with `end_date = NULL`. Zero migrations. Touches only the subscriptions
service — no fence concerns.

## Cross-references

- `memory/followup_r16_resume_sf_reactivation.md` — the R16 spec this rode in on.
- `memory/plans/day-53-r16-resume-sf-reactivation.md` (#408) + code #410.
- Adjacent ruled lane: R-B windowless-resume (#434/#438) fixed the *no-window*
  resume shape; this gap is the *window-exists-but-no-end-date* shape.

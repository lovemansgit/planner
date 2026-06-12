# Day-54 — R16 open-ended resume fix (T3 plan)

**Contract:** `memory/followup_r16_open_ended_resume_gap.md` (#463) — found live by the
Day-54 post-promote smoke on deployment `dpl_Cb69RScg7xF5wcUxrgAgSVBxHAkN`.

## 1. The defect (one sentence)

Early manual resume restores in-window tasks ONLY when the subscription has an
end date — the restore call (and R16's SF re-activation fan-out riding it) is
nested inside `resumeSubscription`'s `earlyManual && subscription.endDate !== null`
branch (`src/modules/subscriptions/service.ts`, guard shape from #160), so an
OPEN-ENDED subscription resumed early leaves its window tasks CANCELED locally
and cancelled at SF with no restore, no re-push, no event, and no operator
signal. The materializer cannot heal them (`ON CONFLICT DO NOTHING`).

## 2. The fix (guard split — restore decouples from shrink arithmetic)

```ts
if (earlyManual) {
  if (subscription.endDate !== null) {
    // end-date shrink arithmetic — UNCHANGED, still end-date-gated
    // (you cannot shrink an end date that does not exist)
  }
  // restore + R16 reactivation — now runs for EVERY early manual resume
  const restoredRows = await markTasksRestoredInWindow(tx, tenantId, id,
    actualResumeDate, pauseWindow.end_date);
  …unchanged from shipped R16…
}
```

Behavioral delta is exactly one cell: open-ended × early-manual gains
restore + reactivation. End-dated behavior byte-identical (the shipped,
integration-proven and live-smoked path). Auto-resume unchanged (different
branch). R-B windowless recovery unchanged (no-pause-window branch, earlier
return). `subscription.resumed` metadata shape unchanged — `new_end_date`
stays `null` for open-ended (no extension was granted at pause time:
`pauseSubscription`'s extension is also end-date-gated, so there is nothing
to shrink — asymmetry is correct and gets a code comment).

## 3. RED first (per the memo)

`tests/integration/resume-sf-reactivation.spec.ts` — new case 7:
`seedSubscription` gains an optional `endDate: string | null = SUB_END`
parameter; case 7 seeds `end_date = NULL`, pauses (window covering one
SF-pushed task), SF-cancels it (pause path), early-manual resumes, and asserts
the FULL case-1 contract: row restored CREATED + ids cleared then re-pushed,
`subscription.resume_reactivations_pushed` emitted with the previous AWB,
`restored_task_count` 1 on `subscription.resumed`. Watched RED on current
main (expected: restored_task_count 0, no event — the live-observed shape),
then GREEN on the split.

Existing cases 1–6 must stay green untouched (they pin the end-dated path).

## 4. Scope fences (Day-54 dispatch)

- Touches: `src/modules/subscriptions/service.ts` + the one spec file. NOTHING else.
- `markTasksRestoredInWindow` is CALLED, not edited — zero `src/modules/tasks/**`
  edits (Session B's rollout fence honored).
- No push/webhook module edits (Session C fence honored).
- **Zero migrations** (state machine untouched; `'pending'` exists since 0026/0028).
  If one becomes necessary, the plan parks per the dispatch.
- No brief bump assigned; flagged at park for Love to assign if wanted
  (arguable §3.1.2-adjacent behavior fix, not a scope change).

## 5. Open questions for the reviewer

None directional — the fix shape was named in the Love-merged memo (#463).
One judgment call flagged: case 7 asserts `new_end_date: null` in the resumed
event (documents the no-extension/no-shrink asymmetry) rather than leaving it
unasserted.

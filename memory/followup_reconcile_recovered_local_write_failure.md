---
name: D8-4b reconcile-recovered local-write failure — DLQ visibility gap
description: Edge case in the AWB-exists reconcile path where getTaskByAwb succeeded (we have the recovered SF id) but the local markTaskPushed UPDATE then failed. Currently Sentry-only — no failed_pushes row, no audit event. Operators have no /admin/failed-pushes visibility for the rare-but-real case. Day 9 follow-up to add a DLQ write with a distinguishing failure_detail prefix.
type: project
---

# D8-4b reconcile-recovered local-write failure — DLQ visibility gap

**Captured:** 2 May 2026 (D8-4b PR #80 review, accept-with-note)
**Why this is durable, not ephemeral:** the gap is non-blocking for D8-4b but is a real operational gap that needs a Day 9 fix. Pinning here so the next session picks it up by name.

---

## The gap

D8-4b's reconcile branch in `src/modules/task-push/service.ts` has three sub-paths:

1. **Reconcile fully succeeds** — `getTaskByAwb` returned the SF id AND `markTaskPushed` (local UPDATE) AND `markFailedPushResolved` (idempotent) all completed. Emits `task.pushed_via_reconcile`. Increments `awbExistsReconciled`.

2. **`getTaskByAwb` itself throws** (network, auth, parse error, 404) — we never got the SF id. Records a `failed_pushes` row with `failure_detail` prefixed `awb_exists_reconcile_failed: '<awb>'; getTaskByAwb error: <message>`. Increments `awbExists`. **/admin/failed-pushes carries the row with the prefix.**

3. **`markTaskPushed` (or `markFailedPushResolved`) throws AFTER `getTaskByAwb` succeeded** — we HAVE the recovered SF id but the local DB write failed. Currently:
   - `captureException` to Sentry with `operation: 'mark_pushed_via_reconcile'`
   - Increments `awbExists`
   - **Does NOT write a `failed_pushes` row**
   - **Does NOT emit any audit event**

Operators on `/admin/failed-pushes` have no visibility on path (3). Only Sentry sees it.

---

## Why this matters

- **Tight cron-retry loop possible (rare but real):** The next cron pass sees the task unpushed → calls `createTask` → SF rejects with AWB-exists (the SF task is already there) → reconcile branch fires again → `getTaskByAwb` succeeds → `markTaskPushed` fails again (same DB issue persists). Could loop pass-after-pass until the underlying DB issue clears or operators intervene.
- **Operator can't manually resolve:** without a DLQ row, the only signal is Sentry. Operators would need to (a) read Sentry, (b) get the recovered SF id from the Sentry context, (c) run a manual `UPDATE tasks SET external_id = ..., pushed_to_external_at = now() WHERE id = ...` SQL. Three steps too many for a recoverable error.
- **Asymmetric with path (2):** path (2) writes a DLQ row with the prefixed failure_detail; path (3) doesn't. Operators should see both reconcile-failure modes the same way.

---

## Day 9 fix

Add a `recordFailedPushAttempt` call inside the `markErr` catch block in
`src/modules/task-push/service.ts` reconcile branch. Distinguishing
`failure_detail` prefix:

```
reconcile_recovered_but_mark_pushed_failed: <awb> (sf_id: <recovered-id>); error: <message>
```

This signals to the operator: "We have the SF id. The remote create
already happened. Just markResolved on this row and run a manual UPDATE
to set external_id." The recovered SF id is recorded in the
failure_detail itself for cut-and-paste recovery.

Counter posture stays the same — count as `awbExists` (loop didn't
close cleanly). The visibility gap is the issue, not the counter.

The fix is a small T2 commit (one file edit + one test). Lands
alongside other Day 9 cleanup or as a standalone follow-up before
post-pilot DLQ-retry UI work begins.

---

## Test to add

In `tests/unit/cron-push-reconciles-awb-exists.spec.ts`, the existing
`"D8-4b reconcile — markTaskPushed write failure (post-recovery)"`
describe block. Add an assertion:

```ts
expect(mockRecord).toHaveBeenCalledTimes(1);
const recordArg = mockRecord.mock.calls[0][1];
expect(recordArg.failureDetail).toMatch(
  /^reconcile_recovered_but_mark_pushed_failed: 'MPL-08187661' \(sf_id: 59254\); error:/,
);
```

The current test only asserts Sentry capture + `awbExists++` + no
audit emit. The Day 9 update flips it to also assert the DLQ row
write.

---

## Cross-references

- `src/modules/task-push/service.ts` — the `markErr` catch block (around line 596-614 at D8-4b merge, may shift)
- `tests/unit/cron-push-reconciles-awb-exists.spec.ts` — `"D8-4b reconcile — markTaskPushed write failure (post-recovery)"` describe block
- D8-4b PR #80 — accept-with-note that captured this gap

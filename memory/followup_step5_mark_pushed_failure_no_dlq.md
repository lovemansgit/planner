# Follow-up — Step-5 sibling gap: SF-success + local mark-pushed failure has no DLQ row

**Filed:** Day-54 (12 Jun 2026), Session C, per the R-D build dispatch ("file the Step-5 sibling followup") and the triage finding (`memory/triage_five_races_findings.md` §R-D, "sibling gap found").

**The gap:** in `pushSingleTask`'s NON-reconcile success path (`src/modules/task-push/service.ts` Step 5 — SF `createTask` SUCCEEDS, then the local `markTaskPushed`/`markFailedPushResolved` write fails), the catch is Sentry-only and returns `kind: "failed_to_dlq"` with `failureDetail: "mark_pushed_after_sf_success failed: …"` — but **no `recordFailedPushAttempt` call backs that name**: no DLQ row lands. The queue handler acks, so there is no QStash retry either; the next cron pass re-attempts because `pushed_to_external_at` stays NULL.

**Why it's worse than the R-D path it siblings:** here the re-attempt issues a FRESH `createTask` for a task SF already accepted — the duplicate-physical-delivery risk the code comment itself names as "worth waking ops up for." (The R-D reconcile path is safe by construction — SF answers AwbExists forever; this path has no such backstop until SF's dedup or the AWB-exists reconcile catches the second create.)

**Fix shape (same pattern as the R-D fix, merged in the same PR this memo rides):** a guarded `recordFailedPushAttempt` in the Step-5 catch with a `sf_accepted_but_mark_pushed_failed:` prefix carrying `external_id` + `tracking_number` inline, retry semantics unchanged. One unit case in `tests/unit/push-single-task.spec.ts` mirroring the R-D case.

**Why not folded into the R-D PR:** the dispatch named R-D's scope as the reconcile-path guard + "no retry-semantics change" and ordered this gap FILED, not built — the Step-5 path's interplay with the duplicate-create risk may deserve more than visibility (e.g. an idempotency-key re-create probe), which is a small product/design call. Build clears on a one-line dispatch.

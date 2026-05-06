---
name: markTaskSkipped rowsAffected=0 cannot distinguish "not materialized" from "already terminal"
description: Service A's markTaskSkipped repository call uses NOT IN ('DELIVERED', 'FAILED', 'CANCELED') in the WHERE clause; rowsAffected=0 conflates "task hasn't materialized yet" (sub-case 13a per merged plan §3.2; service-side no-op success) with "task already in terminal state" (per merged plan §8.1 line 745 ought to reject 422). Webhook race scenario: task webhooks DELIVERED at 17:59 Dubai, operator skips at 18:00 — rowsAffected=0; service silently succeeds; operator sees "skip applied" but task in fact DELIVERED. Not MVP demo load-bearing; the demo skip happens on a future-tense unmaterialized task, not a delivered one. Post-demo fix.
type: project
---

# markTaskSkipped rowsAffected=0 disambiguation

**Surfaced:** Day-16 Block 4-B Service A staging.

**Drift:** `src/modules/tasks/repository.ts:markTaskSkipped` returns `{ rowsAffected }`. Service A treats `rowsAffected === 0` as the merged plan §3.2 step 13a sub-case (task not yet materialized; cron's skip-the-date EXISTS guard handles it on next tick). But the same `rowsAffected === 0` also returns when the task IS materialized but in a terminal state (`DELIVERED`, `FAILED`, `CANCELED`) — the WHERE clause filters those out.

**Failure mode:** webhook race. Task at `target_date=2026-05-08` webhooks to DELIVERED at 17:59 Dubai. Operator opens UI at 18:00, clicks skip on that delivery. Cut-off check passes (it's exactly the cut-off boundary; `>= 18:00` may or may not reject depending on millisecond precision; let's say it doesn't). UPDATE WHERE clause excludes DELIVERED → 0 rows affected. Service treats as 13a no-op success. Operator sees skip-confirmation in UI; task is in fact already delivered. Audit log shows skip applied; operational truth shows delivery completed. Audit + operational state disagree.

**Why deferred:**

- Demo posture: skip happens on a future-tense unmaterialized task (Wednesday weeks ahead), not on a same-day already-delivered one. The race window doesn't open in demo flow.
- Fix is non-trivial: requires reading task state pre-UPDATE, branching service flow on terminal vs not-yet-materialized, mapping terminal to ConflictError 422 with operator-visible "task already delivered/failed; cannot skip" message.
- Webhook-race is an existing edge per merged plan §8.1 (the broader race-handling work is queued for post-demo).

**Fix when ready:**

1. Add `findTaskBySubscriptionAndDateAnyState(tx, tenantId, subscriptionId, deliveryDate)` to tasks repository — sibling to existing `findTaskBySubscriptionAndDate` but without the state filter.
2. In `addSubscriptionException` skip-flow step 13: SELECT task first; if state IN ('DELIVERED', 'FAILED', 'CANCELED') → throw ConflictError; if state IN ('CREATED', 'ASSIGNED', 'IN_TRANSIT', 'SKIPPED', 'ON_HOLD') → call markTaskSkipped (idempotent on already-SKIPPED); if no row → 13a no-op.
3. Test additions: 5 cells (delivered → 422, failed → 422, canceled → 422, in-transit → succeed (skip overrides), already-skipped → succeed-as-replay).
4. Audit event metadata: include the prior state when skip overrides a non-CREATED state, for forensic trail.

**Cross-references:**

- `src/modules/tasks/repository.ts:markTaskSkipped` — current implementation
- `src/modules/subscription-exceptions/service.ts` (Day-16 Block 4-B commit 946b612) — the call site
- Merged plan PR #155 §3.2 step 13 + §8.1 — the dual-semantic for rowsAffected=0
- `memory/followup_correlation_id_v7_swap.md` — same Block 3 pattern: defer with memo, post-demo fix

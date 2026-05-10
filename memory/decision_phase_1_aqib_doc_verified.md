# Decision · Phase 1 SuiteFleet outbound — doc-verified Q1-Q4, Q5/Q6 closed

**Status:** Decided. Closes the Aqib coordination lane on plan-PR §L (Phase 1 merchant-CRUD).
**Decision date:** 10 May 2026 (Day 20).
**Decided by:** Reviewer counter-session via live SuiteFleet API docs at suitefleet.readme.io.
**Source:** SuiteFleet ReadMe docs (verified 10 May 2026).

## Summary

Of the 6 open questions filed at [`followup_suitefleet_outbound_edit_cancel_aqib.md`](followup_suitefleet_outbound_edit_cancel_aqib.md) and cross-referenced in [`plans/day-19-phase-1-merchant-crud.md`](plans/day-19-phase-1-merchant-crud.md) §L:

- **Q1-Q4 ✓ verified** verbatim from SuiteFleet docs
- **Q5/Q6 ⚠️ closed** — not in docs; existing memos provide sufficient guidance; Aqib confirmation is courtesy-only

**Net consequence:** §G.1 adapter signatures UNBLOCKED. Day-21 code-PR lane no longer Aqib-gated. Aqib comm shifts from blocking-comm to courtesy-confirm.

---

## Q1 — updateTask endpoint shape ✓ verified

**Endpoint:** `PATCH /api/tasks/awb/{awb}`

- **Path param:** `awb` (string)
- **Body:** `mergePatchDocument` (RFC 7396 JSON Merge Patch)
- **Headers:** `Authorization: Bearer {access_token}` + `clientId`
- **Responses:** 200 / 204 / 401 / 403

## Q2 — cancelTask endpoint shape ✓ verified (with residual)

**Endpoint:** No separate cancel endpoint. Cancel = status-flip via the same `PATCH /api/tasks/awb/{awb}` carrying the status field in the merge-patch body.

**Residual:** Exact field name (`status: "CANCELED"` vs `internalStatus: "CANCEL"` vs other) NOT documented. **Resolution:** Day-21 sandbox empirical test (single-call probe against the `meal-plan-scheduler` tenant). Not Aqib-blocking — empirical-probe pattern is established (`scripts/probe-sf-*.mjs` precedent).

## Q3 — bulkCancelTasks endpoint shape ✓ verified (with Day-21 empirical correction)

**Endpoint:** `PATCH /api/tasks/bulk/{ids}`

- **Path param:** `ids` (string, comma-separated **numeric SF task id** list — see Day-21 empirical correction below). Original Day-20 doc-verified ruling claimed AWB strings on the basis of the Day-6 asset-tracking `?awbs=` convention; the path-param name `{ids}` was the tell, but the AWB extrapolation was not empirically verified at filing time.
- **Body:** `mergePatchDocument` (single patch applied to all listed tasks)
- **Headers:** Same as Q1 (`Authorization: Bearer` + `clientId`)
- **Async variant:** `POST /api/tasks/bulkUpdateAsync` exists for very-large jobs; not needed for v1's bulk-cancel scope (≤100 tasks per operation per plan-PR §F.4 transactional bound).

### Day-21 empirical correction (filed during code-PR LANE 1 probe)

The Day-20 doc-verified state claimed the bulk endpoint takes comma-separated AWBs. The Day-21 sandbox probe (`scripts/probe-sf-bulk-cancel-shape.mjs`, extended from the Q2 cancel-status field probe) **empirically refuted** the AWB shape:

- `PATCH /api/tasks/bulk/MPL-68604017,MPL-92760002` with `{status:"CANCELED"}` returned **500 Internal Server Error** in 184ms with body `{"method":"PATCH","message":["For input string: \"MPL-68604017\""],"status":"INTERNAL_SERVER_ERROR"}` — Java NumberFormatException-style parse error on the path-param.
- Inline retry against the same 2 stale-CREATED tasks with **numeric SF ids** (`PATCH /api/tasks/bulk/59414,59421`) returned **200 OK** in 266ms with an aggregate job-summary body: `{"id":1764,"tasksExecutedCount":2,"expectedTasksCount":2,"executionTimeInSeconds":0,"status":"COMPLETED","bulkUpdateSource":"BULK_UPDATE",...}`.
- Webhook reflection on numeric-id success: 4 events for 2 tasks (TASK_HAS_BEEN_UPDATED + TASK_STATUS_UPDATED_TO_CANCELED for each AWB), all within ~400ms of the bulk PATCH.

**Consequence on §G.1 + adapter design:**
- `bulkCancelTasks(session, sfTaskIds, correlationId)` accepts numeric SF task id strings (the `tasks.external_id` column), NOT AWBs (the `tasks.external_tracking_number` column). Service-layer callers must fetch the numeric column for bulk paths.
- Single-cancel `cancelTask(session, awb, correlationId)` continues to use AWB at the path level (the single endpoint is `/api/tasks/awb/{awb}` — different addressing convention).
- Adapter SF-side asymmetry mirrors the wire reality cleanly; caller-side AWB→numeric resolution lands with the Phase 1 merchant CRUD UI PR (Day 22+).
- Adapter validates string-numeric shape at the boundary in `SuiteFleetTaskClient.bulkCancelTasks` (regex `/^[1-9]\d*$/`); accidental AWB-string inputs throw `ValidationError` at the adapter layer rather than letting a 500 bubble out.
- Bulk response is **aggregate job-summary**, not per-task results — the adapter parses `BulkCancelResult { jobId, executedCount, expectedCount, status }` and throws `ValidationError` when `executedCount < expectedCount` (response does not say WHICH tasks failed; whole batch DLQ-routable).

**References:**
- Day-21 LANE 1 probe outcome thread (code-PR §3.6) — captures full request + response bytes for both the AWB rejection (500) and the numeric-id success (200) paths.
- `bulkCancelTasks` adapter docstring at [`src/modules/integration/last-mile-adapter.ts`](../src/modules/integration/last-mile-adapter.ts) — IMPORTANT block describing the numeric-id contract + the empirical correction.
- `SuiteFleetTaskClient.bulkCancelTasks` at [`src/modules/integration/providers/suitefleet/task-client.ts`](../src/modules/integration/providers/suitefleet/task-client.ts) — implementation with the numeric-id validator + aggregate parser.

**Consequence on §G.1 (preserved from Day-20):** `bulkCancelTasks` adapter resolves to a single bulk PATCH call, NOT parallel single-cancel fan-out. The "if SF supports bulk endpoint / if not" prose in plan §G.1 retires.

## Q4 — auth posture ✓ verified (with correction)

**Two-stage OAuth 2.0:**

1. **Authenticate:** `GET /api/auth/authenticate?username={Email}&password={Password}` → access token (24h TTL) + refresh token (6mo TTL)
2. **Refresh:** `POST /api/auth/refresh`

**Per-request headers:** `Authorization: Bearer {access_token}` + `clientId`

**Correction to the question's framing:** Outbound auth is **NOT** the same shape as inbound webhook auth (`clientid`/`clientsecret` lowercase header pair). They are different mechanisms:

- **Inbound webhook (Tier-2 verification):** lowercase `clientid` + `clientsecret` headers (see [`followup_suitefleet_webhook_policy.md`](followup_suitefleet_webhook_policy.md))
- **Outbound API:** Bearer token + camelCase `clientId` header (per ReadMe docs)

**Pattern reuse:** Existing [`src/modules/credentials/suitefleet-resolver.ts`](../src/modules/credentials/suitefleet-resolver.ts) `createTask` path already uses Bearer + `clientId` for outbound. `updateTask` + `cancelTask` + `bulkCancelTasks` reuse the same pattern. No new credential resolver work.

## Q5 — idempotency ⚠️ closed (not blocking)

Idempotency posture not in docs. Day-4 memo [`followup_createtask_idempotency.md`](followup_createtask_idempotency.md) empirically established that SuiteFleet does NOT dedupe `createTask` and IGNORES the `Idempotency-Key` header. Same assumption extended to `updateTask` + `cancelTask` + `bulk` variants.

**Mitigation already in plan-PR §G:** QStash decoupling + `correlation_id` UUID per outbound call + `outbound_push_failures` DLQ tracking. Replay safety belongs to the planner, not SF.

Aqib confirmation nice-to-have, not blocking.

## Q6 — rate limits ⚠️ closed (not blocking)

Rate limits not in docs. Already locked at **5 req/sec global per-merchant** per [`decision_daily_cutoff_and_throughput.md`](decision_daily_cutoff_and_throughput.md) (Day 3 EOD).

**Drop from Aqib question list.** Plan body §G assumes 5 req/sec for update/cancel/bulk variants — same throttle as the existing createTask path. Q6 over-hedged in the original question list.

---

## Plan-PR §G.1 + §L amendments

This memo is companion to:

1. **§G.1 patch:** Retire "parallel single-cancel fallback" prose. Replace with single bulk PATCH call resolution. Adapter signatures move from "NOT YET LOCKED" to LOCKED.
2. **§L patch:** Update Q1/Q2/Q3/Q4 status to ✓ doc-verified. Update Q5/Q6 to ⚠️ closed. Reference this memo.

Both patches land in the same PR as this memo.

---

## Day-21 carry-forward

- **One open empirical question** (Q2 residual): exact status field name in merge-patch cancel body. Single-call sandbox probe against `meal-plan-scheduler` (sandbox merchant 588). Adapter implementation can stub the field name + the sandbox probe locks it before code-PR.
- **Aqib comm posture:** courtesy-confirm only. Shift the existing followup memo at [`followup_suitefleet_outbound_edit_cancel_aqib.md`](followup_suitefleet_outbound_edit_cancel_aqib.md) from "open questions" framing to "doc-verified ledger" framing in a follow-up T1.

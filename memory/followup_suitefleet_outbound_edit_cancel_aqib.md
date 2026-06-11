---
name: SuiteFleet outbound edit + cancel — Aqib coordination questions
description: Six open questions for Aqib re SF API endpoints (update task / cancel task / bulk variants), auth posture, idempotency, and rate limits. Plan-PR §G work proceeds on best-known assumptions; adapter signatures firm up before code-PR locks.
type: reference
---

# SuiteFleet outbound edit + cancel — Aqib coordination

> **Filed:** Day 19 PM (9 May 2026)
> **Triggered by:** Phase 1 merchant operator CRUD lane plan-PR (Day-19 PM)
> **Plan-PR:** [`memory/plans/day-19-phase-1-merchant-crud.md`](plans/day-19-phase-1-merchant-crud.md) §G + §L
> **Expected turnaround:** 24-48 hr

## §1 Why Aqib

`LastMileAdapter` interface ([`src/modules/integration/last-mile-adapter.ts:44-126`](../src/modules/integration/last-mile-adapter.ts#L44-L126)) currently defines `createTask`, `getTaskByAwb`, `printLabels`, `fetchAssetTrackingByAwb`, `verifyWebhookRequest`, `parseWebhookEvents`, `mapStatusToInternal`. **No `updateTask`, no `cancelTask`, no bulk variants.**

Phase 1 merchant CRUD lane adds operator-facing edit + cancel + bulk-cancel. Each operation must push to SF outbound. SF endpoint shapes are not documented in the Planner repo; need vendor input before adapter signatures lock.

## §2 Six open questions

### Q1 — Update task endpoint

What is the SF endpoint shape for updating an existing task's `delivery_date`, `delivery_window_start/end`, and `address`?

- HTTP method (PUT vs PATCH)?
- URL pattern: `/api/tasks/{externalTaskId}` or `/api/tasks/awb/{awb}` or other?
- Request body shape: full task body (createTask shape) or partial patch (changed fields only)?
- Response shape: full updated task vs status-code only?
- Field-level constraints: which fields are immutable post-create on SF side? (We assume `customerOrderNumber` is immutable; confirm.)

### Q2 — Cancel task endpoint

What is the SF endpoint shape for canceling a task?

- Dedicated `DELETE /api/tasks/{externalTaskId}` endpoint?
- Or status-update via `PATCH /api/tasks/{externalTaskId}` with `{ status: 'CANCELED' }`?
- Or some other shape (e.g., `POST /api/tasks/{externalTaskId}/cancel`)?
- Soft cancel vs hard delete on SF side? (We assume soft cancel — task remains visible in SF dashboard with canceled status; confirm.)
- Cancel reason field — required? optional? free-text vs enum?

### Q3 — Bulk cancel endpoint (if exists)

Does SF support a bulk-cancel endpoint?

- If YES: shape (POST `/api/tasks/bulk-cancel` with `{ awbs: [...] }` array? Or comma-separated query param?)
- If YES: what's the bulk size limit? (Mirrors `/generate-label` 500-task cap probed at Day-17 PR #175?)
- If NO: confirm. We'll fall back to parallel single-cancel calls @ 5 req/sec throttle (existing convention).

### Q4 — Auth + idempotency posture

- Auth: same `Bearer <token>` header as createTask, or different?
- Idempotency: does SF support an `Idempotency-Key` header or correlation_id query param? Day-4 followup memo (`followup_createtask_idempotency.md`) noted SF ignores `Idempotency-Key` on createTask; does that apply to update + cancel too?
- If SF doesn't support idempotency: we accept single-attempt policy + DLQ on transient failures (existing posture). Confirm acceptable.

### Q5 — Rate-limit constraints

- Is the 5 req/sec throttle (from createTask Day-7 conversation) global per merchant, or per-endpoint?
- Are bulk operations counted as 1 req or N reqs?
- Burst tolerance: can we do 50 reqs in 10 sec then idle, or strict per-second cap?
- We'll respect 5 req/sec floor by default via QStash `flowControl` (per Day-14 cron-decoupling pattern). Confirm this is conservative-enough.

### Q6 — Field shape for address edit

When updating a task's address (Q1 shape), what's the SF expectation?

- New full `location` body (mirrors createTask `buildLocation` at [`task-client.ts:202`](../src/modules/integration/providers/suitefleet/task-client.ts#L202))?
- Just an `addressId` reference to a customer-stored address (if SF maintains an address book per merchant)?
- District / city / countryCode required even on partial update?

## §3 Plan-PR posture pre-Aqib comm

Plan-PR §G locks on best-known assumptions:

| Assumption | Confidence | Source |
|---|---|---|
| Update endpoint exists with PUT/PATCH semantics | High | Industry standard for task management APIs |
| Cancel endpoint exists with PATCH-status or DELETE semantics | High | Existing webhook receives `TASK_HAS_BEEN_CANCELED` events, implying SF-side cancel state |
| Bulk-cancel endpoint may NOT exist | Medium | Createsingle existing; bulk-create absent (Day-4 conversation); pattern suggests bulk operations are not first-class |
| Auth = Bearer token, same as createTask | High | Existing convention |
| Idempotency = NOT supported, single-attempt + DLQ | Medium-High | Day-4 followup memo on createTask |
| Rate limit = 5 req/sec global per merchant | Medium-High | Day-7 conversation context |

**Adapter signatures in plan body §G.1 lock POST-Aqib comm.** Plan-PR opens with placeholder signatures; code-PR opens with confirmed signatures.

## §4 If Aqib responds with material delta

Material delta = any answer that contradicts a "High confidence" assumption above, OR reveals a constraint that adds significant scope (e.g., SF requires per-tenant credentials for outbound which the env-backed resolver doesn't currently support — see [`followup_secrets_manager_swap_critical_path.md`](followup_secrets_manager_swap_critical_path.md)).

In that case:
1. Reviewer is surfaced before code-PR opens
2. Plan-PR §G is amended via single force-push-with-lease (with reviewer pre-authorization per [`feedback_force_push_requires_pre_authorization.md`](feedback_force_push_requires_pre_authorization.md))
3. May 15 demo timeline is reassessed; cut-scope ruling possible

## §5 Aqib comm channel + cadence

- Channel: Slack DM to @aqib.a (existing precedent — Day-3 onboarding doc, Day-4 createTask probes, Day-7 webhook architecture)
- Format: copy this memo's §2 Q1-Q6 verbatim into the message; ask for confirm/correct/refute on each
- Send timing: end of Day 19 PM, after plan-PR opens (parallel lane to plan-PR review)
- Expected turnaround: 24-48 hr (Aqib timezone is UAE, working hours overlap)
- Followup: if no response by Day 21 EOD, escalate to direct call

## §6 Cross-references

- [`memory/plans/day-19-phase-1-merchant-crud.md`](plans/day-19-phase-1-merchant-crud.md) §G + §L
- [`memory/followup_createtask_idempotency.md`](followup_createtask_idempotency.md) — Day-4 SF idempotency posture
- [`memory/followup_suitefleet_base_url.md`](followup_suitefleet_base_url.md) — single host validated
- [`memory/followup_webhook_auth_architecture.md`](followup_webhook_auth_architecture.md) — Day-7 SF webhook auth conversation
- [`memory/followup_secrets_manager_swap_critical_path.md`](followup_secrets_manager_swap_critical_path.md) — per-tenant credentials gate (Phase 2)
- [`src/modules/integration/last-mile-adapter.ts:44-126`](../src/modules/integration/last-mile-adapter.ts#L44-L126) — current adapter interface
- [`src/modules/integration/providers/suitefleet/task-client.ts:170-188`](../src/modules/integration/providers/suitefleet/task-client.ts#L170-L188) — current SuiteFleetTaskClient interface

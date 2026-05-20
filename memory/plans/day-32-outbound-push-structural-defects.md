# Day-32 — Outbound push pipeline: structural defects plan

**Tier:** T3 plan-PR (docs-only).
**Filed:** 2026-05-20 (Wed, Day-32 PM).
**Code base:** main HEAD `852e428` (post-#316, post-Day-31).
**Driver:** Session B Day-31/Day-32 read-only diagnosis surfaced five structural defects (F-1…F-6) + one operator-tooling gap (CLEANUP-1) on the SF outbound push pipeline. AWB-blank tasks in the Planner UI were the operator-visible symptom; the diagnosis ruled out the recent #316 promote as causal (it touched inbound only) and identified planner-side observability / write-asymmetry / reconciliation as the structural cause shape.

Plan-PR persistence holds: this PR stays OPEN until the eventual code-PR ships. No `--admin`.

---

## §1 — Lane entry + locked constraints

- **Tier:** T3.
- **Lane:** Outbound push pipeline structural fixes.
- **Posture:** plan-PR docs-only. No source touched in this PR. Reviewer rules §3 fix design + §6 OQs at §3.6 hard-stop #1; eventual code-PR opens off the ruled plan with §3.6 hard-stop #2 on the diff.
- **Scope is fixed:** F-1, F-2, F-3, F-4, F-5, F-6, CLEANUP-1. **No widening.** Items explicitly out of scope at §5.
- **Constraint — fix-forward only.** No rebase of #316 or earlier lanes; the code-PR builds forward from the current main HEAD. The A1 lane's pattern of locking rulings into the plan-PR via amendment commits applies here too (plan-PR-persistence).
- **Constraint — no scope-overlap with the in-flight outbound-symmetry follow-on.** The Planner→SF outbound EDIT propagation lane (the reverse-direction of A1, committed as a follow-on in the Day-31 PM fold of plan #306) is a separate code-PR; this lane is the create-push path, NOT the edit-push path.
- **Constraint — per-merchant credential audit is out of scope.** The HEM 403 row observed in the 20/20 sample is a single-tenant auth-credential issue (likely SF OpsPortal-side misconfiguration); driving it requires Aqib coordination and is not a planner-side code lane.
- **Constraint — no demo clock.** The A1 lane decoupled the demo from the schedule (Day-31 PM Love directive); this lane inherits the same posture. Build to correctness, not to a date.

---

## §2 — Root cause traces (verbatim from Session B's Day-31 diagnosis at HEAD 852e428)

The diagnosis was filed in the session conversation history at SHA `852e428`. File:line citations below reference real code on main HEAD `852e428`.

### §2.1 — Symptom shape (observed in production)

- **Q-1 result:** 20 most recent AWB-blank tasks (`tasks.external_tracking_number IS NULL`) all carry `pushed_to_external_at IS NULL` and `outbound_sync_state='synced'`. None are demo-data — real subscription-minted rows for MPL + HEM merchants.
- **Q-2 result:** 18/20 rows are `failed_pushes.failure_reason = 'server_5xx'` with `failure_detail = NULL` and `audit_event_count = 0` for `task.push_failed`. 2/20 are `client_4xx` with populated `failure_detail` (one HEM 403 "User not allowed to do such action.", one MPL 400 "deliveryDate must be a date in the present or in the future") and `audit_event_count = 1`.
- **Q-2 task_payload shape:** the 5xx rows' `failed_pushes.task_payload` contains the QStash failureCallback metadata snapshot (`source: "qstash_failure_callback"`, `qstash_dlq_id`, `qstash_retried_count`, `qstash_response_body`, `original_push_payload: { tenant_id, task_id }`), **NOT** the SF wire payload Planner sent. The 4xx rows carry the upstream `TaskCreateRequest` shape.
- **Q-3 result:** AWB-blank tasks span pre-promote AND post-promote dates — not dpl-correlated. The #316 promote (74f853e → 852e428) touched inbound only; it did not introduce or fix anything on the outbound path.

### §2.2 — Code-path trace at HEAD 852e428

QStash → push-task handler → adapter → SF fetch:

| Step | File:line | What it does |
|---|---|---|
| 1 | [`src/app/api/queue/push-task/route.ts:171-225`](../../src/app/api/queue/push-task/route.ts#L171-L225) | Signature-verifies, looks up task, builds system `ctx`, calls `pushSingleTask`. Catches throw at line ~230, re-throws to trigger QStash retry. |
| 2 | [`src/modules/task-push/service.ts:478`](../../src/modules/task-push/service.ts#L478) | `adapter.authenticate(tenantId)` — **OUTSIDE the try block at line 483**. Throw escapes `pushSingleTask` entirely. |
| 3 | [`src/modules/task-push/service.ts:483-485`](../../src/modules/task-push/service.ts#L483-L485) | `try { pushResult = await adapter.createTask(session, request); } catch (err) { … }` — only the SF createTask fetch is wrapped. |
| 4 | [`src/modules/integration/providers/suitefleet/last-mile-adapter-factory.ts:140-156`](../../src/modules/integration/providers/suitefleet/last-mile-adapter-factory.ts#L140-L156) | Adapter `createTask` re-resolves per-tenant `customerId` + `clientId`, delegates to taskClient. |
| 5 | [`src/modules/integration/providers/suitefleet/task-client.ts:591-700`](../../src/modules/integration/providers/suitefleet/task-client.ts#L591-L700) | The actual `fetch(url, ...)` to `${baseUrl}/api/tasks?customerId=...`. |

### §2.3 — F-1: 5xx response body discarded codebase-wide

[`task-client.ts:636-647`](../../src/modules/integration/providers/suitefleet/task-client.ts#L636-L647):
```ts
if (response.status >= 500) {
  log.warn({ operation: "create_task", status: response.status, error_code: "server_5xx", tenant_id, customer_order_number /* NO body, NO response_excerpt */ });
  throw new CredentialError(`SuiteFleet createTask returned ${response.status} — single-attempt policy, no retry`);
}
```

vs the 4xx branch [`task-client.ts:649-680`](../../src/modules/integration/providers/suitefleet/task-client.ts#L649-L680) which reads `responseText = await response.text()`, logs `response_excerpt`, and threads the body text into the thrown typed error.

**Repeats codebase-wide** in 5 other client methods at [`task-client.ts:758`](../../src/modules/integration/providers/suitefleet/task-client.ts#L758), [`:857`](../../src/modules/integration/providers/suitefleet/task-client.ts#L857), [`:952`](../../src/modules/integration/providers/suitefleet/task-client.ts#L952), [`:1042`](../../src/modules/integration/providers/suitefleet/task-client.ts#L1042) (label / getTaskByAwb / update / cancel paths) and in [`asset-tracking-client.ts:244`](../../src/modules/integration/providers/suitefleet/asset-tracking-client.ts#L244) + [`label-client.ts:172`](../../src/modules/integration/providers/suitefleet/label-client.ts#L172). It is a convention, not an isolated `createTask` bug.

**Auth path** ([`auth-client.ts:234,315`](../../src/modules/integration/providers/suitefleet/auth-client.ts#L234)): both 4xx AND 5xx route through `rejectClientError(name, status)` — only the status code is passed; the response body is NEVER read on either path.

### §2.4 — F-2: `adapter.authenticate` outside `pushSingleTask`'s try block

[`task-push/service.ts:478-485`](../../src/modules/task-push/service.ts#L478-L485):
```ts
const session = await adapter.authenticate(tenantId);          // line 478 — UNGUARDED
const request = buildTaskCreateRequest(tenantId, task, consignee); // line 479 — UNGUARDED
let pushResult;
try {
  pushResult = await adapter.createTask(session, request as TaskCreateRequest); // line 484
} catch (err) {                                                 // line 485 — only catches createTask
  …
}
```

A 5xx (or any throw) from `authenticate` propagates past `pushSingleTask`, lands in the route handler's catch, gets re-thrown to QStash, exhausts retries, fires failureCallback → W2 writer (see §2.5).

### §2.5 — F-3: `outbound_sync_state` has no writer on the create-push pipeline

Migration [`supabase/migrations/0026_tasks_outbound_sync_state.sql:50`](../../supabase/migrations/0026_tasks_outbound_sync_state.sql#L50) defaults the column to `'synced'`. Only three writers exist:

- [`tasks/repository.ts:1336`](../../src/modules/tasks/repository.ts#L1336) — `markTaskSkipped` flips to `'pending_cancel'` (skip flow).
- [`api/queue/cancel-task-failed/route.ts:145`](../../src/app/api/queue/cancel-task-failed/route.ts#L145) — flips to `'failed'` on cancel DLQ.
- [`api/queue/cancel-task/route.ts:210`](../../src/app/api/queue/cancel-task/route.ts#L210) — flips back to `'synced'` on cancel success.

**No writer on the CREATE/push pipeline.** A task that has never had a successful push remains at `'synced'` forever. The column lies on AWB-blank rows; the [DayActionPopover.tsx:612](../../src/app/(app)/consignees/[id]/_components/DayActionPopover.tsx#L612) operator UI surface reads it directly.

### §2.6 — F-4: failureCallback bypasses the service layer

Two writers to `failed_pushes`:

| Writer | File:line | task_payload | failure_detail | task.push_failed audit | 23505 handling |
|---|---|---|---|---|---|
| **W1** `recordFailedPushAttempt` (service) | [`failed-pushes/service.ts:256-326`](../../src/modules/failed-pushes/service.ts#L256-L326) | SF wire request | `classified.detail` from caught error | **emitted** at line 319-325 | YES — routes 23505 to `updateFailedPushAttempt` (line 297-307) |
| **W2** `insertFailedPush` (route-direct) | [`push-task-failed/route.ts:136-175`](../../src/app/api/queue/push-task-failed/route.ts#L136-L175) → [`failed-pushes/repository.ts:105`](../../src/modules/failed-pushes/repository.ts#L105) | QStash metadata snapshot | `qstashFailure.body` (production handler's response, NOT SF's) | **NOT emitted** | NO — raw INSERT; throws on duplicate; route catches + re-throws |

Result: every cron tick re-enqueues the failing task, every failureCallback fires, every duplicate INSERT throws 23505, the route re-throws, QStash retries the callback, exhausts. `attempt_count` never advances past 1; `last_attempted_at` never advances past the first failure timestamp.

### §2.7 — F-5: No past-dated guard on push path

Service layer has cutoff guards on EDIT/CANCEL/NOTE/SKIP at multiple sites (e.g. [`tasks/service.ts:1059,1297,1433,1734,1862,1873`](../../src/modules/tasks/service.ts)). **None on the push path.** [`pushSingleTask`](../../src/modules/task-push/service.ts#L347) does not check `task.delivery_date` against today. [`listReconciliationCandidatesByTenant`](../../src/modules/tasks/repository.ts#L1084-L1098) does not filter past-dated tasks. An initial-failure task ages into past-dated as days pass; SF then rejects with 400 "deliveryDate must be a date in the present or in the future" (the MPL 2026-05-11 row observed in production).

### §2.8 — F-6: `task.push_failed` audit silently missing for W2-written rows

A consequence of F-4: because W2 bypasses the service layer, the audit emit at [`failed-pushes/service.ts:319-325`](../../src/modules/failed-pushes/service.ts#L319-L325) never fires. Audit-log queries filtering by `event_type = 'task.push_failed'` see only 4xx-failed pushes. The 5xx population is invisible to the audit ledger. Resolved by F-4 (route both writers through the service layer).

### §2.9 — CLEANUP-1: Bulk-resolve tooling

Beyond the 9 MPL rows just cleaned manually, the structural fixes need an operator-facing way to bulk-resolve or skip stuck failed_pushes rows. Today the only path is the per-row retry button on `/admin/failed-pushes` (which re-pushes — same loop). No "mark resolved with reason" surface exists; no SQL-only "drain" tool either.

---

## §3 — Per-defect fix design (file:line targets)

### §3.1 — F-1 fix: read 5xx response body, attach to thrown error

**Surface:** seven 5xx branches across [`task-client.ts:636,758,857,952,1042`](../../src/modules/integration/providers/suitefleet/task-client.ts), [`asset-tracking-client.ts:244`](../../src/modules/integration/providers/suitefleet/asset-tracking-client.ts#L244), [`label-client.ts:172`](../../src/modules/integration/providers/suitefleet/label-client.ts#L172) + the two auth paths [`auth-client.ts:234,315`](../../src/modules/integration/providers/suitefleet/auth-client.ts#L234).

**Pattern (mirrors the 4xx branch already in `task-client.ts:649-680`):**
```ts
if (response.status >= 500) {
  let responseText: string;
  try { responseText = await response.text(); } catch { responseText = ""; }
  log.warn({ operation, status: response.status, error_code: "server_5xx", tenant_id, customer_order_number, response_excerpt: responseText.slice(0, 400) });
  throw new CredentialError(
    `SuiteFleet ${operation} returned ${response.status}: ${responseText.slice(0, 2000)}`,
  );
}
```

**Decision point:** the auth-client's `rejectClientError(name, status)` helper at [`auth-client.ts:234,315`](../../src/modules/integration/providers/suitefleet/auth-client.ts#L234) does not currently receive a response. Either: (a) extend the helper signature to take an optional `responseText`, or (b) inline the body-read at each call site like the task-client pattern. Open question — see §6 OQ-1.

**Downstream effect:** `classifyAdapterError` at [`task-push/service.ts:186-213`](../../src/modules/task-push/service.ts#L186-L213) already extracts `err.message` into `failure_detail` for `CredentialError`; with the body in the message, `failure_detail` populates for both 4xx and 5xx via the same code path.

### §3.2 — F-2 fix: bring `authenticate` inside the try block

**Surface:** [`task-push/service.ts:478-485`](../../src/modules/task-push/service.ts#L478-L485).

**Shape:**
```ts
let pushResult;
try {
  const session = await adapter.authenticate(tenantId);                     // moved INTO try
  const request = buildTaskCreateRequest(tenantId, task, consignee);        // moved INTO try (defensive — buildTaskCreateRequest can throw on malformed delivery_date string)
  pushResult = await adapter.createTask(session, request as TaskCreateRequest);
} catch (err) {
  // existing AWB-exists branch + non-AWB DLQ branch — unchanged
}
```

**Inter-defect dependency:** F-2 alone routes auth-throw to the existing W1 writer (`recordFailedPushAttempt`); combined with F-1, the W1 row now has a meaningful `failure_detail`. With F-4 also landed, both writers converge on the service layer so the route handler bypass path is removed entirely.

### §3.3 — F-3 fix: wire `outbound_sync_state` on the create-push pipeline

**Surface options:**
- (a) Extend `markTaskPushed` ([`tasks/repository.ts:1116`](../../src/modules/tasks/repository.ts#L1116)) to set `outbound_sync_state = 'synced'` in the same UPDATE alongside `external_id` + `external_tracking_number` + `pushed_to_external_at`. (Cheapest — single-statement extension.)
- (b) Add a new writer that fires from `pushSingleTask`'s catch branch to set `outbound_sync_state = 'failed'` alongside the W1 failed_pushes write.
- (c) Migration to change the default from `'synced'` to a new state `'pending'` so newly-minted-but-not-yet-pushed tasks read truthfully before the first push attempt.

**Recommendation (build perspective):** (a) + (b) + (c). The migration is the most honest, but it touches the canon and needs reviewer sign-off — see §6 OQ-2.

**Lifecycle after fixes:**
- Task created (cron / ad-hoc / subscription) → `'pending'` (or `'synced'` if OQ-2 rules to keep the default).
- pushSingleTask success → `markTaskPushed` writes `'synced'`.
- pushSingleTask failure → DLQ writer also flips to `'failed'` in the same withServiceRole tx as the failed_pushes write.
- Skip / cancel paths — UNCHANGED (Day-29 §D(2) Phase-1 contract preserved).

### §3.4 — F-4 fix: route failureCallback through the service layer

**Surface:** [`push-task-failed/route.ts:160-175`](../../src/app/api/queue/push-task-failed/route.ts#L160-L175).

Replace the direct `insertFailedPush` call with a service-layer call to `recordFailedPushAttempt`. The route handler still builds the `taskPayloadSnapshot` (QStash metadata is useful for ops triage), but routes it through the service so:
- 23505 → `updateFailedPushAttempt` (attempt_count increments, last_attempted_at advances)
- `task.push_failed` audit emit fires (resolves F-6)
- The withServiceRole boundary is the same

**Open question:** the service-layer `recordFailedPushAttempt` expects `taskPayload` to be the SF wire request; the W2 path will pass a different shape (QStash metadata). The column is `jsonb NOT NULL` — both shapes are valid JSON. The W2 vs W1 shape divergence is then encoded by `task_payload.source` (the W2 snapshot already includes `source: "qstash_failure_callback"`). Operators inspecting `/admin/failed-pushes` can branch UI rendering on that key.

**Implication:** the failure_detail truncation cap (4000 chars) at [`service.ts:271-281`](../../src/modules/failed-pushes/service.ts#L271-L281) applies to both writers post-fix.

### §3.5 — F-5 fix: past-dated guard on push + reconciliation filter

**Surface 1 (push-time guard):** add a guard early in `pushSingleTask` ([`task-push/service.ts:347+`](../../src/modules/task-push/service.ts#L347)) or in `buildTaskCreateRequest` that short-circuits when `task.delivery_date < TODAY_DUBAI`. Return a new `kind: "past_dated_no_push"` outcome from `pushSingleTask`. Route handler maps it to a non-retry HTTP 200 (mirrors `failed_to_dlq`).

**Surface 2 (write a DLQ row):** record the past-dated rejection to `failed_pushes` via W1 with `failure_reason: 'past_dated'` (new value — requires CHECK constraint extension at migration time, mirrors the Day-29 0025 pattern that admitted `'reschedule'`). The row is structurally distinct from a 4xx SF rejection so ops triage can separate planner-side guards from SF-side rejects. Open question — see §6 OQ-3.

**Surface 3 (reconciliation filter):** extend [`listReconciliationCandidatesByTenant`](../../src/modules/tasks/repository.ts#L1084-L1098) to filter `WHERE delivery_date >= CURRENT_DATE - INTERVAL '1 day'` (or whatever the OQ-3 ruling sets). Past-dated tasks stop being re-enqueued — they stay in DLQ awaiting operator triage (or auto-resolution via CLEANUP-1).

**Time-zone semantics:** the existing service-layer cutoff guards use `CURRENT_DATE` (Postgres clock) + Dubai-local 18:00 boundary. The push-path guard does NOT need the time-of-day boundary (a task minted at 09:00 for the same day should still push); it only needs the date-boundary. Detail in §6 OQ-3.

### §3.6 — F-6 fix: covered by F-4

No standalone code. F-4 routes the W2 path through the service layer, which emits `task.push_failed`. Audit ledger integrity restored without any audit-layer change.

### §3.7 — CLEANUP-1: Bulk-resolve operator tooling

**Surface options (for reviewer ruling — §6 OQ-4):**
- (a) Admin UI button on `/admin/failed-pushes` — bulk-select rows, prompt for resolution reason, write to `resolved_at` + `resolution_notes` columns (already exist on `failed_pushes`). Audit emit `failed_push.bulk_resolved` (new event type).
- (b) CLI tool `scripts/resolve-failed-pushes.mjs` taking a JSON file of `{ failed_push_id, reason }` pairs. Read-only to start (dry-run mode), write mode behind explicit flag.
- (c) SQL-only — operators run `UPDATE failed_pushes SET resolved_at = now(), resolution_notes = ... WHERE …` directly via Supabase console. Cheapest; no audit trail.

**Recommendation (build perspective):** (a) is the right shape for a multi-tenant ops surface but is the heaviest. (b) is the right shape for a one-off backlog drain. (c) is anti-pattern (audit-ledger blind spot, ad-hoc SQL drift).

---

## §4 — Inter-defect dependencies + ordering

```
   F-1 ─────────────────────────► populates failure_detail in any error path
    │
    │  (auth body capture)         (createTask body capture)
    ▼                              ▼
   F-2 (auth inside try) ────────► routes ALL failures to W1 (was: route handler/W2)
                                   │
                                   ▼
                                  F-4 (W2 → service layer) ──► both writers converge
                                                                │
                                                                ▼
                                                               F-6 (audit emit fires) RESOLVED
   F-3 (outbound_sync_state writer)
    │
    └──► independent of F-1/F-2/F-4 BUT benefits from F-2's "all failures route to W1"
         so the failure-state write is co-located with the W1 row (single tx)

   F-5 (past-dated guard)
    │
    └──► independent. F-5 SHOULD land BEFORE F-1/F-2/F-4 so the cron-tick replay
         loop stops creating new W2 rows for past-dated tasks immediately;
         the other fixes apply going forward.

   CLEANUP-1 (bulk-resolve tooling)
    │
    └──► LAST. Operates on the legacy W2 rows in the DLQ. Build after the
         structural fixes are landed so the tooling targets a stable
         post-fix world, not a moving one.
```

**Suggested code-PR sequence (subject to §6 OQ-5):**

1. **PR-A (T2):** F-5 past-dated guard + reconciliation filter. Smallest, stops the bleed. Migration for `failed_pushes.failure_reason` CHECK constraint extension (`'past_dated'`).
2. **PR-B (T3):** F-1 + F-2 + F-4 + F-6. The structural observability + write-path convergence. Single commit per A1 plan-PR convention.
3. **PR-C (T2):** F-3 outbound_sync_state writer + migration (if OQ-2 admits the default-state change).
4. **PR-D (T2):** CLEANUP-1 operator tooling per OQ-4 ruling.

Alternative: bundle PR-A + PR-B + PR-C into one larger T3 PR if reviewer prefers the unified-fix shape. PR-D stays separate.

---

## §5 — Scope boundary

**IN scope (this lane):**
- F-1 — 5xx response body capture (all SF client methods + both auth paths).
- F-2 — authenticate inside pushSingleTask's try block.
- F-3 — outbound_sync_state writer on create-push pipeline.
- F-4 — failureCallback route through service layer.
- F-5 — past-dated guard + reconciliation filter.
- F-6 — task.push_failed audit emit on W2-class failures (resolved by F-4).
- CLEANUP-1 — operator bulk-resolve tooling.
- Integration specs per §7.
- Migration for `failed_pushes.failure_reason` CHECK extension (`'past_dated'`) and (pending OQ-2) the `outbound_sync_state` default change.

**OUT of scope (explicit non-collisions):**
- **Per-merchant credential audit.** The HEM 403 "User not allowed to do such action." row is a single-tenant credential/customerId issue. Resolution requires Aqib coordination on the SF OpsPortal side. Tracked separately at `memory/followup_aqib_api_key_auth_header_pending.md` (institutional load-bearing) and `memory/followup_suitefleet_outbound_edit_cancel_aqib.md` (operational followup). Not built here.
- **Outbound symmetry follow-on.** Planner→SF outbound EDIT propagation (the reverse direction of A1's inbound work) remains queued separately per the Day-31 PM fold of plan #306 §5. Distinct lane; no bundling.
- **The A1 inbound work itself.** Plan #306 final lane shape is implemented in #316 + the outbound-symmetry follow-on. Not re-touched here.
- **Cron decoupling / materialisation reshape.** Tracked at `memory/followups/cron_materialization_push_coupling.md` (Day-13 followup). The push pipeline this lane fixes runs INSIDE the existing materialization pattern; reshape is a separate lane.
- **SF webhook idempotency / dedup hardening.** Tracked at `memory/followup_isuniqueviolation_err_cause_unwrap_bug.md` (Day-19 followup). Inbound-side; not in scope.
- **Reconcile-recovered local-write failure DLQ visibility gap.** Tracked at `memory/followup_reconcile_recovered_local_write_failure.md` (Day-9 followup). Adjacent surface but pre-dates this lane; not bundled.

---

## §6 — Open questions for reviewer ruling

### OQ-1 — F-1 auth-client signature reshape

The auth-client's `rejectClientError(name, status)` helper at [`auth-client.ts:234,315`](../../src/modules/integration/providers/suitefleet/auth-client.ts#L234) doesn't currently take a response body.

- **(a)** Extend the helper signature to take an optional `responseText` parameter; auth call sites do `response.text()` before calling.
- **(b)** Inline the body-read at the two auth call sites; helper signature unchanged.
- **(c)** Larger refactor — convert all client methods to a shared `readErrorBody(response, operation, status)` helper that centralises the pattern.

Builder recommendation: (a) — narrow signature change, no cross-cutting refactor.

### OQ-2 — F-3 migration: change `outbound_sync_state` default from `'synced'` to `'pending'`

Migration [`0026_tasks_outbound_sync_state.sql:50`](../../supabase/migrations/0026_tasks_outbound_sync_state.sql#L50) defaults the column to `'synced'`. On AWB-blank rows this lies.

- **(a)** Keep `'synced'` default; rely on F-3 fix to write `'pending'` at create time (requires updated INSERT statements everywhere a task is inserted).
- **(b)** Migration that changes the column default to a new state `'pending'`. Backfill existing AWB-blank rows to `'pending'` (or `'failed'` — see OQ-2.1 below).
- **(c)** Keep current default; add CHECK constraint allowing new `'failed'` state from create-path; do not add `'pending'` at all. Treat the failure-DLQ row as the source of truth and the column as an optimistic marker.

Builder recommendation: (b). The column either reflects reality or it doesn't; defaulting to `'synced'` on rows that have never pushed is the bug.

**OQ-2.1 (sub-question if OQ-2 rules (b)):** how to backfill existing `'synced'`-but-AWB-blank rows? `'pending'` (still attempting) vs `'failed'` (give up)? Default the backfill on `failed_pushes.resolved_at` value: unresolved → `'failed'`, no row → `'pending'`.

### OQ-3 — F-5 past-dated guard cutoff semantics

What counts as "past-dated" for the push-path guard?

- **(a)** Strict — `delivery_date < CURRENT_DATE` (Dubai-local). Any task whose delivery date is today or future pushes; yesterday or earlier rejects.
- **(b)** Tolerant — `delivery_date < CURRENT_DATE - INTERVAL '1 day'`. Allows a 24h grace window for late-night Dubai pushes.
- **(c)** Configurable per-tenant via a new `tenants` column (e.g. `push_past_dated_grace_days`). Most flexible; biggest scope addition.

Builder recommendation: (a). The 18:00 Dubai cutoff is encoded elsewhere as the operator-time boundary; for SF-correctness, today-or-future is the right semantic. The MPL 400 row in production confirms SF rejects strict past-dated.

### OQ-4 — CLEANUP-1 surface shape

- **(a)** Admin UI button on `/admin/failed-pushes`.
- **(b)** CLI tool `scripts/resolve-failed-pushes.mjs`.
- **(c)** SQL-only.

Builder recommendation: (a) for the operator surface; (b) as a one-off backlog-drain accompaniment in the same PR; (c) NEVER (no audit trail). Combine (a) + (b).

### OQ-5 — Code-PR shape: bundle or split

§4 lays out PR-A / PR-B / PR-C / PR-D. Reviewer rules:

- **(a)** Four PRs as proposed.
- **(b)** Bundle PR-A + PR-B + PR-C into one T3 PR.
- **(c)** Bundle everything (including CLEANUP-1) into one T3 PR.

Builder recommendation: (a). PR-A is small + urgent (stops the bleed on past-dated re-enqueue); landing it first unblocks ops triage before the larger PR-B lands. PR-D depends on ruling outcomes from PR-B + PR-C and naturally trails.

### OQ-6 — F-4 task_payload shape divergence

W1 writes the SF wire request; W2 will continue writing the QStash metadata snapshot (post-fix, both via `recordFailedPushAttempt`). Operators see `task_payload.source` to distinguish. Is this acceptable, or should the W2 path ALSO capture the SF wire body (would require re-resolving the task + re-building the request, which is wasteful for a callback)?

Builder recommendation: leave the shapes distinct. The W2 snapshot is informational for QStash-replay; the W1 SF wire body is informational for SF-replay. Different debugging axes; both useful.

---

## §7 — Integration spec preview (real-Postgres)

Per A1 plan-PR §7 precedent + brief v1.13 §7.1 CI gate, all specs use the canonical teardown skeleton at `memory/followup_audit_rule_cascade_conflict.md`.

### §7.1 — F-1 spec (5xx body capture)

`tests/integration/sf-client-5xx-body-captured.spec.ts` — mock the `fetch` adapter to return `Response(body='{"error":"underlying SF detail"}', status: 502)`. Assert:
- `pushSingleTask` returns `failed_to_dlq` with `failureDetail` containing the response body excerpt.
- `failed_pushes.failure_detail` row has the body text (not empty/null).
- Log line has `response_excerpt` populated.

Cases: one per client method touched (createTask + 5 others) — 6-8 cases minimum. Pin both 500 and 502 explicitly; the convention extends to all 5xx.

### §7.2 — F-2 spec (auth-throw routed to W1)

`tests/integration/sf-auth-throw-routes-to-w1-dlq.spec.ts` — mock the auth adapter to throw `CredentialError("auth 500: ...")`. Assert:
- `pushSingleTask` returns `failed_to_dlq` (NOT a thrown error).
- `failed_pushes` row exists via W1 (verify `task_payload` has SF-shape, NOT QStash-snapshot shape).
- `task.push_failed` audit emitted.

### §7.3 — F-3 spec (outbound_sync_state writer)

`tests/integration/outbound-sync-state-create-push.spec.ts`:
- Case A: success path — task at `'pending'` (or `'synced'` per OQ-2) → push succeeds → row at `'synced'`.
- Case B: failure path — task at `'pending'` → push fails (4xx or 5xx) → row at `'failed'`.
- Case C: idempotency — push attempt #2 on the same task does not regress state.

### §7.4 — F-4 + F-6 spec (failureCallback service-layer routing + audit emit + attempt_count increment)

**LOAD-BEARING per the diagnosis** — must exercise the QStash callback → service-layer-write path and assert `attempt_count` actually increments across retries.

`tests/integration/failed-push-callback-attempt-count-increments.spec.ts`:
- Setup: insert a `failed_pushes` row directly with `attempt_count: 1` (simulate the first failureCallback write).
- Drive: invoke the push-task-failed route handler with a fresh QStash payload for the same task_id.
- Assert: `attempt_count` is now 2 (NOT still 1; NOT a 23505 throw).
- Assert: `last_attempted_at` advanced.
- Assert: `task.push_failed` audit emitted on this attempt (the second one).
- Assert: NO duplicate `failed_pushes` row inserted.

### §7.5 — F-5 spec (past-dated guard)

`tests/integration/past-dated-task-no-push.spec.ts`:
- Setup: task with `delivery_date = today - 2 days`.
- Drive: invoke `pushSingleTask`.
- Assert: returns `kind: "past_dated_no_push"` (no SF fetch invoked).
- Assert: `failed_pushes` row with `failure_reason: 'past_dated'`.
- Assert: `listReconciliationCandidatesByTenant` does NOT include the task.

### §7.6 — CLEANUP-1 spec

`tests/integration/admin-failed-pushes-bulk-resolve.spec.ts` (if OQ-4 rules (a) + (b)):
- Case A: bulk-resolve 3 rows via service function → all 3 `resolved_at` set, `resolution_notes` set, audit event `failed_push.bulk_resolved` emitted.
- Case B: permission gate — actor lacking `failed_pushes:retry` gets ForbiddenError.

**Estimated spec count:** 12-15 integration specs across §7.1-§7.6. Each uses the canonical teardown skeleton; CI runs against real Postgres per brief v1.13 §7.1.

---

## §8 — Risks + mitigations

### R-1 — F-1 body-read latency

Adding `await response.text()` to the 5xx path adds latency before throw. Risk: marginal extra time in already-failing requests.

**Mitigation:** the body-read is bounded by Vercel's response-streaming layer; for a 500 response from SF the body is typically small (≤ 4KB JSON error). The 4xx path already does this without measurable impact. Capped slicing (`.slice(0, 2000)`) bounds the impact on the thrown error message.

### R-2 — F-2 buildTaskCreateRequest moved into try

If `buildTaskCreateRequest` throws on malformed input (e.g. invalid date format), the W1 writer now catches it where the route handler used to. The semantic shift is from "500 + Vercel error page" to "200 + DLQ row." Probably the right answer, but the DLQ row's `failure_reason` enum doesn't have a clean category for it.

**Mitigation:** classify these as `'client_4xx'` (logically a Planner-side input validation failure) OR add a new `'input_validation'` enum value (migration touch). Default to (a) since it's the cheaper of the two.

### R-3 — F-3 default-state migration backfill

If OQ-2 rules (b), the backfill needs to differentiate "never tried, just minted" from "tried and failed." The `failed_pushes` join key is the disambiguator.

**Mitigation:** migration backfill SQL: `UPDATE tasks SET outbound_sync_state = CASE WHEN external_id IS NOT NULL THEN 'synced' WHEN EXISTS (SELECT 1 FROM failed_pushes WHERE task_id = tasks.id AND resolved_at IS NULL) THEN 'failed' ELSE 'pending' END;`. One UPDATE; deterministic.

### R-4 — F-5 past-dated cliff edge

Tasks minted on the cliff (e.g. midnight Dubai-local for the next day's delivery) could land just-past-dated due to clock skew between Vercel's edge clock and Postgres's clock.

**Mitigation:** evaluate `CURRENT_DATE` in Postgres (the authoritative clock); use `task.delivery_date < CURRENT_DATE` in the guard (no JS Date arithmetic). The cron's own timezone handling already runs against Postgres clock per [`dubai-date.ts`](../../src/modules/task-materialization/dubai-date.ts).

### R-5 — F-4 23505 race

W1 and W2 both eventually route through `recordFailedPushAttempt`. If both fire concurrently (cron re-enqueue immediately followed by failureCallback exhaustion), they could race on the partial UNIQUE.

**Mitigation:** `recordFailedPushAttempt` already handles 23505 → `updateFailedPushAttempt`. Same handler covers both writers. The race resolves to "whichever insert lost gets routed to UPDATE." Both writes converge on the same row.

### R-6 — Migration ordering vs deployment

F-5 needs the `failure_reason = 'past_dated'` enum extension. F-3 needs the `outbound_sync_state` default change (pending OQ-2). Both are pre-deploy migrations.

**Mitigation:** Day-29 0025 + Day-29 0026 set the pattern (CHECK constraint extension + default + backfill in a single migration). Follow that template. Migrations land first on a separate code-PR or as the leading commit of the structural-fix PR per §4 sequencing.

---

## §9 — Code-PR shape preview

### §9.1 — Files expected to be touched (PR-B, the structural fix)

- `src/modules/integration/providers/suitefleet/task-client.ts` (5xx branches: 6 methods)
- `src/modules/integration/providers/suitefleet/asset-tracking-client.ts` (1 method)
- `src/modules/integration/providers/suitefleet/label-client.ts` (1 method)
- `src/modules/integration/providers/suitefleet/auth-client.ts` (2 paths + helper signature change per OQ-1)
- `src/modules/task-push/service.ts` (F-2 try-block reshape)
- `src/app/api/queue/push-task-failed/route.ts` (F-4 service-layer routing)
- `src/modules/tasks/repository.ts` (F-3 markTaskPushed extension)
- `src/modules/failed-pushes/service.ts` (failure_reason enum check might need `'past_dated'` admission via VALID_FAILURE_REASONS const)
- `supabase/migrations/0027_failed_pushes_past_dated.sql` (NEW — CHECK constraint extension)
- `supabase/migrations/0028_tasks_outbound_sync_state_default.sql` (NEW — if OQ-2 rules (b))
- `tests/integration/sf-client-5xx-body-captured.spec.ts` (NEW)
- `tests/integration/sf-auth-throw-routes-to-w1-dlq.spec.ts` (NEW)
- `tests/integration/outbound-sync-state-create-push.spec.ts` (NEW)
- `tests/integration/failed-push-callback-attempt-count-increments.spec.ts` (NEW)
- `tests/integration/past-dated-task-no-push.spec.ts` (NEW)

### §9.2 — Test count expected

12-15 integration specs (§7.1-§7.5); ~5 new unit specs in adjacent modules for the helper signatures (where applicable). Total spec delta ~17-20 cases.

### §9.3 — Single-commit-or-split

Per OQ-5: builder recommendation is the four-PR split. If reviewer rules (b) — bundle PR-A + PR-B + PR-C — a single T3 code-PR with one commit per the §3.6 hard-stop convention is the right shape (mirrors A1 #306's eventual code-PR posture).

### §9.4 — Plan-PR persistence

This plan-PR stays OPEN until the eventual code-PR (or last code-PR in the split sequence) merges. Amendment commits fold rulings, supplementary diagnoses, or scope refinements via the same pattern A1 plan-PR #306 used.

---

## §10 — Reviewer rulings

*Empty — to be filled at §3.6 hard-stop #1 review of this plan-PR.*

---

## §11 — Revision history

| Revision | SHA | Filed | Notes |
|---|---|---|---|
| v1 | (this commit — see push output) | 2026-05-20 (Day-32) | Initial plan — §1-§9 + §10 placeholder. Source: Session B Day-31 diagnosis at main HEAD 852e428. Six OQs surfaced for reviewer. |

**End of plan v1.** T3 plan-PR docs-only. **STOP — do NOT open code-PR.** Sequenced next steps: (1) reviewer §3.6 hard-stop #1 on this plan; (2) reviewer rules OQ-1 through OQ-6; (3) THEN code-PR(s) open per the §4 sequencing per OQ-5 ruling (T3 hard-stop #2 on code-PR diff).

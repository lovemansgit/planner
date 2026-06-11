# Session A bootstrap brief — Day-21 AM start

**For:** fresh Session A successor at Day-21 AM kickoff
**Filed:** Day 20 (10 May 2026), evening, post Day-20 EOD merge
**Filed by:** outgoing Session A at session close after #225 EOD doc merge
**Lane:** SuiteFleet outbound adapter — Phase 1 merchant CRUD code-PR continuation

---

## §1 Handoff context

Day-20 closed clean. Phase 1 backend foundation merged at PR #222 (`699e37d`). §3.3.3 calendar PR-A merged at PR #223 (`3989b51`). Aqib lane retired via PR #220 doc-verify (Q1-Q4 ✓; Q5/Q6 closed; Q2 residual = sandbox empirical probe at impl time).

**Day-21 AM Session A scope: SF outbound adapter — the heaviest single lane in the sprint (~14 hr aggregate).** This brief preserves cross-day context that wouldn't survive a cold-read: doc-verified endpoint shapes, locked CONCERN A/B resolutions, sandbox probe protocol, and the rationale ladder behind each lane.

**This is bootstrap only. Do NOT begin substantive code work in the bootstrap session.** Day-21 AM Session A wakes up fresh, reads this brief + the 5 references in §10, then opens code work in a fresh context window.

---

## §2 Branch state at handoff

- **Production HEAD:** `b685844` (Day-20 morning batched promote — Phase 1.5 admin + brand pass + Day-19 EOD baseline)
- **`origin/main` HEAD:** `a7cb7e4` (post #225 Day-20 EOD doc merge)
- **Day-20 substantive work NOT yet promoted:** #220/#221/#222/#223 + #224 (in-flight at EOD filing) batched into Day-21 morning promote
- **Branch to open:** `day19/phase-1-merchant-crud-code-day21` (or similar) from `main` HEAD post Day-21 morning promote

---

## §3 Doc-verified scope locked (CRITICAL — do NOT relitigate)

Per [`memory/decision_phase_1_aqib_doc_verified.md`](decision_phase_1_aqib_doc_verified.md) (PR #220):

### §3.1 Q1 — updateTask endpoint ✓
- `PATCH /api/tasks/awb/{awb}` with `mergePatchDocument` body (RFC 7396)
- Headers: `Authorization: Bearer {access_token}` + `clientId` (camelCase)
- Responses: 200 / 204 / 401 / 403

### §3.2 Q2 — cancelTask endpoint ✓ (with residual)
- **Same endpoint:** `PATCH /api/tasks/awb/{awb}` with status field in merge-patch body
- **Residual:** exact field name (`status: "CANCELED"` vs `internalStatus: "CANCEL"` vs other) — NOT documented
- **Resolution path:** Day-21 sandbox empirical probe (single-call probe against `meal-plan-scheduler` tenant 588 / customer.code MPL). Pattern precedent: `scripts/probe-sf-*.mjs`. Probe result documented in code-PR §3.6 thread.

### §3.3 Q3 — bulkCancelTasks endpoint ✓
- `PATCH /api/tasks/bulk/{ids}` with comma-separated AWB list (`?awbs=` convention from Day-6 asset-tracking)
- **Single bulk PATCH call**, NOT parallel single-cancel fan-out
- Async variant (`POST /api/tasks/bulkUpdateAsync`) NOT needed — v1 bulk-cancel scope ≤100 tasks per #218 plan §F.4

### §3.4 Q4 — auth posture ✓ (with correction)
- **Two-stage OAuth 2.0:** `GET /api/auth/authenticate?username=...&password=...` → 24h access + 6mo refresh; `POST /api/auth/refresh` for token rotation
- **Outbound headers:** Bearer + camelCase `clientId`
- **NOT the same as inbound webhook:** inbound uses lowercase `clientid`/`clientsecret` headers (different mechanism)
- **Existing resolver pattern reused** at [`src/modules/credentials/suitefleet-resolver.ts`](../../src/modules/credentials/suitefleet-resolver.ts)

### §3.5 Q5/Q6 — closed (not blocking)
- Idempotency: SF doesn't dedupe; ignores `Idempotency-Key`. Mitigation: QStash + correlation_id (Planner-side replay safety)
- Rate limit: 5 req/sec global per merchant per Day-3 EOD lock + Day-7 conversation
- Q5/Q6 confirmation is courtesy, not blocking

---

## §4 Plan-locked architectural concerns (CRITICAL — verify in code-PR §3.6)

### §4.1 CONCERN A — QStash route path versioning
Verify existing `/api/queue/push-task` route pattern — replicate convention exactly for new routes:
- `/api/queue/cancel-task` (mirror `/api/queue/push-task`)
- `/api/queue/update-task`
- Failure routing: `/api/queue/cancel-task-failed` → `outbound_push_failures` DLQ

Body-read [`src/app/api/queue/push-task/route.ts`](../../src/app/api/queue/push-task/route.ts) FIRST before drafting new routes. Match verbatim:
- Auth: QStash signature verification at route entry
- runtime / dynamic / revalidate exports
- Failure-handler path-versioning convention

### §4.2 CONCERN B — outbound_push_failures PII strip at write-time
**Schema-level redaction; PII strip fires BEFORE INSERT.** NOT RLS-gating at read-time. Cleaner audit posture; impossible-by-construction PII leak.

```sql
-- New migration shape (illustrative; final layout per body-read of existing migration patterns):
CREATE TABLE outbound_push_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('update', 'cancel')),
  correlation_id UUID NOT NULL,
  failure_reason TEXT NOT NULL,
  failure_payload JSONB,  -- PII-stripped before write per CONCERN B
  retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX idx_outbound_push_failures_unresolved
  ON outbound_push_failures(tenant_id, created_at DESC)
  WHERE resolved_at IS NULL;
```

PII fields to strip from SF response payloads before write: `consignee.name`, `consignee.phone`, `consignee.email`, `deliveryInformation.address.*`, any free-text notes that may carry PII. Strip in the queue-handler error path BEFORE the INSERT statement runs. Document the strip helper at code-PR §3.6.

### §4.3 CONCERN C — already discharged
SQL builder snapshot test landed at PR #222. Day-21 lane has zero impact on `cte-builder.ts`; no Concern C drift expected.

---

## §5 Day-21 AM lane plan (4 lanes, ~14 hr aggregate)

### §5.1 LANE 1 — LastMileAdapter interface extension (~2 hr)
Add 3 method signatures to [`src/modules/integration/last-mile-adapter.ts`](../../src/modules/integration/last-mile-adapter.ts):

```ts
interface LastMileAdapter {
  // existing methods unchanged
  updateTask(input: UpdateTaskInput): Promise<AdapterResult>;
  cancelTask(input: CancelTaskInput): Promise<AdapterResult>;
  bulkCancelTasks(inputs: readonly CancelTaskInput[]): Promise<AdapterResult>;
}
```

Per-tenant credential resolution via existing `suitefleet-resolver.ts` pattern. NO new env-var requirements; reuses region-scoped Bearer + per-tenant `customerId` resolution from #187 A1 swap.

### §5.2 LANE 2 — SuiteFleetTaskClient impl (~5-6 hr)
At [`src/modules/integration/providers/suitefleet/task-client.ts`](../../src/modules/integration/providers/suitefleet/task-client.ts):

- `updateTask`: `PATCH /api/tasks/awb/{awb}` + Bearer + `clientId` + mergePatchDocument body
- `cancelTask`: same endpoint + status-flip via merge-patch. **Q2 sandbox probe FIRST** (see §6)
- `bulkCancelTasks`: `PATCH /api/tasks/bulk/{ids}` + comma-separated AWB list

Single-attempt policy on transient failures (no retry inside adapter; QStash handles retry). Rate-limit: respect 5 req/sec global per-merchant via QStash `flowControl` (existing key `sf-push-global-mvp` / `sf-push-global-preview` per Day-14 cron-decoupling pattern — DO NOT create new keys).

### §5.3 LANE 3 — QStash routes (~3 hr)
Two new routes mirror `/api/queue/push-task`:
- `/api/queue/cancel-task`
- `/api/queue/update-task`
- `/api/queue/cancel-task-failed` (failure routing per CONCERN A pattern)

Body-read existing push-task route FIRST. Match path-versioning convention exactly.

### §5.4 LANE 4 — outbound_push_failures DLQ migration + service-layer wiring (~3 hr)
- New migration with table + index per §4.2
- PII strip helper at queue-handler error path
- Service-layer wiring: `cancelTask(ctx, taskId)`, `bulkCancelTasks(ctx, taskIds)`, `bulkUpdateTasks(ctx, taskIds, patch)` enqueue QStash jobs after DB updates commit

---

## §6 Q2 sandbox probe protocol (BLOCKER — do FIRST)

Before touching `cancelTask` adapter signature, run a single-call empirical probe:

1. Pick one stale CREATED task on `meal-plan-scheduler` (sandbox tenant 588 / customer.code MPL); verify pre-state via SQL: `SELECT id, internal_status, external_id FROM tasks WHERE ... LIMIT 1`
2. Construct probe script at `scripts/probe-sf-cancel-status-field.mjs` (mirror existing `probe-sf-*.mjs` precedent)
3. Try `{ status: "CANCELED" }` first; if 4xx, try `{ internalStatus: "CANCEL" }`; if 4xx, try other variants per SF readme
4. On success: capture full request + response shape; document in code-PR §3.6 thread VERBATIM
5. Lock adapter signature on the empirically-confirmed field name

**DO NOT skip this step.** Adapter signature is downstream of the probe. If both attempts return 4xx, surface to reviewer immediately — may indicate auth issue, customerId mismatch, or doc-vs-actual divergence.

---

## §7 T1 ride-along (fold opportunistically)

Stale comment at [`src/modules/tasks/index.ts:7`](../../src/modules/tasks/index.ts#L7) reads:
> "createTask, bulkCreateTasks are SYSTEM-ONLY (no user-facing permission in the catalogue; the cron and the migration-import flow are the legitimate callers)."

This is stale post Day-19 §K amendment. Update to reference [`memory/decision_task_module_amendment_v1.md`](decision_task_module_amendment_v1.md): "createTask is dual-actor (system bypass via assertSystemActor; user requires task:create); bulkCreateTasks remains system-only."

NOT in main scope; fold into the Day-21 code-PR if you touch index.ts for any other reason. If not touched, defer to next Session A PR.

---

## §8 What NOT to do (Session A integrity)

- ❌ Do NOT relitigate Q1-Q4 doc-verified shapes — locked at #220
- ❌ Do NOT assume Q2 cancel-status field name — empirical probe required FIRST
- ❌ Do NOT create new QStash flowControl keys — reuse `sf-push-global-mvp` / `sf-push-global-preview` per Day-14 cron-decoupling
- ❌ Do NOT skip CONCERN B PII strip — schema-level write-time strip is non-negotiable
- ❌ Do NOT push Day-21 work to production without batching with Day-20 substantive work + #224 (Day-21 morning promote)
- ❌ Do NOT begin substantive code work in this bootstrap session — fresh context window for code-PR open

---

## §9 Context-window expectation

Lane is ~14 hr scope total. **Realistic chunking:**
- LANE 1 + LANE 2 first sub-PR (~7-8 hr); §3.6 hard-stop at sub-PR open with Q2 probe result
- LANE 3 + LANE 4 second sub-PR (~6-7 hr); §3.6 hard-stop at sub-PR open with CONCERN A path-verification

If session burns above ~50% memory mid-LANE-2, file mid-lane bootstrap brief before LANE 3 to preserve handoff integrity (precedent: Day-19 PM bootstrap brief #212).

Reviewer expects T3 hard-stop at each sub-PR open. §3.6 body-read with §3.21 helper-consumer discipline applied to:
- QStash route helpers (signature verification path)
- DLQ insert path (PII strip helper consumers)
- Adapter signature consumers (service-layer cancelTask/bulkCancelTasks/bulkUpdateTasks)

---

## §10 Files to read on Session A spawn (post-bootstrap)

**In order:**

1. [`memory/PLANNER_PRODUCT_BRIEF.md`](../PLANNER_PRODUCT_BRIEF.md) — full read; §3.1.10 webhook taxonomy + §3.1.11 outbound endpoints + §3.6 SF identifier model
2. [`memory/decision_phase_1_aqib_doc_verified.md`](decision_phase_1_aqib_doc_verified.md) — Q1-Q6 verbatim + corrections
3. [`memory/plans/day-19-phase-1-merchant-crud.md`](../plans/day-19-phase-1-merchant-crud.md) §G.1 (adapter signatures locked) + §K amendment + §L Q-status
4. [`memory/handoffs/day-20-eod.md`](day-20-eod.md) — §3 outbound rulings + §4 §3.21 body-read discipline + §5 UX-FINDING-5 awareness
5. **CONCERN A + CONCERN B from PR #218 §3.6 close** — body-read CRITICAL during code-PR open. Plan body §M.2 + reviewer's plan-PR ack thread.

After absorbing, surface readiness with:
- Verified branch state
- Verified `origin/main` SHA + Day-21 morning promote completion
- Q2 sandbox probe plan (script path + target task id + expected outcomes)
- Stand by for §3.6 trigger at first sub-PR open

---

**End of bootstrap brief. Total read time projected ≈ 8-10 minutes for cold session. Carry-forward integrity preserved into Day-21 AM.**

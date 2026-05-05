---
name: Day-14 cron materialization↔push decoupling — T3 plan (hard-stop-twice)
description: Plan PR (memo-only) for the materialization↔push decoupling required to fix the 9-minute cron runtime that exceeds Vercel's 300s function timeout at demo data volumes. Splits the current single-handler cron into (a) materialization cron — fast bulk INSERT…SELECT per tenant, completes in seconds; and (b) async push — QStash-driven per-task SF createTask handler, independent timeout envelope. Adds 14-day rolling horizon advance via subscription_materialization (table shipped in PR #139). Hardens (tenant_id, target_date) UNIQUE on task_generation_runs against Run-A/Run-B race smell. Uses tasks.pushed_to_external_at as the integration-honesty contract surface (column unchanged from PR #139). T3 hard-stops twice — once at this plan PR, once at the code PR open.
type: project
---

# Day-14 cron materialization↔push decoupling — T3 plan

**Tier:** T3 (cron architecture + queue mechanism + idempotency posture + DLQ contract surface) — hard-stop-twice protocol per [PLANNER_PRODUCT_BRIEF.md §7](../PLANNER_PRODUCT_BRIEF.md).
**Status:** plan-only — no migration files, no service code, no test code today. Implementation lives in the Day-14 code PR after this plan reviews.
**Hard-stops:** (a) this plan PR opens; review-and-approve before any code; (b) Day-14 code PR opens for verification-only counter-review.
**Drivers:** [memory/followups/cron_materialization_push_coupling.md](../followups/cron_materialization_push_coupling.md) §5 (decoupling recommendation) + §3 (Run-A/Run-B race hardening); [PLANNER_PRODUCT_BRIEF.md §3.1.5](../PLANNER_PRODUCT_BRIEF.md) (14-day rolling horizon); §3.3.6 (`tasks.pushed_to_external_at` as integration-honesty marker per v1.2 brief amendment, PR #141).
**Sequencing:** drafts after PR #139 (T3 part-1 code) merged (`875bfc4`); part-2 service-surface plan PR (Day 14 morning) lands separately and is unrelated to this decoupling work.
**Out of scope today:** no service-layer surface, no API routes, no UI; Day-13 part-2 service-surface work (`addSubscriptionException`, `pauseSubscription`, etc.) is its own plan PR; brief amendment for the new `merchant.suspend` action (if §1.7.1 `'suspended'` becomes a service surface) is post-Day-14 if added.

---

## §0 Pre-flight verification

### §0.1 Code-anchored current state

Current single-handler cron at [`src/app/api/cron/generate-tasks/route.ts`](../../src/app/api/cron/generate-tasks/route.ts):

| Concern | Code anchor | Behavior |
|---|---|---|
| Schedule | [`vercel.json`](../../vercel.json) `0 12 * * *` | 12:00 UTC = 16:00 Asia/Dubai |
| Eligibility filter | [`list-cron-eligible-tenants.ts:74-86`](../../src/app/api/cron/generate-tasks/list-cron-eligible-tenants.ts#L74-L86) | `WHERE suitefleet_customer_code IS NOT NULL AND <> ''` |
| Per-tenant phase (a) — generation | [`route.ts:191-198`](../../src/app/api/cron/generate-tasks/route.ts#L191-L198) → [`task-generation/service.ts:120-358`](../../src/modules/task-generation/service.ts#L120-L358) | Bulk INSERT…SELECT into `tasks`; fast (single round-trip per tenant) |
| Per-tenant phase (b) — push | [`route.ts:243`](../../src/app/api/cron/generate-tasks/route.ts#L243) → [`task-push/service.ts`](../../src/modules/task-push/service.ts) | Walks unpushed tasks, calls SF createTask per task at 5 req/sec throttle |
| Per-task push completion | [`tasks/repository.ts:531-549`](../../src/modules/tasks/repository.ts#L531-L549) `markTaskPushed` | UPDATE sets `external_id`, `external_tracking_number`, `pushed_to_external_at = now()` AFTER SF 2xx (declaration L531, UPDATE statement L538-544; verified against main HEAD `4731553`) |
| Run-row lifecycle | [`task-generation/repository.ts:118-163`](../../src/modules/task-generation/repository.ts#L118-L163) `insertRunOrGetExisting` + finaliseRun | UNIQUE on `(tenant_id, window_start, window_end)`; cron handler computes `window_start = now()` at handler entry |
| Per-task SF push throttle | `task-push/service.ts` constants | 5 req/sec → 200ms minimum interval between pushes |

### §0.2 Code-anchored runtime math (re-anchoring the cron memo's diagnosis)

Per the [cron memo](../followups/cron_materialization_push_coupling.md) §2 empirical capture (Day-13 manual trigger, MPL 200/200 + DNR 145/145):

- **Per-task push latency:** ~660ms average (range 655–720ms across MPL + DNR samples)
- **Per-tenant generation latency:** sub-second (single bulk INSERT…SELECT)
- **Concurrency model:** **serial single-in-flight** within a tenant — verified at [task-push/service.ts:3-4](../../src/modules/task-push/service.ts#L3-L4) header comment ("Single-loop, sequential, throttled at 5 req/sec") + [:121](../../src/modules/task-push/service.ts#L121) constant docstring ("5 req/sec — sequential await sleep(200ms) between SF calls") + the `await sleep(SF_THROTTLE_MS)` calls between every loop iteration ([:508](../../src/modules/task-push/service.ts#L508), [:575](../../src/modules/task-push/service.ts#L575), [:650](../../src/modules/task-push/service.ts#L650), [:679](../../src/modules/task-push/service.ts#L679), [:716](../../src/modules/task-push/service.ts#L716), [:759](../../src/modules/task-push/service.ts#L759)). One outbound SF call lives at any moment per tenant. Pacing the loop is pessimistic-by-design — the 200ms `await sleep` runs even after empty/early-exit branches, simplifying the rate-limit math at the cost of throughput. **The 558s figure is therefore wall-clock-correct, not throughput-bound: parallelizing within the existing handler (e.g., 5 concurrent in-flight pushes at 5 req/sec rate-limit) would already collapse it to ~112s and fit Vercel's 300s envelope.** The decoupling proposal is still preferred because it: (i) gives push its own per-message envelope rather than tenant-bundled, (ii) inherits QStash retry semantics natively (§5.2), (iii) keeps phase (a) materialization independent of SF auth/rate hiccups, (iv) makes Run-A/Run-B race in §4 a non-issue per-message. But the urgency framing should be: "currently breaches 300s on serial-only design" rather than "fundamentally cannot fit Vercel".
- **Per-cron pass at full demo volume (845 subs/Tue):** 845 × 660ms ≈ **558s ≈ 9.3 minutes** (serial single-in-flight)
- **Vercel Pro function timeout:** 300s

Verdict: phase (b) push dominates wall-clock; phase (a) generation does not. Decoupling phase (a) from phase (b) takes the cron handler from "9 minutes" to "seconds" with phase (b) shifted to a queue with its own timeout envelope. Decoupling is preferred over in-handler parallelization for the four reasons above, despite the in-handler-parallel option also being technically sufficient on the timeout dimension alone.

### §0.3 QStash dep + env confirmation

| Surface | State |
|---|---|
| `package.json` | `"@upstash/qstash": "^2.10.1"` already a dep — never imported in src/ |
| `.env.example` | `QSTASH_URL=https://qstash.upstash.io`, `QSTASH_TOKEN=eyJ...` already documented |
| Vercel Production env | **§0.4 verification required** — Love confirms QSTASH_TOKEN + QSTASH_URL set before code PR opens |

QStash is the recommended mechanism per §1.2 design.

### §0.4 Verification queries (Love runs / confirms before code PR opens)

| # | Verification | Command / location |
|---|---|---|
| Q1 | QSTASH_TOKEN + QSTASH_URL present in Vercel Production env (Production + Preview scope per `feedback_vercel_env_scope_convention.md`) | Vercel UI → Settings → Environment Variables |
| Q2 | Existing `task_generation_runs` rows for any (tenant, target_date) tuple — `target_date` does NOT yet exist on the table (§0.5), so use surrogate `(tenant_id, (window_start AT TIME ZONE 'UTC')::date)`. Probe runs against main HEAD `4731553` against production DB show **20 tenants with 5 dupe runs each on 2026-05-02**, all `r3-test-*` integration-test fixtures sharing the production DB. The sample shows 5 distinct `(window_start, window_end)` tuples per (tenant, date), legitimately admitted by the current UNIQUE on `(tenant_id, window_start, window_end)`. **Real production tenants (meal-plan-scheduler / dr-nutrition / fresh-butchers) have no current dupes.** Migration §4 must dedupe regardless because the new UNIQUE on `(tenant_id, target_date)` will collide with the test-fixture dupes. **Winning-row policy (locked here so §4 doesn't have to invent it):** within each `(tenant_id, target_date)` group, keep `MAX(completed_at)` if any row in the group has `completed_at IS NOT NULL`; else fall back to `MAX(started_at)`. This preserves the "most-recent successful run" as the row of record and treats fixture noise the same as production race-recovery — both reduce to a single survivor per (tenant, date). | `SELECT tenant_id, (window_start AT TIME ZONE 'UTC')::date AS d, COUNT(*) FROM task_generation_runs GROUP BY 1, 2 HAVING COUNT(*) > 1 ORDER BY 3 DESC` |
| Q3 | Count of rows with `pushed_to_external_at IS NULL` per tenant — sizing the initial push backlog the new system will inherit on cutover. Probe (main HEAD `4731553`, prod DB): only `fresh-butchers` shows backlog (114 unpushed); other 2 demo merchants are 0. Initial backlog ≈ 114 messages on cutover, well within QStash quota irrespective of tier (§0.6). | `SELECT t.slug, COUNT(*) FROM tasks ta JOIN tenants t ON t.id = ta.tenant_id WHERE ta.pushed_to_external_at IS NULL GROUP BY t.slug` |
| Q4 | `subscription_materialization` (shipped in PR #139 / migration 0015) currently has zero rows — confirm baseline before §3 horizon-advance backfill. **Probe (main HEAD `4731553`, prod DB): table does NOT exist on production yet** — confirms PR #139's migrations 0014-0019 haven't been applied to prod. Adds a dependency: §3 horizon-advance backfill is gated on PR #139's migrations being applied to production before the code PR ships, OR on the code PR's own migration step including 0014-0019. Resolution direction (TBD): if `Day-14 EOD batched promotion + apply-migrations` is Love's pattern, then PR #139's migrations apply at promotion time and §3 backfill runs after. Surface to Love before §3 reads. | `SELECT COUNT(*) FROM subscription_materialization` |

Q2 is the most important and is now resolved — winning-row policy locked above. Q4 is the new load-bearing dependency: PR #139 migrations must reach the production DB before the §3 backfill runs.

### §0.5 Migration filename allocation

Next sequence after PR #139's `0019` is `0020_*`. Proposed scope (renamed to reflect the actual change set, not just the constraint add):

| Migration | Scope |
|---|---|
| `0020_task_generation_runs_target_date_column_and_unique.sql` | Three operations in dependency order: (1) ALTER TABLE add `target_date date` column, nullable initially; (2) backfill `target_date = (window_start AT TIME ZONE 'UTC')::date` for all existing rows; (3) dedupe per Q2 winning-row policy (delete losers within each `(tenant_id, target_date)` group); (4) ALTER TABLE set `target_date` NOT NULL; (5) ADD CONSTRAINT UNIQUE on `(tenant_id, target_date)`. The pre-existing UNIQUE on `(tenant_id, window_start, window_end)` is retained — it provides finer-grained idempotency for within-day re-runs even if conceptually subsumed by the new constraint. |

Single migration; transaction-wrapped so partial failure rolls all five steps. The decoupled cron path itself is service-layer change, not schema.

### §0.6 QStash quota check (NEW — gating before code PR opens)

Per Love amendment: the plan must surface Upstash QStash plan tier, request budget on that tier, and projected throughput before the code PR opens.

**Projected throughput at full demo volume:**

| Source | Per-day | Per-week | Notes |
|---|---|---|---|
| Materialization-cron push (steady state) | ~845 messages × 7 days = **~5,900/week** | The 845 figure is from the cron memo §2 (845 subs/Tue at full demo volume); other days vary by `days_of_week` distribution. Assume worst-case all-7-days-1000 for headroom = **~7,000/week** budget. |
| Initial push backlog at cutover (one-time) | 114 messages | 0 | Q3 probe — fresh-butchers only |
| Retries (QStash native, see §5.2) | Bounded by `Upstash-Retried` cap × per-message DLQ floor | Estimate 5% retry × 845/day = ~42/day = ~300/week | Real number depends on §5.2 DLQ posture and SF reliability; budget +10% over base. |
| **Combined budget** | **~1,000/day worst-case** | **~7,500/week** | Budget for headroom + cutover spikes |

**Upstash QStash plan tiers (per public docs at upstash.com/pricing — Love verifies current):**

| Tier | Daily message limit | Pricing |
|---|---|---|
| Free | 500 messages/day | $0 |
| Pay-as-you-go | Unlimited | $1 per 100k messages above free tier |
| Fixed/Pro | Higher caps + reserved concurrency | Varies |

**Verdict (TBD pending Love verification):**

- **Free tier is INSUFFICIENT** at 1,000 messages/day worst-case (the cap is 500/day).
- **Pay-as-you-go covers the demo with negligible cost** (1,000/day × 30 days × ~$1/100k = ~$0.30/month).
- If current Upstash account is on free tier, this is a **gating** item before code PR — must upgrade to pay-as-you-go (no schema/code blocker; just a billing-config flip in Upstash console).

**Action for Love (before code PR opens):**
1. Confirm current Upstash plan tier in Upstash dashboard → Account → Billing.
2. If on free tier: upgrade to pay-as-you-go.
3. If already on pay-as-you-go or Pro: no action needed; surface the tier in the code PR description for audit-trail.

If this verification is deferred, it must be marked as a hard-stop condition on the code PR rather than discovered at deploy time.

---

## §1 Decoupling design

### §1.1 Two-cron model

**Cron A (materialization, shipped via this PR):**

Per-handler-invocation phases, in order:

1. **Reconciliation scan (NEW — outbox-equivalent self-heal).** Before inserting any new tasks, scan `tasks WHERE pushed_to_external_at IS NULL AND tenant_id IN (eligibility set)` and collect their `(tenant_id, task_id)` tuples. This catches: (i) any rows that crashed between Phase 4 commit and Phase 5 enqueue on a previous tick; (ii) the initial cutover backlog (Q3 probe: 114 fresh-butchers tasks). The handler effectively treats `tasks WHERE pushed_to_external_at IS NULL` as the outbox — no separate outbox table, no separate drainer process. Recovery interval is next cron tick (24h worst-case under the `0 12 * * *` schedule).
2. **Per-tenant bulk INSERT…SELECT into `tasks`** for any `subscription_materialization.materialized_through_date < today + 14 days`, including: (a) `address_id` populated per per-tenant per-weekday rotation (with consignee primary fallback), (b) `pushed_to_external_at = NULL` (natural state after INSERT — `markTaskPushed` is the only writer), (c) `idempotency_key` populated deterministically per task per the existing generator's pattern.
3. **Update `subscription_materialization.materialized_through_date = today + 14 days`** for each tenant whose horizon advanced.
4. **Insert `task_generation_runs` row** with `status='completed'` + `target_date = today + 14 days` (the new column added in §4). **Phase 4 is the transaction commit boundary** — Phases 1-4 run in a single per-tenant transaction.
5. **Post-commit QStash batch enqueue** (the outbox-pattern AFTER-commit step). Collect the union of: (a) reconciliation scan tuples from Phase 1, (b) the rows just inserted in Phase 2. Batch-publish via `client.batchJSON([{url, body: {tenant_id, task_id}, deduplicationId: task_id}, ...])` (verified API name — `batchJSON` is the canonical primitive in `@upstash/qstash` per `node_modules/@upstash/qstash/client-CsM1dTnz.d.ts:2476`). **Chunk batches at 100 messages per call** as a conservative guard against the per-call request-size limit (the QStash REST API caps batch payload at ~1MB; at ~80 bytes/message that's ~12,500 max, but Upstash docs publicly documented limits are around 100-1000 per batch — Love verifies exact cap before code PR opens). At ~1,000 messages/day worst-case (§0.6) and 100/batch chunk size, that's ~10 sequential `batchJSON` calls per handler invocation; each call is one HTTPS round-trip (~50-150ms), total ~1-2s — well within the materialization handler's now-fast envelope. **`deduplicationId: task_id` is load-bearing:** it absorbs duplicate enqueues from Phase 1 reconciliation re-discovering rows that were already enqueued on a previous tick, making the at-least-once delivery semantics safe for the push side.
6. **Total wall-clock:** seconds; no per-task SF call inside this handler.

**Why this pattern (transactional outbox via `tasks` table, not a separate outbox table):**
- **No new schema.** The `pushed_to_external_at IS NULL` predicate IS the unfilled-outbox query. Reuses an existing column.
- **Self-healing.** Every tick re-scans null rows, so a crash between Phase 4 commit and Phase 5 enqueue heals on the next tick (24h worst case). Tighter recovery is post-MVP if availability demands it.
- **Idempotent.** QStash `deduplicationId: task_id` absorbs duplicate enqueues, so re-discovering an already-enqueued row is a no-op at QStash side.
- **Crash-safety.** Phase 4 commit before Phase 5 enqueue means the row exists durably before any external-side activity. The window where "row exists but no message" is bounded by next-tick interval.
- **Trade-off accepted:** classical outbox-table-plus-drainer would give faster recovery (drainer can poll seconds-to-minutes), at the cost of an extra table + a second cron / drainer process. For MVP demo posture, next-tick recovery is acceptable; Phase 2 hardening can introduce the drainer if needed.

**Cron B (push handler, new — receives QStash deliveries):**
- Schedule: invoked per-message by QStash (push-driven, not pull-driven)
- Endpoint: new `POST /api/queue/push-task` accepting QStash payload `{ tenant_id, task_id }`
- Per invocation: call SF `createTask` for the one task; on success call `markTaskPushed` (existing `tasks/repository.ts:531-549`)
- On failure: rely on QStash retry semantics (see §5.2)
- After N failed retries: lands in `failed_pushes` table (existing surface — DLQ unchanged)
- Per-invocation timeout: independent of the cron handler — Vercel function timeout still 300s but the work per invocation is one SF call (~660ms), so no envelope concern

### §1.2 Mechanism choice — QStash

Three candidate mechanisms surfaced in the cron memo. **Note (post-§0.2 amendment):** the timeout dimension alone does NOT discriminate between A and B — in-handler parallelization with 5 concurrent in-flight pushes at 5 req/sec would resolve to ~112s for 845 tasks (845 × 660ms ÷ 5 ≈ 112s), which fits Vercel's 300s envelope. The argument for A over B is therefore NOT "B doesn't fit"; it's that B fits-but-doesn't-isolate.

| Mechanism | Pro | Con |
|---|---|---|
| **A. QStash (Upstash)** | (i) Per-message retry semantics — QStash retries each push independently with native backoff; (ii) Materialization-independence — push failure does not roll back materialization, the row exists in `tasks` regardless; (iii) Per-message timeout envelope — each push gets the full 300s budget, not a fraction shared with 844 siblings; (iv) Operational visibility — queue depth, DLQ inspection, retry log are first-class observables; (v) Already provisioned; env vars already documented; matches existing serverless posture; (vi) No new infrastructure | New external dependency in the critical path; cost scales with task volume (quantified in §0.6 / pricing here) |
| B. Vercel function fan-out via per-tenant subrequest with in-handler parallelization (5 concurrent in-flight at 5 req/sec) | (i) No external dep; (ii) Fits Vercel 300s envelope (~112s for 845 tasks per the §0.2 math); (iii) Simpler operationally (no queue to monitor) | (i) Per-handler retry — failure of any single SF call retries the whole 112s pass, not the failing task; (ii) Materialization-coupled — phase (b) push failure aborts the same handler that did phase (a) materialization, so a transient SF blip can roll back useful work; (iii) Shared-fraction timeout envelope — 845 tasks share 300s, so worst-case per-task budget is ~355ms; (iv) Limited operational visibility — no queue depth, no per-task retry log; (v) Still serial-fragile — once one SF call hangs near its envelope, the whole 5-way concurrency degrades |
| C. Per-tenant workers (long-running process) | Maximum control | Requires hosting outside Vercel — out of architectural scope for MVP |

**Recommendation: A (QStash).** Not because B fails the timeout test, but because B couples push failures to materialization successes (i and ii above), gives no per-message retry primitive (iii), and offers no operational queue surface (iv). A's cost is negligible at demo volume (~$0.01/day at PAYG rate per §0.6). Operational risk is QStash-as-SPOF — mitigated by §5 retry posture and the existing `failed_pushes` DLQ.

### §1.3 `tasks.pushed_to_external_at` as the contract surface + code-path retirement

Per [PLANNER_PRODUCT_BRIEF.md §3.1.1 v1.2 amendment](../PLANNER_PRODUCT_BRIEF.md) (PR #141 brief amendment):

> Contract surface for forthcoming materialization/push decoupling (Day-14 own T3 plan PR).

The decoupled push handler uses the existing column unchanged. Materialization leaves it NULL; push handler sets it via `markTaskPushed`. Consumers that read `pushed_to_external_at` (UI integration-honesty indicator per §3.3.6, the cron's "find unpushed" query at [`task-push/service.ts:373-381`](../../src/modules/task-push/service.ts#L373-L381)) require **zero changes** — the column semantic is preserved exactly.

**Code-path retirement post-cutover** (named explicitly so reviewers don't have to ask "does the old loop still run in parallel?"):

| Surface | Fate | Code anchor |
|---|---|---|
| `pushTasksForTenant` (bulk per-tenant cron-loop variant) | **RETIRES.** Last caller is the existing cron handler at `route.ts:243`; that caller goes away when the cron handler is replaced by the new materialization-only handler in §2. The whole 500-line function is dead code post-cutover. | [`task-push/service.ts:327`](../../src/modules/task-push/service.ts#L327) |
| Reconcile-branch logic inside `pushTasksForTenant` (mid-loop SF-already-knows-this-AWB recovery from D8-4b) | **RETIRES with its parent.** The line ~586 reconcile branch is part of the bulk loop body. | [`task-push/service.ts:586`](../../src/modules/task-push/service.ts#L586) |
| Per-iteration `markTaskPushed` call inside `pushTasksForTenant` success branch | **RETIRES with its parent.** | [`task-push/service.ts:727`](../../src/modules/task-push/service.ts#L727) |
| `pushSingleTask` (single-task variant — currently called from DLQ retry UI per `failed_pushes:retry` permission) | **SURVIVES; gains a second caller.** Today: called from `/admin/failed-pushes` retry button. Post-cutover: also called from the new `/api/queue/push-task` QStash handler. The function body is unchanged. | [`task-push/service.ts:827`](../../src/modules/task-push/service.ts#L827) |
| Reconcile-branch logic inside `pushSingleTask` (mid-call SF-already-knows-this-AWB recovery) | **SURVIVES.** Reuses the existing reconcile semantic for queue-handler retries that hit an already-pushed task. | [`task-push/service.ts:1002`](../../src/modules/task-push/service.ts#L1002) |
| Per-call `markTaskPushed` call inside `pushSingleTask` success branch | **SURVIVES.** Becomes the only call site for `markTaskPushed` post-cutover. | [`task-push/service.ts:1104`](../../src/modules/task-push/service.ts#L1104) |
| `markTaskPushed` (in `tasks/repository.ts`) | **SURVIVES.** Single caller post-cutover (`pushSingleTask`). | [`tasks/repository.ts:531-549`](../../src/modules/tasks/repository.ts#L531-L549) |
| Existing cron handler at `/api/cron/generate-tasks/route.ts` (the 9-min-runtime offender) | **RETIRES; replaced by new handler.** The new materialization-only handler at the same path subsumes the schedule slot. | [`route.ts`](../../src/app/api/cron/generate-tasks/route.ts) |

**Net effect on the codebase:** ~500 lines of `pushTasksForTenant` + its reconcile/markTaskPushed branches retire. ~330 lines of `pushSingleTask` + its branches stay. One new ~150-line handler is added at `/api/queue/push-task`. One new ~200-line materialization handler replaces the existing cron handler. Net diff is approximately neutral (-300 lines old code + ~350 lines new code), but the architectural posture changes substantially.

**Code-path retirement is staged in the code PR, not this plan PR.** This list serves as the audit-trail for what gets deleted; the actual deletion lives in the implementation PR.

---

## §2 Materialization cron implementation outline

### §2.1 Handler shape (matches §1.1 6-phase model)

`src/app/api/cron/generate-tasks/route.ts` rewrites materially. The sketch below is the canonical implementation outline; if §1.1 and §2.1 disagree, §1.1 wins and §2.1 must be re-amended:

```typescript
// Sketch — 6-phase per-tenant invocation matching §1.1
export async function GET(req: Request): Promise<Response> {
  // (Handler-entry, NOT per-tenant)
  // 0a. CRON_SECRET check (unchanged)
  // 0b. Compute target_date = today + 14 days
  // 0c. Enumerate cron-eligible tenants (unchanged β filter from list-cron-eligible-tenants.ts)

  for (const tenant of eligibleTenants) {
    // PHASE 1 — Reconciliation scan (NEW per §1.1).
    //   Read tasks.id WHERE tenant_id = tenant.id AND pushed_to_external_at IS NULL.
    //   These are: (a) rows that crashed between Phase 4 commit and Phase 5 enqueue
    //   on a previous tick, (b) the cutover backlog (Q3 probe: 114 fresh-butchers
    //   tasks). Self-healing on every tick. Result: reconciliationTuples[].
    //   IMPORTANT: filter address_id IS NOT NULL on this scan too — null-address rows
    //   (per §2.2 refuse-to-materialize policy below) should NOT be re-enqueued; they
    //   stay quarantined until the operator-actionable counter (§2.2) is resolved.

    // PHASE 2-4 — single per-tenant transaction (the materialization tx)
    await withServiceRole(async (tx) => {
      // PHASE 2: bulk INSERT…SELECT into tasks. Per-row address_id resolved per §2.3
      //   four-layer COALESCE chain (override_one_off → override_forward → rotation
      //   → primary). Subscriptions whose chain returns NULL are SKIPPED with the
      //   §2.2 quarantine policy (no INSERT for that (sub, target_date), counter
      //   bumped). RETURNING id for newInsertedIds[].
      // PHASE 3: UPDATE subscription_materialization.materialized_through_date
      //   = target_date for affected subs.
      // PHASE 4: INSERT task_generation_runs row with status='completed',
      //   target_date = target_date, started_at, completed_at, projected_count,
      //   subscriptions_walked, tasks_created, tasks_skipped_existing.
      // tx COMMIT here — this is the durability boundary for the materialization side.
    });

    // PHASE 5 — post-commit QStash batch enqueue.
    //   Build the union: reconciliationTuples ∪ newInsertedIds.
    //   Chunk to batches of 100; for each chunk:
    //     await qstashClient.batchJSON(chunk.map(t => ({
    //       url: `${PUBLIC_BASE_URL}/api/queue/push-task`,
    //       body: { tenant_id, task_id: t },
    //       deduplicationId: t,  // task_id — load-bearing for at-least-once safety
    //     })));
    //   Failures here are logged + Sentry-captured but do NOT roll back Phase 4 commit.
    //   Next-tick reconciliation (Phase 1) re-discovers any missed rows.
  }

  // PHASE 6 — handler-exit.
  // Log per-tenant + total wall-clock + tasks_created + tasks_enqueued + reconciliation_count.
  // Return summary JSON.
}
```

Materialization phase still runs inside `withServiceRole` because cron is a system actor. Inserting tasks per the address-rotation lookup pattern (deferred to part 2 in PR #139) lands HERE in the rewrite — this is the part-2 deferral resolved.

**Sketch-vs-§1.1 reconciliation note:** earlier draft put enqueue inside the per-tenant tx (step "e"). That was wrong — it would couple QStash availability to materialization durability and re-introduce the cross-system race §1.1 explicitly designed against. The corrected sketch above lifts enqueue out of the tx into Phase 5.

### §2.2 Address-rotation honoring + null-address policy (part-2 deferral resolved)

The deferred §2 generator code from Day-13 plan §2 lands in this Day-14 code PR.

**Address resolution order — four layers, most-specific-first.** See §2.3 for the canonical SQL with all four layers. Summary order:
1. Active `address_override_one_off` for `target_date` (most specific — single-day operator override).
2. Active `address_override_forward` whose `start_date <= target_date`, taking the most recent (`MAX(start_date)`) when multiple are present (operator's running address change, until superseded by a newer forward override).
3. `subscription_address_rotations` row for `EXTRACT(ISODOW FROM target_date)` (per-weekday rotation rule).
4. Consignee primary address (`addresses.is_primary = true`, guaranteed-unique by 0014's partial UNIQUE — see §2.3).

**Null-address policy: refuse to materialize (the row).** If all four layers return NULL for a `(subscription_id, target_date)` tuple, **skip the INSERT for that tuple**. The materialization SQL filters out those rows in the WHERE clause (or treats the COALESCE result as a guard predicate). The skipped tuple is logged as a warning + Sentry-captured + bumps an operational counter `materialization.address_resolution_failed` keyed on `{tenant_id, consignee_id, subscription_id, target_date}`.

**Why refuse-to-materialize, not materialize-with-NULL:**
- Failing at SF push masks the data gap: it would surface as a generic `failed_pushes` row with reason `bad_request`, indistinguishable from SF flakiness or genuine SF-side errors. Diagnosis at that point requires drilling into payload inspection.
- Refuse-to-materialize fails upstream where the diagnosis is unambiguous: the consignee has neither a rotation rule for that weekday, nor a primary address, nor an active override. The fix lives in the consignee-onboarding UI, not in the integration layer.
- DLQ stays clean: `failed_pushes` reflects real SF integration issues, not data-completeness gaps.
- The operational counter surfaces this as merchant-visible telemetry on Day-18 polish (or Phase 2 if observability surface isn't built yet).

**Audit-event-vs-counter decision (TBD — Love confirms before code PR):** the brief's locked 9-event audit vocabulary (per `memory/project_brief_audit_event_count_correction.md`) does NOT include a `materialization.address_resolution_failed` event. Two options:
- **(a) Operational counter + Sentry only** (no audit event). Lighter-weight; doesn't require brief amendment; counter is queryable from app metrics. **Recommended for MVP** — preserves the locked 9-event vocabulary and the v1.2 amendment protocol.
- **(b) Add `materialization.address_resolution_failed` as the 10th audit event.** Requires brief amendment + version bump to v1.3. Heavier, but gives the failure first-class audit-trail status.

**MVP default:** option (a). Surface to Love at code-PR review time; if Love wants option (b), file the brief amendment first per the v1.0+ amendment protocol (`decision_*.md` + version bump).

`tasks.address_id` is nullable per Day-13 plan §1.3.1 Condition 3 — but post-this-amendment, **no row is ever inserted with `address_id IS NULL` from the cron path**. The nullable column posture remains for future-proofing (e.g., manual operator-created tasks pre-rotation-setup); the cron-materialization path enforces NOT NULL by construction.

### §2.3 Schema-aware exception application (part-2 deferral resolved)

Exception types split into **two categories** with different effects on materialization:

| Category | Exception types | Effect | Resolution location |
|---|---|---|---|
| **Skip-the-date** (no INSERT) | `skip`, `pause_window` | The materialization WHERE clause excludes the `(subscription_id, target_date)` tuple entirely. No task row created; no QStash message; calendar UI sources SKIPPED indication from the `subscription_exceptions` row. | WHERE clause |
| **Override-the-address** (INSERT with override's address_id) | `address_override_one_off`, `address_override_forward` | The materialization INSERT proceeds, but the `address_id` column resolution prefers the override's `address_override_id` over the rotation/primary fallback. The row IS materialized — the override only redirects the address. | COALESCE chain in SELECT |
| **Goodwill addition** (INSERT with rotation/primary; no override) | `append_without_skip` | Materializes a tail-end task per §3.1.6 BRD pattern. Address resolution falls through to rotation → primary (no override layer applies). The exception row exists for audit; it does not redirect anything during materialization. | (Treated as a normal materialization; the exception row's effect is on `subscription.end_date`, applied at exception-creation time, not at materialization time.) |

**Canonical SQL pattern** — corrected COALESCE order per amendment 4 (override-aware, primary-UNIQUE-aware):

```sql
INSERT INTO tasks (..., address_id, ...)
SELECT
  s.id AS subscription_id,
  s.tenant_id,
  s.consignee_id,
  target_date,
  -- Address resolution: 4-layer COALESCE, most-specific-first.
  -- The four layers map exactly to §2.2's resolution order; row is
  -- excluded from INSERT (see WHERE below) if all four return NULL,
  -- per §2.2 refuse-to-materialize policy.
  COALESCE(
    -- Layer 1: address_override_one_off for THIS date (most specific)
    (SELECT e.address_override_id
       FROM subscription_exceptions e
      WHERE e.subscription_id = s.id
        AND e.type = 'address_override_one_off'
        AND e.start_date = target_date
        AND e.address_override_id IS NOT NULL
      LIMIT 1),
    -- Layer 2: most-recent active address_override_forward
    -- (operator's running address change, until superseded)
    (SELECT e.address_override_id
       FROM subscription_exceptions e
      WHERE e.subscription_id = s.id
        AND e.type = 'address_override_forward'
        AND e.start_date <= target_date
        AND e.address_override_id IS NOT NULL
      ORDER BY e.start_date DESC
      LIMIT 1),
    -- Layer 3: per-weekday rotation rule
    (SELECT r.address_id
       FROM subscription_address_rotations r
      WHERE r.subscription_id = s.id
        AND r.weekday = EXTRACT(ISODOW FROM target_date)::int),
    -- Layer 4: consignee's primary address
    -- The is_primary partial UNIQUE in 0014 (PR #139) — `UNIQUE
    -- (consignee_id) WHERE is_primary = true` — guarantees AT MOST
    -- one primary per consignee, so LIMIT 1 here is a defense-in-depth
    -- guard, not the load-bearing constraint. ORDER BY a.id added for
    -- deterministic tie-break in the (constraint-violated) impossible
    -- case where two primaries somehow coexist.
    (SELECT a.id
       FROM addresses a
      WHERE a.consignee_id = s.consignee_id
        AND a.is_primary = true
      ORDER BY a.id
      LIMIT 1)
  ) AS address_id,
  ...
FROM subscriptions s
WHERE
  s.status = 'ACTIVE'
  AND s.tenant_id = :tenant_id
  AND target_date BETWEEN s.start_date AND s.end_date
  AND EXTRACT(ISODOW FROM target_date)::int = ANY(s.days_of_week)
  -- Skip-the-date exceptions: exclude the tuple
  AND NOT EXISTS (
    SELECT 1 FROM subscription_exceptions e
     WHERE e.subscription_id = s.id
       AND ((e.type = 'skip' AND e.start_date = target_date)
         OR (e.type = 'pause_window'
             AND target_date BETWEEN e.start_date AND e.end_date))
  )
  -- Refuse-to-materialize guard (§2.2): skip rows whose 4-layer
  -- COALESCE returns NULL — the COALESCE result IS NULL only when
  -- ALL four layers fail, so this guard fires the §2.2 quarantine.
  -- Note: the same COALESCE chain is recomputed inline; in the actual
  -- code PR this should be hoisted via LATERAL or a CTE so the chain
  -- evaluates exactly once per row (perf + readability).
  AND COALESCE(
    (SELECT e.address_override_id FROM subscription_exceptions e
       WHERE e.subscription_id = s.id AND e.type = 'address_override_one_off'
         AND e.start_date = target_date AND e.address_override_id IS NOT NULL LIMIT 1),
    (SELECT e.address_override_id FROM subscription_exceptions e
       WHERE e.subscription_id = s.id AND e.type = 'address_override_forward'
         AND e.start_date <= target_date AND e.address_override_id IS NOT NULL
       ORDER BY e.start_date DESC LIMIT 1),
    (SELECT r.address_id FROM subscription_address_rotations r
       WHERE r.subscription_id = s.id
         AND r.weekday = EXTRACT(ISODOW FROM target_date)::int),
    (SELECT a.id FROM addresses a
       WHERE a.consignee_id = s.consignee_id AND a.is_primary = true
       ORDER BY a.id LIMIT 1)
  ) IS NOT NULL;
```

**Implementation note:** the duplicate COALESCE chain (one in SELECT, one in WHERE) is illustrative — the code PR should hoist it via a `LATERAL` join or a CTE so the chain evaluates exactly once per row. Side-by-side duplication would also let the SELECT and WHERE diverge silently, which is exactly the bug class §2 is designed against.

`countMatchingSubscriptions` (the cap-projection mirror used by Day-13's volumetric guard) mirrors the same WHERE so cap projection stays accurate post-amendment.

### §2.4 Per-exception-type INSERT/no-INSERT decision

Replaces the prior single-line decision with an explicit row-by-row policy that the §2.3 SQL implements verbatim:

| `subscription_exceptions.type` | INSERT row? | `address_id` source if INSERT | Audit/UX surface |
|---|---|---|---|
| `skip` | **No** | n/a | `SKIPPED` indication on calendar comes from the `subscription_exceptions` row; `subscription.exception.created` audit event already emits at exception-creation time (per PR #139 §3.2 audit registrations). |
| `pause_window` | **No** | n/a | Pause indication on calendar comes from the `subscription_exceptions` row's `[start_date, end_date]` span; `subscription.paused` audit event emits at pause-creation time (pre-existing event from `event-types.ts:320`). |
| `address_override_one_off` | **Yes** | `subscription_exceptions.address_override_id` (Layer 1 of §2.3 COALESCE) | `subscription.address_override.applied` audit event emits at exception-creation time. Calendar shows the override-address in the popover for that single date. |
| `address_override_forward` | **Yes** | `subscription_exceptions.address_override_id` (Layer 2 of §2.3 COALESCE) — the most-recent active forward override | `subscription.address_override.applied` audit event emits at exception-creation time. Every materialized task for `target_date >= override.start_date` (until superseded) carries the override's address_id. |
| `append_without_skip` | **Yes** (one extra tail-end task per the BRD §3.1.6 pattern) | Rotation/primary fallback (§2.3 Layers 3-4); no override applies | `subscription.end_date.extended` audit event emits at exception-creation time with `triggered_by='append_without_skip'`; the materialized tail-end task is indistinguishable on the calendar from a regular materialized task except for the extended `end_date`. |

**Why this decomposition matters for §2.3 SQL:** the SQL's WHERE clause excludes only the *skip-the-date* category (`skip` + `pause_window`); the *override-the-address* category is handled in the COALESCE chain, not the WHERE; the *goodwill* category is handled implicitly by the subscription's already-extended `end_date` (the materialization horizon walk picks up the new tail-end date naturally — no special SQL needed). This is why §2.3's WHERE has 2 EXISTS predicates, not 4.

**Audit trail invariant:** every exception type emits its own audit event at exception-CREATION time (not at materialization time). The materialization handler does NOT emit audit events. This keeps the audit vocabulary at the locked 9-event count and avoids the "every task generation emits an audit row" anti-pattern that would balloon `audit_events` at full demo volume.

### §2.5 Materialization-phase throughput math (NEW per amendment 6)

**Problem:** §1.1 amendment claims "total wall-clock seconds" for the materialization handler. The QStash batch enqueue cost was pinned (~1-2s for 10 chunks of 100 messages); the materialization SQL itself was not.

**Estimate at full demo volume (845 active subs across 3 tenants × 14 horizon-days = up to 11,830 candidate `(subscription_id, target_date)` tuples):**

| Operation | Estimated wall-clock | Reasoning |
|---|---|---|
| Phase 1 reconciliation scan | <100ms per tenant | Indexed scan on `tasks(tenant_id) WHERE pushed_to_external_at IS NULL`; cutover-day backlog is 114 rows total per Q3 probe, smaller thereafter |
| Phase 2 INSERT…SELECT (per tenant) | **2-8s per tenant** | The 4-layer COALESCE chain has nested correlated subqueries; per-row cost grows with `subscription_exceptions` and `subscription_address_rotations` size. At 845/3 = ~280 subs/tenant × 14 days = 3,920 candidate rows per tenant, with ~5-10ms/row when subqueries hit indexed lookups, that's 20-40s — **but** most subs likely have already-materialized rows for most dates (only the new tail-end day each day is candidate), so steady-state is ~280 rows/tenant/day, ~1.4-2.8s/tenant. **Cutover day (initial materialization of all 14 horizon days) is the worst case.** |
| Phase 3 materialization update | <100ms per tenant | Indexed UPDATE on `subscription_materialization` PK |
| Phase 4 run-row insert | <100ms | Single INSERT |
| Phase 5 batchJSON enqueue | 1-2s per tenant | Per §1.1, ~10 chunks × ~100ms each per tenant (one-third of total since 3 tenants) |

**Steady-state estimate:** ~3-5s per tenant × 3 tenants = **9-15s total wall-clock per handler invocation.** Well within Vercel's 300s envelope.

**Cutover-day estimate (one-time, when materialization horizon advances 14 days at once for all subs):** ~25-50s per tenant × 3 tenants = **75-150s.** Still within envelope, but not by the order-of-magnitude steady-state suggests.

**§0 verification item to lock during code-PR prep (NEW):** run an `EXPLAIN ANALYZE` on the canonical §2.3 INSERT…SELECT against staging data sized to full demo volume. Pin the actual numbers in the code PR description. If cutover-day projects above ~200s, add a Phase 0 horizon-throttle (advance horizon 1-2 days/tick instead of 14-at-once on first run).

Without this verification, the post-amendment "total wall-clock seconds" claim in §1.1 is supported only by hand math; the EXPLAIN ANALYZE is the load-bearing evidence.

---

## §3 14-day rolling horizon advance

### §3.1 Subscription_materialization table (already shipped in PR #139)

Schema lands in PR #139's `0015_subscription_exceptions_and_materialization.sql`. One row per subscription:

```sql
CREATE TABLE subscription_materialization (
  subscription_id            uuid PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
  tenant_id                  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  materialized_through_date  date NOT NULL,
  last_materialized_at       timestamptz NOT NULL DEFAULT now()
);
```

This Day-14 work seeds initial rows (one-time backfill, see §3.3) and adds the cron logic that reads + updates them.

### §3.2 Horizon-advance algorithm

Per [PLANNER_PRODUCT_BRIEF.md §3.1.5](../PLANNER_PRODUCT_BRIEF.md):

```
For each cron-eligible tenant:
  For each active subscription S:
    IF subscription_materialization[S].materialized_through_date < today + 14:
      generate tasks for S in date range
        (subscription_materialization[S].materialized_through_date + 1, today + 14)
      apply per-weekday eligibility filter (s.days_of_week)
      apply schema-aware exception exclusion (§2.3)
      apply address-rotation lookup (§2.2)
      enqueue QStash message per inserted task
    UPDATE subscription_materialization[S].materialized_through_date = today + 14
    UPDATE subscription_materialization[S].last_materialized_at = now()
```

### §3.3 One-time backfill

On Day-14 deploy: one-time backfill INSERT seeding `subscription_materialization` for every existing active subscription with `materialized_through_date = today` (so the next cron tick generates the full 14-day horizon for each).

Backfill SQL sketch (lands in Day-14 code PR's first migration or in a one-time script per the existing `scripts/onboard-merchant.mjs` pattern):

```sql
INSERT INTO subscription_materialization
  (subscription_id, tenant_id, materialized_through_date)
SELECT id, tenant_id, current_date
FROM subscriptions
WHERE status = 'active'
ON CONFLICT (subscription_id) DO NOTHING;
```

### §3.4 Cutover posture

The new materialization cron coexists with the old single-handler cron only at deploy boundary. Cutover sequence:

1. Day-14 morning: deploy code PR; new materialization cron at the existing schedule
2. Old single-handler cron handler retired in same deploy (the rewrite IS the route handler)
3. First post-deploy cron tick: backfill rows from §3.3 land via migration; cron walks the now-populated subscription_materialization table and materializes 14 days for each subscription
4. QStash messages enqueue per inserted task; push handler drains them async

No old-vs-new dual-write window. The push handler drains the existing unpushed-task backlog (per §5.4) plus the new materialization output indistinguishably.

---

## §4 Run-row idempotency hardening — `(tenant_id, target_date)` UNIQUE

### §4.1 Why

Per the [cron memo](../followups/cron_materialization_push_coupling.md) §3 Run-A vs Run-B race:

> Two concurrent runs walked the same tenant set against the same external API — wasted SF API budget and duplicate audit churn.
> The race was safe **only because** generation was fast enough to commit before the second run started; if generation phase ever slows, the safety margin disappears.

Adding `(tenant_id, target_date)` UNIQUE on `task_generation_runs` makes the safety hard at the schema layer. A second run for the same target_date hits SQLSTATE 23505 and short-circuits — same posture as the existing `(tenant_id, window_start, window_end)` UNIQUE.

### §4.2 Migration shape — `0020_task_generation_runs_target_date_unique.sql`

```sql
-- 0020_task_generation_runs_target_date_unique.sql (sketch — final lands in code PR)

-- Add target_date column. Initially nullable to allow the backfill step
-- to populate it; promoted to NOT NULL after backfill.
ALTER TABLE task_generation_runs
  ADD COLUMN target_date date;

-- Backfill: existing rows have target_date implicit in window_end's
-- next-calendar-day-in-Dubai computation. The cron handler computed
-- targetDate = nextCalendarDateInDubai(now) at handler entry; for
-- historical rows we approximate via window_start + 4h shift.
-- (4h shift = UTC→Dubai timezone offset; same calendar-day semantic the
-- handler uses.)
UPDATE task_generation_runs
   SET target_date = (window_start + INTERVAL '4 hours')::date + 1
 WHERE target_date IS NULL;

ALTER TABLE task_generation_runs
  ALTER COLUMN target_date SET NOT NULL;

-- §0.4 Q2 verification: existing rows must have no (tenant_id, target_date)
-- duplicates pre-add. If duplicates exist, dedup step lands here BEFORE the
-- UNIQUE.
CREATE UNIQUE INDEX task_generation_runs_tenant_target_date_unique_idx
  ON task_generation_runs (tenant_id, target_date);
```

### §4.3 Backfill caveat

The backfill UPDATE at §4.2 assumes `window_start + INTERVAL '4 hours'` matches the handler's `nextCalendarDateInDubai` computation. For all historical rows generated by the existing cron at 12:00 UTC, this is exact (12:00 UTC + 4h = 16:00 Dubai → next-day = (12:00 UTC + 4h)::date + 1).

For manual-trigger rows (where `window_start` is the manual-trigger UTC instant), the backfill is approximate but still correct as long as the manual trigger occurred between 00:00 and 20:00 UTC (Dubai 04:00–24:00). Outside that range the +4h shift crosses a calendar day and the backfill could mis-derive target_date by one day. Operational impact: a single historical row could be off by one day. Acceptable for a backfill of a handful of historical rows; surfaced in the migration header comment.

If §0.4 Q2 finds duplicates from this approximation, the dedup step runs before the UNIQUE add.

### §4.4 Handler reaction on conflict

The materialization cron handler attempts the run-row INSERT for `(tenant_id, target_date)`. On 23505:
- Read the existing row
- If `status='completed'` → skip (idempotent re-run)
- If `status='running'` → skip (concurrent run is winning the race)
- If `status='failed'` → DO NOT auto-retry; ops triage decides

Same shape as the existing `(tenant_id, window_start, window_end)` conflict path at [`task-generation/repository.ts:118-163`](../../src/modules/task-generation/repository.ts#L118-L163), just keyed on `(tenant_id, target_date)` instead of the window tuple.

---

## §5 Push handler implementation outline

### §5.1 Endpoint shape

`POST /api/queue/push-task` (new route):

```typescript
// Sketch
import { verifySignatureAppRouter } from "@upstash/qstash/dist/nextjs";
export const POST = verifySignatureAppRouter(async (req: Request) => {
  const { tenant_id, task_id } = await req.json();
  // 1. Read task by id (system actor — withServiceRole)
  // 2. Skip if pushed_to_external_at IS NOT NULL (idempotent — covers QStash redelivery)
  // 3. Resolve SF credentials per tenant (existing src/modules/credentials/suitefleet-resolver.ts)
  // 4. Call SF createTask via existing adapter (src/modules/integration/providers/suitefleet/...)
  // 5. On 2xx: markTaskPushed (existing tasks/repository.ts:531-543)
  // 6. On AwbExists 4xx: reconcile via existing D8-4b path (task-push/service.ts handlers)
  // 7. On other failure: throw — QStash retries per §5.2
});
```

`verifySignatureAppRouter` is the QStash SDK's signature-verification wrapper — gates the endpoint to QStash-signed deliveries only. Same posture as the existing `/api/cron/generate-tasks` CRON_SECRET check.

### §5.2 Retry posture — QStash native + DLQ

QStash retries per its built-in policy (configurable per-message; 3 retries with exponential backoff is the default). After the final retry exhausts:

- QStash optionally enqueues to a DLQ topic (configurable)
- We mirror to our existing `failed_pushes` table (the existing DLQ surface from D8-5 / D8-4) so operators see the failure in the existing `/admin/failed-pushes` UI without learning a new surface

Existing `failed_pushes` row shape unchanged. New emission path: from the push handler's catch-all on QStash-final-retry-exhausted (signaled via QStash's failure callback or via our explicit `markFailedPush` after handler-side retry ceiling).

### §5.3 Idempotency

Three layers:

1. **QStash message id** — QStash deduplicates messages by id at the broker layer (avoids the same message being enqueued twice from the materialization cron)
2. **Handler-level skip** — the handler's step 2 (`Skip if pushed_to_external_at IS NOT NULL`) catches QStash redelivery of an already-pushed task
3. **SF AwbExists 4xx reconcile** — existing D8-4b path catches the case where SF accepted the task on a prior attempt that we lost track of

### §5.4 Backlog drainage

On Day-14 deploy, the new push handler inherits the unpushed-task backlog from PR #139 and prior days. One-time backfill enqueues every existing `pushed_to_external_at IS NULL` task as a QStash message:

```typescript
// One-time script: scripts/backfill-push-queue.mjs (sketch)
// SELECT id, tenant_id FROM tasks WHERE pushed_to_external_at IS NULL
// for each: enqueue QStash message { tenant_id, task_id }
```

§0.4 Q3 sizes this backlog. At demo data volumes, expected to be <1000 messages — drains in minutes through the QStash queue.

---

## §6 LastMileAdapter interface posture

### §6.1 No interface boundary change

`src/modules/integration/providers/suitefleet/last-mile-adapter-factory.ts` and the `LastMileAdapter` interface surface stay unchanged. The push handler at §5.1 calls the same adapter methods as the old single-handler cron — `createTask`, `getTaskByAwb`, etc. The decoupling is at the **caller** layer (handler vs cron), not at the adapter layer.

### §6.2 SF auth caching unchanged

Per the existing token cache at `src/modules/integration/providers/suitefleet/token-cache.ts` — 24h JWT cached per-tenant, refreshed on expiry. The push handler benefits from the cache the same way the single-handler cron did. No change.

### §6.3 SF rate-limit posture

Existing throttle is 5 req/sec inline in the cron. With QStash dispatching messages, we lose the inline throttle — QStash delivers as fast as the consumer accepts. Three options:

| Option | Mechanism |
|---|---|
| **A. QStash rate-limit per topic (recommended)** | QStash supports per-topic rate-limits; configure 5 msg/sec at the topic level |
| B. Per-handler in-memory delay | Handler `await sleep(200ms)` before each SF call. Crude; doesn't scale across concurrent invocations |
| C. SF-side: rely on SF rate-limiting | Accept 429s from SF; QStash retries them |

**Recommendation: A.** Configured at QStash topic-create time; one-line config.

---

## §7 Test coverage

### §7.1 Materialization cron tests

| Test | What it pins |
|---|---|
| Materialization happy path: subscriptions A+B, both eligible Mon-Fri, today=Mon → 10 tasks generated for each (5 per sub × 2 weeks); subscription_materialization rows updated | New cron handler shape + horizon-advance |
| Materialization with skip exception: sub A has skip exception on Wed of week 1 → 9 tasks generated for A (Mon, Tue, Thu, Fri × 2 weeks + Wed week 2) | §2.3 schema-aware skip exclusion |
| Materialization with pause_window: sub B paused for week 1 → 5 tasks generated for B (week 2 only) | §2.3 schema-aware pause exclusion |
| Materialization with address_rotation: sub C has rotation Mon→home, Tue→office, Wed (no rotation row) → tasks land with respective address_ids; Wed task uses primary fallback | §2.2 address-rotation honoring |
| Materialization with address_override_forward: sub D has forward override starting Wed week 1 → tasks from Wed week 1 onward use override address | §2.3 forward-override resolution |
| Run-row UNIQUE conflict: two concurrent calls for same (tenant, target_date) → second short-circuits per §4.4 | §4 idempotency hardening |
| Materialization enqueues QStash message per task: assert N tasks → N enqueue calls (mocked QStash client) | §1.1 enqueue path |

### §7.2 Push handler tests

| Test | What it pins |
|---|---|
| Push handler happy path: receive `{ tenant_id, task_id }` → SF createTask called → markTaskPushed called → 200 returned | §5.1 happy path |
| Push handler skips already-pushed task: receive `{ tenant_id, task_id }` where `pushed_to_external_at IS NOT NULL` → SF NOT called → 200 returned | §5.3 idempotency layer 2 |
| Push handler reconciles AwbExists: SF returns 4xx with AwbExists → existing D8-4b reconcile path runs → markTaskPushed called with reconciled external_id | §5.3 idempotency layer 3 |
| Push handler throws on transient error: SF returns 5xx → handler throws → QStash retries (test asserts handler returned non-2xx, doesn't test QStash itself) | §5.2 retry trigger |
| Push handler signature verification: missing/invalid QStash signature → 401 returned | §5.1 endpoint gate |

### §7.3 Migration test for `0020`

| Test | What it pins |
|---|---|
| Existing rows backfill correctly: insert pre-migration row with `window_start = '2026-05-04T12:00:00Z'`, run migration, assert `target_date = '2026-05-05'` | §4.2 backfill correctness |
| UNIQUE constraint catches duplicate (tenant_id, target_date): insert two rows → second hits 23505 | §4 schema enforcement |

### §7.4 Integration test for end-to-end flow

Single integration test that:
1. Triggers the materialization cron handler (via test invocation, not real HTTP)
2. Asserts tasks are inserted
3. Asserts QStash messages enqueued (mocked QStash client)
4. Triggers the push handler with a sample message
5. Asserts SF createTask was called (mocked SF adapter)
6. Asserts `pushed_to_external_at` is set

---

## §8 Out of scope (explicit boundaries)

### Day-14 part-2 service-surface plan PR (separate)

This Day-14 cron decoupling plan PR does NOT cover the service-layer surface for the exception model:
- `addSubscriptionException` / `pauseSubscription` / `resumeSubscription` / `changeConsigneeCrmState` / `createMerchant` / `appendWithoutSkip`
- API routes
- UI surfaces

That work is a separate Day-14 part-2 plan PR (per Day-13 plan §6) sequenced after this decoupling lands.

### Phase 2 deferrals carried forward

Per [PLANNER_PRODUCT_BRIEF.md §4](../PLANNER_PRODUCT_BRIEF.md), unchanged by this plan:
- Configurable cutoff time per merchant
- Configurable max_skips_per_subscription per merchant
- Per-merchant blackout date editor
- Per-tenant SuiteFleet credential isolation (first post-pilot item)
- Reconciliation job between Planner and SF
- Audit log viewer UI

### `'suspended'` tenant status service surface (per Day-13 plan §6)

Decision deferred: whether `'suspended'` becomes an additional service action surface (e.g., `merchant:suspend` permission + `suspendMerchant` service + `merchant.suspended` audit event) OR stays operationally-set-only. Default if undecided: stays reserved, no part-2 service work, revisit Phase 2.

---

## §9 Risks + watch items

| Risk | Mitigation |
|---|---|
| QStash as new SPOF in the critical push path | §5.2 retry → existing `failed_pushes` DLQ; ops surfaces failures in `/admin/failed-pushes` UI without learning a new surface |
| Migration `0020` backfill mis-derives `target_date` for off-hour manual-trigger rows | §4.3 caveat — single-row off-by-one is acceptable; surfaced in migration header |
| QStash topic configuration drift between Production / Preview / Local | §0.4 Q1 verifies env presence; topic-create idempotent (named topic, retry-on-exists) |
| Push handler timeout on SF auth refresh storm (token cache miss for many tenants at once) | Existing token cache amortizes auth across tasks; cold-start risk on Day-14 deploy mitigated by §5.4 backlog drainage being naturally rate-limited |
| Demo dependency: cron decoupling MUST land before Day-19 demo prep | Day-14 implementation has 5 days of buffer (May 6 → May 11); Day-15+ feature work blocks if decoupling fails — surface ASAP if plan-PR review delays |
| `tasks.address_id IS NULL` if both rotation lookup AND primary-address fallback fail | Push handler at §5.1 surfaces actionable error; failed_pushes row with reason `'missing_address'`; operator surfaces in `/admin/failed-pushes` |
| Backwards compat with existing `task-push/service.ts` callers (e.g., DLQ retry endpoint) | Existing `task-push/service.ts` continues to expose its functions; the cron handler stops calling them inline but retry-from-DLQ surface still uses them. No breaking change at the module export level. |

---

## §10 Cross-references

- [memory/followups/cron_materialization_push_coupling.md](../followups/cron_materialization_push_coupling.md) — root-cause memo + decoupling recommendation
- [PLANNER_PRODUCT_BRIEF.md §3.1.1, §3.1.5, §3.3.6, §7](../PLANNER_PRODUCT_BRIEF.md) — push_acknowledged contract surface, 14-day horizon, integration-honesty UI indicator, tier discipline
- [memory/plans/day-13-exception-model-part-1.md §2](../plans/day-13-exception-model-part-1.md) — generator code changes deferred from part-1 land here in §2 of this plan
- [memory/decision_brief_v1_2_amendments_d13_part1.md](../decision_brief_v1_2_amendments_d13_part1.md) — `tasks.pushed_to_external_at` brief amendment that locks the contract surface name
- PR #138 (Day-13 plan, merged `8772aae`) — sequencing predecessor
- PR #139 (Day-13 part-1 code, merged `875bfc4`) — `subscription_materialization` table + `tasks.address_id` + `subscription_address_rotations` + audit/permission surfaces consumed by this Day-14 work
- PR #141 (brief v1.2 amendment, in flight) — locks the `tasks.pushed_to_external_at` column reference
- [vercel.json](../../vercel.json) — current cron schedule
- [src/app/api/cron/generate-tasks/route.ts](../../src/app/api/cron/generate-tasks/route.ts) — current handler being rewritten
- [src/modules/task-push/service.ts](../../src/modules/task-push/service.ts) — current per-task push code being repurposed for the QStash handler
- [src/modules/tasks/repository.ts:531-543](../../src/modules/tasks/repository.ts#L531-L543) — `markTaskPushed` UPDATE (unchanged contract surface)
- [package.json L30](../../package.json#L30) — QStash dep already present
- [.env.example](../../.env.example) — QSTASH_URL + QSTASH_TOKEN env documentation

---

## §11 Plan-PR review checklist

For the reviewer (Love) at plan-PR review time:

- [ ] §0.4 verification queries (Q1–Q4) run; results pasted as PR comment; no existing `(tenant_id, target_date)` duplicates surfaces
- [ ] §0.5 migration count confirmed (single migration `0020`); no other schema changes in this PR
- [ ] §1.2 mechanism choice locked (recommended A: QStash; alternatives B/C documented)
- [ ] §2.4 SKIPPED-vs-no-INSERT decision confirmed (recommended: no-INSERT, audit lives in `subscription_exceptions`)
- [ ] §3.3 one-time backfill posture confirmed (single migration tx OK vs separate script)
- [ ] §3.4 cutover posture confirmed (no dual-write window — old cron handler IS the rewrite target)
- [ ] §4.3 migration backfill caveat acknowledged (single-row off-by-one for off-hour manual-trigger rows is acceptable)
- [ ] §5.2 retry posture confirmed (QStash native retry → existing `failed_pushes` DLQ; no new operator surface)
- [ ] §6.3 SF rate-limit option locked (recommended A: QStash topic rate-limit at 5 msg/sec)
- [ ] §8 part-2 boundary acknowledged (this plan does NOT cover the service-layer surface; that's a separate Day-14 plan PR)
- [ ] §9 demo-dependency risk acknowledged (5-day buffer; surface ASAP if plan-PR review delays)

After approval: T3 hard-stop #1 clears. Day-14 code PR opens for T3 hard-stop #2 verification-only counter-review.

---

**End of plan.**

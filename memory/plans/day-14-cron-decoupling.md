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
  s.status = 'active'
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

### §3.1 Subscription_materialization table (in PR #139 git, NOT yet on prod DB)

Schema lands in PR #139's `0015_subscription_exceptions_and_materialization.sql`. One row per subscription:

```sql
CREATE TABLE subscription_materialization (
  subscription_id            uuid PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
  tenant_id                  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  materialized_through_date  date NOT NULL,
  last_materialized_at       timestamptz NOT NULL DEFAULT now()
);
```

**Migration-deploy dependency (NEW callout per amendment 1, cross-referencing §0.4 Q4):** the `subscription_materialization` table exists in PR #139's git tree (commit `875bfc4`, merged Day-13 EOD) but **has NOT been applied to the production DB** as of Day-14 morning. The §0.4 Q4 probe against production at main HEAD `4731553` returned `relation "subscription_materialization" does not exist`.

**Code PR pre-merge gate MUST verify either:**
- (a) `subscription_materialization` exists in production DB (i.e., PR #139's migrations 0014-0019 have been applied separately, e.g., via the next promotion's `apply-migrations` step), OR
- (b) the code PR description includes the manual SQL-editor step Love runs against production after PR merge but before the next cron tick.

**§3.3 backfill cannot run until 0015 lands on prod.** If both (a) and (b) miss, the first post-deploy cron tick will hit `relation does not exist` and crash, the new handler will never advance horizon, and old `pushed_to_external_at IS NULL` rows will never get re-enqueued. This makes the migration-deploy dependency a **hard-stop** condition on the code PR's pre-merge checklist (added in §11).

This Day-14 work assumes the table is present at code-PR-merge time; it seeds initial rows via the one-time script (§3.3) and adds the cron logic that reads + updates them.

### §3.2 Horizon-advance algorithm (per-subscription detail of §2.1's Phase 2-3 bulk operation)

Per [PLANNER_PRODUCT_BRIEF.md §3.1.5](../PLANNER_PRODUCT_BRIEF.md). **Note:** §3.2 describes the per-subscription logic that the §2.1 sketch's bulk INSERT…SELECT realizes. Enqueue is NOT part of §3.2 — it lives at §2.1 Phase 5 post-commit and operates on the union of (Phase 1 reconciliation rows ∪ Phase 2 newly-inserted rows). Earlier draft incorrectly inlined the enqueue here, contradicting §2.1 — corrected per amendment 2:

```
For each cron-eligible tenant (eligibility filter unchanged from existing β):
  For each subscription S WHERE S.tenant_id = tenant
                          AND S.status = 'active':       # lowercase per 0009_subscription.sql:136-137
    horizon_target = LEAST(today + 14, S.end_date)        # amendment 3: cap at S's natural end
    IF subscription_materialization[S].materialized_through_date < horizon_target:
      # Generation lives inside §2.1's Phase 2 single-tx bulk INSERT…SELECT —
      # this pseudocode describes the per-row decision the SQL implements.
      For target_date in (subscription_materialization[S].materialized_through_date + 1
                          ... horizon_target):
        IF EXTRACT(ISODOW FROM target_date) NOT IN S.days_of_week → skip
        IF skip-the-date exception covers target_date (§2.3 EXISTS guard) → skip
        IF address resolution returns NULL (§2.3 4-layer COALESCE) → skip + bump
                                                                     §2.2 counter
        ELSE → INSERT row with address_id from §2.3 COALESCE
      UPDATE subscription_materialization[S].materialized_through_date = horizon_target
                                            # amendment 3: capped end_date, not unconditional today+14
      UPDATE subscription_materialization[S].last_materialized_at = now()
  # Phase 4 of §2.1: insert task_generation_runs row, target_date = today + 14
  # tx COMMIT here — the §2.1 Phase 2-4 boundary
  # Phase 5 of §2.1: post-commit batchJSON enqueue runs OUTSIDE this loop
```

**Paused-status handling (amendment 4):** subscriptions with `status='paused'` are excluded by the `status = 'active'` filter above. Paused subs do NOT advance horizon while paused. They re-enter the materialization set when `resumeSubscription` (Day-14 part-2 service surface) flips status back to `'active'`; the next cron tick after resume picks them up via the same predicate. This means: (a) materialization stops advancing horizon during pause windows automatically, and (b) the resumeSubscription service does NOT need to manually re-materialize — the cron self-heals on next tick.

**End_date capping (amendment 3):** without the `LEAST(today + 14, S.end_date)` cap, short-runway subscriptions (e.g., 3 days from `end_date`) get marked `materialized_through_date = today + 14` even though their natural end is at `today + 3`. This breaks two future flows:
- **Skip extension:** if operator applies a skip on the last day, `addSubscriptionException` extends `S.end_date` to a new tail-end date; without the cap, the next cron sees `materialized_through_date >= new end_date` and skips re-materialization, leaving the appended task ungenerated.
- **Append-without-skip:** same failure mode — operator-initiated tail-end addition extends `S.end_date`; cron must re-materialize the new dates.

The cap fixes both by ensuring `materialized_through_date` never exceeds the subscription's own end. When `end_date` extends, the next tick sees `materialized_through_date < new horizon_target` and re-materializes the gap.

**§3.2 is the per-subscription detail of §2.1's bulk operation, not a parallel sketch.** The bulk SQL implements this per-subscription logic across all eligible subs in a single INSERT…SELECT for performance; the pseudocode above documents what each per-row decision is.

### §3.3 One-time backfill (script, NOT migration)

**Locked as one-time script (amendment 6):** `scripts/backfill-subscription-materialization.mjs`, mirroring the existing `scripts/seed-subscriptions.mjs` pattern. Migrations stay schema-only per the project's existing convention (R-0 onward — no migration in this repo has data-mutation as its primary purpose). The choice matters because:

- **Migration** would run on every fresh DB clone (CI, integration tests, staging) and re-seed materialization for whatever subscriptions exist there. Test fixtures get unwanted materialization rows; cleanup-then-re-seed becomes the test pattern. Brittle.
- **One-time script** runs once on production, manually, by Love. CI / integration tests / staging do NOT run this; they get fresh `subscription_materialization` seeded by their own test fixtures (a per-test `INSERT INTO subscription_materialization (...) VALUES (...)` per the test's needs). Removes the "every fresh DB clone re-seeds" failure mode.

**Run procedure** (lands in Day-14 code PR description):
1. PR #139's migrations 0014-0019 applied to production (per §3.1 migration-deploy dependency callout — the `subscription_materialization` table must exist before the script runs).
2. Day-14 code PR merged.
3. Love runs `node scripts/backfill-subscription-materialization.mjs` against production credentials (`SUPABASE_DATABASE_URL` from `.env.local` or Vercel CLI env-pull). Script uses `withServiceRole` since it's a system-actor mutation.
4. Script reports `<N> rows seeded; <M> conflicts skipped (already exist)`.
5. Love confirms script output before the next cron tick at 12:00 UTC.

**Backfill SQL sketch** (the script's `executePython`-equivalent body):

```sql
INSERT INTO subscription_materialization
  (subscription_id, tenant_id, materialized_through_date)
SELECT id, tenant_id, current_date
FROM subscriptions
WHERE status = 'active'                                  -- amendment 5 (Day-14 morning correction): lowercase per 0009_subscription.sql:136-137
ON CONFLICT (subscription_id) DO NOTHING;
```

**Casing convention cross-reference (amendment 5, corrected Day-14 morning):** `subscriptions.status = 'active'` is **lowercase** per [`supabase/migrations/0009_subscription.sql:136-137`](../../supabase/migrations/0009_subscription.sql#L136-L137) — the schema CHECK constraint is `CHECK (status IN ('active', 'paused', 'ended'))` and the existing `task-generation` service at `src/modules/task-generation/repository.ts:318` filters on `s.status = 'active'` (lowercase). The brief `PLANNER_PRODUCT_BRIEF.md §3.1.1` line 153 reference applies to **`consignees.crm_state`** only (uppercase: `ACTIVE` / `ON_HOLD` / `HIGH_RISK` / etc.); the brief never specified casing for `subscriptions.status`, and the prior amendment 5 draft incorrectly extrapolated the consignees-crm-state casing to subscriptions. The existing schema convention is canonical at lowercase. Note also that `tenants.status` is independently **lowercase 4-state** (`provisioning` / `active` / `suspended` / `inactive`) per the v1.2 brief amendment (`memory/decision_brief_v1_2_amendments_d13_part1.md`) — three separate enums on three separate tables, two lowercase + one uppercase, all correct as written.

### §3.4 Cutover posture

The new materialization cron coexists with the old single-handler cron only at deploy boundary. Cutover sequence:

1. Day-14 morning: deploy code PR; new materialization cron at the existing schedule
2. Old single-handler cron handler retired in same deploy (the rewrite IS the route handler — the file at `src/app/api/cron/generate-tasks/route.ts` gets replaced atomically)
3. Love runs `scripts/backfill-subscription-materialization.mjs` against production per §3.3 run procedure
4. First post-deploy cron tick: cron walks the now-populated `subscription_materialization` table and materializes up to 14 days for each subscription (capped at `S.end_date` per §3.2)
5. QStash messages enqueue per inserted task via Phase 5 `batchJSON` per §1.1; push handler drains them async (the cutover backlog from prior days is picked up by Phase 1 reconciliation scan automatically — no separate `scripts/backfill-push-queue.mjs` needed; that script's job has been absorbed into §1.1 Phase 1)

No old-vs-new dual-write window. The push handler drains the existing unpushed-task backlog (per §1.1 Phase 1 reconciliation, NOT §5.4) plus the new materialization output indistinguishably.

**Cutover-vs-cron-tick acknowledgment (amendment 7):** the cutover assumes the Vercel deploy and the `0 12 * * *` UTC cron tick do NOT overlap. **Operational mitigation: do not deploy within ±10 minutes of 12:00 UTC.** Vercel's atomic function-swap handles in-flight invocations cleanly, but the cron tick that fires during the swap window is non-deterministic on which handler version runs. Avoiding the deploy window sidesteps the question entirely.

### §3.5 Rollback story (NEW per amendment 8)

If the new materialization cron breaks in a way that needs to be reverted post-cutover:

**Rollback path:** `git revert <Day-14-code-PR-merge-commit-sha>` on main + redeploy via Vercel auto-promote (or manual `vercel promote` per existing pattern). Reverts the route.ts file to the pre-decoupling handler; old cron logic resumes at next schedule tick.

**Data-state durability:**
- `subscription_materialization` rows seeded by §3.3 backfill **persist** in production DB. The old handler does NOT query this table, so the rows are inert; they don't break the old handler.
- `task_generation_runs.target_date` column persists too (additive migration; old handler does not write or query the new column).
- `tasks` rows materialized by the new handler before rollback persist with `pushed_to_external_at = NULL`. The old handler's "find unpushed" query at `task-push/service.ts:373-381` picks them up on its next tick and pushes them inline — exactly the existing flow.
- QStash queue drains naturally — existing in-flight messages process via `/api/queue/push-task` (the route still exists post-rollback unless explicitly removed; if removed in the revert, in-flight messages 404 and re-enter QStash retry → DLQ).

**One-way doors:** schema additions (`subscription_materialization`, `task_generation_runs.target_date`) are durable and additive — they don't break the old handler. The `(tenant_id, target_date)` UNIQUE on `task_generation_runs` is new and could theoretically collide with the old handler's run-row INSERTs if it generated rows with `target_date` populated by some other path; but since the old handler doesn't write `target_date`, the constraint is effectively vacuous from the old handler's perspective.

**Blast radius:** revert affects (a) cron handler runtime, (b) push-queue endpoint behavior. Does NOT affect: existing UI surfaces, existing API routes, existing audit emissions, existing operator workflows.

**Operational mitigation for the revert window:** if the new handler is failing at a tick boundary, the manual `vercel promote` of the previous Production deployment is faster than `git revert` (~30s vs ~5min). Per `memory/feedback_claude_code_executes_default.md`, Love runs the Vercel UI step.

**What this rollback does NOT cover:** if the new handler corrupted data on its way down (e.g., wrote bad rows to `tasks` that the old handler then tries to push), the data-corruption is durable and revert alone won't fix it. Mitigation: §7 test coverage + §0 code-PR pre-flight aim to catch corruption pre-deploy. If corruption-post-deploy happens anyway, the fix is a forward-rolling data-cleanup script, not the revert.

---

## §4 Run-row idempotency hardening — `(tenant_id, target_date)` UNIQUE

### §4.1 Why

Per the [cron memo](../followups/cron_materialization_push_coupling.md) §3 Run-A vs Run-B race:

> Two concurrent runs walked the same tenant set against the same external API — wasted SF API budget and duplicate audit churn.
> The race was safe **only because** generation was fast enough to commit before the second run started; if generation phase ever slows, the safety margin disappears.

Adding `(tenant_id, target_date)` UNIQUE on `task_generation_runs` makes the safety hard at the schema layer. A second run for the same target_date hits SQLSTATE 23505 and short-circuits — same posture as the existing `(tenant_id, window_start, window_end)` UNIQUE.

**Framing clarity (amendment 5 — what this UNIQUE does and does NOT do):** the existing `tasks` partial UNIQUE on `(subscription_id, delivery_date)` + the push gate (`pushed_to_external_at IS NULL`) already made the Run-A/Run-B race **idempotency-safe at the data layer** — duplicate task INSERTs from a second run hit the partial UNIQUE and are deduped; duplicate push attempts hit the push gate and are no-ops. The new run-row UNIQUE is therefore an **efficiency-and-cleanliness fix** (no wasted SF API budget on a doomed second pass, no duplicate audit churn from re-walking the same tenant set, no two run-rows confusing operational telemetry), **not a correctness fix on top of broken behavior**. A reviewer reading this section should not infer that the existing handler is incorrect; it's correct-but-noisy under concurrency, and §4 makes it correct-and-clean.

### §4.2 Migration shape — `0020_task_generation_runs_target_date_column_and_unique.sql`

**Coupled-deploy callout (amendment 4):** This migration AND the new materialization handler MUST land in the same Vercel deploy. The NOT NULL constraint on `target_date` (added at step 5 below) breaks the existing handler's INSERT path — the legacy `task-generation/service.ts:223` insert at `status='completed'` does not write `target_date`, so a migration-only deploy without the handler swap = production cron breaks at the next tick. **Code PR pre-merge gate:** confirm both files (`supabase/migrations/0020_*.sql` AND `src/app/api/cron/generate-tasks/route.ts` rewrite) are in the same PR, both reach prod in the same Vercel deploy, and the post-merge migration apply step (§3.1 callout) is sequenced AFTER the deploy completes (so the new handler is the first writer to encounter the NOT NULL).

The migration is wrapped in an explicit transaction (amendment D4-3) so partial failure rolls all five steps; Postgres DDL is auto-commit by default, which would leave the table in an intermediate state if any step fails mid-way.

```sql
-- 0020_task_generation_runs_target_date_column_and_unique.sql (sketch — final lands in code PR)

BEGIN;

-- (1) Add target_date column. Initially nullable to allow the backfill
-- step (2) to populate it; promoted to NOT NULL at step (4).
ALTER TABLE task_generation_runs
  ADD COLUMN target_date date;

-- (2) Backfill: existing rows have target_date implicit in window_start's
-- Dubai-local-day. The cron handler computes targetDate as Dubai-tomorrow
-- at handler entry; for historical rows we re-derive via the timezone-aware
-- form below (amendment 1 — replaces the prior offset-arithmetic form
-- '(window_start + INTERVAL 4 hours)::date + 1' which was numerically
-- equivalent for the canonical 12:00 UTC tick but obscured the timezone
-- intent and broke under DST or off-hour manual triggers).
UPDATE task_generation_runs
   SET target_date = ((window_start AT TIME ZONE 'Asia/Dubai')::date + 1)
 WHERE target_date IS NULL;

-- (3) Dedup per §0.4 Q2 winning-row policy (amendment D4-2).
-- §0.4 Q2 probe found 20 r3-test-* fixture tenants with 5 dupe runs each
-- on 2026-05-02 (production tenants meal-plan-scheduler / dr-nutrition /
-- fresh-butchers have no dupes). Winning-row policy locked at §0.4: keep
-- MAX(completed_at) within each (tenant_id, target_date) group if any row
-- in the group has completed_at IS NOT NULL; else fall back to
-- MAX(started_at). This preserves the most-recent successful run as row
-- of record and treats fixture noise the same as production race-recovery.
DELETE FROM task_generation_runs
 WHERE id IN (
   SELECT id FROM (
     SELECT id,
       ROW_NUMBER() OVER (
         PARTITION BY tenant_id, target_date
         ORDER BY
           -- Completed rows ranked first within group; among completed,
           -- most-recent completed_at wins. Among non-completed, most-recent
           -- started_at wins.
           (completed_at IS NULL),       -- false (= 0) sorts before true (= 1)
           completed_at DESC NULLS LAST,
           started_at DESC
       ) AS rn
     FROM task_generation_runs
   ) ranked
   WHERE ranked.rn > 1
 );

-- (4) Promote target_date to NOT NULL — every row now has it from step (2).
ALTER TABLE task_generation_runs
  ALTER COLUMN target_date SET NOT NULL;

-- (5) Add the new UNIQUE on (tenant_id, target_date). The pre-existing
-- UNIQUE on (tenant_id, window_start, window_end) — see migration 0012
-- — is RETAINED per §0.5 (amendment D4-4). It provides finer-grained
-- idempotency for within-day re-runs (e.g., manual cron triggers at
-- different UTC instants on the same target_date) even though the new
-- (tenant_id, target_date) UNIQUE conceptually subsumes it. Both
-- co-exist; the new one fires first on cron-tick re-runs, the old one
-- remains as belt-and-braces.
CREATE UNIQUE INDEX task_generation_runs_tenant_target_date_unique_idx
  ON task_generation_runs (tenant_id, target_date);

COMMIT;
```

### §4.3 Backfill caveat

The backfill UPDATE at §4.2 step (2) uses `(window_start AT TIME ZONE 'Asia/Dubai')::date + 1` (amendment 1 — replaces the prior offset-arithmetic form). This explicitly converts the UTC-stored `window_start` to Dubai local time, takes the calendar date, adds one day. Result is identical for the canonical 12:00 UTC cron tick (12:00 UTC = 16:00 Dubai → next day) but the AT TIME ZONE form makes the timezone intent legible and survives DST transitions / off-hour manual triggers without the +4h offset arithmetic crossing a day boundary unexpectedly.

For all historical rows generated by the existing cron at 12:00 UTC, the backfill is exact. For manual-trigger rows (where `window_start` is the manual-trigger UTC instant), the backfill remains correct as long as the manual trigger occurred during a Dubai-business-day; off-hour manual triggers (which are rare in practice — Day-13 morning's manual trigger was the only one observed) carry the same one-day risk as before but fall on the AT TIME ZONE conversion's Dubai-day, not the +4h-offset's UTC-day. Operational impact: a single historical row could be off by one day; acceptable for a backfill of a handful of historical rows; surfaced in the migration header comment.

The dedup step at §4.2 step (3) runs unconditionally — it will no-op if no duplicates exist (the `ROW_NUMBER() > 1` filter is empty), and clean up duplicates if they do (which §0.4 Q2 confirmed they do, all in r3-test-* fixture tenants). No conditional logic needed.

### §4.4 Handler reaction on conflict

The materialization cron handler attempts the run-row INSERT for `(tenant_id, target_date)`. On 23505, read the existing row and branch on `status`. The full status enum is **5 values** per `0012_task_generation_runs.sql:180-186`: `running`, `completed`, `capped`, `skipped_already_run`, `failed` (amendment 3 — the prior 3-branch list was incomplete).

| Existing row's `status` | Handler reaction | Reasoning |
|---|---|---|
| `completed` | **Skip; return short-circuit summary.** | Idempotent re-run — work is already done. No SF calls, no audit churn. |
| `running` AND `started_at >= now() - interval '15 minutes'` | **Skip.** | A concurrent run is genuinely in flight (15-min threshold > materialization-phase wall-clock per §2.5 estimate of 9-15s steady-state, 75-150s cutover). Let it win the race. |
| `running` AND `started_at < now() - interval '15 minutes'` | **STALE — recover (amendment 2, load-bearing).** | Prior tick crashed mid-execution and left the row pinned at `running` indefinitely. Without this branch, every subsequent tick hits 23505, sees `running`, skips, and the cron silently stops materializing for that tenant — a self-DOS vector under crash conditions. Recovery action: log warning, bump operational counter `cron.stale_running_detected` keyed on `{tenant_id, target_date, original_started_at}`, then UPDATE the stale row in-place to `started_at = now()` **using an optimistic-update CAS predicate** (`WHERE id = $stale_id AND started_at = $original_stale_started_at RETURNING id`). If RETURNING is empty, another concurrent handler invocation already reclaimed the stale row — this invocation short-circuits without materializing. If RETURNING returns the row, this invocation owns the recovery and proceeds to materialize as if the row were fresh. The CAS predicate prevents the concurrent-recovery race documented at §9 (multiple handlers detect the same stale row simultaneously and would otherwise both materialize). The 15-minute threshold is conservative — at full demo volume the materialization phase completes in seconds (§2.5: 9-15s steady-state, 75-150s cutover-day worst case), and 15 minutes leaves headroom for a 4×-worse-than-cutover edge case before triggering recovery. |
| `capped` | **Skip; return short-circuit summary.** | The volumetric guard fired on a prior tick (sub count exceeded the cap). Re-running won't change the cap state; ops decides whether to raise the cap or accept the truncation. |
| `skipped_already_run` | **Skip; treat as completed.** | Existing handler emits this when the run-row UNIQUE on `(tenant_id, window_start, window_end)` rejected a same-window re-attempt. The new `(tenant_id, target_date)` UNIQUE makes this status semi-redundant for fresh writes but the historical rows persist with this value; treat as terminal-success. |
| `failed` | **DO NOT auto-retry; surface to ops.** | Prior tick failed for a reason that auto-retry won't fix (e.g., bad credentials, schema drift, application-level bug). Ops triage decides whether to manually re-run. |

Same general shape as the existing `(tenant_id, window_start, window_end)` conflict path at [`task-generation/repository.ts:118-163`](../../src/modules/task-generation/repository.ts#L118-L163), just keyed on `(tenant_id, target_date)` instead of the window tuple, plus the new stale-`running` recovery branch (which also applies to the existing path, post-amendment).

**§7 test coverage to add (forward-reference for §7 amendments):** test cases for each of the 6 branches above, with the stale-`running` recovery branch as the load-bearing one (assert: stale row found → counter incremented → row updated → materialization proceeds → final state is correct).

---

## §5 Push handler implementation outline

### §5.1 Endpoint shape

`POST /api/queue/push-task` (new route):

```typescript
// Sketch
import { verifySignatureAppRouter } from "@upstash/qstash/dist/nextjs";

// Amendment 3 (RUNTIME BUG, load-bearing): Vercel non-cron API routes default
// to 60s on Pro; the existing /api/cron/* routes get 300s by virtue of being
// cron-routes, but /api/queue/* are regular API routes and must opt in.
// Without this declaration, the §1.1 "per-message timeout envelope" claim is
// FALSE — the handler dies at 60s mid-SF-call on slow responses. Code-PR
// pre-merge gate: confirm this line is present.
export const maxDuration = 300;

export const POST = verifySignatureAppRouter(async (req: Request) => {
  const payload = await req.json();
  const { tenant_id, task_id } = payload;

  // 1. Read task by id (system actor — withServiceRole)
  // 1.4 (amendment 1, tenant scoping defense-in-depth):
  //   Assert task.tenant_id === payload.tenant_id; reject with 400 if mismatch.
  //   QStash signature gate prevents external spoofing; this prevents internal
  //   payload-construction bugs in our own materialization handler. Costs
  //   nothing; surfaces the bug class loudly.
  // 1.5 (amendment 2, address_id null guard):
  //   If task.address_id IS NULL, reject with 400 + Sentry-capture
  //   push.address_id_null + log warning. Do NOT crash; QStash retry won't
  //   help (the row's null state is durable); let it land in DLQ via
  //   failureCallback for ops triage. Defense-in-depth against the §2.2
  //   refuse-to-materialize policy lapsing in future hardening.
  // 2. Skip if pushed_to_external_at IS NOT NULL (idempotent — covers QStash
  //    redelivery; complements Layer 1 deduplicationId per §5.3).
  // 3. Resolve SF credentials per tenant (existing
  //    src/modules/credentials/suitefleet-resolver.ts).
  // 4. Call pushSingleTask(tenant_id, task_id) — NOT the SF adapter directly
  //    (amendment 6). pushSingleTask (task-push/service.ts:827) wraps the
  //    adapter call with the existing D8-4b reconcile branch (line 1002)
  //    AND the markTaskPushed call (line 1104). Calling the adapter directly
  //    would lose the reconcile semantic and break the §1.3 retirement
  //    table's claim that pushSingleTask becomes the only post-cutover caller
  //    of markTaskPushed. Code-PR pre-merge gate: confirm queue handler
  //    invokes pushSingleTask, not the adapter.
  // 5. On 2xx: markTaskPushed already called by pushSingleTask (existing
  //    tasks/repository.ts:531-549; reached via pushSingleTask:1104 path).
  // 6. On AwbExists 4xx: reconcile branch already runs inside pushSingleTask
  //    (line 1002 path).
  // 7. On other failure: throw — QStash retries per §5.2; final-retry-
  //    exhausted lands in failed_pushes via failureCallback.
});
```

`verifySignatureAppRouter` is the QStash SDK's signature-verification wrapper — gates the endpoint to QStash-signed deliveries only. Same posture as the existing `/api/cron/generate-tasks` CRON_SECRET check.

### §5.2 Retry posture — QStash native + DLQ via failureCallback

**Pinned QStash retry config (amendment 4):** the materialization handler's `batchJSON` call passes the following parameters on every message (set per-call, not per-account):

| Parameter | Value | Reason |
|---|---|---|
| `retries` | `3` | Three retries before final exhaustion. Matches QStash's default but pinned explicitly so the deploy doesn't silently inherit a different default if Upstash changes it. |
| Backoff | Exponential (QStash default — base 5s, max 60s) | QStash applies exponential backoff with jitter natively; no client-side backoff config needed. |
| Per-call timeout | 30s | Each individual SF call should complete in <1s (typical 660ms per the §0.2 cron memo); 30s gives 30× headroom for SF latency spikes without holding the QStash worker indefinitely. Vercel `maxDuration = 300` (per §5.1 amendment 3) is the hard ceiling above this. |

**Final-retry-exhausted → `failed_pushes` (amendment 5 — failureCallback only, drop the markFailedPush alternative):**

QStash supports a `failureCallback` URL on every published message — when retries exhaust, QStash POSTs to the failureCallback with the failure metadata (message body, error, retry count). The decoupled handler uses this as the canonical signal source:

| Field | Value |
|---|---|
| failureCallback URL | `${PUBLIC_BASE_URL}/api/queue/push-task-failed` |
| Verification | Signature-verified via the same `verifySignatureAppRouter` wrapper as §5.1 |
| Behavior | Reads the original `{ tenant_id, task_id }` payload + the QStash failure metadata, INSERTs a row into `failed_pushes` with reason derived from QStash's error field, surfaces in the existing `/admin/failed-pushes` UI without any operator-side change |
| Schema | Existing `failed_pushes` row shape unchanged from D8-5 / D8-4 |

**Why failureCallback instead of client-side retry counting:** the prior draft offered "QStash failure callback OR explicit `markFailedPush` after handler-side retry ceiling" as alternatives. Client-side retry counting is the wrong posture — same failure class as the §4.4 stale-`running` issue. Tracking retry state in our application means: (a) we have to durably store the count somewhere (which becomes its own consistency problem under handler crashes), (b) we duplicate logic QStash already implements correctly, (c) under crash conditions we have orphaned retry counters with no recovery path. **QStash owns the retry state.** failureCallback is the canonical pattern for "queue-driven retry-exhaustion signal" — pick it, drop the alternative.

### §5.3 Idempotency

Three layers, each with a specific failure mode it absorbs:

1. **QStash deduplication via `deduplicationId: task_id`** (amendment D5-3) — every `batchJSON` message from §1.1 Phase 5 sets `deduplicationId: task_id`. Same task_id seen twice within QStash's deduplication window collapses to one delivery at the broker layer. This is the load-bearing primitive for §1.1's at-least-once-but-idempotent guarantee: when Phase 1 reconciliation re-discovers a task that was already enqueued on a previous tick (because the previous tick's commit succeeded but the enqueue failed mid-call, or the row was already enqueued and the worker hasn't picked it up yet), QStash sees the duplicate `deduplicationId` and silently absorbs the second enqueue. **Without this, every tick would enqueue duplicates of every still-unpushed task.**
2. **Handler-level skip** — the handler's step 2 (`Skip if pushed_to_external_at IS NOT NULL`) catches QStash redelivery of an already-pushed task. This handles the case where Layer 1's dedup window expires (QStash's window is finite) and a stale message lands after the original was processed. Cheap (single DB read), correct (the column is the source of truth on push state).
3. **SF AwbExists 4xx reconcile** — existing D8-4b path inside `pushSingleTask:1002` catches the case where SF accepted the task on a prior attempt that we lost track of (e.g., we crashed after SF 2xx but before `markTaskPushed` returned). Recovers `external_id` from SF and calls `markTaskPushed` to converge state. This is the asymmetric-failure-recovery layer — covers the gap between "we sent it" and "we knew we sent it."

The three layers compose: Layer 1 absorbs duplicate enqueues from our handler; Layer 2 absorbs duplicate deliveries from the queue; Layer 3 absorbs duplicate sends to SF that we lost track of. Each fires on a distinct failure mode; each is independently necessary.

### §5.4 Backlog drainage (no separate script — see §1.1 Phase 1)

**Reframe (amendment D5-2):** the prior draft proposed a separate `scripts/backfill-push-queue.mjs` to enqueue the cutover backlog. Post-§1.1 amendment, this is unnecessary — Phase 1 reconciliation inside the materialization handler scans `tasks WHERE pushed_to_external_at IS NULL` on every tick and includes them in the post-commit `batchJSON` enqueue. The cutover backlog is therefore picked up automatically by the first post-deploy materialization tick. **No separate script — one less code path to maintain.**

**Sizing per §0.4 Q3:** 114 fresh-butchers tasks unpushed; 0 on the other two demo merchants. Total cutover backlog is well under the 1,000 messages/day worst case (§0.6) and drains via QStash within minutes of the first tick.

### §5.5 Observability (NEW per amendment 7)

Per-handler-invocation log (one log line per push attempt, structured): `{ tenant_id, task_id, sf_latency_ms, outcome }` where `outcome ∈ {success, awb_exists_reconciled, retry_throw, address_id_null_rejected, tenant_mismatch_rejected}`. Aggregates derive from this log line.

| Surface | Source | Use |
|---|---|---|
| Per-handler-invocation log | Structured log emitted at handler exit | Sentry / log aggregation; per-task triage |
| QStash queue depth | `client.messages.list({ queue })` from `@upstash/qstash` (read-only API) | Operational dashboard; "is the queue backing up?" gauge |
| `failed_pushes` row count | DB query against existing table | DLQ size; surfaces in `/admin/failed-pushes` already |
| Push success rate | Aggregate over the per-handler log over a rolling window | Health metric — "what fraction of pushes succeeded in last 24h?" |
| `cron.stale_running_detected` counter | Per §4.4 stale-`running` recovery branch | Surfaces handler-level crashes that the new UNIQUE+recovery flow caught |
| `materialization.address_resolution_failed` counter | Per §2.2 refuse-to-materialize policy | Surfaces consignee-data-gap quarantine events |

This subsection establishes that the surface exists — Phase 2 builds dashboards on top. For Day-14 MVP, structured logs + the existing `/admin/failed-pushes` UI are enough; operational counters land in the same handler that emits them and surface via log aggregation queries (no separate metrics service in the pilot scope).

---

## §6 LastMileAdapter interface posture

### §6.1 No interface boundary change

`src/modules/integration/providers/suitefleet/last-mile-adapter-factory.ts` and the `LastMileAdapter` interface surface stay unchanged. The decoupling is at the **caller** layer (handler vs cron), not at the adapter layer.

**Indirect call path (clarification per amendment 1):** Adapter methods are called via `pushSingleTask` (per §5.1 Step 4), NOT directly. The queue handler invokes `pushSingleTask(tenant_id, task_id)`; `pushSingleTask` invokes the adapter. Interface surface and method signatures unchanged from current; only the **caller-of-`pushSingleTask`** set changes — pre-Day-14 it was just the DLQ retry UI; post-Day-14 it's the DLQ retry UI plus the new `/api/queue/push-task` queue handler. The queue handler does NOT bypass `pushSingleTask` to reach the adapter directly; if it did, it would lose the D8-4b reconcile branch (per §1.3 retirement table).

**`getTaskByAwb` fate (amendment 6 optional clarification):** the adapter's `getTaskByAwb` method is invoked only on the reconcile branch inside `pushSingleTask:1002`, never by the queue handler directly. Steady-state push flow uses `createTask` only; `getTaskByAwb` is the asymmetric-failure-recovery call, fired on AwbExists 4xx. Adapter surface is unchanged from current.

### §6.2 SF auth caching unchanged + cold-start latency disclosure

Per the existing token cache at `src/modules/integration/providers/suitefleet/token-cache.ts` — 24h JWT cached per-tenant, refreshed on expiry. The push handler benefits from the cache the same way the single-handler cron did. No change to the cache mechanism.

**Cold-start auth latency disclosure (amendment 2):** the token cache is **in-memory per-Vercel-function-instance** — not a shared cross-instance cache. Cold-start auth refresh adds ~200-500ms to the first message landing on a fresh instance. At demo volume (~1,000 messages/day spread across ~3-5 active Vercel instances during a cron-tick burst), worst case is ~3-5 cold-auth round-trips per cron tick — one per instance, on its first message. Subsequent messages on the same instance hit the warm cache and pay only the SF call latency.

**Why this is acceptable for MVP:** total cold-auth wall-clock per tick is ~3-5 × ~350ms ≈ 1-2s spread across instances (parallel, not serial). Under the §1.1 6-phase model this is invisible — the materialization handler doesn't wait on the queue handler; QStash absorbs the messages and releases at flow-control rate. The cold-auth latency just means the first message per instance takes ~1s instead of ~660ms.

**Phase 2 hardening (deferred):** if observability shows this becoming a real-world bottleneck (e.g., very-spiky traffic patterns where cold-starts dominate), move auth to a shared Upstash Redis cache keyed on `sf-token:{tenant_id}` to amortize across instances. Out of scope for MVP; flagged here so the upgrade path is documented.

### §6.3 SF rate-limit posture

**Where the existing throttle lives + what happens to it (D6-1 reframe):** the existing 5 req/sec throttle lives in `pushTasksForTenant` (cron-loop variant), which retires per §1.3. With the cron-loop function gone, the throttle disappears with it. We re-establish the throttle at the **QStash → push-handler edge** (egress) via Flow Control on the materialization-side `batchJSON` calls per §1.1 Phase 5.

**Mechanism (D6-2 fix):** QStash uses **Flow Control**, not topic-level rate limits. Verified against `node_modules/@upstash/qstash/client-CsM1dTnz.d.ts:142-180`: the `flowControl` parameter on `publishJSON`/`batchJSON` accepts `{ key, parallelism, rate, period }`. Topic-level rate limits do NOT exist in the SDK — the prior draft's "QStash rate-limit per topic" framing was wrong.

**Ingress vs egress (amendment 4 clarification):** Flow Control governs the QStash → push-handler edge (**egress**). Materialization → QStash (**ingress**) bursts ~1,000 messages in ~1-2s per §1.1 amendment (10 sequential `batchJSON` calls × 100 messages each). QStash absorbs the burst and releases at the flow-control rate. **Ingress is intentionally unconstrained** — that's the queue's job, and it's why the materialization handler can advertise "total wall-clock seconds" in §1.1 even at full demo volume.

**Three options + decision:**

| Option | Mechanism | Verdict |
|---|---|---|
| **A. QStash Flow Control (RECOMMENDED)** | Pass `flowControl: { key: 'sf-push-global-mvp', rate: 5, period: '1s' }` on every `batchJSON` call from the materialization handler in §1.1 Phase 5. Flow-control key groups messages so cross-batch calls all count against the same rate budget. | **Adopted.** One-parameter config; no separate infrastructure; matches the egress-rate-limit pattern QStash is designed for. |
| B. Per-handler in-memory delay | Handler `await sleep(200ms)` before each SF call | **Rejected.** Crude (doesn't scale across concurrent Vercel-instance invocations — each instance sleeps independently, so 5 instances ÷ 1 SF rate budget = 25 effective req/sec, blowing the budget by 5×). |
| C. Rely on SF-side 429 throttling | Accept SF's 429 responses; let QStash retry them | **Rejected (amendment 5 explicit).** Deliberately overshoots the rate budget and burns QStash retries on 429s. Wasteful and noisy — every 429 is a doomed round-trip we paid for. Documented here so reviewers don't have to re-litigate. |

**`flowControl.key` naming convention (amendment 3, load-bearing for per-tenant credential migration):**

| Phase | Key | Reason |
|---|---|---|
| **MVP (this work)** | `sf-push-global-mvp` | Per `memory/decision_mvp_shared_suitefleet_credentials.md`, all tenants share a single SF sandbox credential (customer code 588). SF itself enforces a single rate budget across all tenants → global key matches reality. Per-tenant keying would over-throttle (each tenant gets `rate=5` but they all hit the same SF rate ceiling, so we'd serialize what could safely run in parallel). |
| **Phase 2 (deferred)** | `sf-push:{tenant_id}` | Per-tenant credential isolation per `memory/followup_secrets_manager_swap_critical_path.md` — once each tenant has its own SF customer code with its own rate budget, per-tenant keying becomes correct. Migration to per-tenant key is gated on the Secrets Manager swap and lands together with that work; not a separate Day-N task. |

This decision is documented in §10 cross-references and surfaces on the §11 review checklist; the MVP key is locked here so the implementing PR doesn't have to re-decide.

---

## §7 Test coverage

Major expansion post-§0-§6 amendments — every amendment that introduced new behavior gets a corresponding test. §7 grows from the prior 14 rows to ~26 rows + §7.5 split for heavier integration tests.

### §7.1 Materialization cron tests (~12 rows)

| Test | What it pins |
|---|---|
| **Happy path:** subscriptions A+B, both eligible Mon-Fri, today=Mon → 10 tasks generated for each (5 per sub × 2 weeks); `subscription_materialization` rows updated to today+14 | New cron handler shape + horizon-advance per §3.2 |
| **Skip exception:** sub A has `skip` exception on Wed of week 1 → 9 tasks generated for A (Mon, Tue, Thu, Fri × 2 weeks + Wed week 2) | §2.3 skip-the-date EXISTS guard / §2.4 row 1 |
| **Pause_window:** sub B paused for week 1 → 5 tasks generated for B (week 2 only) | §2.3 pause-the-date EXISTS guard / §2.4 row 2 |
| **Address rotation:** sub C has rotation Mon→home, Tue→office, Wed (no rotation row) → tasks land with respective `address_id`s; Wed task uses Layer-4 primary fallback | §2.3 Layers 3-4 / §2.2 |
| **Address_override_one_off (D7-5):** sub F has one-off override on Wed week 1 with `address_override_id = office` → only Wed week 1 task uses Layer-1 override; Thu/Fri/etc. of week 1 use rotation; Wed week 2 uses rotation (override didn't carry forward) | §2.3 Layer 1 / §2.4 row 3 |
| **Address_override_forward + supersession (D7-1 tighten):** sub D has forward override starting Wed week 1 → tasks Wed week 1 onward use Layer-2 override A. **Two-step:** create second forward override starting Fri week 1 → tasks Fri week 1 onward switch to override B (most-recent `start_date` wins per §2.3 Layer 2 ORDER BY); Wed/Thu week 1 stay on override A | §2.3 Layer 2 ORDER BY DESC / §2.4 row 4 |
| **Append_without_skip (NEW):** operator applies `append_without_skip` extending sub E's `end_date` from today+10 to today+12 → cron materializes 2 new tail-end tasks at today+11 and today+12 with rotation/primary fallback (no override applies); no `subscription_exceptions` row affects address resolution; `subscription.end_date.extended` audit emitted at exception-creation, NOT at materialization | §2.4 row 5 |
| **Null-address quarantine (D7-4):** sub G has `consignee` with no rotation rows, no `is_primary=true` address, no override → row NOT materialized for G's eligible dates; `materialization.address_resolution_failed` counter incremented; `tasks` table has no row for `(G.id, target_date)`; `subscription_materialization` does NOT advance for G (the policy is per-row, not per-sub — but if NO row materializes for the entire horizon, horizon shouldn't advance either since there's nothing materialized) | §2.2 refuse-to-materialize policy |
| **Horizon cap at S.end_date (NEW):** sub H has `end_date = today + 3` → only 3 days materialized (Mon, Tue, Wed if today is Sun); `materialized_through_date = today + 3` (NOT today + 14). Then operator applies `append_without_skip` extending end_date to today+5 → next tick fills the gap (days +4, +5); `materialized_through_date = today + 5` | §3.2 amendment 3 LEAST cap |
| **Paused filter (NEW):** sub I has `status = 'paused'` → no rows materialized for I; `subscription_materialization` does NOT advance for I. Then `resumeSubscription` flips I to `'active'` → next tick re-enters I via the predicate; materializes from `materialized_through_date` to current `today + 14` | §3.2 amendment 4 paused filter |
| **Phase 1 reconciliation (D7-3, load-bearing):** seed 3 pre-existing tasks for tenant T with `pushed_to_external_at IS NULL` and `address_id IS NOT NULL` (i.e., from a prior tick that crashed between commit and enqueue). Run materialization cron. Assert: the 3 reconciliation rows appear in the post-commit `batchJSON` payload alongside any newly-inserted rows; mock-asserted QStash dedup absorbs duplicates if any of the 3 had been enqueued by a previous tick (test the `deduplicationId: task_id` is set per row) | §1.1 Phase 1 self-healing claim |
| **Run-row UNIQUE conflict — happy-status branches:** two concurrent calls for same `(tenant, target_date)` → second hits 23505 + reads existing row + branches per §4.4 status. Test all 5 happy-status branches: `completed` skip, `running`-fresh skip, `capped` skip, `skipped_already_run` skip, `failed` no-auto-retry | §4.4 status enum 5 values |
| **Run-row UNIQUE conflict — stale-running recovery (§4.4 amendment 2, load-bearing):** seed existing run-row with `status='running'` AND `started_at < now() - interval '15 minutes'`. Run materialization cron. Assert: stale row detected; `cron.stale_running_detected` counter bumped; row UPDATEd in-place to `started_at = now()`; materialization proceeds; final state is correct (tasks materialized, target_date row updated to status='completed') | §4.4 amendment 2 |
| **Materialization enqueues via batchJSON (D7-2 rewrite):** materialize N tasks (tested with N=50, N=100, N=250, N=1001 to exercise chunking boundary). Assert: handler calls `batchJSON` exactly `ceil(N/100)` times; each call carries up to 100 messages; each message carries `deduplicationId: <task_id>`, `flowControl: { key: 'sf-push-global-mvp', rate: 5, period: '1s' }`, `failureCallback: ${PUBLIC_BASE_URL}/api/queue/push-task-failed`, `retries: 3`, `url: ${PUBLIC_BASE_URL}/api/queue/push-task` | §1.1 batchJSON + §6.3 flow control + §5.2 retry config + §5.2 failureCallback |

### §7.2 Push handler tests (~12 rows)

| Test | What it pins |
|---|---|
| **`maxDuration` build-time check (NEW, runtime-bug guard):** CI step greps `src/app/api/queue/push-task/route.ts` for `export const maxDuration = 300`. If absent, CI fails. (Unit test can assert the export exists at module level, but a build-time grep is the honest "does this declaration reach Vercel?" check.) | §5.1 amendment 3 — without this, the §1.1 envelope claim fails at runtime, never in tests |
| **Happy path (D7-6 anchor):** receive `{ tenant_id, task_id }` → handler calls `pushSingleTask(tenant_id, task_id)` → `pushSingleTask` calls SF `createTask` → on 2xx, `markTaskPushed` (at [`tasks/repository.ts:531-549`](../../src/modules/tasks/repository.ts#L531-L549)) called → 200 returned | §5.1 happy path |
| **`pushSingleTask` invocation (NEW, §5.1 amendment 6):** mock-spy on `pushSingleTask` and on the SF adapter. Assert handler calls `pushSingleTask`, NOT the adapter directly. If the handler bypassed `pushSingleTask`, the spy on the adapter would fire while the spy on `pushSingleTask` would not — that's the failure case. | §5.1 amendment 6 |
| **Tenant-scoping mismatch (NEW, §5.1 amendment 1):** task in DB has `tenant_id = T1`; payload sends `tenant_id = T2`. Handler returns 400; no SF call made; no `markTaskPushed` call | §5.1 Step 1.4 defense-in-depth |
| **address_id null guard (NEW, §5.1 amendment 2):** task in DB has `address_id IS NULL`. Handler returns 400; Sentry-capture `push.address_id_null` fired (mock-asserted); no SF call. Test that the failureCallback DLQ path receives this failure (assert via integration test in §7.5) | §5.1 Step 1.5 defense-in-depth |
| **Already-pushed skip (Layer 2):** receive `{ tenant_id, task_id }` where `pushed_to_external_at IS NOT NULL` → SF NOT called → 200 returned | §5.3 Layer 2 |
| **AwbExists reconcile (Layer 3):** SF returns 4xx with AwbExists → existing D8-4b reconcile path inside `pushSingleTask:1002` runs → `getTaskByAwb` called → `markTaskPushed` called with reconciled `external_id` | §5.3 Layer 3 |
| **Transient 5xx → throws:** SF returns 5xx → handler throws (assert via the test framework's exception-asserting helper) → QStash retries (we test handler returned non-2xx, NOT QStash itself) | §5.2 retry trigger |
| **Signature gate:** missing or invalid QStash signature → 401 returned; no body parsing | §5.1 `verifySignatureAppRouter` |
| **Observability log shape (NEW, §5.5):** trigger handler under each `outcome` enum value; assert log line emitted with `{ tenant_id, task_id, sf_latency_ms: <number>, outcome: <one-of-5-states> }`. Outcome enum strict-check (no string drift): `success` / `awb_exists_reconciled` / `retry_throw` / `address_id_null_rejected` / `tenant_mismatch_rejected` | §5.5 observability surface |
| **failureCallback handler — happy path (NEW, §5.2 amendment 5):** new endpoint `/api/queue/push-task-failed` receives QStash failure metadata `{ originalBody: { tenant_id, task_id }, error, retryCount }`, signature-verified via same `verifySignatureAppRouter`. Asserts: `failed_pushes` row inserted with `tenant_id`, `task_id`, `reason` derived from QStash error field, `retried_count` from QStash metadata; surfaces in `/admin/failed-pushes` UI (mock or via integration test) | §5.2 amendment 5 — failureCallback as DLQ signal source |
| **failureCallback handler — signature gate:** unsigned POST to `/api/queue/push-task-failed` → 401; no DB write | §5.2 endpoint security |

### §7.3 Migration test for `0020` (~6 rows)

| Test | What it pins |
|---|---|
| **Backfill correctness for canonical 12:00 UTC tick (D7-1 update for AT TIME ZONE):** insert pre-migration row with `window_start = '2026-05-04T12:00:00Z'`. Run migration. Assert `target_date = '2026-05-05'` (Dubai-tomorrow at 12:00 UTC = 16:00 Dubai → next day) | §4.2 step (2) backfill via AT TIME ZONE form |
| **DST-boundary backfill (NEW):** insert row with `window_start = '2026-03-29T22:00:00Z'`. Run migration. Assert `target_date = '2026-03-30'`. Dubai is constant UTC+4 (no DST) so this is theoretical — but documents we considered DST and the AT TIME ZONE form survives the boundary | §4.3 amendment + due-diligence on DST |
| **Dedup with winning-row policy (D7-7a):** seed 5 rows for `(tenant_id=T, target_date=2026-05-02)` with varied `(completed_at, started_at)` — 2 rows have non-null `completed_at` (different timestamps), 3 have null. Run migration. Assert: only 1 row survives for `(T, 2026-05-02)`; that row has the `MAX(completed_at)` (i.e., the most-recently-completed row wins among the 2 with `completed_at IS NOT NULL`). Re-run with all 5 rows having NULL completed_at; assert the row with `MAX(started_at)` survives | §4.2 step (3) + §0.4 Q2 winning-row policy |
| **target_date column-add + NOT NULL promotion (D7-7b/c):** assert `target_date` column exists post-migration; assert `column_default IS NULL`; assert `is_nullable = 'NO'`. Then induce a row that backfill skipped (e.g., insert a row pre-migration with `window_start IS NULL` or some path that bypasses backfill); run migration; assert step 4 ALTER NOT NULL fails AND the BEGIN/COMMIT wrapper rolls all prior steps (target_date column NOT added, no dedup performed) | §4.2 steps (1)/(4) + transactional wrapper |
| **BEGIN/COMMIT wrapper rollback (NEW):** induce a forced failure mid-migration (e.g., simulate a constraint violation on the dedup DELETE). Assert: no `target_date` column in `task_generation_runs` post-failure; existing rows unchanged; no UNIQUE index `task_generation_runs_tenant_target_date_unique_idx` exists. Proves the wrapper is intact | §4.2 amendment D4-3 |
| **Pre-existing UNIQUE preserved (D7-7d):** run migration. Insert two rows with same `(tenant_id, window_start, window_end)` (the OLD UNIQUE columns). Assert: second insert hits 23505 — proves the OLD UNIQUE on `(tenant_id, window_start, window_end)` from migration 0012 is still enforced post-0020 | §4.2 amendment D4-4 |
| **New UNIQUE catches dupe (existing, kept):** insert two rows with same `(tenant_id, target_date)`. Assert: second insert hits 23505 on `task_generation_runs_tenant_target_date_unique_idx` | §4.2 step (5) — new constraint |

### §7.4 Integration test — happy path (~10 steps)

Single happy-path integration test that exercises the full ingress → queue → egress pipeline against mock SF adapter:

1. Pre-seed 1 tenant + 1 active subscription with rotation set up
2. Pre-seed 1 row in `tasks` with `pushed_to_external_at IS NULL` and `address_id IS NOT NULL` (the cutover-backlog row)
3. Trigger materialization cron handler (test-invoked, not real HTTP)
4. Assert: 1 backlog row + 14 newly-materialized rows = 15 tasks now exist for the tenant
5. Assert: post-commit `batchJSON` called once (≤100 messages, all 15 fit in 1 batch); each message carries `deduplicationId: <task_id>`, `flowControl: { key: 'sf-push-global-mvp', rate: 5, period: '1s' }`, `failureCallback: ${PUBLIC_BASE_URL}/api/queue/push-task-failed`, `retries: 3`
6. Assert: `subscription_materialization.materialized_through_date = today + 14` (or capped at `S.end_date` if set)
7. Assert: `task_generation_runs` row exists with `status='completed'`, `target_date = today + 14`, `tasks_created = 15`
8. Trigger the push handler with one of the 15 messages (test-invoked POST to `/api/queue/push-task`)
9. Assert: `pushSingleTask` invoked; mock SF adapter called; `pushed_to_external_at` set on that task; 200 returned
10. Assert: structured log emitted with all 4 §5.5 fields and `outcome: 'success'`

### §7.5 Integration tests — edge cases (NEW, heavier — integration-test schedule, not every PR)

These tests require fuller fixtures and longer runtime; isolated from §7.4's "every PR" path:

| Test | What it pins |
|---|---|
| **Stale-`running` recovery under concurrency:** seed 1 stale `running` row + 1 fresh `running` row for different tenants. Trigger 3 concurrent materialization handler invocations (simulating Run-A/Run-B/Run-C race). Assert: stale row recovered + materialized; fresh-running rows preserved (concurrent runs short-circuit on 23505 + skip); 1 of the 3 invocations wins the race per tenant | §4.4 amendment 2 + §4.4 happy-status branches |
| **Phase 1 reconciliation under burst conditions:** seed 850 tasks across 3 tenants with `pushed_to_external_at IS NULL`. Trigger materialization cron. Assert: handler invokes `batchJSON` ceil(850/100) = 9 times; total messages enqueued = 850 + N newly-materialized; QStash mock asserts dedup absorbs duplicates if any pre-existing message ID overlaps; total wall-clock for materialization phase < 30s (matches §2.5 estimate) | §1.1 Phase 1 + §6.3 ingress-burst-then-flow-control |
| **Flow-control rate-limit assertion:** integration test that runs against a real Upstash QStash test queue (not mock). Enqueue 50 messages with `flowControl: { key: 'sf-push-test-50', rate: 5, period: '1s' }`. Assert: messages delivered to handler at ~5/sec (allow 20% jitter); 50 messages take ≥10s wall-clock to fully drain | §6.3 Flow Control mechanism actually works at the QStash boundary |
| **Full-volume integration with all 5 exception types:** seed 845 subscriptions across 3 tenants, each with one of the 5 exception types (skip, pause_window, address_override_one_off, address_override_forward, append_without_skip) interleaved. Trigger cron. Assert: per-exception-type behavior matches §2.4 row-by-row; `tasks` row count matches the expected projection (no over-materialization, no under-materialization) | §2.4 full table coverage |
| **Cutover-backlog drainage end-to-end:** seed 114 tasks for fresh-butchers tenant with `pushed_to_external_at IS NULL` (matching §0.4 Q3 sized backlog). Run cutover sequence (apply migration 0020, run backfill script, trigger first cron tick). Assert: 114 backlog rows + 14×N new horizon rows enqueued via `batchJSON`; push handler mock-drains all messages; final state has all 114 + new rows with `pushed_to_external_at IS NOT NULL` | §3.4 cutover posture |
| **Rollback path (per §3.5):** apply migration + new handler; materialize a subset; revert handler via mock git revert (in test, swap the route handler back to old version). Assert: old handler does NOT crash on the new schema (additive migration is durable); old handler picks up `pushed_to_external_at IS NULL` rows via its existing find-unpushed query and pushes them inline; no data corruption | §3.5 rollback story |

---

## §8 Out of scope (explicit boundaries)

### §8.1 Day-14 part-2 service-surface plan PR (separate, sequenced after this)

This Day-14 cron decoupling plan PR does NOT cover the service-layer surface for the exception model:
- `addSubscriptionException` / `pauseSubscription` / `resumeSubscription` / `changeConsigneeCrmState` / `createMerchant` / `appendWithoutSkip`
- API routes
- UI surfaces

That work is a separate Day-14 part-2 plan PR (per Day-13 plan §6) sequenced AFTER this decoupling lands.

**Sequencing rationale (amendment 8 — three concrete reasons):**
- **(a) Data-flow dependency.** Part-2's `addSubscriptionException` service writes the `subscription_exceptions` rows that Phase 1 reconciliation (§1.1) consumes (specifically: skip exceptions reduce materialization, address overrides redirect address resolution, append_without_skip extends end_date for tail-end materialization). The queue infrastructure must be stable first; otherwise a part-2 service write hits a half-built materialization path.
- **(b) Behavioral dependency.** Part-2's `pauseSubscription` flips `subscriptions.status` to `'paused'`. The §3.2 amendment 4 paused filter behavior must be verified end-to-end before the service that triggers the transition exists; otherwise a regression in the filter wouldn't be caught until a real merchant pauses a subscription in production.
- **(c) Same-day T3 PR contention.** Two T3 plan PRs landing the same day would compete for review attention and risk schema-migration sequencing collisions (e.g., this plan's `0020_*` lands first, part-2's any-new-migration lands after; reversing that order means part-2 has a target_date null on its INSERTs). Sequential prevents the contention.

### §8.2 Alternatives REJECTED after consideration (NOT deferred to Phase 2)

These are "considered, decided no" — distinct from "deferred to Phase 2." A future contributor proposing them must surface a new argument that wasn't in the original consideration; restating the original case is not enough.

| Alternative | Source | Rejection rationale |
|---|---|---|
| **In-handler 5-concurrent parallelization** | §1.2 Option B | Fits Vercel 300s envelope (~112s for 845 tasks at 5 concurrent × 660ms) but **doesn't isolate**. Rejected on four dimensions: per-handler retry vs per-message retry, materialization-coupled failures, shared-fraction timeout envelope, no operational visibility. Detailed rejection at §1.2 amendment table. |
| **Per-tenant long-running workers** | §1.2 Option C | Requires hosting outside Vercel — out of architectural scope for MVP. Phase 2 may revisit IF cron-tier hosting becomes a strategic choice (e.g., the platform pivots away from serverless), but rejection stands today. **Not** a deferral; a directional decision. |
| **Per-handler in-memory delay** (`await sleep(200ms)`) | §6.3 Option B | Doesn't scale across concurrent Vercel-instance invocations — each instance sleeps independently, so 5 instances ÷ 1 SF rate budget = 25 effective req/sec, blowing the budget by 5×. Detailed rejection at §6.3 amendment table. |
| **SF-side 429 throttling** | §6.3 Option C | Deliberately overshoots the rate budget and burns QStash retries on 429s. Wasteful and noisy. Detailed rejection at §6.3 amendment table. |
| **Client-side retry counting (`markFailedPush` after handler-side ceiling)** | §5.2 alternative | Tracks retry state in our application — same failure class as §4.4 stale-`running`: client-side state under crash conditions has its own consistency problem and duplicates QStash logic. QStash owns retry state via `failureCallback`. Detailed rejection at §5.2 amendment 5. |
| **Separate `scripts/backfill-push-queue.mjs` cutover script** | §5.4 alternative | Phase 1 reconciliation per §1.1 absorbs cutover-backlog drainage automatically. **No future contributor should propose building this** — the architectural decision is the queue-handler-as-self-healing pattern, not a one-shot script. The right pattern is "every materialization tick is the cutover script for whatever's still null." |

### §8.3 Phase 2 deferrals (full list lives in the brief)

See [PLANNER_PRODUCT_BRIEF.md §4](../PLANNER_PRODUCT_BRIEF.md) for the canonical Phase 2 deferrals list — ~30 items, last sync'd at v1.2.

**Items in brief §4 that interact with this plan's surface area** (referenced inline above so the boundary is explicit):

| Item | Where this plan references it |
|---|---|
| Per-tenant SuiteFleet credential isolation (first post-pilot item) | §6.3 amendment 3 — flow-control key swap rides with this work |
| AWS Secrets Manager swap | §6.3 amendment 3 — gates the per-tenant flow-control key migration |
| Reconciliation job between Planner and SF | Adjacent to §1.1 reconciliation but distinct: Planner↔SF reconciliation is a Phase 2 cross-system reconciliation; §1.1 reconciliation is intra-Planner self-healing |
| Audit log viewer UI | Renders the `cron.stale_running_detected` + `materialization.address_resolution_failed` operational counters once they exist as observable surfaces |

**Inline Phase 2 hardening items introduced by this plan's amendments** (not in brief §4 today; would need brief amendment to land formally):

| Item | Driver | Path to landing |
|---|---|---|
| Shared Upstash Redis cache for SF auth tokens (`sf-token:{tenant_id}` keyed) | §6.2 amendment — amortizes cold-start auth across Vercel instances | If observability shows cold-start auth as a real-world bottleneck. Brief amendment if escalated. |
| Flow-control key migration `'sf-push-global-mvp'` → `'sf-push:{tenant_id}'` | §6.3 amendment 3 — coupled to per-tenant credential isolation | Lands together with the Secrets Manager swap; not a separate Day-N task |
| `materialization.address_resolution_failed` as 10th audit event | §2.2 amendment audit-event-vs-counter decision (option b) | MVP ships as operational counter only (Sentry-captured + log warning per §2.2). Phase 2 brief amendment to v1.3 with this as the 10th audit event IF observability surfaces it as ops-actionable (e.g., recurring data-gap pattern that needs an audit trail rather than just a counter). **Default for MVP: counter only; option (a).** |
| `'SKIPPED'` task internal_status CHECK admission removal | PR #139's 0019 migration added `'SKIPPED'` to `tasks.internal_status` CHECK. The new materialization handler does NOT write this value — skip exceptions = no INSERT per §2.4. `'SKIPPED'` becomes vestigial in the new path | Removal of CHECK admission is Phase 2 cleanup IF no consumer surfaces; admitted for MVP as defense-in-depth against legacy ad-hoc paths writing the value. |

Partial lists drift from the brief's full list and create confusion about which is canonical; this plan refers to the brief by reference for the full list and itemizes only the interactions specific to this plan PR.

### §8.4 `'suspended'` tenant status service surface (tangential — included only because raised in Day-13 plan §6)

Decision deferred: whether `'suspended'` becomes an additional service action surface (e.g., `merchant:suspend` permission + `suspendMerchant` service + `merchant.suspended` audit event) OR stays operationally-set-only.

**Default:** stays reserved; no part-2 service work; revisit Phase 2 if a Transcorp-staff workflow demands the suspend transition.

**Note (amendment 7):** this is **tangential to the cron-decoupling plan** — included here only because it was raised in Day-13 plan §6 deferrals and a fresh reader of this plan might wonder why `'suspended'` shows up nowhere else in the §3.2 paused filter discussion. It's a `tenants.status` lifecycle question, not a `subscriptions.status` question; the materialization filter doesn't read `tenants.status` (cron-eligibility filter at `list-cron-eligible-tenants.ts:74-86` reads `suitefleet_customer_code` only).

---

## §9 Risks + watch items

Risk register grows from 7 to ~16 rows post-§0-§8 amendments, tiered into three categories so reviewers can prioritize: **(A) MVP-blocking** (must be addressed before code PR opens or as code-PR pre-merge gates), **(B) Phase-2 cleanup** (known limitations carried forward, not blockers for MVP), **(C) framing-only** (clarifications and forecast risks; no immediate action). Within each tier, ordered roughly by load-bearing-ness.

### §9.A MVP-blocking risks (gate code PR or require explicit Love sign-off before merge)

| # | Risk | Mitigation | Status |
|---|---|---|---|
| A1 | **PR #139 migrations 0014-0019 not yet on production DB at Day-14 plan time** (§3.1 amendment callout) | Code PR pre-merge gate: confirm migration 0015 (`subscription_materialization`) exists on prod, OR include manual SQL-editor application step in PR description, OR schedule a CI-driven migration apply. Failure mode: first post-deploy cron tick crashes on `relation does not exist` → new handler never advances horizon → cutover backlog never drains. | **GATE** at code PR pre-merge |
| A2 | **`maxDuration = 300` declaration missing on `/api/queue/push-task` route** (§5.1 amendment 3, runtime bug) | Build-time grep test in CI per §7.2 fails if declaration absent. Without it, handler dies at 60s mid-SF-call on slow responses; §1.1 per-message envelope claim fails at runtime, never in unit tests. | **GATE** at code PR pre-merge |
| A3 | **Coupled-deploy unit: migration `0020` AND new materialization handler must land in same Vercel deploy** (§4.2 amendment 4) | NOT NULL on `target_date` breaks existing handler INSERT path (`task-generation/service.ts:223`). Migration-only deploy without handler swap = production cron breaks at next tick. Code PR pre-merge gate confirms both files in same PR + post-merge migration apply step sequenced AFTER deploy completes. | **GATE** at code PR pre-merge |
| A4 | **Stale-`running` recovery race under concurrent invocations** (§4.4 amendment 2 update) | §4.4 stale-recovery branch uses optimistic-update CAS predicate (`WHERE id = $stale_id AND started_at = $original_stale_started_at RETURNING id`). Loser of the race short-circuits. Without this, two handlers detecting the same stale row would both materialize, producing duplicate INSERTs across different `(subscription, target_date)` resolution paths. Code PR pre-merge gate: verify CAS predicate is present and tested per §7.5 row 1. | **GATE** at code PR pre-merge |
| A5 | **Demo dependency: cron decoupling blocks Day-14 part-2 (service layer)** (per §8.1 sequencing rationale) | Day-14 part-2's `addSubscriptionException` writes rows that Phase 1 reconciliation consumes; queue infrastructure must be stable first. Day-15+ feature work (4-step wizard, consignee-detail calendar, subscription detail) does NOT directly depend on decoupling — it depends on Day-14 part-2 service layer. **Cascade:** decoupling delays → part-2 delays → Day-15+ UI work delays → demo at risk. Day-14 implementation has ~5-day buffer (May 6 → May 11) but the cascade compresses it. Surface ASAP if plan-PR review or implementation hits delays. | **TRACKING** until code PR merges |
| A6 | **QStash flow-control key drift between Production / Preview / Local environments** (§6.3 amendment 3) | Env-var-driven `QSTASH_FLOW_CONTROL_KEY` per environment (rather than hardcoded literal in code). §0.4 Q1 verifies env presence pre-deploy. Without env-var posture, Preview deploys could share a flow-control budget with Production — same key = same rate budget across environments, causing Preview load to throttle Production. | **GATE** at code PR pre-merge |

### §9.B Phase-2 cleanup risks (known limitations, not MVP-blocking)

| # | Risk | Mitigation | Path to landing |
|---|---|---|---|
| B1 | **Orphan-row accumulation from crashed handlers** | Handler crashes mid-Phase-2 leave a `running` row pinned with old `target_date`. The §4.4 stale-recovery branch fires only on conflict against the SAME `(tenant_id, target_date)` — it doesn't sweep orphans from previous days where target_date has moved on. Accumulation rate bounded by deploy-frequency × crash-frequency = low at MVP scale; not a near-term issue. | Phase 2 cleanup job: scheduled (e.g., daily) sweep that marks `running` rows with `started_at < now() - interval '24 hours'` as `failed`. TBD threshold; default 24h. |
| B2 | **Consignee data gap (no rotation, no primary, no override) → row NOT materialized** (D9-1 reframe per §2.2 amendment) | Refuse-to-materialize policy: row NOT inserted; counter `materialization.address_resolution_failed` bumped + Sentry-captured + log warning. Operator-visible signal in MVP via Sentry/log aggregation. §5.1 amendment 2 null-address guard is defense-in-depth in the queue handler in case the §2.2 policy lapses (e.g., a manual-operator-INSERT path bypasses the materialization layer). | Phase 2: surface as in-line validation in the consignee-onboarding wizard (require at least one address before subscription creation). |
| B3 | **`materialization.address_resolution_failed` brief-amendment escalation path** | Phase 2 escalation from operational counter (option a — MVP default) to 10th audit event (option b) requires brief amendment to v1.3 per `PLANNER_PRODUCT_BRIEF.md §10` amendment protocol (`decision_*.md` filing + version bump). | Not gated on this PR; gated on observability evidence — if recurring data-gap pattern emerges in MVP usage and ops decides counter-only is insufficient. |
| B4 | **In-memory SF auth token cache cold-start latency** (§6.2 amendment) | Token cache is per-Vercel-function-instance; cold-start adds ~200-500ms to first message per instance. At ~1,000 msg/day across ~3-5 active instances, ~3-5 cold-auth round-trips per cron tick spread across the ~200s flow-control drainage window. Mitigation: QStash flow control caps egress at 5 msg/sec, so cold-start auth refresh is naturally rate-limited at the queue boundary, not the handler boundary. Per-instance cache amortization is good enough for MVP volume. | Phase 2: shared Upstash Redis cache keyed `sf-token:{tenant_id}` to amortize across instances IF observability shows real-world bottleneck. |
| B5 | **Flow-control key migration `'sf-push-global-mvp'` → `'sf-push:{tenant_id}'`** (§6.3 amendment 3) | MVP key matches reality (shared SF sandbox credentials per `decision_mvp_shared_suitefleet_credentials.md`); per-tenant keying would over-throttle. | Phase 2: lands together with the AWS Secrets Manager swap (`memory/followup_secrets_manager_swap_critical_path.md`) + per-tenant SF credential isolation. |
| B6 | **`'SKIPPED'` task internal_status becomes vestigial in new path** | PR #139's 0019 migration added `'SKIPPED'` to `tasks.internal_status` CHECK. The new materialization handler does NOT write this value — skip exceptions = no INSERT per §2.4. Admitted for MVP as defense-in-depth against legacy ad-hoc paths writing the value. | Phase 2: remove CHECK admission of `'SKIPPED'` IF no consumer surfaces. |

### §9.C Framing-only risks (forecast, no immediate action; helps reviewers anticipate)

| # | Risk | Detail |
|---|---|---|
| C1 | **QStash as new SPOF in the critical push path** | §5.2 retry → existing `failed_pushes` DLQ via failureCallback. Ops surfaces failures in `/admin/failed-pushes` UI without learning a new surface. Net SPOF risk equivalent to the existing reliance on Vercel + Supabase + QStash → SF; QStash adds one node to the dependency chain. Acceptable for MVP demo posture. |
| C2 | **Migration `0020` backfill mis-derives `target_date` for off-hour manual-trigger rows** | §4.3 caveat — `(window_start AT TIME ZONE 'Asia/Dubai')::date + 1` form survives DST and off-hour triggers; single-row off-by-one is acceptable for a backfill of ~5-10 historical rows; surfaced in migration header comment. Worth sanity-checking the backfilled values against the actual cron-run log post-migration. |
| C3 | **Queue depth spike on cron tick (operational alerting)** | Materialization burst enqueues ~1,000 messages immediately post-cron-tick (per §1.1 batchJSON + §0.6 throughput); QStash drains at 5 msg/sec flow control, so queue depth peaks at ~1,000 and drains over ~200s. Set ops alert threshold ABOVE 1,500 to avoid false positives during normal cron ticks; 1,500 captures abnormal backup (e.g., flow-control misconfig, push-handler outage) without spurious alarms on healthy ticks. |
| C4 | **`deduplicationId` window overrun for tasks pinned `pushed_to_external_at IS NULL` for >7 days** | QStash deduplication-id window is finite (~7 days per public docs). Rows pinned NULL for >7 days re-enqueue without dedup on the next Phase 1 reconciliation tick. Layer 2 (handler-level `pushed_to_external_at IS NOT NULL` skip per §5.3) catches the duplicate at the handler boundary. Net effect: at-most-1 duplicate SF call per task per 7-day re-discovery cycle. Acceptable; surfaces only on edge cases (extended SF outages, data-gap quarantines lasting >7 days). |
| C5 | **Rollback during in-flight queue messages** (per §3.5 rollback story) | Post-rollback, in-flight QStash messages target a now-deleted `/api/queue/push-task` endpoint → 404 → QStash retries 3× with exponential backoff → DLQs them via failureCallback (which also doesn't exist post-rollback, so messages land as terminal failures in QStash's own log surface, not in our `failed_pushes` table). ~90s additional unpushed delay per affected task during the retry window. At demo volume (~1,000 messages/day), rollback during peak burst affects all pending in-flight messages; bounded by retry timeout. |
| C6 | **Test fixture row accumulation in shared CI DB causing UNIQUE collision** | `(tenant_id, target_date)` UNIQUE could collide across CI runs if test fixtures aren't tenant-scoped or torn down. Existing pattern: per-test tenant UUID (the `r3-test-*` fixture pattern in CI from §0.4 Q2 probe data already uses this). §7.3 BEGIN/COMMIT wrapper + per-test tenant UUID + test-suite teardown should make this self-bounded; verify in §7 implementation. |
| C7 | **Backwards compat with existing `task-push/service.ts` callers (DLQ retry UI)** | Existing `task-push/service.ts` continues to expose `pushSingleTask` (per §1.3 retirement table); `pushTasksForTenant` and its associated cron-loop machinery retire. The DLQ retry UI surface at `/admin/failed-pushes` continues to call `pushSingleTask` (now via internal API route, same posture as today). No breaking change at the module export level for surviving functions. |

---

## §10 Cross-references

Grouped into five subsections for navigation. Each entry annotates which plan section consumes it so reviewers can trace amendments back to their evidence.

### §10.a Brief + canonical product memory

- [PLANNER_PRODUCT_BRIEF.md §3.1.1, §3.1.5, §3.3.6, §7](../PLANNER_PRODUCT_BRIEF.md) — `tasks.pushed_to_external_at` contract surface, 14-day rolling horizon, integration-honesty UI indicator, tier discipline. Consumed by §0.1, §1.3, §3.1, §3.2.
- [memory/decision_brief_v1_2_amendments_d13_part1.md](../decision_brief_v1_2_amendments_d13_part1.md) — `tasks.pushed_to_external_at` brief amendment that locks the contract surface name. Consumed by §1.3, §3.3 casing-convention cross-ref.
- [memory/project_brief_audit_event_count_correction.md](../../../.claude/projects/-Users-lovemans-Code-planner/memory/project_brief_audit_event_count_correction.md) — locks the brief's audit-event vocabulary at 9 events. Consumed by §2.2 / §2.4 amendments to prevent materialization-time audit emissions; §8.3 / §9 B3 Phase-2 brief-amendment-escalation path.
- [memory/decision_mvp_shared_suitefleet_credentials.md](../decision_mvp_shared_suitefleet_credentials.md) — MVP shared SF sandbox credential decision. Consumed by §6.3 amendment 3 flow-control key naming convention (`'sf-push-global-mvp'`).
- [memory/followups/cron_materialization_push_coupling.md](../followups/cron_materialization_push_coupling.md) — root-cause memo + decoupling recommendation. Consumed by §0.2 runtime-math anchor and §1.1/§1.2 mechanism-choice framing.
- [memory/followup_secrets_manager_swap_critical_path.md](../followup_secrets_manager_swap_critical_path.md) — AWS Secrets Manager swap critical-path. Consumed by §6.3 amendment 3 flow-control key migration to `'sf-push:{tenant_id}'`; §8.3 Phase-2-deferral interaction table; §9 B5 migration-coupled risk.

### §10.b Predecessor + adjacent PRs

- **PR #138** (Day-13 backend exception model schema part-1 plan, merged `8772aae`) — sequencing predecessor; this plan PR drafts after #138 lands per the hard-stop-twice protocol.
- **PR #139** (Day-13 part-1 code, merged `875bfc4`) — ships `subscription_materialization` table + `tasks.address_id` + `subscription_address_rotations` + audit/permission surfaces consumed by this Day-14 work. **NOTE:** migrations 0014-0019 are in the PR's git tree but NOT yet applied to production DB — see §3.1 callout + §9 A1 hard-stop.
- **PR #141** (brief v1.2 amendment, merged `ea377d1`) — locks the `tasks.pushed_to_external_at` column reference.
- **PR #142** (Posture B retirement runbook, merged `634ea6d`) — adjacent operational work landed Day-13 EOD; runbook §1 pre-flight check P5 query was amended in PR #144 during this plan-PR review window.
- **PR #143** (Day 13 EOD handoff, merged `4731553`) — context-setting predecessor; documents the migration-deploy gap (§3.1 callout) and the cron-decoupling driver memo.
- **PR #144** (Posture B retirement runbook §1 P5 query fix, merged Day-14 morning) — review-window companion; runbook bug surfaced by Day-14 morning's P5 probe execution; same operational work-stream as this plan PR.
- [memory/plans/day-13-exception-model-part-1.md §2](../plans/day-13-exception-model-part-1.md) — Day-13 plan from which §2 generator code changes were deferred to this Day-14 plan (resolved in this plan's §2.2 + §2.3).

### §10.c Source code anchors

- [vercel.json](../../vercel.json) — current cron schedule (`0 12 * * *` UTC); unchanged by this plan.
- [src/app/api/cron/generate-tasks/route.ts](../../src/app/api/cron/generate-tasks/route.ts) — current single-handler cron being rewritten as the materialization-only handler per §2.1.
- [src/app/api/cron/generate-tasks/list-cron-eligible-tenants.ts:74-86](../../src/app/api/cron/generate-tasks/list-cron-eligible-tenants.ts#L74-L86) — eligibility filter (`suitefleet_customer_code IS NOT NULL AND <> ''`); unchanged.
- [src/modules/task-generation/service.ts:120-358](../../src/modules/task-generation/service.ts#L120-L358) — current generation phase (Phase 2 in §2.1 6-phase model).
- [src/modules/task-generation/service.ts:223](../../src/modules/task-generation/service.ts#L223) + [:262](../../src/modules/task-generation/service.ts#L262) — current `task_generation_runs` row writes at `status='completed'` and `status='failed'`; consumed by §4.2 amendment 4 coupled-deploy callout.
- [src/modules/task-generation/repository.ts:118-163](../../src/modules/task-generation/repository.ts#L118-L163) — existing run-row UNIQUE conflict path on `(tenant_id, window_start, window_end)`; consumed by §4.4 amendment 3 status-enum gap fix.
- **§1.3 retirement table — `task-push/service.ts` (NOT whole file):**
  - [src/modules/task-push/service.ts:327](../../src/modules/task-push/service.ts#L327) — `pushTasksForTenant` (cron-loop variant) — **RETIRES.**
  - [src/modules/task-push/service.ts:586](../../src/modules/task-push/service.ts#L586) — reconcile branch inside `pushTasksForTenant` — **RETIRES with parent.**
  - [src/modules/task-push/service.ts:727](../../src/modules/task-push/service.ts#L727) — `markTaskPushed` call inside `pushTasksForTenant` — **RETIRES with parent.**
  - [src/modules/task-push/service.ts:827](../../src/modules/task-push/service.ts#L827) — `pushSingleTask` (single-task variant) — **SURVIVES; gains second caller (the new `/api/queue/push-task` queue handler).**
  - [src/modules/task-push/service.ts:1002](../../src/modules/task-push/service.ts#L1002) — reconcile branch inside `pushSingleTask` — **SURVIVES.**
  - [src/modules/task-push/service.ts:1104](../../src/modules/task-push/service.ts#L1104) — `markTaskPushed` call inside `pushSingleTask` — **SURVIVES; only post-cutover caller of `markTaskPushed`.**
- [src/modules/tasks/repository.ts:531-549](../../src/modules/tasks/repository.ts#L531-L549) — `markTaskPushed` UPDATE (unchanged contract surface; declaration L531, UPDATE statement L538-544).
- [src/modules/integration/providers/suitefleet/last-mile-adapter-factory.ts](../../src/modules/integration/providers/suitefleet/last-mile-adapter-factory.ts) — `LastMileAdapter` interface + factory; unchanged by this plan per §6.1.
- [src/modules/integration/providers/suitefleet/token-cache.ts](../../src/modules/integration/providers/suitefleet/token-cache.ts) — in-memory per-Vercel-function-instance JWT cache; consumed by §6.2 cold-start latency disclosure.
- [src/modules/credentials/suitefleet-resolver.ts](../../src/modules/credentials/suitefleet-resolver.ts) — per-tenant SF credential resolution; consumed by §5.1 Step 3.
- [supabase/migrations/0012_task_generation_runs.sql:179-186](../../supabase/migrations/0012_task_generation_runs.sql#L179-L186) — existing 5-value status enum (`running`, `completed`, `capped`, `skipped_already_run`, `failed`) + UNIQUE on `(tenant_id, window_start, window_end)`. Consumed by §4.2 amendment D4-4 (UNIQUE retention) and §4.4 amendment 3 (status enum gap fix).
- [supabase/migrations/0014_addresses_and_subscription_address_rotations.sql](../../supabase/migrations/0014_addresses_and_subscription_address_rotations.sql) — `addresses` (with `is_primary` partial UNIQUE per consignee), `subscription_address_rotations`, `tasks.address_id` nullable column. Consumed by §2.3 4-layer COALESCE chain (specifically Layer 4's primary-uniqueness guarantee).
- [supabase/migrations/0015_subscription_exceptions_and_materialization.sql](../../supabase/migrations/0015_subscription_exceptions_and_materialization.sql) — `subscription_exceptions` (5-type discriminator) + `subscription_materialization` table. **Migration in PR #139 git tree; NOT yet applied to production DB at Day-14 plan time** — §3.1 callout + §9 A1 hard-stop.
- [package.json L30](../../package.json#L30) — `@upstash/qstash` dep already present (`^2.10.1`); never imported in `src/` pre-Day-14.
- [.env.example](../../.env.example) — `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_FLOW_CONTROL_KEY` (NEW per §6.3 amendment 3) env documentation.

### §10.d External SDK references

- [@upstash/qstash type defs](../../node_modules/@upstash/qstash/client-CsM1dTnz.d.ts) — verifies API surface of consumed primitives. Consumed by §1.1 + §6.3:
  - **`FlowControl` type** at lines 142-180 — defines `{ key, parallelism, rate, period }` shape for the §6.3 flow-control mechanism. Verified to NOT support topic-level rate limits (D6-2 fix).
  - **`batchJSON` method** at line 2476 — canonical batch primitive for §1.1 Phase 5 enqueue. Verified vs the older `publishJSON` mechanism that would've created N sequential HTTP calls.
- QStash REST API per-call batch size limit — public docs (verify current cap before code PR opens per §0.6 Love verification step). §1.1 chunk size of 100 messages is conservative under the documented limit.

### §10.e Auto-memory governance (load-bearing for review process; lives outside repo `memory/` dir)

- `feedback_t3_plan_prs_need_realtime_review.md` — gates hard-stop-twice protocol for T3 plan PRs. Consumed by this plan PR's review process (you must be awake for real-time counter-review per the auto-memory standing rule); auto-mode is T1-only.
- `feedback_claude_code_executes_default.md` — assigns Love as Vercel UI executor for §3.1 PR #139 migration apply step. Consumed by §3.1 callout + §3.3 backfill run procedure + §9 A1 mitigation.
- `feedback_vercel_env_scope_convention.md` — Production+Preview only, never Development. Consumed by §0.4 Q1 env-scope check + §6.3 amendment 3 `QSTASH_FLOW_CONTROL_KEY` per-environment posture + §9 A6 flow-control-key drift mitigation.

---

## §11 Review checklist

Re-architected post-§0-§10 amendments. Split into two sub-checklists matching the T3 hard-stop-twice protocol: **§11.1 plan-PR approval gates** (Love clears at this PR's review to clear T3 hard-stop #1) and **§11.2 code-PR pre-merge gates** (consumed at the Day-14 code PR's verification-only counter-review to clear T3 hard-stop #2). Each row is anchored to §10 cross-refs and the relevant plan section so reviewers can trace decisions back to evidence.

### §11.1 Plan-PR approval checklist (clears T3 hard-stop #1)

For Love at this plan-PR review time. Each item asks "do you accept the plan's stated decision?" — if yes, check; if no, comment-amend before approval.

#### Decisions to confirm (existing-rows, text-amended)

- [ ] **§0.4 verification queries** — Q1 (QStash env vars present) and Q3 (push backlog sizing per fresh-butchers 114 tasks) land at code-PR prep. **Q2 found dupes exist** (20 r3-test-* fixture tenants × 5 rows each on 2026-05-02) — winning-row policy locked: keep `MAX(completed_at)` if any in group; else `MAX(started_at)`. **Q4 found `subscription_materialization` table NOT yet on prod** — escalates to §9 A1 hard-stop. Reference [§10.a brief] + [§10.b PR #139].
- [ ] **§0.5 migration filename** — `0020_task_generation_runs_target_date_column_and_unique.sql` (renamed from `_unique.sql` to reflect 5-step transactional scope: column-add → backfill → dedupe → NOT NULL promotion → UNIQUE add). Reference [§10.c source code anchors §0.5].
- [ ] **§1.2 mechanism choice (A: QStash) reframed** — A wins NOT because B fails the timeout dimension (§0.2 amendment showed B's in-handler 5-concurrent fits 300s envelope in ~112s) but because B couples push failures to materialization successes, lacks per-message retry, and offers no operational queue surface. B is rejected, not deferred (per §8.2 alternatives table). Reference [§10.a brief §3.1.5] + §1.2 / §0.2 amendments.
- [ ] **§2.4 per-exception-type INSERT/no-INSERT table (replaces single-line decision)** — 5 rows: skip → no INSERT, pause_window → no INSERT, address_override_one_off → INSERT with override (Layer 1), address_override_forward → INSERT with override (Layer 2), append_without_skip → INSERT with rotation/primary fallback (no override). Reference §2.3 SQL + §2.4 amendment table.
- [ ] **§3.3 backfill posture: one-time script, NOT migration** — `scripts/backfill-subscription-materialization.mjs` mirroring `seed-subscriptions.mjs` pattern. Migrations stay schema-only per project convention. CI / staging / integration tests do NOT run this; they get fresh `subscription_materialization` seeded by their own test fixtures. Removes the "every fresh DB clone re-seeds" failure mode. Reference [§10.c source-code §3.3] + `feedback_claude_code_executes_default.md` (auto-memory) for the run-procedure assignment to Love.
- [ ] **§3.4 cutover posture + ±10min deploy/cron-tick caveat** — old cron handler IS the rewrite target (no dual-write window). Vercel deploy and `0 12 * * *` UTC cron tick must NOT overlap; **operational mitigation: do not deploy within ±10 minutes of 12:00 UTC.** Reference §3.4 amendment 7.
- [ ] **§4.3 migration backfill timezone form** — `(window_start AT TIME ZONE 'Asia/Dubai')::date + 1` (replaces prior offset-arithmetic). Numerically identical for the canonical 12:00 UTC tick but explicit timezone-aware; survives DST and off-hour manual triggers without crossing day boundaries unexpectedly. Single-row off-by-one risk for very-off-hour manual triggers documented at §4.3 caveat. Reference §4.2 step (2) + §4.3.
- [ ] **§5.2 retry posture pinned + failureCallback for DLQ** — `retries: 3`, exponential backoff (QStash default base 5s/max 60s), per-call timeout 30s. failureCallback URL `${PUBLIC_BASE_URL}/api/queue/push-task-failed` (signature-verified, writes existing `failed_pushes`). **No new operator surface** — existing `/admin/failed-pushes` UI absorbs the DLQ rows. **Client-side retry counting REJECTED** (§8.2 row); QStash owns retry state. Reference §5.2 amendments 4-5 + [§10.a `decision_brief_v1_2_amendments_d13_part1.md`].
- [ ] **§6.3 SF rate-limit via QStash Flow Control (NOT topic rate-limits)** — Flow Control mechanism: `flowControl: { key: 'sf-push-global-mvp', rate: 5, period: '1s' }` on every `batchJSON` call from the materialization handler. Topic-level rate limits do NOT exist in `@upstash/qstash`. **MVP key locked** as `'sf-push-global-mvp'` (matches shared-credential reality per `decision_mvp_shared_suitefleet_credentials.md`); Phase 2 migration to `'sf-push:{tenant_id}'` is gated on Secrets Manager swap. Reference [§10.d FlowControl SDK shape] + §6.3 amendments + §8.3 Phase 2 interaction table.
- [ ] **§8.1 part-2 boundary + sequencing rationale** — this plan does NOT cover the service-layer surface (`addSubscriptionException`, `pauseSubscription`, etc.); that's a separate Day-14 part-2 plan PR. Sequenced AFTER this decoupling lands per the three-reason rationale (data-flow dependency, behavioral dependency, same-day T3 contention) at §8.1 amendment 8. Reference §8.1.
- [ ] **§9 demo-dependency cascade detail** — cron decoupling blocks Day-14 part-2 (service layer needs queue infrastructure stable per §8.1). Day-15+ feature work (4-step wizard, consignee-detail calendar, subscription detail, label generation) does NOT directly depend on decoupling — depends on Day-14 part-2 service-layer landing. **Cascade:** decoupling delays → part-2 delays → Day-15+ UI work delays → demo at risk on May 12. ~5-day buffer (May 6 → May 11) compresses fast under the cascade; surface ASAP if plan-PR review or implementation hits delays. Reference §9 A5 + [§10.a brief §6 day-by-day plan].

#### NEW decisions to confirm (added by §0-§9 amendments — five new rows)

- [ ] **§0.6 QStash quota tier verification (gating before code PR opens)** — projected throughput ~1,000 messages/day worst-case + ~7,500/week with retry budget; Upstash free tier (500/day) **insufficient**; pay-as-you-go covers demo at ~$0.01-$0.30/month. Love confirms current Upstash plan tier in dashboard before code PR opens; if free tier, upgrade to PAYG (no schema/code blocker; billing-config flip in Upstash console). Reference §0.6 + [§10.a `followups/cron_materialization_push_coupling.md`].
- [ ] **§1.3 code-path retirement audit** — explicit table naming what dies vs survives post-cutover. **Retires (~500 lines):** `pushTasksForTenant` cron-loop variant + reconcile branch + per-iteration `markTaskPushed` call. **Survives (~330 lines):** `pushSingleTask` + reconcile branch + per-call `markTaskPushed` call (becomes the only post-cutover caller of `markTaskPushed`). The actual deletion lives in the implementation PR, not this plan PR — this list serves as the audit-trail for what gets deleted. Reference [§10.c source-code task-push/service.ts line ranges] + §1.3 retirement table.
- [ ] **§2.2 null-address policy + audit-event-vs-counter decision** — refuse-to-materialize is the policy (row NOT inserted when 4-layer COALESCE returns NULL); operational counter `materialization.address_resolution_failed` is the MVP signal; **option (a) counter-only is the MVP default**, option (b) brief amendment to v1.3 making it the 10th audit event is Phase 2 IF observability shows ops-actionable. Confirm option (a) at plan-PR; option (b) is documented as Phase 2 escalation path at §9 B3 + §8.3 inline Phase 2 table.
- [ ] **§2.5 materialization-phase throughput math + EXPLAIN ANALYZE verification (§0 verification item)** — steady-state estimate **9-15s** per handler invocation (3-5s × 3 tenants); cutover-day worst case **75-150s.** Both within Vercel 300s envelope. **Code-PR prep step:** run `EXPLAIN ANALYZE` on the canonical §2.3 INSERT…SELECT against staging data sized to full demo volume; pin actual numbers in code PR description. If cutover projects above ~200s, add Phase 0 horizon-throttle (advance 1-2 days/tick instead of 14-at-once on first run). Reference §2.5.
- [ ] **§3.5 rollback story acknowledgment** — rollback path = `git revert` + Vercel redeploy (or `vercel promote previous-Production` for ~30s fast-revert). Data-state durability: `subscription_materialization` rows + `target_date` column are durable and additive; old handler ignores both. QStash queue drains naturally. Schema additions are additive; **one-way doors are on schema, not data**. Blast radius: cron handler runtime + push-queue endpoint only — does NOT affect existing UI surfaces, API routes, audit emissions, operator workflows. Forward-rolling cleanup script (NOT revert) is the path if data-corruption occurs pre-rollback. Reference §3.5.

### §11.2 Code-PR pre-merge gates (clears T3 hard-stop #2)

For the verification-only counter-review at code-PR open. These are NOT plan-PR decisions — they're pre-merge checks the implementing PR must pass. Single flat list; rows 1-6 map to §9.A MVP-blocking risks; rows 7-9 are additional pre-merge verifications introduced by §5.5 / §7 amendments.

- [ ] **1 — Migration 0015 application status confirmed.** Either (a) `subscription_materialization` table exists in production DB pre-merge, OR (b) PR description includes the manual SQL-editor application step Love runs after merge but before next cron tick, OR (c) CI-driven migration apply step is sequenced into the deploy pipeline. Without one of these, first post-deploy cron tick crashes. Reference §3.1 callout + §9 A1.
- [ ] **2 — `export const maxDuration = 300;` declaration present** in `src/app/api/queue/push-task/route.ts`. CI build-time grep test per §7.2 row 1 fails if absent. Without it, handler dies at 60s; §1.1 per-message envelope claim fails at runtime. Reference §5.1 amendment 3 + §7.2 row 1.
- [ ] **3 — Coupled deploy unit verified.** PR contains BOTH `supabase/migrations/0020_*.sql` AND `src/app/api/cron/generate-tasks/route.ts` rewrite. Migration apply step sequenced AFTER Vercel deploy completes (so the new handler is the first writer to encounter the NOT NULL on `target_date`). Reference §4.2 amendment 4 + §9 A3.
- [ ] **4 — Stale-`running` recovery CAS predicate present in code** — `WHERE id = $stale_id AND started_at = $original_stale_started_at RETURNING id`. Test from §7.5 row 1 (stale-running recovery under concurrency) passes. Without the CAS predicate, the recovery branch races with itself under concurrent invocations. Reference §4.4 amendment 2 + §7.5 row 1.
- [ ] **5 — Demo dependency tracking row** — surface to Love at code-PR open if implementation timeline slipped vs plan-PR-stated 5-day buffer. Day-14 part-2 plan PR cannot open until this code PR merges. Reference §8.1 + §9 A5.
- [ ] **6 — `QSTASH_FLOW_CONTROL_KEY` env-var configured per environment** — Production scope set to `'sf-push-global-mvp'`; Preview scope set to `'sf-push-global-preview'` (locked literal — implementer cannot substitute at code-PR time; if a different value is needed, plan amendment lands first); Local development unset (per `feedback_vercel_env_scope_convention.md` Production+Preview only). Verify via §0.4 Q1 env-presence check + Vercel UI inspection. Reference §6.3 amendment 3 + §9 A6.
- [ ] **7 — §7 test coverage:** ~26 row tests (§7.1-§7.3) + §7.4 happy-path integration + §7.5 6-row edge-case integration tests, with §7.5 row 1 (stale-running) and §7.5 row 2 (Phase 1 reconciliation under burst) load-bearing.
- [ ] **8 — §5.5 observability surface present:** per-handler structured log with all 4 fields (`tenant_id`, `task_id`, `sf_latency_ms`, `outcome`); QStash queue depth gauge readable via `client.messages.list`; `failed_pushes` UI surface unchanged.
- [ ] **9 — §7.1 enqueue test (D7-2 rewrite) asserts:** N tasks → `ceil(N/100)` `batchJSON` calls; each message carries `deduplicationId: <task_id>`, `flowControl: { key: <env-var-resolved>, rate: 5, period: '1s' }`, `failureCallback: ${PUBLIC_BASE_URL}/api/queue/push-task-failed`, `retries: 3`. Tested at chunking boundaries N ∈ {50, 100, 250, 1001}.

### §11.3 After plan-PR approval

Once §11.1 fully checks: T3 hard-stop #1 clears. Day-14 code PR opens for T3 hard-stop #2 verification-only counter-review against §11.2 + the code-PR-only items.

---

**End of plan.**

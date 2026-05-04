---
name: Cron materialization↔push coupling — May 4/5 silent partial-completion cascade
description: Root cause memo for the May 4 + May 5 production cron silent failures. The generation cron synchronously pushes every newly-materialized task to SuiteFleet inline (~600–720ms per task); at demo data volumes (845 subs/day on Tue) total wall-clock ≈9 minutes, exceeding the Vercel 300s function timeout. Scheduled ticks DID fire and partially complete; Vercel filters out invocations that never write a completion log line, creating the false "didn't fire" impression. Decoupling materialization from push is filed as own T3 plan PR for Day 14; tasks.suitefleet_push_acknowledged_at is the contract surface. Includes Run A vs Run B race analysis (idempotency-safe but a smell) and the diagnostic queries that locked the diagnosis.
type: project
---

# Cron materialization↔push coupling — May 4/5 silent partial-completion cascade

**Filed:** Day 13 (5 May 2026), late afternoon, after live diagnosis with Love
**Scope:** Production cron `/api/cron/generate-tasks` (`vercel.json` `0 12 * * *` = 16:00 Asia/Dubai)
**Severity:** High — silent demo-data starvation in the 7-day window before the 12 May CAIO demo. Recovered today via concurrent manual + scheduled trigger; daily manual trigger required until decoupling lands.

---

## 1. Timeline

| Date / time (UTC) | Tick | Outcome | Result |
|---|---|---|---|
| 2026-05-02 ~15:49–15:57 | Manual triggers via Vercel UI (per `followup_suitefleet_bulk_push_empirical.md`) | Succeeded after 6-prereq chain cleared | Sandbox tenant only — light load |
| 2026-05-03 12:00:38 | Scheduled | 200 in Vercel logs, target_date 2026-05-04 | Light load — demo tenant subscriptions had not yet been seeded against production at the time of this tick; sandbox-only walk completed well under timeout |
| 2026-05-04 12:00 | Scheduled | **No completion log line in Vercel** — initially mis-read as "didn't fire" | Did fire; partially completed (generation phase landed for some tenants); function killed mid-execution by Vercel timeout; final `task generation cron run complete` line never written |
| 2026-05-05 12:00 | Scheduled | **No completion log line in Vercel** — same as May 4 | Same partial-completion pattern; later confirmed by Run B fingerprint (see §3) |
| 2026-05-05 11:57:13.975 | Run A — manual trigger via Vercel UI | In flight when diagnosis filed | Sandbox + MPL 200/200 + DNR 145/145; reached FBU at 12:01:18 — found all 500 May 6 rows already present (walked=500, created=0) |
| 2026-05-05 12:00:16.373 | Run B — scheduled May 5 12:00 UTC tick | Fired ~3 minutes after Run A started | Sandbox + MPL/DNR (skipped, duplicates per ON CONFLICT) + FBU 500/500 fresh inserts |

**Net:** all 845 May 5 + 345 May 6 tasks present in production after Run A and Run B settled. Race was idempotency-safe (see §4) but is a smell.

---

## 2. Root cause

The generation cron handler ([src/app/api/cron/generate-tasks/route.ts:154–278](../../src/app/api/cron/generate-tasks/route.ts#L154-L278)) runs **two phases per tenant in sequence**:

1. **Phase (a) — `generateTasksForWindow`** — bulk `INSERT … SELECT` into `tasks` (one round-trip, fast)
2. **Phase (b) — `pushTasksForTenant`** — walks all unpushed tasks for the tenant, calls SuiteFleet `POST /api/tasks` per task, throttled at the 5 req/sec ceiling (200ms minimum interval between pushes)

Phase (b) is **per-task synchronous**. Empirical latency from today's Run A:

| Tenant | Subs | Pushed | Wall clock | Per-task |
|---|---|---|---|---|
| MPL | 200 | 200 | 11:57:17→11:59:41 = 144s | 720ms/task |
| DNR | 145 | 145 | 11:59:43→12:01:18 = 95s | 655ms/task |
| FBU | 500 | (already pushed) | walked=500, created=0 | n/a |

**Throughput math:** at 845 subs/day on a Tue (full demo seed), total wall-clock ≈ **845 × 660ms = 558s ≈ 9.3 minutes**. This exceeds:

- Vercel Hobby plan: 60s
- **Vercel Pro plan: 300s (current production posture)**

Result: scheduled cron times out mid-walk on full-volume days. The function is killed mid-execution; the handler's own `task generation cron run complete` log line ([route.ts:309](../../src/app/api/cron/generate-tasks/route.ts#L309)) never emits.

### The "didn't fire" misdiagnosis

**Vercel filters out incomplete invocations from the default logs view** — invocations that never reach a successful response (timeout-killed) drop out of the panel's history, creating the false impression of "scheduler dropped registration." Initial diagnosis chased that hypothesis (see §5 contributing factors). The truth surfaced only when prod-data inspection of `task_generation_runs` revealed runs in `running` status with `started_at` matching the May 4 / May 5 12:00 UTC ticks.

**Operational lesson:** Vercel logs filter is unsafe to treat as authoritative for "did the cron fire?" Truth lives in `task_generation_runs.started_at` server-side.

---

## 3. Run A vs Run B — race analysis

Today's diagnosis surfaced **two concurrent runs**, not one:

- **Run A:** `window_start = 2026-05-05 11:57:13.975 UTC` — manual trigger via Vercel cron panel "Run" button while diagnosing
- **Run B:** `window_start = 2026-05-05 12:00:16.373 UTC` — the scheduled 12:00 UTC tick, fired ~3 minutes later, **also completed today** (correcting the earlier "scheduler dropped" hypothesis)

The handler computes `window_start = now()` at handler entry ([route.ts:111](../../src/app/api/cron/generate-tasks/route.ts#L111)). Two invocations 3 minutes apart get distinct `window_start` values, so the run-row UNIQUE constraint `(tenant_id, window_start, window_end)` does NOT collapse them — both runs proceed to the per-tenant generation + push loop.

**What kept the race idempotency-safe:**

- **Generation phase** — `tasks` partial UNIQUE on `(subscription_id, delivery_date) WHERE subscription_id IS NOT NULL` ([repository.ts:322](../../src/modules/task-generation/repository.ts#L322)) makes the bulk `INSERT … SELECT` self-deduplicating via `ON CONFLICT DO NOTHING`. Run B's MPL/DNR generations saw `tasks_created = 0` because Run A had already landed the rows. The deterministic `customer_order_number = SUB-<sub-id-12>-<YYYYMMDD>` ([repository.ts:309](../../src/modules/task-generation/repository.ts#L309)) provides a second layer of identity collision-detection.
- **Push phase** — operates on `pushed_to_external_at IS NULL`, so once Run A finished pushing a task and stamped the timestamp, Run B's push walk skipped it. AWB-exists guard would also have caught any escapee at the SF end.

**Why this is still a smell:**

1. Two concurrent runs walked the same tenant set against the same external API — wasted SF API budget and duplicate audit churn (`task.bulk_generation_skipped_already_run` and `task.created` per-task emits).
2. The race was safe **only because** generation was fast enough to commit before the second run started; if generation phase ever slows, the safety margin disappears.
3. Operator confusion: two run rows per tenant per scheduled-day-with-manual-recovery pattern bloats `task_generation_runs` and complicates "did today's cron complete?" queries.

**What would harden the race posture:** pin a per-day idempotency key (e.g. `(tenant_id, target_date)` UNIQUE on `task_generation_runs` alongside the existing `(tenant_id, window_start, window_end)` UNIQUE), so manual-trigger + scheduled-tick collisions short-circuit at the run-row insert. Filed as a sub-item of the Day-14 decoupling plan (see §6).

---

## 4. Three contributing factors (corrected)

1. **β-filter (Day 8, PR #81) fixed enumeration scaling but not per-tenant scaling.** The β fix ([list-cron-eligible-tenants.ts](../../src/app/api/cron/generate-tasks/list-cron-eligible-tenants.ts)) dropped the tenant walk from 340 → ~4 by filtering on `suitefleet_customer_code`. Correct for the 2 May 340-tenant timeout incident, but did not address the per-task push latency that dominates once seeded subscriptions land.

2. **bom1 region pin (PR #130, 2026-05-04 07:05 UTC) was a red herring.** The redeploy timing was suspicious in initial diagnosis (5h before the May 4 tick). The cron registration was never dropped — the Vercel cron panel showed it registered and enabled throughout, and today's data confirms the May 4 / May 5 ticks did fire.

3. **Demo tenant subscription seeding timing (PR #123/#128, Day 12) made May 3 a false-positive baseline.** The May 3 12:00 UTC tick succeeded because demo tenant subscriptions had not yet been seeded against production at that point — the run carried only the legacy sandbox load and completed well under timeout. Once seeding landed (Day 12 evening), every subsequent tick exceeded the budget on volume-eligible days. The May 3 success therefore failed to surface the latent latency coupling that had been baked into the cron design since Day 8.

---

## 5. Recommendation: decouple materialization from push (own T3 plan PR, Day 14)

Materialization and push are two responsibilities collapsed into one cron handler. The brief explicitly anticipates this split:

- `tasks.suitefleet_push_acknowledged_at` ([PLANNER_PRODUCT_BRIEF.md §3.1.1](../PLANNER_PRODUCT_BRIEF.md)) is designed as the SF-push integration-honesty indicator on the operator UI: NULL on a freshly-materialized task; populated when push completes. The split is implicit in the column's existence — materialization owns the INSERT, push owns the timestamp UPDATE.

**Decoupling shape (to be designed in the Day-14 T3 plan PR, not here):**

- **Materialization cron:** 14-day rolling horizon per [PLANNER_PRODUCT_BRIEF.md §3.1.5](../PLANNER_PRODUCT_BRIEF.md), single bulk `INSERT … SELECT` per tenant, completes in seconds
- **Push:** async — candidate mechanisms include Upstash QStash (already in `package.json` dependencies), Vercel function fan-out per-tenant subrequest, or per-tenant workers. Independent timeout envelope. Retries on transient SF errors. `suitefleet_push_acknowledged_at` is the completion signal.
- **Run-row idempotency hardening:** `(tenant_id, target_date)` UNIQUE on `task_generation_runs` to short-circuit manual + scheduled collision (§3 smell).

**Tier:** **T3.** Touches `LastMileAdapter` interface boundary; `tasks.suitefleet_push_acknowledged_at` semantics; audit event vocabulary (push success/failure becomes its own UoW separate from `task.bulk_generated`); retry/idempotency posture on the push path.

**Sequencing:** plan PR drafts after the Day-13 exception-model T3 plan PR is approved. Tier discipline per [PLANNER_PRODUCT_BRIEF.md §7](../PLANNER_PRODUCT_BRIEF.md): no two T3 plan PRs open simultaneously without clearing the first. Code PR target Day 14.

---

## 6. Operational mitigation (until decoupling lands)

- **Daily manual trigger** before 12:00 UTC each day via the Vercel cron panel "Run" button. Vercel's manual-trigger path has a different timeout envelope than scheduled cron and allows the ~9-minute walk to complete. Today's manual trigger was sufficient by accident; daily proactive trigger is the safe pattern.
- **The Day-13 exception-model schema PR part 1** explicitly notes in its `tasks.suitefleet_push_acknowledged_at` schema section that this column is the contract surface for the forthcoming materialization/push decoupling (Day-14 separate plan PR). Avoids the column shipping with no documented integration intent.

---

## 7. Diagnostic reproducibility

Queries that locked today's diagnosis. Re-runnable any time against production to verify cron health.

```sql
-- Q1: cron run history — 'running' status with old started_at means partial-completion timeout
SELECT id, tenant_id, window_start, window_end, status,
       cap_threshold, projected_count, subscriptions_walked,
       tasks_created, tasks_skipped_existing, error_text,
       started_at, completed_at, created_at
FROM task_generation_runs
ORDER BY created_at DESC
LIMIT 20;

-- Q2: cron-eligible tenant set
SELECT id, slug, suitefleet_customer_code, created_at, updated_at
FROM tenants
WHERE suitefleet_customer_code IS NOT NULL AND suitefleet_customer_code <> ''
ORDER BY created_at ASC;

-- Q3: subscription eligibility shape per merchant
SELECT t.slug, s.status, s.days_of_week, COUNT(*)
FROM subscriptions s
JOIN tenants t ON t.id = s.tenant_id
WHERE t.slug IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers')
GROUP BY t.slug, s.status, s.days_of_week
ORDER BY t.slug, s.status;

-- Q4: cron-diary task counts by delivery_date
SELECT t.slug AS tenant_slug, ta.delivery_date, COUNT(*)
FROM tasks ta
JOIN tenants t ON t.id = ta.tenant_id
WHERE ta.delivery_date BETWEEN '2026-05-03' AND '2026-05-07'
GROUP BY t.slug, ta.delivery_date
ORDER BY ta.delivery_date, t.slug;

-- Q5: per-tenant push throughput (the per-task latency proof)
SELECT t.slug,
       COUNT(*) FILTER (WHERE ta.pushed_to_external_at IS NOT NULL) AS pushed_count,
       COUNT(*) AS total_tasks,
       MIN(ta.pushed_to_external_at) AS first_push,
       MAX(ta.pushed_to_external_at) AS last_push,
       EXTRACT(EPOCH FROM (MAX(ta.pushed_to_external_at) - MIN(ta.pushed_to_external_at))) AS span_seconds
FROM tasks ta
JOIN tenants t ON t.id = ta.tenant_id
WHERE ta.delivery_date = '2026-05-06'
GROUP BY t.slug;
```

---

## 8. Cross-references

- [PLANNER_PRODUCT_BRIEF.md §3.1.1, §3.1.5, §3.3.6, §7](../PLANNER_PRODUCT_BRIEF.md) — `suitefleet_push_acknowledged_at` design intent, 14-day horizon, integration-honesty UI indicator, tier discipline
- [followup_suitefleet_bulk_push_empirical.md](../followup_suitefleet_bulk_push_empirical.md) — Day 8 SF push first-run capture; β-filter rationale; per-task push throttling baseline
- [followup_audit_rule_cascade_conflict.md](../followup_audit_rule_cascade_conflict.md) — upstream stale-tenant cleanup gap referenced by the β-filter
- [src/app/api/cron/generate-tasks/route.ts](../../src/app/api/cron/generate-tasks/route.ts) — current coupled handler (generate phase + push phase per tenant)
- [src/modules/task-push/service.ts](../../src/modules/task-push/service.ts) — per-task push loop with 5 req/sec throttle
- [src/modules/task-generation/repository.ts:322](../../src/modules/task-generation/repository.ts#L322) — partial UNIQUE on `(subscription_id, delivery_date)` that kept the Run A/B race idempotency-safe

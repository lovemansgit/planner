---
name: CI test-tenants leak to production — recurrence pattern + Phase 2 remediation
description: Integration tests seed tenants via withServiceRole; teardown DELETE blocked by 0002's audit_events_no_delete RULE when audit rows reference the tenant; rows leak to production. PR #191 (Day-18 morning) archived 379 leaked rows; this PM PR archives 62 more from today's CI runs (PR #194 + #196 merge CI). Recurrence forecast: 50-70 rows leak per integration suite run. Phase 2 paths ranked — ephemeral test DB (cleanest, largest), CI cleanup hook with extended service-role grant (medium), is_internal flag at the admin layer (hides not stops). Manual archive-on-merge mitigation continues until Phase 2 lands.
type: project
---

# CI test-tenants leak to production — recurrence pattern + Phase 2 remediation

**Filed:** Day 18, 8 May 2026 (afternoon, post-transcorp-sysadmin onboarding + Gate 12 prep)
**Tier when triggered:** T2 (depending on chosen path; ephemeral DB is T3)
**Trigger date:** between Day 25 (post-internal demo) and Day 28 (external demo), or earlier if CI test runs leak so heavily the admin surface becomes unusable
**Cross-references on disk:**
- `memory/followup_audit_rule_cascade_conflict.md` (Day-2 — original RULE finding)
- `memory/followup_audit_rule_cascade_conflict_cleanup.md` (Day-10 — first cleanup attempt)
- `memory/decision_test_tenants_cleanup_snapshot.md` (Day-18 morning — Session B's snapshot pattern, PR #191)
- `memory/decision_test_tenants_cleanup_snapshot_day18_pm.csv` (this PM run's snapshot — bundled with this PR)
- `memory/followup_admin_merchant_list_filter_internal_tenant.md` (related — `is_internal` flag for admin-layer filtering)
- `supabase/migrations/0002_audit.sql` (the `audit_events_no_delete` RULE that blocks teardown)
- `tests/integration/task-materialization.spec.ts:82-108` (`teardownTenant` try/catch with the audit-RULE comment)

---

## §1 What surfaced

Day-18 PM Gate 12 smoke surfaced **66 tenants visible on `/admin/merchants`** when only 4 were expected (MPL + DNR + FBU + transcorp).

Read-only investigation enumerated the 62 unexpected tenants — all integration-test fixtures from CI runs created in a single 41-second window (`2026-05-08T07:40:28` through `07:41:09` UTC). That window corresponds to the integration suite run for PRs #194 (transcorp-sysadmin plan-PR) + #196 (transcorp-sysadmin code-PR) merging on Day 18 morning.

Naming-prefix taxonomy of the 62 leaked rows:

| Prefix family | Count | Source spec |
|---|---|---|
| `d18-*` | 8 | Day-18 multi-status fixtures |
| `auth-test-*` | 4 | Auth-related integration fixtures |
| `d14-mat-*` | 16 | `task-materialization.spec.ts` `seedTenant()` per-test |
| `d14-mig0020-*`, `d14-e2e-*` | 2 | Day-14 migration + E2E fixtures |
| `bg4g-{e2e,ov,rot}-*` | 3 | Block 4-G exception-model happy-path fixtures |
| `svc-{a,b}-*` | 4 | Service-A/B test fixtures |
| `tai-*`, `lvtei-*`, `lvti-*` | 6 | Module-abbreviation test fixtures |
| `r3-*`, `s1-*`, `s2-*`, `t1-*`, `t6-*`, `b1-*`, `c6-*`, `c8-*`, `p4a-*`, `d13-*` | 19 | Module-prefix test fixtures across Days 13-14 |

Status distribution: 17 active + 39 provisioning + 3 inactive + 3 suspended.

This PM PR archives all 62 via `UPDATE tenants SET status='archived'` matching Session B's PR #191 pattern. Pre-state snapshot CSV at `memory/decision_test_tenants_cleanup_snapshot_day18_pm.csv` for restorability.

## §2 Background — why the leak happens

Integration tests under `tests/integration/` seed tenants via `withServiceRole` to bypass RLS at setup time. Teardown attempts `DELETE FROM tenants WHERE id IN (...)`, which cascades through FK references — but `0002_audit.sql`'s `audit_events_no_delete` RULE blocks DELETE from `audit_events` in turn, breaking the cascade.

The teardown logic is wrapped in try/catch with explicit comment acknowledgment:

```ts
// tests/integration/task-materialization.spec.ts:82-108 (teardownTenant):
// Cleanup wrapped in try/catch — audit_events_no_delete RULE (0002)
// breaks DELETE CASCADE from tenants when audit rows exist.
// Random per-run tenant UUIDs prevent cross-run pollution.
try {
  await withServiceRole("§7.1 mat teardown", async (tx) => {
    await tx.execute(sqlTag`DELETE FROM tasks WHERE tenant_id = ${tenantId}`);
    // ... etc
  });
} catch {
  /* audit RULE; ignore */
}
```

So:
- Test seeds tenant → setup writes audit rows referencing that tenant
- Test teardown attempts DELETE → audit-RULE blocks → DELETE rolls back → tenant row leaks
- Random per-run UUIDs prevent the next run from colliding, but the leaked row stays

## §3 Recurrence forecast

| Surface | Leaked-rows-per-run estimate | Frequency |
|---|---|---|
| Full integration suite (`vitest run --project integration`) | 50-70 rows | Every CI run on every PR push |
| `tests/integration/task-materialization.spec.ts` alone | ~16 rows | Same |
| `tests/integration/exception-model-happy-path.spec.ts` alone | ~3 rows | Same |
| `tests/integration/cron-decoupling-happy-path.spec.ts` alone | ~1 row | Same |
| Local-developer `npm run test:integration` | Same as CI | Per developer run |

**Forecast: tomorrow's CI runs will leak another ~60 rows.** Without remediation, the manual archive-on-merge cycle has to repeat every demo-prep cycle.

## §4 Phase 2 remediation paths (ranked)

### §4.1 (Path A) Migrate integration tests to ephemeral DB

**Scope:** T3 — separate Supabase project for CI; integration tests target the ephemeral DB instead of production. CI workflow provisions schema via `supabase/migrations/*.sql` on every run; tears down at run-end. Local developer flow uses Docker postgres or a local Supabase via `supabase start`.

**Pros:**
- Permanent fix. Production never sees CI fixtures again.
- Integration tests gain isolation guarantees that production-shared currently lacks (cross-run pollution risks, RLS-bypass concerns).
- Removes the audit-RULE-cascade-conflict tension entirely for tests.

**Cons:**
- Largest scope. Provisioning a CI DB + wiring credentials + ensuring schema parity + handling per-run isolation = multi-week work.
- Local-dev experience changes — developers need Docker or `supabase start`.

**Estimated effort:** 2-3 days of focused work; sized as a substantive Day-25+ initiative.

### §4.2 (Path B) CI cleanup hook with extended service-role grant

**Scope:** T2 — add a Supabase role with grants that bypass the audit-RULE for cleanup contexts. `audit_events_no_delete` RULE could be `RULE ... DO INSTEAD NOTHING` rather than a blanket prohibition; an explicit `DELETE` from a privileged role would succeed. CI workflow runs a post-test cleanup script using that role that walks fixture-tenants by created-at-window and deletes.

**Pros:**
- Smaller scope (one new role, one cleanup script, one CI step).
- Production remains the single DB (no ephemeral-DB infra).

**Cons:**
- Doesn't address the architectural concern that integration tests share production DB.
- Cleanup hook needs care — over-broad role could be misused; under-scoped role fails to clean.
- Audit-RULE semantic change (or a parallel privileged-role bypass) requires reviewer approval — touches the security posture documented in `0002_audit.sql`.

**Estimated effort:** 4-6 hours.

### §4.3 (Path C) `is_internal` flag at admin layer (hides not stops)

**Scope:** T2 — already pending per `memory/followup_admin_merchant_list_filter_internal_tenant.md`. Add `tenants.is_internal boolean` column; integration test `seedTenant()` defaults `is_internal: true`; `/admin/merchants` filters `is_internal = false` by default.

**Pros:**
- Smallest scope. Reuses the already-planned `is_internal` flag column.
- Admin-surface UX cleaner immediately.

**Cons:**
- Does NOT stop the leak. Production DB still accumulates fixture rows; storage grows unbounded.
- Cron β filter already excludes (via `suitefleet_customer_code IS NOT NULL`); this just hides the rows from the admin surface too.
- Long-term, hidden ≠ archived. Leaked rows still consume DB space and complicate forensic queries.

**Estimated effort:** 2-3 hours (bundled with the existing followup memo's planned work).

### §4.4 Recommendation

**Path A** is the right end-state. **Path C** is the right Day-25 demo-prep mitigation. **Path B** is a viable middle ground.

- For internal demo (Day 19): Path C deferred, manual archive-on-merge continues (this PR pattern).
- For external demo (Day 28+): Path A or Path B should land before then to avoid manual cycle.

## §5 Demo unblock for now

Manual archive-on-merge is the current mitigation:

1. Snapshot the leaked rows to a CSV under `memory/`
2. `UPDATE tenants SET status='archived'` for the matching set
3. Bundle the CSV + a recurrence memo (this file) in a T1 PR
4. Re-run as needed before each demo-prep cycle

This PR demonstrates the pattern. Session B's PR #191 was the first instance. PR pattern reusable.

## §6 Cross-references

- `memory/followup_audit_rule_cascade_conflict.md` (Day-2 — original RULE-finding memo)
- `memory/followup_audit_rule_cascade_conflict_cleanup.md` (Day-10 — first cleanup attempt scoped to probe-merchant-a/b)
- `memory/decision_test_tenants_cleanup_snapshot.md` (Day-18 morning — Session B's PR #191 snapshot decision)
- `memory/decision_test_tenants_cleanup_snapshot_day18_pm.csv` (this PM run's snapshot — bundled in this PR)
- `memory/followup_admin_merchant_list_filter_internal_tenant.md` (Day-18 — Path C `is_internal` flag work)
- `memory/plans/day-18-test-tenants-cleanup.md` (Day-18 — Session B's plan-PR for the morning archive)
- `supabase/migrations/0002_audit.sql` (the audit-RULE that blocks teardown DELETE)
- `supabase/migrations/0021_tenants_status_archived.sql` (the migration that added the `'archived'` status enum value, supporting both archive cycles)
- `tests/integration/task-materialization.spec.ts:82-108` (the canonical `teardownTenant` with audit-RULE try/catch comment)
- PR #191 (Day-18 morning archive — 377 rows)
- This PR (Day-18 PM cleanup — bundles CSV snapshot + this memo; 62 rows archived via direct SQL UPDATE prior to merge)

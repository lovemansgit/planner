---
name: audit_events_no_delete RULE conflicts with ON DELETE CASCADE
description: 0002_audit's append-only RULE blocks cascade-deletes from tenants → audit_events, breaking any future cascade through tenant deletion. Surfaced 27 April 2026 during R-0 verification cleanup.
type: project
originSessionId: 745ed780-25c9-41f2-a58d-a5c1bbf8d5df
---
`supabase/migrations/0002_audit.sql` defines:

```sql
audit_events.tenant_id  uuid REFERENCES tenants(id) ON DELETE CASCADE,
...
CREATE RULE audit_events_no_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;
```

These two facts contradict each other. When you `DELETE FROM tenants`, Postgres tries to cascade-delete the matching `audit_events` rows. The `audit_events_no_delete` RULE rewrites that internal DELETE to `DO INSTEAD NOTHING`, which Postgres reports as `ri_PerformCheck: referential integrity query gave unexpected result` — the cascade can't be satisfied, so the original `DELETE FROM tenants` aborts.

Effect: **once any audit_events row exists with a non-null tenant_id, that tenant cannot be deleted.** Even if the test data has zero audit events pointing at it, Postgres still trips the RULE because the rewrite happens at the schema level before row-count is known. Caught in R-0 verification when verify-r0.mjs left test tenants behind that couldn't be cleaned up. Worked around by using random per-run UUIDs/slugs in the script so the harmless artifacts never collide on retry.

**Why:** The append-only audit log was the right design (per R-4) — but pairing `ON DELETE CASCADE` from tenants→audit_events with a blanket `DO INSTEAD NOTHING` rule on audit_events makes the cascade structurally impossible. We probably want one of:

- Drop `ON DELETE CASCADE` and document that audit_events outlive their tenants by design (likely the right answer — audit retention regulations often require this anyway).
- Replace the blanket rule with a more targeted approach: a `BEFORE DELETE` trigger that raises EXCEPTION with a friendlier message, plus a `WITH (security_barrier)` view if read-side filtering is needed. The trigger pattern lets you carve out an "internal cascade" pathway that the rule doesn't intercept.
- Keep CASCADE but DROP the rule and rely solely on the application-layer `withServiceRole`-only insert path to enforce append-only. Loses the database-level defense, which the resolutions doc (R-4) explicitly wanted. Probably not acceptable.

**How to apply:** Out of scope for the R-0 PR — the bug exists on the schema regardless of R-0, just made visible by the verification cleanup path. Tackle in a small T3 PR after Day 2 lands. Suggested approach: drop the FK CASCADE, change to `ON DELETE NO ACTION` or `ON DELETE SET NULL` (both compatible with the rule), and add a comment to 0002 explaining the constraint shape. Need to also clean up the leaked R-0 verification test tenants from the live database — those will require either disabling the rule briefly via a privileged dashboard SQL session, or a one-shot migration that reshapes the FK first.

**Surfaced:** R-0 verification, 27 April 2026. Workaround: verify-r0.mjs uses random per-run UUIDs to avoid retry collisions.

**Scope addition (Day 3, 2026-04-28):** when this fix lands, `consignees` is also in scope. 0004_consignee.sql ships `consignees.tenant_id REFERENCES tenants(id) ON DELETE CASCADE`, same shape as audit_events.tenant_id but without the append-only RULE — so consignees would cascade cleanly today. The point is that whatever FK reshape the audit fix lands on (drop CASCADE, change to NO ACTION, etc.) needs a coherent decision across all tenant-FK tables, not just audit_events. Tenants are the root of every multi-tenant FK chain; the cascade story should be uniform. Re-evaluate every `REFERENCES tenants(id) ON DELETE …` clause in scope when this PR opens: tenants 0001 (users, roles, role_assignments, api_keys), 0002 (audit_events), 0004 (consignees), and any new tables added between now and then.

---

## Test-hygiene observation surfaced 3 May 2026 (D8-4a production schema audit)

Querying production for D8-4a's first-run cron prep surfaced **239 stale test consignees across 129 test tenants** that integration tests created and never cleaned up. Breakdown:

| Slug pattern | Tenants | Consignees | Source test suite |
|---|---|---|---|
| `r3-test-*` | 63 | 173 | R-3 RLS isolation tests (`tests/integration/rls-tenant-isolation.spec.ts`) |
| `t1-trigger-*` | 33 | 33 | T-1 trigger tests (`tests/integration/task-packages-tenant-match.spec.ts` etc.) |
| `t6-trigger-*` | 27 | 27 | T-6 trigger tests (`tests/integration/failed-pushes-tenant-match.spec.ts`) |
| `b1-*` | 6 | 6 | B-1 asset-tracking tests (`tests/integration/asset-tracking-tenant-match.spec.ts`) |
| `<other / real>` | 0 | 0 | — |
| **TOTAL** | **129** | **239** | |

Zero real-merchant rows in the leak set — every leaked consignee is in a test-only tenant. Operational impact for D8-4a: zero (the cron only walks tenants it enumerates; test-only tenants have no active subscriptions and no production-cron exposure).

But the count is growing every CI run — each `r3-test-${RUN_ID}` invocation leaks 2-3 consignees per run, never cleaned up because the `audit_events_no_delete` RULE blocks the obvious cascade-delete cleanup path the test fixtures would naturally use.

**Day 9+ scope item — pick one:**

(a) **Carve a test-only cleanup exemption.** Options:
   - Drop the audit RULE during test setup (privileged role); tests run, RULE re-applied teardown. Risky if a test crashes mid-run; need scoping.
   - Add a `planner_test` Postgres role that has BYPASSRLS + permission to DELETE audit_events; tests use it for cleanup only. Clean but adds another role to the matrix.
   - Composite ON DELETE NO ACTION on the audit_events FK + a separate test-only `cleanupTenantWithAuditEvents()` helper that NULLs out audit_events.tenant_id before deleting the tenant. Preserves the audit data but unhooks the cascade.

(b) **Accept the stale-test-data drift as an artifact.** Rationale: production has zero real-tenant impact; CI test DB resets each run anyway (CI uses ephemeral postgres:17 service container per `tests/integration/...spec.ts` headers); the only place leaks accumulate is the **production preview/sandbox DB** where tests shouldn't run. If the right fix is "stop running integration tests against production DB", then (b) is acceptable + the discipline lives in CI config.

Lean: **(b) — the stale data isn't a real problem; the absence of a CI-vs-production test boundary is the real problem.** A long-term hygiene PR could add an explicit guard rejecting integration tests when `SUPABASE_DATABASE_URL` host matches the production pooler. That's the upstream fix.

Not blocking D8-4. Re-surface when the audit-RULE-cascade reshape lands or when test count crosses an arbitrary threshold (say, 1000 stale consignees).

### Update — D8-4a first-run empirical trigger (3 May 2026)

The 339 stale test tenants directly blocked the D8-4a first-run cron. Cron timed out before reaching the sandbox tenant (position 194 of 340 in `created_at ASC` order); each tenant takes ~7 sec for the missing-customer-code guard's `tenant_skipped` path (load_config + count_unpushed + emit). 340 × 7 ≈ 40 min, way over Vercel's cron timeout.

Two layers of treatment:

1. **α (immediate):** Moved sandbox to position 1 via `UPDATE tenants SET created_at = '2024-01-01' WHERE id = '8bfc84b0...'`. Lets the cron process sandbox first, captures empirical, rest of the iteration can time out without affecting capture. Workaround, not a fix.

2. **β (post-D8-4b T2):** Add `WHERE suitefleet_customer_code IS NOT NULL` to `listAllTenantIds()` in the cron handler. Drops enumeration from 340 → 1 in current state. Future tenants only enter the loop after their customer_code is backfilled — natural gate matching the production-readiness invariant.

**β treats the symptom in the cron path; the upstream cleanup gap (this memo's subject) remains.** Tonight's 12:00 UTC scheduled cron uses β's filter so it doesn't time out, but the next time anyone needs to walk all tenants for any reason (e.g., a future system-wide migration script), the 339-tenant cost recurs. The audit-rule-cascade reshape is still the right long-term fix.

Day 9+ carry-forward: the cleanup-mechanism PR (option (a) above — test-only role with audit-events-delete permission, OR composite `ON DELETE NO ACTION` + cleanup helper) lands when the next person bumps into the iteration cost.

---
name: CI-residue cleanup task — 339 stale tenant rows + Day-10 probe-merchant-a/b
description: Tracks the actual cleanup work for the leaked CI test tenants surfaced in followup_audit_rule_cascade_conflict.md. As of Day 10 (3 May 2026) the tenants table holds 340 rows — 1 real (sandbox-merchant-588) and 339 CI residue. Day-10 P2 cross-tenant probe adds probe-merchant-a/b on top of this residue; both need cleanup post-probe via the teardown path documented here.
type: project
---

# CI-residue cleanup task — 339 stale tenants + Day-10 probe-merchant-a/b

**Captured:** 3 May 2026 (Day 10 P2 cross-tenant probe prep)
**Companion to:** [followup_audit_rule_cascade_conflict.md](followup_audit_rule_cascade_conflict.md) — the upstream root-cause memo (audit_events_no_delete RULE blocks ON DELETE CASCADE from tenants → audit_events)

---

## Current DB state (3 May 2026)

```
tenants table:  340 rows total
  ├─ 1 real:   sandbox-merchant-588 (id 8bfc84b0..., MPL, created 2024-01-01)
  └─ 339 CI residue (every test pattern):
       ├─ r0-test-*       (R-0 verification harness)
       ├─ r3-test-*       (R-3 RLS isolation)
       ├─ p4a-test-*      (P4a webhook-config)
       ├─ auth-test-*     (Day-10 P2 auth-end-to-end — adds 2 per CI run)
       ├─ b1-test-*       (B-1 asset-tracking)
       ├─ b2-test-*       (B-2 asset-tracking)
       ├─ c*-test-*       (C-series consignee tests)
       ├─ s1-check-*      (S-1 check trigger tests, ~20 rows)
       ├─ s2-link-*       (S-2 task-subscription link tests, ~20 rows)
       ├─ t1-trigger-*    (T-1 trigger tests, ~50 rows)
       ├─ t6-trigger-*    (T-6 trigger tests, ~50 rows)
       └─ d8-*, mp-*      (Day-8 + MP-* lifecycle tests)
```

The 339 residue grows by ~5-10 rows per Preview-merge cycle (each CI integration run adds the new test's tenants). Day-10 P2 added auth-end-to-end's 2 per run.

## Day-10 probe-merchant-a/b on top

Per Love's call (3 May 2026), the cross-tenant probe seeds two additional tenants directly via `npm run onboard-merchant`:
- `probe-merchant-a` (slug, suitefleet_customer_code=PMA, admin-a@probe.test)
- `probe-merchant-b` (slug, suitefleet_customer_code=PMB, admin-b@probe.test)

These are real-data writes against the same DB the CI residue already lives in (Supabase Nano = single Postgres per project; Preview + Production share). Once the probe completes, both must be cleaned up — they carry working Auth credentials (probe passwords are throwaway per Love's instruction) and a permission grant; leaving them around is a small but non-zero attack surface.

## Cleanup path for probe-merchant-a/b

Probe-specific cleanup, NOT the wider 339-row sweep:

```sql
-- Run AFTER cross-tenant probe completes + before EOD promotion.
-- Delete probe-merchant Auth users via supabase.auth.admin.deleteUser
-- (same path as createUser, inverse). Cascade kicks in via
-- public.users.id REFERENCES auth.users(id) ON DELETE CASCADE.

-- Step 1 (Node, in scripts/teardown-probe-merchants.mjs — to be written):
--   for each user in [admin-a@probe.test, admin-b@probe.test]:
--     supabase.auth.admin.deleteUser(userId)
--   This cascades to public.users (FK ON DELETE CASCADE)
--   AND to role_assignments (FK ON DELETE CASCADE on user_id)

-- Step 2 (DB, after auth.users gone):
--   DELETE FROM tenants WHERE slug IN ('probe-merchant-a', 'probe-merchant-b')
--   ⚠ This will hit the audit_events_no_delete RULE conflict. The probe
--     emits user.login_succeeded + user.login_failed audit events that
--     reference tenant_id, so the cascade-delete from tenants → audit_events
--     will fail per the parent memo's structural finding.
--
-- Workaround (matches the parent memo's option (a) / "drop RULE briefly"
-- approach for ad-hoc cleanup): use a privileged dashboard SQL session
-- to execute:
--     ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
--     DELETE FROM tenants WHERE slug IN ('probe-merchant-a', 'probe-merchant-b');
--     ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Risky if anything else writes to audit_events during the brief window;
-- in practice the probe is sequential and Love-driven, so window is
-- tightly bounded.
```

If the cleanup script gets written: add to `scripts/teardown-probe-merchants.mjs`. Idempotent (no-op on absent records). Loops both merchants; logs each step.

If not written (acceptable for one-off probe): manual SQL via Supabase Dashboard with the brief RULE disable above.

## Wider 339-row sweep — STAYS open as parent memo's scope

This memo is NOT the place to track the wider cleanup. Per parent memo's option (b) lean: *"the stale data isn't a real problem; the absence of a CI-vs-production test boundary is the real problem."* The right upstream fix is preventing CI from running integration tests against the production-pooler URL. That work re-surfaces when:

- Stale tenant count crosses an arbitrary threshold (parent memo says 1000 stale consignees; tenants currently at 339 + new growth)
- A future system-wide migration script needs to walk all tenants and pays the iteration cost
- The audit-rule-cascade reshape PR opens

When the wider sweep happens, probe-merchant-a/b cleanup folds into it (no separate teardown needed). Until then, the probe-specific cleanup above is the focused task.

## Cross-references

- [followup_audit_rule_cascade_conflict.md](followup_audit_rule_cascade_conflict.md) — root cause + 3-option treatment menu (this memo's parent)
- [scripts/onboard-merchant.mjs](scripts/onboard-merchant.mjs) — the script that adds probe merchants
- Day-10 P2 cross-tenant probe (3 May 2026) — the trigger for this memo's existence
- Future `scripts/teardown-probe-merchants.mjs` (TBW if needed) — the inverse of onboard-merchant for ad-hoc cleanup

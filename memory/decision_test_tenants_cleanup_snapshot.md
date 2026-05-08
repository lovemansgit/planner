---
name: Test-tenants cleanup pre-archive snapshot (Day-18)
description: Pre-archive snapshot of the 377 fixture-pollution rows flipped to status='archived' in migration 0021. Captured for restorability per plan-PR §3.3 sandbox-merchant-588 lesson — any row later identified as production-significant can be reverted via a one-line UPDATE referencing the snapshot CSV at memory/snapshots/test-tenants-archive-2026-05-08.csv.
type: decision
---

# Test-tenants cleanup — pre-archive snapshot (Day-18)

**Filed:** Day 18 (8 May 2026), pre-merge of code-PR (cleanup atomic bundle).
**Migration that flips these rows:** `supabase/migrations/0021_tenants_status_archived.sql`.
**Plan-PR:** [#189](https://github.com/lovemansgit/planner/pull/189) merged at `8347d00`.

This memo is the durable forensic artifact for the soft-archive of 377
fixture-pollution rows in the `tenants` table. Its purpose is **row-level
restorability** if any archived row later turns out to have been
load-bearing.

---

## §1 What the snapshot covers

Every row in `tenants` whose `slug` is **not** in
`('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers')` — i.e. every
row the migration archives. Row count: **377**.

Captured columns: `id`, `slug`, `name`, `status`, `created_at`,
`suitefleet_customer_code`. Columns omitted from the snapshot
(e.g. `pickup_address_line/district/emirate`, `source_of_truth`,
`migration_gate_status`) are either NULL/default for fixture rows or
not relevant to a status-only restoration.

**Snapshot file:** [`memory/snapshots/test-tenants-archive-2026-05-08.csv`](snapshots/test-tenants-archive-2026-05-08.csv) — 378 lines (1 header + 377 data rows).

**Capture timestamp:** 2026-05-08 (CP1b query during code-PR Checkpoint 1).

**Capture method:** read-only `SELECT … FROM tenants WHERE slug NOT IN (...) ORDER BY created_at` against `SUPABASE_DATABASE_URL` (admin role; bypasses RLS for the cross-tenant scan).

---

## §2 Reasoning recap (load-bearing — why archive vs delete)

Plan-PR §3 enumerated three paths and locked Path C (this PR is the
B-style one-shot UPDATE; the lifecycle service-fn A-style is queued
for Phase 2). Key reasoning kept here for forensic future-readers:

- **Hide, don't delete.** Love's Day-18 call. Hard-delete would
  destroy `id`-bearing references (`audit_events.resource_id`
  back-pointers, etc.) and is reversible only via DB restore.
  Soft-archive is reversible via a one-line UPDATE per row.

- **Allowlist over denylist.** The fixture taxonomy spans 13+ slug
  prefixes (`r0-/r3-/c6-/t1-/t6-/s1-/s2-/b1-/bg4g-/svc-/lvti-/lvtei-/tai-`).
  Enumerating fixture prefixes is a maintenance trap; preserving the
  3 demo merchants by `slug IN (...)` allowlist is concrete and
  auditable.

- **`sandbox-merchant-588` archived alongside the prefix-fixtures.**
  Slug suggests SF sandbox alignment but the row is not referenced
  by any seeder allowlist or load-bearing test path the
  CP1 survey turned up. Archived under interpretation (i) "throwaway
  fixture from an early sandbox-roundtrip seeder." Recovery for
  interpretation (ii) "intentional sandbox-aligned tenant" is via
  the §4 procedure below. Pre-archive state captured in this memo:
  `id=8bfc84b0-c139-4f43-b966-5a12eaa7a302, status='provisioning',
  suitefleet_customer_code='MPL', created_at='2024-01-01T00:00:00.000Z'`.

- **Audit-silent.** No `merchant.archived` event registered. Per
  §A registered-metadata-wins, fabricating per-row audit events for
  ~377 rows that no operator actually acted on would create
  misleading attribution history. The migration filename + this
  memo are the durable artifact.

---

## §3 Distribution at capture time

Status distribution within the 377-row archive set:

| Status | Count |
|---|---|
| `provisioning` | 340 |
| `active` | 37 |
| `suspended` | 0 |
| `inactive` | 0 |
| **Total** | **377** |

The 3 demo merchants (`meal-plan-scheduler`, `dr-nutrition`,
`fresh-butchers`) are **not** in this set; they remain `active`
post-archive.

**Rows in the archive set carrying non-null `suitefleet_customer_code`** —
load-bearing for the cron β filter scope addition (this PR also adds
`AND status IN ('provisioning', 'active')` to the cron's tenant
enumeration so post-archive these rows are excluded from cron walks):

| slug | name | status | customer_code |
|---|---|---|---|
| `bg4g-rot-745f38ea` | Block 4-G Rotation Tenant | active | `'ROT-745f38ea'` |
| `bg4g-ov-745f38ea` | Block 4-G Override Tenant | active | `'OV-745f38ea'` |
| `bg4g-e2e-745f38ea` | Block 4-G E2E Tenant | active | `'E2E-745f38ea'` |
| `bg4g-ov-60cb07c8` | Block 4-G Override Tenant | active | `'OV-60cb07c8'` |
| `bg4g-e2e-60cb07c8` | Block 4-G E2E Tenant | active | `'E2E-60cb07c8'` |
| `bg4g-rot-60cb07c8` | Block 4-G Rotation Tenant | active | `'ROT-60cb07c8'` |
| `sandbox-merchant-588` | Sandbox Merchant 588 (transcorpsb) | provisioning | `'MPL'` |

All seven carry alphanumeric `customer_code` values that A1's
incoming numeric-only resolver (PR #187 code-PR) would reject with
`CredentialError`. The status filter on the cron β SELECT is the
gate that prevents the post-archive DLQ flood.

---

## §4 Restoration procedure — single row

If a specific row is later identified as load-bearing and needs to
return to its pre-archive status:

```sql
-- Example: restore sandbox-merchant-588 to its captured pre-archive
-- status (look up the row in the snapshot CSV first to confirm
-- the captured status value).
UPDATE tenants
SET status = 'provisioning'  -- value from snapshot CSV
WHERE id = '8bfc84b0-c139-4f43-b966-5a12eaa7a302';
```

The snapshot CSV's `status` column carries the captured pre-archive
value; copy it verbatim into the UPDATE's RHS. Do **not** reuse the
slug as the lookup key — the snapshot is keyed on `id` (UUID) which
is stable across the archive flip; slug stays the same too but `id`
is the canonical handle.

---

## §5 Restoration procedure — bulk

If the whole archive needs to be reverted (e.g. CHECK-constraint
narrowing rollback per plan-PR §7), re-import the CSV and bulk-UPDATE:

```sql
-- Pseudocode — exact syntax depends on whichever migration tool
-- runs the rollback.
WITH snapshot AS (
  SELECT id, status AS pre_archive_status
  FROM staging_test_tenants_archive_2026_05_08  -- imported from CSV
)
UPDATE tenants t
SET status = s.pre_archive_status
FROM snapshot s
WHERE t.id = s.id
  AND t.status = 'archived';
```

The pre-archive status distribution (§3) tells you what the bulk
result should look like: 340 rows back to `provisioning`, 37 rows
back to `active`. Verify post-rollback row counts against §3.

---

## §6 Cross-references

- [`memory/plans/day-18-test-tenants-cleanup.md`](plans/day-18-test-tenants-cleanup.md) — plan-PR (§3.3 disposition rationale, §4.2 capture method)
- [`memory/followup_merchant_lifecycle_transition_expansion.md`](followup_merchant_lifecycle_transition_expansion.md) — Phase-2 lifecycle expansion (operator-driven `archiveMerchant` service fn) — explicitly out of scope for this cleanup
- [`memory/feedback_parallel_sessions_use_git_worktree.md`](feedback_parallel_sessions_use_git_worktree.md) — coordination posture with Session A (PR #187 A1 resolver swap)
- `supabase/migrations/0021_tenants_status_archived.sql` — the migration that flips these rows
- [`memory/snapshots/test-tenants-archive-2026-05-08.csv`](snapshots/test-tenants-archive-2026-05-08.csv) — the 377-row snapshot itself

# Day-18 Plan — Test-tenants cleanup via soft-archive

**Tier:** T2 (plan-PR + code-PR; single hard-stop at each PR open)
**Branch (this plan):** `day18/test-tenants-cleanup-plan`
**Branch (code, after this plan merges):** `day18/test-tenants-cleanup-code`
**Cross-refs:** PR #187 (A1 resolver swap) — coordination flag in §6.
**Filed:** Day 18.

---

## §1 Goal

Demo hygiene. The `/admin/merchants` list page (shipped Day-18 PR #186)
currently renders **380 rows** of which **377 are test fixtures** from
the Day-13 → Day-17 integration-test seeders. Only three are real
demo merchants. The transcorp-staff admin surface is unusable — and
panel-visible — until the noise is hidden.

Cleanup-PR ships:

1. New status enum value `'archived'` (5th value, alongside the
   shipped 4-state `provisioning / active / suspended / inactive`
   canon).
2. One-shot migration UPDATE that flips the **377 non-demo rows** to
   `status='archived'` while preserving the **3 demo merchants**
   (`meal-plan-scheduler`, `dr-nutrition`, `fresh-butchers`).
3. UI default-exclude — `listMerchants(ctx)` (no filter) returns
   non-archived rows only; archived rows reachable via explicit
   `?status=archived` filter for forensic review.
4. Coordinated TypeScript union + exhaustive-switch updates so the
   schema change and the code change land atomically (split-PR
   approach is uncompilable — see §3).

Out of scope: lifecycle service-fn `archiveMerchant`, route, audit
event, permission. See §10.

---

## §2 Survey baseline

Read-only survey filed in the prior session turn against
`SUPABASE_DATABASE_URL` (admin role; bypasses RLS). Summary numbers
(verbatim from the survey):

| Bucket | Rows |
|---|---|
| Total `tenants` rows | **380** |
| Demo merchants (`meal-plan-scheduler`, `dr-nutrition`, `fresh-butchers`) | **3** (all `active`; preserved) |
| Fixture-pollution rows (clear cleanup targets) | **376** |
| Ambiguous-but-archived (`sandbox-merchant-588`) | **1** (see §3.3; archive with snapshot-based recovery path) |
| **Total archive targets (cleanup count)** | **377** |

**Status distribution today:** 340 `provisioning` + 40 `active`. ZERO
ROWS in `suspended` or `inactive`.

**Fixture-prefix taxonomy** (substantive prefixes, all 376 rows fall
under these — no surprise production rows in the "other" bucket per
survey Q4 top-30):

```
r3-test-*-a / r3-test-*-b      regression-pin pairs
c6-test-*                       C-6 commit fixtures
t1-trigger-*-a / t1-trigger-*-b  task-package trigger tests
t6-trigger-*-a / t6-trigger-*-b  task-package trigger tests
s1-check-*                      seed-flow checks
s2-link-*                       seed-flow links
b1-trigger-*-a / b1-trigger-*-b  block-1 trigger tests
r0-test-*-a / r0-test-*-b        round-0 fixtures
bg4g-{e2e,ov,rot}-*              Block 4-G integration tests (some carry SF customer codes — see §3.3)
svc-{a,b}-test-*-a / -b           Day-15/16 concurrency-test fixtures
svc-a-concurrent-*               Day-15/16 concurrency-test fixtures
lvti-*-a / lvti-*-b              Day-17 list-visible-task-ids regression-pin tests
lvtei-*-a / lvtei-*-b            Day-17 list-visible-task-external-ids regression-pin tests
tai-*-a / tai-*-b                Day-17 task-asset-tracking regression-pin tests
```

**Demo merchants stay live** (allowlist; see §3.2):

```sql
slug IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers')
```

---

## §3 Approach

### §3.1 Path choice — Path C from the survey (one-shot UPDATE + later optional service fn)

Survey enumerated three paths:

- **(A)** Build a full `archiveMerchant` service fn + permission +
  audit event + UI button.
- **(B)** One-shot SQL UPDATE in the migration; no service fn; no
  audit event.
- **(C)** Hybrid — migration handles fixture cleanup (B-style); a
  future PR ships the service fn (A-style) for operator-driven
  archival, decoupled from this work.

**Locked: Path C.** This PR is **(B)** — one-shot UPDATE in the
migration, audit-silent, no service-fn surface. Future operator-driven
archival is queued behind
[`memory/followup_merchant_lifecycle_transition_expansion.md`](../followup_merchant_lifecycle_transition_expansion.md)
and is **explicitly out of scope** here (§10).

Rationale: archiving fixture rows the operator never touched is data
hygiene, not lifecycle expansion. Per `§A registered-metadata-wins`,
fabricating audit events for rows with no operator authorship would
create misleading history. The migration filename + commit message
are the durable forensic artifact for this cleanup.

### §3.2 Allowlist over denylist

Survey showed the bootstrap's "~90 fixture rows" estimate
under-counted by a factor of >4×, and the supplied LIKE patterns
(`test%`, `qa%`, `dev%`, `tmp/temp%`, `*fixture*`) matched **zero**
of the actual fixture prefixes. Real prefixes are
`r0-/r3-/c6-/t1-/t6-/s1-/s2-/b1-/bg4g-/svc-/lvti-/lvtei-/tai-` —
13+ distinct families.

A denylist enumerating these prefixes would silently skip any future
fixture prefix (test-coupled risk). An **allowlist** keeping
`slug IN (demo-three) AND <reviewer-blessed exceptions>` and
archiving everything else is safer and more auditable. The migration
UPDATE statement is the canonical declaration of "what we keep".

### §3.3 `sandbox-merchant-588` disposition

Single ambiguous row. Provisioning status. Slug suggests intentional
SF sandbox alignment (matches the SF sandbox `customerId=588` in
`SUITEFLEET_SANDBOX_CUSTOMER_ID` env var). Possible interpretations:

- **(i)** Throwaway fixture from an early sandbox-roundtrip seeder
  (most likely; can be archived without harm).
- **(ii)** Intentional sandbox-aligned tenant for future SF
  integration smoke (treat as production-significant; archival
  reversible via snapshot).

**Decision:** **archive** — include in the bulk archive UPDATE
alongside the 376 prefix-fixture rows (377 total). Interpretation
(i) is the most likely reading; the slug doesn't appear in any
seeder allowlist or load-bearing test path the survey turned up.
Recovery for interpretation (ii) is a one-line UPDATE referencing
the §5.4 snapshot — see §10.

The six `bg4g-*` rows (active, with non-null
`suitefleet_customer_code` like `'E2E-745f38ea'`) are **archive
targets** — they were used in past Block 4-G integration tests
against SF sandbox customer 588 but are not load-bearing for
production. PR #187 (A1 resolver swap) separately enforces a
numeric-only `suitefleet_customer_code`, which is the resolver-side
guard against accidentally pushing tasks for these alphanumeric
codes; this PR's archive flips the rows to a status the cron
shouldn't walk in the first place. See §6.

### §3.4 Atomic bundle — schema + types + UI must ship together

The shipped `statusBadgeSurface` and `statusAction` switches in
[`src/app/(admin)/admin/merchants/_helpers.ts`](../../src/app/(admin)/admin/merchants/_helpers.ts)
are **exhaustive over the `TenantStatus` union**. Adding `'archived'`
to the CHECK constraint **without** simultaneously updating
`TenantStatus` and the helper switches breaks TypeScript compilation.
The schema change cannot ship before the code change, and vice versa.

This forces the cleanup-PR to be an atomic bundle:

```
migration 0021         (CHECK widening + UPDATE statement)
TenantStatus union     (add 'archived' literal)
statusBadgeSurface     (add 'archived' case → muted-neutral)
statusAction           (add 'archived' case → null; no MVP action)
listMerchants repo     (default-exclude archived; preserve filter override)
unit + integration tests
```

Single PR. No split. No feature flag (the schema change is the gate).

### §3.5 Audit-silent posture

No `merchant.archived` audit event registered. No
`merchant:archive` permission registered. Migration `UPDATE` runs
unaudited. Justification per §3.1 — data hygiene, not lifecycle
transition; fabricating per-row audit events would create misleading
operator-attribution history for ~377 rows that no operator actually
acted on.

### §3.6 Reviewer re-review

Plan-PR opens (this file). Reviewer counter-reviews at plan-PR open;
gates 1–10 in §9 are deferred to code-PR (only docs review here).
Plan-PR merges only after reviewer approves. Code-PR opens off the
post-merge `main` HEAD on a fresh branch
`day18/test-tenants-cleanup-code`. Reviewer counter-reviews at
code-PR open. Code-PR merges only after every gate in §9 clears.

---

## §4 Implementation steps (code-PR scope)

### §4.1 Migration 0021 — CHECK widen + UPDATE

New file `supabase/migrations/0021_tenants_status_archived.sql`.

```sql
-- =============================================================================
-- supabase/migrations/0021_tenants_status_archived.sql
-- =============================================================================
-- Day-18 / C-cleanup. Adds 'archived' to tenants.status and flips the
-- ~376 fixture-pollution rows to it in the same migration so the
-- /admin/merchants list page shows real demo merchants only.
--
-- Allowlist posture (§3.2): keep slug IN ('meal-plan-scheduler',
-- 'dr-nutrition', 'fresh-butchers'); preserve sandbox-merchant-588
-- (§3.3); archive everything else.
--
-- Audit-silent (§3.5): no merchant.archived event registered;
-- migration filename + commit message are the durable artifact.
-- =============================================================================

-- Widen the CHECK constraint to admit 'archived' as a fifth value.
ALTER TABLE tenants DROP CONSTRAINT tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('provisioning', 'active', 'suspended', 'inactive', 'archived'));

-- Flip non-demo rows to 'archived'. Allowlist preserved: demo-three
-- only. sandbox-merchant-588 archived alongside the 376 prefix
-- fixtures (§3.3); recovery is via the §5.4 snapshot if reviewer
-- later identifies it as load-bearing. Idempotent — re-running this
-- UPDATE is a no-op once the rows already carry status='archived'.
UPDATE tenants
SET status = 'archived'
WHERE slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers')
  AND status != 'archived';
```

**Dry-run gate (§9 gate 1):** apply against dev DB; verify
**~377 rows** updated; verify
`SELECT status, COUNT(*) FROM tenants GROUP BY status` post-apply
shows `archived: 377` and `active: 3` (the demo-three) — every other
status bucket goes to zero.

### §4.2 Pre-archive snapshot capture

Before the migration applies in the code-PR's verification gate, dump
the current state of every row that this migration will flip:

```sql
COPY (
  SELECT id, slug, name, status, created_at,
         suitefleet_customer_code, source_of_truth
  FROM tenants
  WHERE slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers')
  ORDER BY created_at
) TO STDOUT WITH (FORMAT CSV, HEADER);
```

Snapshot output captured in
[`memory/decision_test_tenants_cleanup_snapshot.md`](../decision_test_tenants_cleanup_snapshot.md)
(see §5.4) so the pre-archive state is recoverable for any row that
later turns out to have been load-bearing. Recovery is a one-line
UPDATE per row (§7 rollback path). Snapshot row count = 377 (matches
the migration's UPDATE row count).

### §4.3 TypeScript union widening

[`src/modules/merchants/types.ts:39`](../../src/modules/merchants/types.ts#L39):

```ts
// Before:
export type TenantStatus = "provisioning" | "active" | "suspended" | "inactive";

// After:
export type TenantStatus = "provisioning" | "active" | "suspended" | "inactive" | "archived";
```

Run `tsc --noEmit` immediately after this change to surface every
exhaustive-switch consumer that needs an `archived` clause. Expected
break-points (per the prior survey): `statusBadgeSurface` +
`statusAction` in `_helpers.ts`. If `tsc` surfaces additional
consumers, document them here as a §4.3 addendum at code-PR open
time.

### §4.4 Helper switches + repo filter

**`statusBadgeSurface`** ([`_helpers.ts:51`](../../src/app/(admin)/admin/merchants/_helpers.ts#L51))
— add `case "archived"` returning a muted-neutral surface:

```ts
case "archived":
  return {
    label: "Archived",
    className: "bg-[color:var(--color-text-tertiary)]/15 text-[color:var(--color-text-tertiary)]",
  };
```

**`statusAction`** ([`_helpers.ts:84`](../../src/app/(admin)/admin/merchants/_helpers.ts#L84))
— archived returns `null` (no MVP action; same posture as `suspended`
and `inactive`). The current early-return order works as-is once
`'archived'` is in the union; explicit case-clause not required, but
add the explicit comment to document intent.

**`listMerchants` repository default** ([`src/modules/merchants/repository.ts:225`](../../src/modules/merchants/repository.ts#L225))
— add an `excludeArchived` filter that defaults `true`. Filter is
applied independently of the existing `status` filter so callers can
still opt in to viewing archived rows via explicit `status: 'archived'`:

```ts
export interface ListMerchantsFilters {
  readonly status?: TenantStatus;
  readonly excludeArchived?: boolean;  // defaults true
}
```

When `filters.status === 'archived'`, the explicit filter wins and
`excludeArchived` is ignored. When no status filter is set,
`excludeArchived` (default `true`) appends `WHERE status != 'archived'`.

### §4.5 Test additions

See §8 for the full test plan. Highlights:

- Unit tests against `listMerchants` filter behavior (mock-tx).
- Integration test seeding 3 statuses (active / archived /
  provisioning); assert default-exclude and explicit-filter behavior.
- Migration test: apply 0021 against test DB seeded with 5 mixed
  rows; assert allowlist preservation + idempotent re-run.

---

## §5 Bundled scope (memos + docs)

### §5.1 No brief amendment required

Brief §3.2 frames merchant admin as a Transcorp-staff surface; it
does not enumerate the status canon. The 4-state canon lives in
[`memory/decision_brief_v1_2_amendments_d13_part1.md`](../decision_brief_v1_2_amendments_d13_part1.md)
§1.7.1. Adding `'archived'` is a 5th DB-side state but does NOT
change the lifecycle the brief describes (the lifecycle is operator-
driven create → activate → deactivate; archive is not in that
operator path). No brief amendment in this PR.

### §5.2 No audit-event registration

Per §3.5 audit-silent posture. No new `merchant.archived` event.
[`src/modules/audit/event-types.ts:688-700`](../../src/modules/audit/event-types.ts#L688-L700)
canonical lifecycle comment header reads correctly with the existing
3 events; the comment is left unchanged because the operator-driven
lifecycle it describes is unchanged.

### §5.3 No permission registration

No `merchant:archive` permission. Operator-driven archival is the
lifecycle-expansion scope (Phase 2; out of scope per §10). The
migration UPDATE runs under `withServiceRole` semantics implicitly
(it's a raw SQL migration; no `withTenant` involved).

### §5.4 New decision file — pre-archive snapshot

New file `memory/decision_test_tenants_cleanup_snapshot.md`. Single
purpose: durable record of what each archived row looked like
pre-archive so any row later identified as production-significant
can be restored via a one-line UPDATE.

Frontmatter:

```markdown
---
name: Test-tenants cleanup pre-archive snapshot (Day-18)
description: Pre-archive snapshot of the ~376 fixture rows flipped to status='archived' in migration 0021. Captured for restorability per §3.3 sandbox-merchant-588 lesson — any row later identified as production-significant can be reverted via a one-line UPDATE referencing the snapshot.
type: decision
---
```

Body: full CSV dump per §4.2 query, plus a short prose section
documenting (a) capture timestamp, (b) capture command (psql /
node script reproduction), (c) restoration procedure for a single
row (one-line UPDATE template), (d) restoration procedure for
all 376 rows (csv-replay script template).

### §5.5 Index update

Add a Day-18 entry to `memory/MEMORY-index.md` under the existing
Day-18 section. The bullet text below uses a path-relative link
because `MEMORY-index.md` lives at `memory/MEMORY-index.md` —
`plans/day-18-...` resolves correctly from that file (same discipline
as PR #187 §5.5).

Bullet to add:

Day-18 C-cleanup — test-tenants cleanup via soft-archive — committed via this plan-PR alongside §5.4 snapshot memo

NOTE: this bullet text goes into `memory/MEMORY-index.md` only. Do
NOT use this exact relative path in any PR description or other
location — it only resolves when sibling to `plans/`.

---

## §6 Coordination with PR #187 (A1 resolver swap)

A1 ships a resolver that throws `CredentialError` on any non-numeric
`suitefleet_customer_code`. Six `bg4g-*` rows in the to-be-archived set
have alphanumeric customer_codes (e.g. `'E2E-745f38ea'`). After this PR
lands:

- Those rows have `status='archived'`
- The cron tenant-walk (whatever its current shape) presumably filters
  by status — verify this in implementation
- If the cron walks archived rows and calls the A1 resolver against them,
  A1 throws `CredentialError` per row per cron pass

**Verify in implementation:**

1. Read the cron's tenant-walk SELECT. Does it filter by status?
2. If yes (e.g. `WHERE status = 'active'`), no further action — archived
   rows are invisible to the cron.
3. If no (cron walks all rows), this PR also adds the status filter to
   the cron query. That's a small additional surface in this PR's scope.

NON-CONFLICT but synchronized: A1's resolver swap and this PR's archive
filter both gate "which tenants the cron tries to push for." Both can
ship in either order; final correct behavior requires both landed.

## §7 Risks + rollback

**Schema risk:** CHECK constraint widening is forward-only. Rollback
requires:
1. Restore 377 rows to pre-archive status from snapshot (§4.2)
2. New migration 0022 narrows CHECK back to 4-state canon (drops
   'archived')
3. Code revert of types + helper + repo changes

**TypeScript exhaustiveness:** if any consumer of `TenantStatus` is
surfaced by `tsc --noEmit` and missed in this PR's bundle, build breaks
on merge. Mitigation: run `tsc --noEmit` after the union widening,
before commit.

**`sandbox-merchant-588` disposition:** archiving this row may break
future SF sandbox alignment work if it was deliberately significant.
Mitigation: snapshot memo (§5.4) captures the row in pre-archive state;
recoverable via UPDATE if needed.

**Cron tenant-walk filter unknown:** if the cron doesn't currently filter
by status, this PR may need to add that filter (per §6). Implementation-
time verification required; surface back to reviewer if discovered.

**Test-fixture impact:** integration tests under `tests/integration/`
that seed test tenants will continue to work because they create new
rows with `status='active'` (default behavior of `onboardMerchant`),
which fall outside the archive set. Existing rows already created by
prior test runs are now archived — fine, those rows aren't load-bearing
for any future test.

**Rollback path:** straightforward `git revert` of the code commits;
the migration revert requires the 0022 migration above.

## §8 Test plan

### §8.1 Unit tests

- `listMerchants` with no filter — assert returns non-archived rows only
- `listMerchants` with `status: 'archived'` — assert returns archived rows
- `statusBadgeSurface('archived')` — assert returns muted neutral surface
- `statusAction('archived')` — assert returns null

### §8.2 Integration tests

- New spec: `tests/integration/tenants-archived-status.spec.ts`
- Seed three tenants with statuses: active, archived, provisioning
- Assert default `listMerchants` returns 2 (active + provisioning)
- Assert filtered `listMerchants({ status: 'archived' })` returns 1

### §8.3 Migration test

- Apply 0021 against test DB seeded with mixed-status tenants
- Verify CHECK constraint accepts 'archived'
- Verify 377-row pattern simulation: seed 5 rows (3 demo-aligned, 2
  fixture-aligned); apply 0021; assert 3 active + 2 archived
- Verify idempotent: re-applying the UPDATE statement is a no-op (re-runs
  fine, no errors)

### §8.4 No new sandbox test

This is data-hygiene, not behavioral. Sandbox roundtrip tests are out
of scope; none added in this PR.

## §9 Pre-merge verification gates (T2 hard-stop checklist)

| # | Gate | Verifier | Notes |
|---|---|---|---|
| 1 | Migration 0021 applies cleanly to dev DB | manual run | §4.1 |
| 2 | Pre-archive snapshot captured + filed at memory/decision_test_tenants_cleanup_snapshot.md | docs review | §4.2, §5.4 |
| 3 | `tsc --noEmit` clean after types + switch updates | CI | §4.3, §4.4 |
| 4 | `listMerchants` no-filter excludes archived | unit + integration | §8.1, §8.2 |
| 5 | `listMerchants` status='archived' filter returns archived | unit + integration | §8.1, §8.2 |
| 6 | Status badge renders muted-neutral for archived | unit | §8.1 |
| 7 | `statusAction('archived')` returns null | unit | §8.1 |
| 8 | Cron tenant-walk filters by status (verified, OR filter added in this PR) | code review | §6 |
| 9 | Index updated | docs review | §5.5 |
| 10 | Snapshot memo filed | docs review | §5.4 |
| 11 | typecheck + lint clean | CI | standard |
| 12 | Production smoke post-merge: admin merchant list shows 3 demo merchants only | manual smoke | post-deploy |

## §10 Out of scope (explicit)

- **`archiveMerchant` service fn + permission + audit event + UI button** —
  Phase-2 lifecycle expansion per `followup_merchant_lifecycle_transition_expansion.md`.
  This PR is data-hygiene only.
- **`sandbox-merchant-588` undo** — if it later turns out the row was
  load-bearing, recovery is via the §4.2 snapshot, not by re-running this
  PR.
- **Hard-delete of 377 rows** — explicitly rejected (Love's Day-18 call:
  hide, don't delete).
- **Status enum values beyond 'archived'** — no expansion of suspended /
  inactive semantics; those are Phase-2 lifecycle scope.
- **Cron-walk filter additions beyond status** — only add status filter
  if §6 verification surfaces a gap.

## §11 Sequencing

1. **This plan-PR opens** → reviewer counter-review at plan-PR open
   (T2 first hard-stop)
2. **Plan-PR merges** after reviewer approves
3. **Code-PR opens** on a fresh branch `day18/test-tenants-cleanup-code`
   off main HEAD post-plan-PR-merge → reviewer counter-review at
   code-PR open (T2 hard-stop)
4. **Code-PR merges** after every gate in §9 clears
5. **Production smoke** post-deploy (gate 12)

## §12 Effort estimate

- Plan-PR: this file. ~25-35 min including reviewer's §3.6 re-review.
- Code-PR: ~2-3 hr including atomic bundle + tests + memos.
- Total wall-clock: ~3-4 hr from plan-PR open to code-PR merge.

═══════════════════════════════════════════════════════════════════════════════
END OF PLAN FILE
═══════════════════════════════════════════════════════════════════════════════

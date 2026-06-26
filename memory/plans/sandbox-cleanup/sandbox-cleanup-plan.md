# Sandbox Junk Cleanup — PLAN ONLY (Floor 1, LIVE PROD DB)

> **Status:** PLAN DOC ONLY. No query runs, no row is deleted from this PR. Every
> execution stage parks for a named Love clear (Floor 1). Sibling of PR #661 — reuses
> its FK map, Blocker-A/B handling, freeze-then-delete model, and single-file-backup
> pattern. This is the **second purge** flagged in #661 plan §6.

**Goal:** Delete the **1,759** automated-test junk tenants that sit on the **canonical
Sandbox region `transcorpsb`** (which we KEEP), leaving exactly the **11** real Sandbox
tenants. Tenants-only — **no region delete, no Stage 3.** (Stage A confirmed live:
1,759 junk + 11 keep = 1,770 on `transcorpsb` — matches the "~1770 Sandbox" of #661 §6.)

**Keep-set (11), CONFIRMED kept — can never enter the junk snapshot:**
- the 8 genuine allowlist slugs (excluded by `slug NOT IN (...)`), plus
- `r0-test-a`, `r0-test-b`, `sandbox-merchant-588` — code-referenced test anchors +
  documented seed. None contains a run of 8 consecutive hex chars, so each **fails
  `slug ~ '[0-9a-f]{8}'`** and is excluded by the pattern itself (not just the allowlist).
- The scope-fence guard re-asserts this against the snapshot (abort if any snapshot id is
  off-Sandbox / non-hex / allowlisted). Triple-protected.

**Target DB:** Supabase `qdotjmwqbyzldfuxphei` (PRODUCTION; no dev/staging).

**Mechanism:** Love runs each reviewed stage in the Supabase SQL editor (agent psql is
classifier-blocked; the `ALTER TABLE … DISABLE RULE` and `SET LOCAL` escapes need the
editor's `postgres` owner role). No agent executes any SQL.

## The three differences from #661

| | #661 | This purge |
|---|---|---|
| Set size | 54 (literal id list) | **1,759** — too many to export; frozen **in-DB** (temp snapshot + count guard), not a pasted list |
| Region | junk tenants on **non-canonical** regions → delete tenants **and** regions | junk on **canonical `transcorpsb`** which we **KEEP** → delete **tenants only**, no Stage 3 |
| Keep-set basis | 8-slug allowlist + canonical-region binding | the **11 real Sandbox tenants** = tenants with **no 8-hex slug run** (Love ruled: trust the hex pattern to identify junk); the 8-slug allowlist is an extra guard |

## Junk identification (Love's ruling: trust the hex-slug pattern)

- **Junk (delete):** on `transcorpsb` **AND** `slug ~ '[0-9a-f]{8}'` (un-anchored 8-hex
  run, `genuine-merchants.ts:75`) **AND** `slug NOT IN` the 8 genuine slugs.
- **Keep (survives):** everything else on `transcorpsb` — no 8-hex run, or a genuine
  allowlist slug. The ~11 real ones.
- Proof basis: the un-anchored `[0-9a-f]{8}` matched **1,821 of 1,832** tenants live;
  the 11 non-matches were exactly the genuine tenants (`genuine-merchants.ts:16-17`).
- Real example junk slug: `r3-test-74a6b577-a` / `det-db4cd52c-full` (8-hex mid-slug).

## Deliverable 1 — Stage-A audit (read-only; Love runs FIRST)

`stage-a-audit.sql`. Read-only, fingerprint-gated. Produces:
- **Query A** — junk_count (delete candidates). **This live count is authoritative** and
  becomes `AUDITED_COUNT`.
- **Query B** — keep_count, plus a sanity assert (A + B = total on `transcorpsb`).
- **Query C** — the **keep-set list** (every surviving tenant by slug/name/status). Love
  eyeballs that all ~11 real ones are present **before any delete** — the pattern proving
  itself on live data.
- **Query D** — RETIRED. No id export (1,759 ids exceed the CSV cap). The junk set is
  frozen **in-DB** at delete time (Deliverable 2); only Query A's count carries forward.
- **Query E** — backup-volume summary (per-table row counts for the junk set) so Love
  sizes the backup (single-file vs per-batch) before running it.

## Deliverable 2 — Freeze-then-delete, IN-DATABASE (no literal list)

The ~1,759 ids exceed the SQL-editor CSV export cap (~1k rows), so we do **not** export a
literal list. Instead the delete script freezes the set **in-DB at the top of each run**:

```sql
DROP TABLE IF EXISTS _sandbox_junk;
CREATE TEMP TABLE _sandbox_junk (tenant_id uuid PRIMARY KEY, rn int) ON COMMIT PRESERVE ROWS;
INSERT INTO _sandbox_junk (tenant_id, rn)
SELECT t.id, row_number() OVER (ORDER BY t.id)
FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE r.client_id = 'transcorpsb' AND t.slug ~ '[0-9a-f]{8}'
  AND t.slug NOT IN (<8 genuine slugs>);
```

Then a **FREEZE GUARD**: `count(_sandbox_junk)` MUST equal the Stage-A audited `junk_count`
(**1,759**) — abort otherwise. The snapshot is derived **once** and every batch consumes a
disjoint `rn`-range over it (`rn > lo AND rn <= hi`) — the live pattern is **never** re-run
per batch, so the set is frozen even though it is derived in-DB (a tenant created mid-op can
never be swept; one appearing pre-run bumps the count → the guard aborts). `ON COMMIT
PRESERVE ROWS` keeps the snapshot alive across the per-batch `BEGIN/COMMIT`s **within one
SQL-editor Run** — so each section (dry-run / execute) must be run as a single Run.
`AUDITED_COUNT = 1759` is baked into the generator; it emits `ceil(1759/100) = 18` batches.

## Deliverable 3 — Safety guards

- **Project-ref fingerprint** (`qdotjmwqbyzldfuxphei`) + `transcorpsb` presence — at the top
  of each section; abort on mismatch, never re-scope.
- **Freeze guard:** `count(_sandbox_junk) = 1759` or abort.
- **Scope fence (once, against the snapshot):** abort if any snapshot id is **not on
  `transcorpsb`**, or **lacks the 8-hex run** (a keep-set tenant), or **is an allowlist slug**.
  Centralized at the snapshot (the whole frozen set is fenced), not re-derived per batch.
- **Blocker A** (the #661 Stage-2 lesson): the tenant delete's `ON DELETE CASCADE` into
  `audit_events` is rewritten by `audit_events_no_delete` (0002:90) → XX000. **Every batch**
  wraps its deletes in `DISABLE RULE … ENABLE RULE` (re-enabled before COMMIT/ROLLBACK;
  DDL is transactional). Also covers the explicit `audit_events` delete.
- **Blocker B:** `asset_scan_log` is RESTRICT + append-only trigger (0032) → each batch
  `SET LOCAL app.allow_scan_log_delete='on'` and deletes `asset_scan_log` first (harmless
  if 0 rows).

## Deliverable 4 — Every-row-verified + full FK map, BATCHED

Same FK map as #661 (all 21 `tenant_id`-FK tables; full citations in `../purge-661/` and
`phase122-test-tenant-junk-region-purge.md` §1). Per batch, in child→parent order:
`asset_scan_log → tasks → subscriptions → task_generation_runs → consignee_crm_events →
addresses → consignees → audit_events → tenants`. Cascades clear
`task_packages/failed_pushes/asset_tracking_cache/outbound_push_failures` (via `tasks`) and
the `subscription_*` trio (via `subscriptions`); the tenant delete cascades the 6 identity
tables (`users, roles, role_assignments, api_keys, tenant_suitefleet_webhook_credentials,
webhook_events`). **Each batch's verify sums all 22 tenant-scoped tables (for its `rn`-range)
and must read 0** (RAISE EXCEPTION otherwise; RAISE NOTICE on success).

**Batching:** `BATCH_SIZE = 100` tenants per transaction → **18 batches** over the 1,759
(`rn` 1–100, …, 1701–1759 = 59). One giant transaction would risk lock/WAL/timeout; each
batch is an independent committed unit consuming a disjoint `rn`-range of the frozen snapshot.
If EXECUTE is interrupted, committed batches stand (junk — safe partial); re-running over a
fresh snapshot will trip the `=1759` freeze guard (intended), so resume = re-audit the smaller
count + regenerate.

## Deliverable 5 — Backup (Free tier, no PITR/dashboard backup)

Supabase **Free has no PITR or dashboard backup**, so the rollback artifact is a scoped,
self-run dump.

**Primary — `BACKUP-RUNBOOK.md` + `backup-query.sql` (run via `psql`):** one read-only query
emits an `INSERT`-per-row (`to_jsonb`+`jsonb_populate_record`) for all 1,759 junk tenants + every
FK-child row, in restore order; `psql -At` streams it to **one file**
`sandbox-cleanup-backup-<date>.sql` with **no row cap**. `backup-rowcount.sql` prints the
expected ~20k for a `wc -l` cross-check. Restore = `psql -1 -f <file>` (parents before children;
`INSERT` allowed on the append-only tables). The runbook is written for a non-technical operator
(psql install, where to copy the Session-pooler connection string, the exact commands, what
success looks like) and keeps the secret on Love's machine (hidden `read -rs` prompt, never
echoed/committed).

**Fallback — `stage-b-backup-perbatch.sql` (SQL editor):** 18 read-only queries, same `rn`-ranges
as the delete batches, one CSV each. Only if `psql` is unavailable; some CSVs may truncate at the
editor's ~1k cap (stated, not silent).

_(Single-file CSV via the editor retired — ~20k rows is not reliably exportable there. psql is
the path.)_

## Authorization shape (Floor 1 — named clears, dry-run-then-execute)

| # | Stage | Type |
|---|---|---|
| 1 | **Audit** (`stage-a-audit.sql`) — DONE; junk=1759, keep=11 | READ ONLY |
| 2 | **Backup** — `BACKUP-RUNBOOK.md` (psql single-file, primary) or `stage-b-backup-perbatch.sql` (editor fallback) | READ ONLY |
| 3 | **Delete — DRY-RUN** (`delete-batched.sql` dry-run section, ONE Run; all batches ROLLBACK; watch NOTICE lines) | dry-run |
| 4 | **Delete — EXECUTE** (execute section, ONE Run; all batches COMMIT) | execute |
| 5 | **Final verify** (read-only: 0 junk tenants remain on `transcorpsb`) | READ ONLY |

Each destructive stage waits for its own named Love clear after the prior output is seen.
Mismatch/abort at any guard = stop, never re-scope.

## Confirmations

- **`transcorpsb` is KEPT.** No `DELETE FROM suitefleet_regions`. The region's
  bound-tenant count drops from ~1,832 to ~11; the region row itself is untouched.
- **Disjoint from #661.** #661's 54 targets are on non-canonical regions; this set is on
  `transcorpsb`. No overlap.
- **Vault orphans:** as in #661, deleted tenants may leave orphaned `vault.secrets`
  (harmless, unreferenced) — flagged, not in scope.

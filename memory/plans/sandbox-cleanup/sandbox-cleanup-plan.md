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

## Deliverable 2 — Freeze-then-delete, IN-DATABASE (committed table; editor-safe)

The ~1,759 ids exceed the SQL-editor CSV export cap (~1k rows), so we do **not** export a
literal list. The delete script freezes the set in-DB into a **NORMAL (persistent) table,
committed once before any delete**:

```sql
DROP TABLE IF EXISTS _sandbox_junk_frozen;
CREATE TABLE _sandbox_junk_frozen (tenant_id uuid PRIMARY KEY, rn int);
INSERT INTO _sandbox_junk_frozen (tenant_id, rn)
SELECT t.id, row_number() OVER (ORDER BY t.id)
FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE r.client_id = 'transcorpsb' AND t.slug ~ '[0-9a-f]{8}'
  AND t.slug NOT IN (<8 genuine slugs>);
-- fingerprint + FREEZE GUARD (count = 1759) + SCOPE FENCE, then:
COMMIT;   -- persist so the per-batch ROLLBACKs cannot unwind it
```

**Why a committed normal table, not a TEMP table:** the Supabase SQL editor wraps a pasted
script in **one implicit transaction**, so a `TEMP` snapshot created before the batches is
**unwound by the first batch's `ROLLBACK`** (dry-run → `42P01 relation "_sandbox_junk" does
not exist` at batch 2) — and worse, EXECUTE (all `COMMIT`) might survive, so the dry-run
could not faithfully predict the execute. Committing a normal table makes it survive every
later `ROLLBACK`, so **DRY-RUN and EXECUTE use the IDENTICAL frozen set**. The explicit
`COMMIT` is honored whether the editor wraps the script (it commits the leading statements)
or auto-commits (harmless no-op). Each section drops the table at top and end; if a section
aborts mid-batch, run `DROP TABLE IF EXISTS _sandbox_junk_frozen;` to clean up.

**FREEZE GUARD** `count(_sandbox_junk_frozen) = 1759` runs **once, before any delete** → valid
in both modes (deletes never shrink the static frozen copy; a tenant appearing pre-run bumps
the count → abort). Each batch consumes a disjoint `rn`-range (`rn > lo AND rn <= hi`) of the
frozen table — the live pattern is **never** re-run per batch. `AUDITED_COUNT = 1759` is baked
into the generator; it emits `ceil(1759/100) = 18` batches. Each section is run as **one
editor paste**.

## Deliverable 3 — Safety guards

- **Project-ref fingerprint** (`qdotjmwqbyzldfuxphei`) + `transcorpsb` presence — at the top
  of each section; abort on mismatch, never re-scope.
- **Freeze guard:** `count(_sandbox_junk_frozen) = 1759` or abort (once, pre-delete).
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

## Deliverable 5 — Backup (Free tier, GitHub-OAuth login → no DB password)

Supabase **Free has no PITR/dashboard backup**, and Love logs in via **GitHub OAuth so there is
no database password** — i.e. **no `psql`/Terminal path**. The backup runs **entirely in the SQL
editor**, designed around its ~1,000-row CSV export cap.

**Primary — `stage-b-backup-editor.sql`:** one file Love runs block-by-block in the editor.
- **QUERY 0 (size check)** lists each table's live row count + `chunks_needed` (`ceil(rows/900)`);
  Love skips `rows = 0` tables and learns how many parts each needs (live-authoritative).
- One labelled query **per non-empty tenant-scoped table** in restore order (`NN_table.csv`,
  `NN` = restore_seq). Tables ≤ 900 rows → one CSV; over → the **minimum** 900-row parts via
  stable `ORDER BY id` + `LIMIT/OFFSET` (`NN_table_partKofM.csv`). Chunked (Stage-A est.):
  `tenants` 2, `consignees` 2, `task_generation_runs` 4, `tasks` 6, `audit_events` 6.
- Each row is a runnable `INSERT` (`to_jsonb`+`jsonb_populate_record`, **generated columns omitted**
  so `asset_tracking_cache.awb` etc. recompute on restore). Header gives a per-file expected-row
  table (cross-check vs Query E, total ~20k) and a **truncation guard**: if a saved CSV has fewer
  rows than Query 0 says, STOP (it truncated). Restore = run the CSVs' `restore_sql` column in
  `NN` order (parents before children; `INSERT` allowed on the append-only tables).

**Not usable here — `BACKUP-RUNBOOK.md` + `backup-query.sql`/`backup-rowcount.sql` (psql):** kept
for the record; needs a DB password Love doesn't have. Use only if a direct DB password is ever set.
`stage-b-backup-perbatch.sql` (18 rn-range CSVs) is an older editor variant superseded by the
table-by-table `stage-b-backup-editor.sql`.

## Authorization shape (Floor 1 — named clears, dry-run-then-execute)

| # | Stage | Type |
|---|---|---|
| 1 | **Audit** (`stage-a-audit.sql`) — DONE; junk=1759, keep=11 | READ ONLY |
| 2 | **Backup** — `stage-b-backup-editor.sql` (SQL editor, primary; size-check then per-table CSVs) | READ ONLY |
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

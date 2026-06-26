# Sandbox Junk Cleanup — scripts (#661 follow-on)

Plan: `sandbox-cleanup-plan.md`. **Nothing here executes against a database.** Love runs
each stage in the Supabase SQL editor (project `qdotjmwqbyzldfuxphei`, PROD), one named
clear per stage. Deletes the **1,759** hex-slug junk tenants ON the KEPT `transcorpsb`
(Sandbox) region — tenants only, no region delete. Keep-set = **11** (8 allowlist +
`r0-test-a` + `r0-test-b` + `sandbox-merchant-588`).

## In-DB frozen snapshot (no literal id list)

The ~1,759 ids exceed the SQL-editor CSV export cap, so there is **no `target_ids.txt`**.
The delete script snapshots the junk set in-DB into a TEMP table `_sandbox_junk` (count-
guarded `= 1759`) and batches over disjoint `rn`-ranges. Run each delete section as **one
SQL-editor Run** so the `ON COMMIT PRESERVE ROWS` snapshot survives the per-batch commits.

## Files

| File | Purpose |
|---|---|
| `stage-a-audit.sql` | READ-ONLY. Already run: junk_count (A) = 1759, keep_count (B) = 11, keep-set LIST (C), backup-volume summary (E). (Query D id-export retired — frozen in-DB instead.) |
| `generate-sandbox-cleanup-sql.mjs` | Generator (no id input; `AUDITED_COUNT=1759`, `BATCH_SIZE=100`). Emits the 5 SQL files below. |
| `delete-batched.sql` | *(generated)* DRY-RUN + EXECUTE sections. Each: fingerprint → snapshot → freeze guard (=1759) → scope fence → 18 `rn`-range batches (Blocker A/B, child→parent deletes, 0-residual verify) → drop snapshot. |
| `stage-b-backup-editor.sql` | *(generated)* **PRIMARY backup.** READ-ONLY, run in the SQL editor: QUERY 0 size-check, then one labelled CSV query per non-empty table (restore order; ≤900 → 1 file, over → 900-row parts). Generated columns omitted. |
| `stage-b-backup-perbatch.sql` | *(generated)* READ-ONLY, 18 per-`rn`-range CSVs. Older editor variant, superseded by the table-by-table editor backup. |
| `BACKUP-RUNBOOK.md`, `backup-query.sql`, `backup-rowcount.sql` | psql single-file path. **Not usable here** — needs a DB password Love doesn't have (GitHub-OAuth login). Kept for the record / future. |

## Backup (Free tier, GitHub-OAuth login — no DB password, no psql)

**Primary — `stage-b-backup-editor.sql`** (SQL editor, one file): run QUERY 0 (size check) first
to see which tables to skip (rows=0) and how many 900-row parts each needs, then run each labelled
block → Download CSV → save as the `NN_table[_partKofM].csv` in its label (restore order). Cross-
check every CSV's row count against QUERY 0 (fewer = truncated → stop). ~20k rows total.

**Not usable here:** `BACKUP-RUNBOOK.md` + `backup-query.sql`/`backup-rowcount.sql` (psql) need a DB
password Love doesn't have. `stage-b-backup-perbatch.sql` is an older editor variant, superseded.

## Flow

1. Stage A — DONE (junk=1759, keep=11; the 11 eyeballed kept).
2. Reviewer body-reads the emitted SQL at the pinned head; Love outside-checks.
3. Execution, each its own named clear: **Backup (DB backup ± per-batch CSV) → Delete DRY-RUN (one Run) → Delete EXECUTE (one Run) → final verify.**

## Safety properties

- Fingerprint + `transcorpsb` presence (each section).
- Freeze: in-DB snapshot count-guarded `= 1759`; batches consume the frozen snapshot, never a live pattern per batch.
- Scope fence (once, vs snapshot): abort if any id is off-Sandbox / lacks the 8-hex run (keep-set) / is allowlisted. The 11 keep-set can never enter (3 fixtures have no 8-hex run; 8 allowlist excluded).
- Blocker A (audit-rule wrap on the tenant delete, every batch — the #661 Stage-2 lesson) + Blocker B (asset_scan_log GUC).
- Every-row-verified: per-batch 0-residual sum across all 22 tenant-scoped tables.
- Batched (100/txn, 18 batches) within one Run; verify-before-commit via DRY-RUN→EXECUTE.

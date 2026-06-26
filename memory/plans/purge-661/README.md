# PURGE #661 — Stage-B scripts (backup + staged deletes)

Companion to the plan at `../phase122-test-tenant-junk-region-purge.md`. **Nothing here
executes against a database.** These are reviewed SQL artifacts Love pastes into the
Supabase SQL editor (project **`qdotjmwqbyzldfuxphei`**, PROD), one stage per named
authorization, after Stage-A audit sign-off (54 junk tenants confirmed, 0 real caught).

## Files

| File | Purpose |
|---|---|
| `generate-purge-sql.mjs` | Generator. Reads `target_ids.txt`, emits the 4 SQL files below keyed to the **literal** 54 ids (never re-derived from a slug pattern). Validates exactly 54 distinct valid UUIDs or aborts. |
| `target_ids.txt` | The authoritative 54 Stage-A `tenant_id`s, one per line. Single source of truth. Written by the agent from Love's paste (Love does not hand-edit). |
| `stage-b-backup.sql` | *(generated)* READ-ONLY. 23 CSV-ready dumps (regions + tenants + every FK-child table, restore order). The rollback artifact. |
| `stage-1-child-deletes.sql` | *(generated)* One txn. Blocker-A (audit RULE) + Blocker-B (asset_scan_log GUC) escapes, then tasks→subscriptions→consignee graph. DRY-RUN + EXECUTE blocks. |
| `stage-2-tenant-deletes.sql` | *(generated)* One txn. `DELETE FROM tenants` (cascades leaf children). DRY-RUN + EXECUTE. |
| `stage-3-region-deletes.sql` | *(generated)* One txn. Deletes all non-canonical regions (now-unbound). DRY-RUN + EXECUTE. |

## Flow

1. Agent writes the 54 ids into `target_ids.txt` from Love's pasted Stage-A output.
2. Agent runs `node generate-purge-sql.mjs` → emits the 4 `.sql` files.
3. Independent reviewer body-reads the emitted SQL at the pinned head SHA; Love
   (outside check) body-reads before any script reaches execution.
4. Execution, only on Love's **separate named clear per stage**, in order:
   **Backup (save all 23 CSVs) → Stage 1 → Stage 2 → Stage 3 → final verify.**
   Each stage: run DRY-RUN block, read the verify output, then run EXECUTE on the clear.

## Safety properties baked into every generated stage

- **Project-ref fingerprint** pre-flight (asserts the 4 canonical regions exist) —
  mismatch aborts the transaction. Never re-scope on mismatch; stop.
- **Literal-id authority**: deletes target only the frozen 54 ids (seeded into a
  TEMP `_purge_targets`), not a live pattern match.
- **Count guard**: aborts unless exactly 54 targets resolve to 54 live tenants
  (catches a typo or an already-deleted id).
- **Safety guard**: aborts if any target is an allowlisted-genuine slug or bound to a
  canonical region.
- **Drift notice**: `RAISE NOTICE` (not abort) if the live junk predicate now matches
  ≠54 — a new test tenant appeared since Stage A; scope still stays the frozen 54.
- **Verify-before-commit**: DRY-RUN (`ROLLBACK`) precedes EXECUTE (`COMMIT`); the
  EXECUTE block runs only on the named clear.

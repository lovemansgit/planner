# Sandbox Junk Cleanup — scripts (#661 follow-on)

Plan: `sandbox-cleanup-plan.md`. **Nothing here executes against a database.** Love runs
each stage in the Supabase SQL editor (project `qdotjmwqbyzldfuxphei`, PROD), one named
clear per stage. Deletes the ~1,821 hex-slug junk tenants ON the KEPT `transcorpsb`
(Sandbox) region — tenants only, no region delete.

## Files

| File | Purpose |
|---|---|
| `stage-a-audit.sql` | READ-ONLY. Love runs FIRST: junk/keep counts, the keep-set list to eyeball, the frozen target ids (Query D → `target_ids.txt`), and a backup-volume summary. |
| `target_ids.txt` | The frozen junk `tenant_id`s + a `# AUDITED_COUNT: <n>` header (Stage-A Query A). Single source of truth; written by the agent from Love's export (Love does not hand-edit). |
| `generate-sandbox-cleanup-sql.mjs` | Generator. Reads `target_ids.txt`, emits the 3 SQL files below. **Aborts unless the id count == AUDITED_COUNT** and all are distinct valid UUIDs. |
| `delete-batched.sql` | *(generated)* Batched delete (BATCH_SIZE=100). DRY-RUN section (all batches ROLLBACK) + EXECUTE section (all batches COMMIT). Each batch: fingerprint → frozen seed → guards → Blocker A/B → child→parent deletes → 0-residual verify. |
| `stage-b-backup-singlefile.sql` | *(generated)* READ-ONLY, one query → one restorable artifact. Modest sets only — see scale note. |
| `stage-b-backup-perbatch.sql` | *(generated)* READ-ONLY, one CSV per batch. **Recommended at ~1,821 scale.** |

## Flow

1. Love runs `stage-a-audit.sql`; eyeballs Query C keep-set; exports Query D ids + notes Query A count.
2. Agent writes `target_ids.txt` (ids + `# AUDITED_COUNT`), runs the generator → 3 SQL files.
3. Independent reviewer body-reads the emitted SQL at the pinned head SHA; Love outside-checks.
4. Execution, each its own named clear: **Backup (size via Query E/summary → single-file or per-batch) → Delete DRY-RUN → Delete EXECUTE → final verify.**

## Safety properties

- Project-ref fingerprint + `transcorpsb` presence on every batch (abort on mismatch).
- Frozen-id authority: deletes target only the literal frozen list, never a live pattern.
- Scope fence per batch: abort if any id is off-Sandbox, lacks the 8-hex run (keep-set), or is allowlisted; + count + existence checks.
- Blocker A (audit-rule wrap on the tenant delete — the #661 Stage-2 lesson) and Blocker B (asset_scan_log GUC) in every batch.
- Every-row-verified: per-batch 0-residual sum across all 22 tenant-scoped tables.
- Batched (100/txn) so no single transaction can lock/time out; verify-before-commit via DRY-RUN→EXECUTE.

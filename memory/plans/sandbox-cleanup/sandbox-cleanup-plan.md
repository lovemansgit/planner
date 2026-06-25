# Sandbox Junk Cleanup — PLAN ONLY (Floor 1, LIVE PROD DB)

> **Status:** PLAN DOC ONLY. No query runs, no row is deleted from this PR. Every
> execution stage parks for a named Love clear (Floor 1). Sibling of PR #661 — reuses
> its FK map, Blocker-A/B handling, freeze-then-delete model, and single-file-backup
> pattern. This is the **second purge** flagged in #661 plan §6.

**Goal:** Delete the ~1,821 automated-test junk tenants that sit on the **canonical
Sandbox region `transcorpsb`** (which we KEEP), leaving only the ~11 real Sandbox
tenants. Tenants-only — **no region delete, no Stage 3.**

**Target DB:** Supabase `qdotjmwqbyzldfuxphei` (PRODUCTION; no dev/staging).

**Mechanism:** Love runs each reviewed stage in the Supabase SQL editor (agent psql is
classifier-blocked; the `ALTER TABLE … DISABLE RULE` and `SET LOCAL` escapes need the
editor's `postgres` owner role). No agent executes any SQL.

## The three differences from #661

| | #661 | This purge |
|---|---|---|
| Set size | 54 | **~1,821** (stale; re-audit live in Stage A) |
| Region | junk tenants on **non-canonical** regions → delete tenants **and** regions | junk on **canonical `transcorpsb`** which we **KEEP** → delete **tenants only**, no Stage 3 |
| Keep-set basis | 8-slug allowlist + canonical-region binding | the **~11 real Sandbox tenants** = tenants with **no 8-hex slug run** (Love ruled: trust the hex pattern to identify junk); the 8-slug allowlist is an extra guard |

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
- **Query D** — the **frozen target ids** (the junk `tenant_id`s). Love exports this id
  column; the agent writes it into `target_ids.txt`.
- **Query E** — backup-volume summary (per-table row counts for the junk set) so Love
  sizes the backup (single-file vs per-batch) before running it.

## Deliverable 2 — Freeze-then-delete

Stage-A Query D's ids freeze into `target_ids.txt` (literal list). The delete acts **only
on the frozen ids**, never a live pattern — a tenant created after the snapshot can never
be swept. `generate-sandbox-cleanup-sql.mjs` **aborts unless the frozen list length ==
`AUDITED_COUNT`** (Query A) and all are distinct valid UUIDs.

## Deliverable 3 — Safety guards (every stage)

- **Project-ref fingerprint** (`qdotjmwqbyzldfuxphei`) + `transcorpsb` presence — abort on
  mismatch, never re-scope.
- **Scope fence (Sandbox only):** each batch aborts if any frozen id is **not on
  `transcorpsb`**, or **lacks the 8-hex run** (a keep-set tenant), or **is an allowlist
  slug** — plus a count + existence check.
- **Blocker A** (the #661 Stage-2 lesson): the tenant delete's `ON DELETE CASCADE` into
  `audit_events` is rewritten by `audit_events_no_delete` (0002:90) → XX000. Each batch
  wraps its deletes in `DISABLE RULE … ENABLE RULE` (re-enabled before COMMIT/ROLLBACK;
  DDL is transactional). This also covers the explicit `audit_events` delete.
- **Blocker B:** `asset_scan_log` is RESTRICT + append-only trigger (0032) → each batch
  `SET LOCAL app.allow_scan_log_delete='on'` and deletes `asset_scan_log` first (harmless
  if 0 rows).

## Deliverable 4 — Every-row-verified + full FK map, BATCHED

Same FK map as #661 (all 21 `tenant_id`-FK tables; full citations in
`../purge-661/` and `phase122-test-tenant-junk-region-purge.md` §1). Per batch, in
child→parent order: `asset_scan_log → tasks → subscriptions → task_generation_runs →
consignee_crm_events → addresses → consignees → audit_events → tenants`. Cascades clear
`task_packages/failed_pushes/asset_tracking_cache/outbound_push_failures` (via `tasks`)
and the `subscription_*` trio (via `subscriptions`); the tenant delete cascades the 6
identity tables (`users, roles, role_assignments, api_keys,
tenant_suitefleet_webhook_credentials, webhook_events`). **Each batch's verify sums all 22
tenant-scoped tables and must read 0** (RAISE EXCEPTION otherwise; RAISE NOTICE on success).

**Batching:** `BATCH_SIZE = 100` tenants per transaction → **ceil(AUDITED_COUNT / 100)**
batches (~19 at 1,821). One giant transaction would risk lock/WAL/timeout; each batch is an
independent committed unit. If a batch aborts, prior committed batches stand (junk — safe
partial progress) and the remaining batches re-run.

## Deliverable 5 — Single-file backup (+ scale honesty)

`stage-b-backup-singlefile.sql` keyed to the frozen ids: Query 1 = row-count summary (run
first), Query 2 = one read-only query emitting an `INSERT`-per-row via
`to_jsonb`+`jsonb_populate_record`, restorable (tenants restore first; `transcorpsb` is
KEPT so the FK parent is present).

**Scale honesty:** at ~1,821 tenants this artifact may be **too large for one reliable CSV
export** (editor row-cap / export size / query timeout). **Decision rule:** run Query 1
first; if the total backup rows exceed ~50,000 (or Query 2 errors/truncates), use
**`stage-b-backup-perbatch.sql`** instead — one modest CSV per delete batch (~19 files),
each one batch's slice, which together are the full rollback artifact. This is the
**recommended** path at this scale. (Not a silent fallback — Love picks based on Query 1.)

## Authorization shape (Floor 1 — named clears, dry-run-then-execute)

| # | Stage | Type |
|---|---|---|
| 1 | **Audit** (`stage-a-audit.sql`) | READ ONLY |
| 2 | **Backup** (single-file or per-batch, per Query-1 size) | READ ONLY (export) |
| 3 | **Delete — DRY-RUN** (`delete-batched.sql` dry-run section; all batches ROLLBACK; watch NOTICE lines) | dry-run |
| 4 | **Delete — EXECUTE** (execute section; all batches COMMIT) | execute |
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

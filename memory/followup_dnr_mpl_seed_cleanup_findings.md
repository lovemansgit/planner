---
name: followup_dnr_mpl_seed_cleanup_findings
description: DNR + MPL seed-junk cleanup findings — MPL-under-DNR resolved (not a bug), DNR 100% junk, MPL mixed (200 bulk junk + 2 demo personas + 13 unmarked manual rows needing Love's ruling)
metadata:
  type: project
---

# Dr. Nutrition + Meal Plan Scheduler — seed-junk cleanup findings

**Status:** READ-ONLY INVESTIGATION. No writes, no deletes. Proof produced by
`scripts/probe-dnr-mpl-seed-readonly.mjs` (SET TRANSACTION READ ONLY) against
prod `qdotjmwqbyzldfuxphei`. Unlike Fresh Butchers, these merchants hold a MIX
of junk and real data, so the marker safety is the whole game.

---

## 0. The load-bearing question — MPL- AWBs under Dr. Nutrition — RESOLVED, NOT A BUG

Love saw, in /admin/tasks filtered to Dr. Nutrition, tasks with `MPL-…` AWBs
(e.g. `MPL-88048734`) and `SUB-…` order numbers, status CREATED, delivery
2026-05-06. Verdict after three checks:

1. **Zero cross-tenant tasks platform-wide.** Every task's consignee AND
   subscription belong to the same tenant as the task. No mislabeling exists.
2. **The 290 MPL-AWB tasks under dr-nutrition all trace to `SEED-DNR-CON-####`
   / `SEED-DNR-SUB-####` parents *inside the dr-nutrition tenant*** (e.g. "DNR
   Customer 0070"). They are Dr. Nutrition's **own** dev-seed junk, materialised
   by the cron (`created_via='subscription'`, order# `SUB-…` is the standard
   subscription-task format for every merchant — see task-materialization/service.ts:316).
3. **`MPL-` is the shared SuiteFleet *sandbox* AWB prefix, not a tenant tag.**
   dr-nutrition's 290 tasks AND meal-plan-scheduler's 517 tasks are *all*
   `MPL-`-prefixed. The sandbox issues `MPL-` AWBs to every merchant's pushes.

**Conclusion:** there is **no data-integrity bug** and **no real MPL data hiding
under DNR**. Deleting DNR's `SEED-DNR-%` junk destroys nothing real. `tenant_id`
is authoritative throughout.

---

## 1. Per-merchant junk-vs-real split

### Dr. Nutrition (`dr-nutrition`, SF code 586) — 100% junk, ZERO real
| Table | Total | Junk (`SEED-DNR-%`) | Real |
|---|---:|---:|---:|
| Consignees | 145 | **145** | **0** |
| Subscriptions | 145 | **145** | **0** |
| Tasks | 290 | **290** (by seeded parent) | **0** |

- All 145 consignees are named "DNR Customer ####" and carry `SEED-DNR-CON-####`.
- No demo personas, no manual test rows, no real refs, no NULL refs. Nothing else exists under DNR.
- Marker `SEED-DNR-%` is **exact** (0 marked-odd-name; catches 0 demo/persona rows). Same clean situation as Fresh Butchers.

### Meal Plan Scheduler (`meal-plan-scheduler`, SF code 588) — MIXED
| Bucket | Consignees | Subs | Tasks | Disposition |
|---|---:|---:|---:|---|
| **Bulk junk** `SEED-MPL-%` ("MPL Customer ####") | **200** | **200** | **400** | DELETE |
| **Demo personas** `SEED-DEMO-%` (Fatima Al Mansouri, Sarah Khouri) | 2 | 2 | 19 | **KEEP** |
| **Unmarked manual rows** (`external_ref` NULL) | 13 | 23 | 108 | **NEEDS RULING** (§2) |
| **Totals** | 215 | 225 | 527 | |

- Marker `SEED-MPL-%` is **exact**: it catches exactly the 200 bulk junk consignees (all "MPL Customer ####") and **excludes** the demo personas AND all 13 unmarked rows (verified: 0 marked-odd-name, marker catches 0 fatima/sarah/demo).

---

## 2. The one ambiguity — MPL's 13 unmarked manual rows (Love must rule)

These were created manually via the UI during testing/demos. They carry **no
marker** (`external_ref` NULL) and can only be told apart by name — too unreliable
to auto-delete. **None are touched by the proposed `SEED-MPL-%` delete.** Full list:

| Name | subs | tasks | crm | Likely | 
|---|---:|---:|---|---|
| `test` | 1 | 7 | ACTIVE | junk |
| `TEST1` | 1 | 0 | ACTIVE | junk |
| `Test 1` | 1 | 11 | ACTIVE | junk |
| `QB` | 2 | 7 | ACTIVE | junk |
| `Gate 18 Wire Test gate18-wievb8jr` | 0 | 1 | ACTIVE | junk |
| `Gate 18 Wire Test gate18-ff4x0ar7` | 0 | 1 | CHURNED | junk |
| `Love Mansukhani` | 6 | 23 | ACTIVE | **keep?** (owner's own persona) |
| `Quentin` | 1 | 7 | ACTIVE | ? person-named |
| `Aqib` | 1 | 6 | ACTIVE | ? (Aqib = SF integration partner) |
| `Marwan` | 2 | 8 | ACTIVE | ? person-named |
| `Shanavas` | 1 | 5 | ACTIVE | ? person-named |
| `Toufic` | 2 | 10 | ACTIVE | ? person-named |
| `Roudy M` | 4 | 22 | ACTIVE | ? person-named |

**I am NOT proposing a delete for these.** Love rules per-row (or by group:
"delete the 6 obvious test rows, keep the 7 person-named + Love Mansukhani").
Once ruled, they'd be deleted by an explicit **id-list** scope (never by name
heuristic), as a separate authorized step.

---

## 3. Real data that MUST be preserved (the proposed markers exclude all of it)

- **Demo personas** Fatima Al Mansouri (`SEED-DEMO-CON-FATIMA`, 2 subs/16 tasks) and
  Sarah Khouri (`SEED-DEMO-CON-SARAH`, 1 sub/3 tasks) under MPL — excluded by
  `SEED-MPL-%` (they're `SEED-DEMO-`, a different prefix).
- **The 13 unmarked manual rows** (incl. `Love Mansukhani`) — excluded (NULL ref ≠ `SEED-MPL-`).
- No real TranscorpSB/production deliveries exist under DNR or MPL (all DNR is
  bulk junk; all MPL non-bulk is demo personas or manual test rows). The genuine
  production merchants are elsewhere (`transcorp`/`hem`/`mlp` per the genuine-merchant allowlist).

---

## 4. Proposal + the authorization Love would give

The delete is **code/script** (a marker-scoped prod write that PARKS for a named
sentence; no migration, no schema change). Same proven pattern as
`delete-fbu-seed-junk.mjs`, generalised into one parameterised, preservation-
asserting script `scripts/delete-merchant-seed-junk.mjs --slug=<slug>`:
single transaction; default DRY RUN (rehearse + rollback); `--execute=true` to
commit; in-tx re-count gate on the **stable** marked consignee/subscription
counts; tasks deleted by in-tx re-count of marked-parent tasks (drift-tolerant);
**preservation gate** — non-marker consignees/subs/tasks count BEFORE == AFTER
(proves demo personas + the 13 unmarked rows are untouched); `asset_scan_log`
RESTRICT guard; FK-safe order; ROLLBACK on any mismatch.

**Clean & unambiguous → ready to authorize:**
- **Dr. Nutrition** — delete `SEED-DNR-%` (145 consignees / 145 subs / ~290 tasks). Zero real implicated.
- **Meal Plan Scheduler bulk** — delete `SEED-MPL-%` (200 consignees / 200 subs / ~400 tasks). Demo personas + all 13 unmarked rows provably preserved.

**Parked for ruling (NOT scripted):** MPL's 13 unmarked manual rows (§2).

**Named authorization Love would give (after review of the script at pinned head):**
> *"Authorized: run `delete-merchant-seed-junk.mjs` against prod for `--slug=dr-nutrition` and `--slug=meal-plan-scheduler` — dry-run first, then `--execute=true`. Scoped to the `SEED-DNR-%` / `SEED-MPL-%` marker only; preserve the demo personas and all unmarked rows; abort and surface on any drift."*

Plus a separate ruling on the 13 unmarked rows (§2) before any of those are touched.

# Day-27 production schema audit — findings

**Filed:** Day-27 (15 May 2026), AM.
**Source:** `memory/audit/day-27-production-schema-audit-input.md` (merged in PR #287, `fac8dd2`), run against production Supabase project `qdotjmwqbyzldfuxphei` by Love via SQL editor.
**Status:** Audit findings. Establishes ground truth for the T3 reconciliation plan-PR.

## Headline

**Production matches the repo migration history almost completely.** Of 21 expected tables, 1 view, 45 identity-table columns, 21 identity-table constraints, 21 RLS-enabled tables, 16 expected triggers, 25 expected RLS policies, 1 trigger function, 1 application role, and 2 append-only rules: **two minor divergences were found.** Everything else matches exactly.

The Day-26 followup memo (`memory/followup_production_identity_schema_absent.md`) is **factually wrong on every claim it makes about production's schema state.** It is not wrong that migration 0024 failed — the failure itself is real and unexplained — but the *cause* it proposed (absent identity tables, absent function, absent `updated_at` column) is contradicted by the audit on every point.

## What the audit found

### Schema completeness

| Element | Expected | Found | Status |
|---|---|---|---|
| Tables in `public` | 21 | 21 | ✓ exact |
| Views in `public` | 1 (`consignee_timeline_events`) | 1 | ✓ exact |
| `tenants` columns | 14 | 14, same types & nullability | ✓ exact |
| `users` columns | 7 (incl. `updated_at`) | 7 (incl. `updated_at`) | ✓ exact |
| `roles` columns | 7 | 7 | ✓ exact |
| `role_assignments` columns | 5 | 5 | ✓ exact |
| `api_keys` columns | 11 | 11 | ✓ exact |
| Identity constraints | 21 (across 5 tables) | 21 | ✓ exact |
| `set_updated_at()` function | present in `public` | present in `public`, `LANGUAGE plpgsql`, returns trigger | ✓ exact |
| `planner_app` role | present, LOGIN, no-bypass-RLS | present, LOGIN, no-bypass-RLS, INHERIT | ✓ exact |
| RLS enabled on `public.*` | 21 tables | 21 tables | ✓ exact |
| Append-only rules on `audit_events` | 2 (`_no_update`, `_no_delete`) | 2 | ✓ exact |
| Supabase Vault | available | `supabase_vault` v0.3.1 in schema `vault` | ✓ |

### Two divergences from repo

1. **Trigger `users_set_updated_at` is missing.** Every other `set_updated_at` trigger from the repo (11 of them) is attached on the correct table. The trigger on `public.users` specifically is absent. Operational effect: `users.updated_at` populates on INSERT via the column DEFAULT but does not advance on UPDATE. Low-blast-radius — degrades the audit timestamp on the `users` table only; no data integrity or security impact. Fix is a single `CREATE TRIGGER` statement.

2. **`webhook_events` policy is `FOR ALL` instead of read-only.** Migration 0018 was written to GRANT SELECT+INSERT only to `planner_app` (append-only, mirrors `audit_events`). The RLS policy on the table is `webhook_events_tenant_isolation FOR ALL` rather than something narrower. Because RLS policies layer on top of grants — they can only restrict what grants allow, not expand it — this is almost certainly benign: if `planner_app` doesn't have UPDATE/DELETE grants, the policy can't enable those operations regardless. Worth flagging in the reconciliation plan to verify the grant state, but unlikely to be a real divergence. May not need any action.

### Data is real, with one anomaly worth noting

Exact row counts (Q11):
audit_events                4,621
tasks                       2,744
consignees                  1,224
subscriptions                 953
task_generation_runs          151
webhook_events                212
addresses                      55
role_assignments               73
users                          71
tenants                       558  ← anomaly
roles                           4
api_keys                        0

- Most counts are consistent with the platform being live and accumulating real pilot data.
- `users` has been written to continuously from **2026-05-03 to 2026-05-13** with 71 rows. Continuous time window, no gap — *rules out the "DB was wiped and partially restored" hypothesis* from the Day-26 followup. A wipe would leave no rows from before the wipe; a partial restore would show a visible discontinuity. Neither is present.
- `roles` has 4 rows — matches the brief's role catalogue (`transcorp_staff`, `tenant_admin`, `operations_manager`, `customer_service_agent`).
- `api_keys` has 0 rows — no production API keys ever issued. Consistent with the per-merchant SF API-key path being blocked on Aqib's header reply.

**The 558-tenants anomaly.** Q12b shows that of 558 tenant rows, only **57 distinct tenants have any associated user**. The other 501 tenants exist as rows with no operators attached. Of the 57 user-bearing tenants, 51 have exactly one user each. The "1 user per tenant" pattern strongly suggests integration-test residue accumulated over the sprint — tests creating tenant rows on production rather than against a separate test DB. The Day-24 brief's "stale tenants archived, test users removed" cleanup did not catch the full residue.

This is **tech debt, not an audit failure.** It does not block anything operational. Production has been running with this residue the entire sprint. Worth surfacing for the reconciliation plan-PR to decide whether to scope cleanup into the same lane.

### No migration ledger on production

`supabase_migrations.schema_migrations` does not exist on production. Neither does any `public.schema_migrations`. The repo doesn't use a ledger either (no Drizzle journal, no Supabase CLI config). All migrations have been applied via raw SQL-editor paste, leaving no authoritative record.

This is expected per the audit input doc's Part A.5 prediction. Not a problem in itself. It does mean any reconciliation work has to **stand on schema evidence**, not a migration-ledger diff.

## What we can conclude

1. **Production's identity schema is intact.** Migration 0001's tables, columns, constraints, function, role, RLS, policies, and 11-of-12 triggers all applied successfully. The exception is one missing trigger.

2. **Day-26's diagnostic was wrong** — in some specific way we don't fully understand. Three possibilities, ranked by likelihood:
   - The diagnostic queries themselves had a flaw (wrong schema filter, looking at the wrong catalog, looking at `pg_class` with relkind constraints that excluded valid relations, etc.). The Day-26 EOD doc says queries were run against `qdotjmwqbyzldfuxphei` but doesn't preserve the exact query text. We can't reconstruct what was queried, only what was reported.
   - The Supabase SQL editor session was somehow not connected to the project the URL claimed. Unlikely on a hosted platform but not impossible.
   - There's a transient mode where the catalog reports differently (e.g., during a long-running locked transaction, blocked by another concurrent process). Plausible but hand-wavy.

   We probably don't need to resolve this precisely. The diagnostic was wrong; production was fine; that's enough.

3. **Migration 0024 genuinely failed to apply** — but **not** because the foundation was missing. The foundation was always there. The failure must have a different cause. Candidates worth investigating:
   - The 0024 migration body itself had a Postgres-version-specific issue when executed against prod's Postgres 17.6 that didn't surface against the CI database (different minor version, different extension state).
   - The 0024 attempt ran against a state where some prior migration (e.g., 0017 pickup_address, 0021 status CHECK widening) hadn't actually applied — i.e., production *might* be missing a more recent migration's worth of changes that the audit didn't specifically look for. **This is the question the reconciliation plan-PR has to answer first.**
   - A transient Vault state, lock, or permission issue at the time of attempt.

4. **The credentials lane code on main is still correctly written.** Nothing in the audit invalidates the lane's design. The blocker to promoting Day-26's PRs is no longer "fix the foundation" — it's "establish whether 0024 can now apply, and apply it if so."

## What the reconciliation plan-PR needs to scope

I'm not drafting it. But these are the questions it has to answer, in order:

1. **Are migrations 0017–0023 fully applied to production?** The audit confirmed 0001, 0002, 0003 (function, role, rules). It confirmed the *final* shape of `tenants` includes 0005's migration_gate columns, 0013's `suitefleet_customer_code`, and 0017's pickup_address columns. So 0017 applied. Did 0021's status CHECK widening apply (5 status values, including 'archived')? Did 0022's 10 webhook-extracted columns on `tasks` apply? Did 0023's `outbound_push_failures` table apply? Q2 confirmed `outbound_push_failures` exists (relname listed). So **likely yes**, but the plan-PR should verify each of 0017–0023's specific deltas before assuming.
2. **Why did 0024 fail on the live attempt?** Re-attempting 0024 in a controlled way (locally against a snapshot, or in a feature-branch DB) would surface the actual error. The reconciliation plan should specify *how* to surface it — not improvise live.
3. **Reconcile the two trivial divergences.** One missing trigger, one possibly-broader policy. Both are single-statement fixes. Sequence them before or after the 0024 retry, doesn't matter much.
4. **Decide whether the 501-orphaned-tenants tech debt is in scope.** Probably defer to a separate cleanup — folding it in pollutes the reconciliation lane.

## What the reconciliation plan-PR does NOT need to do

- Restore the identity schema (it's intact).
- Add `users.updated_at` (it's there).
- Recreate `set_updated_at()` (it's there).
- Recreate `planner_app` (it's there).
- Restore any RLS / policies / constraints on identity tables (all present).

## Followup memo state

`memory/followup_production_identity_schema_absent.md` is now factually wrong. It should be **superseded, not edited in place**, because:
- The Day-26 EOD doc references it as 🔴 LOAD-BEARING.
- The MEMORY.md index references it as the active load-bearing followup.
- The original memo is the historical record of what Day-26 thought; it shouldn't be silently rewritten.

The right move: file this audit findings memo, mark the Day-26 memo as superseded with a forward pointer, rotate `MEMORY-followup-current.md` to point at this memo (or at the new reconciliation plan-PR memo once that exists), and update the index.

---

**End of audit findings.**

# Day-54 Session C plan — F-1: apply migration 0025 to the shared dev DB (SQL-TO-APPLY, plan only)

**Filed:** Day-54 (12 Jun 2026), Session C, per the post-clearance dispatch item 3: *"F-1 PLAN only (it carries SQL — the code/migration parks for Love's named authorization; do not build past the plan's park)."*
**Contract:** `memory/triage_five_races_findings.md` §F-1 (merged `6c193ca`).
**This plan PARKS at filing. Nothing is executed.** The SQL below runs only on Love's explicit NAMED authorization, builder-executed per the standing convention.

## §1 What is wrong (environment drift, not code)

The shared dev/sandbox DB's live `outbound_push_failures_operation_check` constraint still reads the 0023-era value set `('update','cancel','bulk_cancel')` — migration `supabase/migrations/0025_outbound_push_failures_operation_reschedule.sql` (which extends it with `'reschedule'`) **was never applied there**. CI provisions fresh from migrations and passes; only the shared dev DB is behind. The standing local-integration red (`tests/integration/migration-0026-tasks-outbound-sync-state.spec.ts:64`) is the drift detector doing its job — the exact pattern `memory/followup_migration_drift_check.md` predicted (migrations land in git but not on the DB).

## §2 The statements (verbatim from 0025 — no new SQL is authored)

```sql
ALTER TABLE outbound_push_failures
  DROP CONSTRAINT outbound_push_failures_operation_check;

ALTER TABLE outbound_push_failures
  ADD CONSTRAINT outbound_push_failures_operation_check
    CHECK (operation IN ('update', 'cancel', 'bulk_cancel', 'reschedule'));
```

- **Target:** the shared dev/sandbox database only (the one carrying the UAT demo data) — which is WHY this is Love-trigger #1 / SQL-TO-APPLY / named authorization, despite being a two-statement, no-data-touch CHECK swap.
- **Risk:** minimal and bounded — a CHECK extension admits a superset; no rows are read, written, or re-validated against a narrower rule. The DROP/ADD pair is the migration's own form. Brief-blessed: 0025 merged long ago; this is application, not authorship.
- **Window note:** between DROP and ADD there is a moment with no CHECK; running the pair in one transaction (`BEGIN; … COMMIT;`) closes it. Recommended execution form: single transaction, then verify.

## §3 Verification (read-only, after the apply)

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'outbound_push_failures_operation_check';
```

Expect the four-value set including `'reschedule'`. Then re-run `tests/integration/migration-0026-tasks-outbound-sync-state.spec.ts` — the standing red clears; that spec is the post-apply proof.

## §4 Out of scope

- The `psql` drift-check tooling the triage memo suggested as a ride-along (compare live constraints vs migrations — the long-filed `followup_migration_drift_check.md`) — tooling scope, separate item, not required to clear this red.
- Any other drift remediation; only 0025's pair is in this plan.
- Any production-DB action. Dev/sandbox only.

## §5 Park

**Parks as `parked-t3` + SQL-TO-APPLY at filing.** Clears on one line from Love naming the apply (e.g. "apply 0025 to the dev DB"); the builder then executes §2 in one transaction, runs §3 verification, and reports the constraint definition + the spec going green in-thread.

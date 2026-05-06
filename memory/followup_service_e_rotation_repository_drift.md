---
name: Service E selectCurrentRotation referenced columns id + created_at that don't exist on subscription_address_rotations per migration 0014; integration coverage at Block 4-G surfaced the drift; hotfix trims the SELECT + the CurrentRotationRow type
description: Day-16 Block 4-G integration coverage at §9.3 row 10 (rotation → cron Layer-3 re-materialization) hit real Postgres on the changeAddressRotation no_op-detection path. Service E's selectCurrentRotation in src/modules/subscription-addresses/repository.ts:164-193 SELECTed `id, weekday, address_id, created_at` but the subscription_address_rotations table per supabase/migrations/0014_addresses_and_subscription_address_rotations.sql:170-176 has only 4 columns (subscription_id, tenant_id, weekday, address_id) — no id, no created_at. CurrentRotationRow at src/modules/subscription-addresses/types.ts:116-121 declared the same two over-specified fields. Mocked-repo unit tests at service.spec.ts never hit real Postgres so the drift was invisible at unit layer. Hotfix lands in the same Block 4-G commit per reviewer Option 1 ruling: trim the SELECT to `weekday, address_id` + trim the type to two fields. service.ts:217-220 rotationsEqual logic only reads (weekday, addressId) so the trim is no-callers-affected.
type: project
---

# Service E selectCurrentRotation column drift — fixed

**Surfaced:** Day-16 Block 4-G integration test run at §9.3 row 10 (rotation → cron Layer-3 re-materialization).

## §1 The drift — repository SELECT vs migration 0014 schema

Three over-specified field references between Service E's TypeScript layer and the actual `subscription_address_rotations` schema:

| Source | Fields |
|---|---|
| **`src/modules/subscription-addresses/repository.ts:164-193`** `selectCurrentRotation` (pre-hotfix) | SELECT `id, weekday, address_id, created_at`; row mapper read `row.id` + `row.created_at` |
| **`src/modules/subscription-addresses/types.ts:116-121`** `CurrentRotationRow` (pre-hotfix) | `readonly id: Uuid`, `readonly weekday: IsoWeekday`, `readonly addressId: Uuid`, `readonly createdAt: IsoTimestamp` |
| **`supabase/migrations/0014_addresses_and_subscription_address_rotations.sql:170-176`** schema CREATE TABLE | `subscription_id`, `tenant_id`, `weekday`, `address_id` only — **no `id`, no `created_at`** |

Migration 0014 schema is the source of truth. The TypeScript layer was over-declared.

## §2 Why mocked-repo unit tests didn't catch it

Service E's unit tests at `src/modules/subscription-addresses/tests/service.spec.ts` mock the entire repository module via `vi.mock(...)`. Test fixtures returned object literals matching the over-declared `CurrentRotationRow` type — TypeScript type-check passed because the type itself was wrong, and the mocked repo never executed the broken SELECT.

Repository unit tests at `src/modules/subscription-addresses/tests/repository.spec.ts` use a `makeStubTx` harness that returns canned-result rows without executing real SQL — the SELECT statement was syntax-checked via the SQL pattern assertion (`expect(captured.sql).toMatch(/SELECT id, weekday, address_id, created_at/i)`) but never run against Postgres.

The drift was invisible at the unit layer in both directions: the service tests trusted the over-declared type; the repository tests trusted the over-declared SELECT.

## §3 How Block 4-G integration coverage surfaced it

`tests/integration/exception-model-happy-path.spec.ts` it 2 (§9.3 row 10) calls `changeAddressRotation` against a real Postgres connection (per the SUPABASE_APP_DATABASE_URL env path). Service-layer flow: `findSubscriptionForRotation` → `findAddressForConsignee` (cross-consignee gate) → **`selectCurrentRotation`** (no_op detection) → … The first two repo calls return rows; `selectCurrentRotation` then issues the broken SELECT against real Postgres and Postgres throws:

```
PostgresError: column "created_at" does not exist
```

The error bubbles up through `withTenant`, the tx aborts, and the service throws the unwrapped error to the caller. Production behavior would have been identical: every `changeAddressRotation` call against an active subscription with an existing rotation row hits this path and fails.

## §4 Hotfix — minimal-blast-radius (Block 4-G reviewer Option 1)

Five-line repository SELECT trim + two-field type trim, all in one commit alongside the integration spec files that surfaced the drift.

### §4.1 `src/modules/subscription-addresses/repository.ts:164-193`

Drop `id` + `created_at` from the SELECT, the inline `Row` type, and the row mapper. Result: `selectCurrentRotation` returns rows with shape `{ weekday, addressId }`.

### §4.2 `src/modules/subscription-addresses/types.ts:116-121`

Drop `id: Uuid` + `createdAt: IsoTimestamp` from `CurrentRotationRow`. The orphaned `IsoTimestamp` import on line 24 also drops (was the only usage). Comment block updated to cite this memo + the migration-0014 4-column schema.

### §4.3 Companion test updates

- `src/modules/subscription-addresses/tests/service.spec.ts`: `rotationRow` factory at line 107-114 trimmed to return `{ weekday, addressId }`. Unused `FIXED_NOW` constant at line 70 dropped.
- `src/modules/subscription-addresses/tests/repository.spec.ts`: `selectCurrentRotation` test at line 185-207 stub data trimmed to `{ weekday, address_id }`; SQL pattern assertion updated to `/SELECT weekday, address_id\s+FROM subscription_address_rotations/i`; `expect(result[0].createdAt).toBe(...)` assertion removed. Unused `FIXED_NOW` constant at line 30 dropped.

### §4.4 Why the trim is safe (no-callers-affected proof)

`src/modules/subscription-addresses/service.ts:215-220` is the only consumer of `selectCurrentRotation`. The `currentPairs` projection at line 217-220 reads only `weekday` and `addressId` from each row. The `rotationsEqual` comparator at the end of the file only operates on `(weekday, addressId)` pairs. Neither `id` nor `createdAt` is referenced anywhere downstream of `selectCurrentRotation`.

## §5 Discipline lesson — integration-vs-unit coverage

Mocked-repo unit tests are NOT sufficient regression-grade signal for repository-layer schema drift. The repository's SELECT statement must execute against real Postgres at least once in the test surface, or column-vs-schema drift can ship into production unnoticed. Integration tests against `subscription_address_rotations` should always exercise `selectCurrentRotation` directly OR transitively via `changeAddressRotation`.

The Block 4-G integration spec at `tests/integration/exception-model-happy-path.spec.ts` it 2 is the regression pin going forward — any future drift between Service E's TypeScript layer and migration 0014 columns fails this test loud.

The broader rule (already in §A discipline): the schema layer is the contract; SELECT statements + TypeScript projection types must align with the schema, not with what the developer expected the schema to be.

## §6 Phase 2 / future considerations

If a Phase 2 surface ever needs per-row identity for `subscription_address_rotations` (e.g., for per-row audit emit, or for selective UPDATE of one weekday's row by id), the schema migration adds `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` + `created_at timestamptz NOT NULL DEFAULT now()` columns FIRST, then the TypeScript `CurrentRotationRow` re-extends. The reverse order (TypeScript-first, schema-after) created the drift this memo documents.

Brief §10.6 (audit event for rotation changes) is the open question that may eventually drive the Phase 2 schema extension. If rotation gets a registered audit event, the per-row id column becomes a forensic-query convenience — at which point the schema migration is the correct entry point.

## §7 Cross-references

- **`src/modules/subscription-addresses/repository.ts:164-193`** (post-hotfix) — `selectCurrentRotation` with trimmed SELECT
- **`src/modules/subscription-addresses/types.ts:116-121`** (post-hotfix) — `CurrentRotationRow` 2-field type
- **`src/modules/subscription-addresses/service.ts:217-220`** — only consumer; reads (weekday, addressId) only
- **`supabase/migrations/0014_addresses_and_subscription_address_rotations.sql:170-176`** — schema source of truth (4 columns)
- **`tests/integration/exception-model-happy-path.spec.ts`** it 2 — the integration regression pin
- **`memory/PLANNER_PRODUCT_BRIEF.md`** v1.3 §10.6 — open question on rotation audit events; potential Phase 2 trigger for schema extension
- **Block 4-G reviewer Option 1 ruling** (Day-16, this turn) — authorized the hotfix bundle
- **`memory/followup_audit_body_vs_plan_text_drift.md`** + sibling Block 4-D/E/F memos — same plan-sync bundle for Day-17 morning

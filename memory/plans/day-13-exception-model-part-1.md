---
name: Day-13 backend exception model — schema part 1 (T3, hard-stop-twice)
description: Plan PR (memo-only) for the Day-13 substantive scope — schema migrations + generator-layer wiring for the brief's backend exception model. Lands the data plane (subscription_exceptions, subscription_materialization, addresses, subscription_address_rotations, consignees.crm_state, consignee_crm_events + view, tenants.status + pickup_address_*, tasks.suitefleet_push_acknowledged_at, webhook_events.raw_payload, tasks_internal_status_check extension to add SKIPPED), audit event registrations (9 new events), permissions catalogue (10 new permissions), generator updates (address rotation honoring + schema-aware exception application during materialization), and test coverage (worked examples + edge cases + RLS isolation). Service surface, API routes, and UI are part 2 (Day 14). T3 hard-stops twice — once at this plan PR, once at the code PR open.
type: project
---

# Day-13 backend exception model — schema part 1

**Tier:** T3 (schema, RLS, audit, permissions catalogue) — hard-stop-twice protocol per [PLANNER_PRODUCT_BRIEF.md §7](../PLANNER_PRODUCT_BRIEF.md)
**Status:** plan-only — no migration files, no service code, no test code today. Implementation lives in the part-1 code PR after this plan reviews.
**Hard-stops:** (a) this plan PR opens; review-and-approve before any code; (b) part-1 code PR opens for verification-only counter-review.
**Drivers:** PLANNER_PRODUCT_BRIEF.md §3.1.1–§3.1.4 (schema + audit + permissions), §3.4 (RLS three-layer enforcement), §7 (tier discipline + idempotency + correlation_id).
**Out of scope today:** service-layer surface (`addSubscriptionException`, `pauseSubscription`, etc.), API routes, UI, idempotency-key API enforcement, cut-off enforcement at request boundary, webhook deduplication, integration tests — all part 2 (Day 14). Cron materialization↔push decoupling and `(tenant_id, target_date)` UNIQUE on `task_generation_runs` are own T3 plan PR (Day 14) per [memory/followups/cron_materialization_push_coupling.md](../followups/cron_materialization_push_coupling.md).

---

## §0 Pre-flight verification

Local-migration grep (this branch) gives a starting picture; production schema may have drifted (per [followup_migration_drift_check.md](../followup_migration_drift_check.md)). §0's purpose: lock actual prod state before §1 declares net-new vs column-add vs rename for each item.

### §0.1 Local-migration findings (already established)

| Brief item | Local-migration state | Initial classification |
|---|---|---|
| `subscription_exceptions` | absent | **net-new table** |
| `subscription_materialization` | absent | **net-new table** |
| `subscription_address_rotations` | absent | **net-new table** |
| `consignee_crm_events` | absent | **net-new table** |
| `addresses` | absent ([0004:5](../../supabase/migrations/0004_consignee.sql) comment: "consignee_addresses table in Phase 2 (out of pilot scope)" — Phase 2 is now MVP) | **net-new table** |
| `consignee_timeline_events` | absent | **net-new view** |
| `consignees.crm_state` | absent in 0004 | **column-add** |
| `tenants.status` | absent in identity migrations | **column-add** (verify prod) |
| `tenants.pickup_address_line / _district / _emirate` | absent | **column-add (×3)** |
| `webhook_events.raw_payload` | **table itself absent** — not defined in any migration; webhook events are only persisted as `audit_events` rows | **net-new table including raw_payload column** |
| `tasks_internal_status_check` | confirmed at [0006:131-138](../../supabase/migrations/0006_task.sql) — values `CREATED, ASSIGNED, IN_TRANSIT, DELIVERED, FAILED, CANCELED, ON_HOLD` | **CHECK extension** — add `SKIPPED` |
| `tasks.suitefleet_push_acknowledged_at` (brief name) vs `tasks.pushed_to_external_at` (existing at [0006:156](../../supabase/migrations/0006_task.sql)) | existing column has same semantic intent | **decision required — see §0.3** |

### §0.2 Verification queries (Love runs against production)

Read-only. None mutate. Paste output back; §1 refines per actuals.

```sql
-- §0-Q1: tenants.status presence + shape
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'status';

-- §0-Q2: tenants.pickup_address_* presence
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tenants'
  AND column_name LIKE 'pickup_%'
ORDER BY column_name;

-- §0-Q3: webhook_events table existence + columns (NULL result confirms net-new)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'webhook_events'
ORDER BY ordinal_position;

-- §0-Q4: addresses table existence + columns (NULL result confirms net-new)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'addresses'
ORDER BY ordinal_position;

-- §0-Q5: tasks_internal_status_check current allowed values
SELECT consrc AS check_clause
FROM pg_constraint
WHERE conname LIKE 'tasks_internal_status%' AND contype = 'c';
-- Postgres 12+: pg_get_constraintdef(oid) instead of consrc
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname LIKE 'tasks%internal_status%' AND contype = 'c';

-- §0-Q6: tasks.pushed_to_external_at vs suitefleet_push_acknowledged_at — which exists?
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tasks'
  AND column_name IN ('pushed_to_external_at', 'suitefleet_push_acknowledged_at')
ORDER BY column_name;

-- §0-Q7: consignees.crm_state presence
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'consignees' AND column_name = 'crm_state';

-- §0-Q8: subscription_exceptions / _materialization / _address_rotations / consignee_crm_events presence
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'subscription_exceptions',
    'subscription_materialization',
    'subscription_address_rotations',
    'consignee_crm_events',
    'consignee_timeline_events'
  )
ORDER BY table_name;
```

#### §0-Q9 — Code-read confirmation: `pushed_to_external_at` populated AFTER SF returns 2xx (NOT before request initiation)

This is a **code-read verification step (no SQL)** — the §0.3 Option A recommendation depends on this semantic match. Locked at plan-PR amendment time:

`tasks.pushed_to_external_at` is set by `markTaskPushed` at [`src/modules/tasks/repository.ts:531-543`](../../src/modules/tasks/repository.ts#L531-L543):

```sql
UPDATE tasks
SET external_id = ${externalId},
    external_tracking_number = ${externalTrackingNumber},
    pushed_to_external_at = now()
WHERE id = ${taskId} AND tenant_id = ${tenantId}
```

`markTaskPushed` is invoked from two sites in [`src/modules/task-push/service.ts`](../../src/modules/task-push/service.ts), both **after** `pushResult` materializes from the SuiteFleet createTask call:

| Call site | Lines | Path |
|---|---|---|
| Cron-loop success path | [723–728](../../src/modules/task-push/service.ts#L723-L728) | inside `// Success: mark task pushed` block |
| Single-task success path | [1098–1104](../../src/modules/task-push/service.ts#L1098-L1104) | inside `// Step 5: success — mark task pushed` block |

Two corroborating comments in the same file:
- **Header at L35–37**: documents the order explicitly — "(2) Calls `markTaskPushed(taskId, externalId, awb)` to set external_id / external_tracking_number / pushed_to_external_at" — step (2) follows step (1), which is the SF push that returned 2xx.
- **Sentry-loud at L1116–1119**: "the next cron pass will see `pushed_to_external_at IS NULL` and re-attempt — duplicate-physical-delivery risk worth waking ops up for" — confirms the column is the integration-honesty marker for confirmed-acknowledged-by-SF state, never request-initiated state.

**Conclusion:** `tasks.pushed_to_external_at` semantic exactly matches the brief's intent for `suitefleet_push_acknowledged_at`. §0.3 Option A is safe.

**Reviewer surfaces in PR comment alongside §0-Q1…Q8 SQL results.**

### §0.3 Decision: `tasks.suitefleet_push_acknowledged_at` vs `tasks.pushed_to_external_at`

**Brief calls for** `tasks.suitefleet_push_acknowledged_at` ([§3.1.1](../PLANNER_PRODUCT_BRIEF.md)).
**Existing column** at [`supabase/migrations/0006_task.sql:156`](../../supabase/migrations/0006_task.sql) is `pushed_to_external_at timestamptz` with the identical semantic ("populated when SF POST returns 2xx" — code-confirmed in §0-Q9 above).

Three options:

| Option | Cost | Benefit | Tradeoff |
|---|---|---|---|
| **A. Keep existing `pushed_to_external_at`; amend brief** | Trivial — brief amendment per §10 protocol; one-line column reference update in §3.1.1 | Zero migration churn; existing audit metadata, integration code (`task-push/service.ts`), and tests stay coherent | Brief column name slightly less precise than the proposed name |
| **B. Rename `pushed_to_external_at` → `suitefleet_push_acknowledged_at`** | Migration with `ALTER TABLE … RENAME COLUMN …`; touches `src/modules/task-push/service.ts`, audit event metadata field name, all test fixtures, type re-export at `@/shared/types`; possible drift between local and prod renames | Brief stays as written; column name fully self-describes the SuiteFleet-acknowledgement semantic | Production renames are operational risk (writes-in-flight), force a coordinated deploy + migration ordering, and create cross-cutting code churn for stylistic gain |
| **C. Add NEW `suitefleet_push_acknowledged_at`; deprecate `pushed_to_external_at`** | Two-column window (write to both; backfill; future migration removes old) | Clean cut-over with zero downtime | Doubles complexity for the same semantic; Phase-2 cleanup debt |

**Recommendation:** **Option A.** Per CLAUDE.md "Don't add features ... beyond what the task requires" — renaming for stylistic fit when the existing column already works correctly is unjustified work. The brief amendment cost is one-line.

**Brief amendment text (proposed):** in [§3.1.1](../PLANNER_PRODUCT_BRIEF.md), replace the `tasks.suitefleet_push_acknowledged_at` column block with:

> **`tasks.pushed_to_external_at` column:** `timestamptz NULL` — already present in `0006_task.sql`. Populated when SuiteFleet POST returns 2xx. Surfaced on UI as integration-honesty indicator (§3.3.6). **Contract surface for forthcoming materialization/push decoupling (Day-14 own T3 plan PR per `memory/followups/cron_materialization_push_coupling.md`). Day-13 makes no schema change to this column; Day-14 work uses its existing semantics as the integration-honesty marker.**

If the reviewer prefers **Option B** (rename), the part-1 code PR scope grows to include the rename migration + cross-cutting code touch. Surface preference at this plan PR review.

### §0.4 Net-new vs column-add summary (locked against §0.2 actuals)

§0.2 Q1–Q8 confirmed the local-migration picture with one drift: **`tenants.status` already exists in prod** (Q1) — see §1.7 amendment.

- **Net-new tables (6):** `subscription_exceptions`, `subscription_materialization`, `subscription_address_rotations`, `consignee_crm_events`, `addresses`, `webhook_events`
- **Net-new view (1):** `consignee_timeline_events`
- **Column-add (5 columns across 3 tables):** `tenants.pickup_address_line`, `tenants.pickup_address_district`, `tenants.pickup_address_emirate`, `consignees.crm_state`, `tasks.address_id` (nullable — locked at plan stage; see §1.3 + §2)
- **CHECK extension (1):** `tasks_internal_status_check` adds `SKIPPED`
- **No-op — already in prod (per §0.2 Q1):** `tenants.status` exists as `text NOT NULL DEFAULT 'provisioning'` with CHECK `('provisioning', 'active', 'suspended', 'inactive')` — adopt prod's 4-state lowercase canon; see §1.7 amendment
- **No-op (per §0.3 Option A):** `tasks.pushed_to_external_at` — keep as-is

### §0.5 Migration filename allocation

Next sequence is `0014_*`. Proposed split for atomic-review chunks:

| Migration | Scope |
|---|---|
| `0014_addresses_and_subscription_address_rotations.sql` | net-new tables + RLS + indexes + `tasks.address_id` nullable column-add (declared as future-generator schema dependency; see §1.3 + §2) |
| `0015_subscription_exceptions_and_materialization.sql` | net-new tables + RLS + indexes + correlation_id design |
| `0016_consignee_crm_state_and_events.sql` | column-add + net-new table + view + RLS |
| `0017_tenants_pickup_address.sql` | column-add (×3) for `tenants.pickup_address_line / _district / _emirate`. **`tenants.status` is no-op per §1.7 amendment** — already in prod with 4-state lowercase canon |
| `0018_webhook_events.sql` | net-new table + UNIQUE (deduplication) + RLS |
| `0019_tasks_internal_status_skipped.sql` | CHECK extension only — single-statement migration |

One PR, six migration files. Six is a lot; alternative is one bundled `0014_exception_model_part_1.sql`. **Reviewer to choose at plan-PR review.** Recommended: split (each migration is independently revertible; review surface is clearer per-table).

---

## §1 Schema migrations

Each subsection below: rationale → DDL sketch (commented; not executable; final DDL lands in code PR with line-anchored review) → RLS → indexes → CHECK constraints → FK semantics. RLS pattern follows the `tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid` convention from [`0004_consignee.sql`](../../supabase/migrations/0004_consignee.sql).

### §1.1 `subscription_exceptions`

Per brief [§3.1.1](../PLANNER_PRODUCT_BRIEF.md). Single table covers all five exception types: `skip`, `pause_window`, `address_override_one_off`, `address_override_forward`, `append_without_skip`. Discriminator + per-type-conditional columns; type-specific column constraints are CHECK-enforced.

```sql
-- 0015_subscription_exceptions_and_materialization.sql (sketch — final lands in code PR)
CREATE TABLE subscription_exceptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id          uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type                     text NOT NULL CHECK (type IN (
                             'skip', 'pause_window',
                             'address_override_one_off',
                             'address_override_forward',
                             'append_without_skip'
                           )),
  start_date               date NOT NULL,
  end_date                 date,
  target_date_override     date,
  skip_without_append      boolean NOT NULL DEFAULT false,
  reason                   text,
  address_override_id      uuid REFERENCES addresses(id) ON DELETE RESTRICT,
  compensating_date        date,
  correlation_id           uuid NOT NULL,
  idempotency_key          uuid NOT NULL,
  created_by               uuid NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),

  -- Per-type conditional CHECKs (named for review-grep)
  CONSTRAINT exc_address_override_requires_address_id CHECK (
    type NOT IN ('address_override_one_off', 'address_override_forward')
    OR address_override_id IS NOT NULL
  ),
  CONSTRAINT exc_pause_window_requires_end_date CHECK (
    type <> 'pause_window' OR end_date IS NOT NULL
  ),
  CONSTRAINT exc_skip_without_append_only_for_skip CHECK (
    skip_without_append = false OR type = 'skip'
  ),
  CONSTRAINT exc_compensating_date_only_for_skip CHECK (
    compensating_date IS NULL OR type = 'skip'
  )
);

-- Indexes
CREATE INDEX subscription_exceptions_sub_start_idx
  ON subscription_exceptions (subscription_id, start_date);
CREATE INDEX subscription_exceptions_tenant_idx
  ON subscription_exceptions (tenant_id);
-- Idempotency UNIQUE (per brief §7 — required on mutating ops).
CREATE UNIQUE INDEX subscription_exceptions_idempotency_idx
  ON subscription_exceptions (subscription_id, idempotency_key);

-- RLS
ALTER TABLE subscription_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_exceptions_tenant_isolation ON subscription_exceptions
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_exceptions TO planner_app;
```

**FK cascade rationale:**
- `subscription_id ON DELETE CASCADE` — deleting a subscription wipes its exceptions; subscriptions delete is operator-rare and Phase-2-flagged (no UI today). If keep-history-on-delete is required, lift cascade in Phase 2.
- `tenant_id ON DELETE CASCADE` — mirrors existing tables; tenant-delete is a system-only op. **Note:** the audit-rule cascade conflict from [followup_audit_rule_cascade_conflict.md](../followup_audit_rule_cascade_conflict.md) does not apply here (this table has no audit-rule).
- `address_override_id ON DELETE RESTRICT` — addresses referenced by an exception cannot be deleted; forces explicit cleanup.

**Idempotency:** UNIQUE on `(subscription_id, idempotency_key)`. Service layer (part 2) catches the 23505 and returns 409 with the existing exception_id.

**`correlation_id`:** uuid v7 generated at service-layer entry (part 2). NOT NULL because all five exception types emit at least one paired audit event (`subscription.exception.created`); for `skip` without `skip_without_append=true`, the same id appears on the paired `subscription.end_date.extended` row.

### §1.2 `subscription_materialization`

Per brief [§3.1.1](../PLANNER_PRODUCT_BRIEF.md) + [§3.1.5](../PLANNER_PRODUCT_BRIEF.md). One row per subscription tracking how far the 14-day rolling horizon has materialized.

```sql
CREATE TABLE subscription_materialization (
  subscription_id            uuid PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
  tenant_id                  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  materialized_through_date  date NOT NULL,
  last_materialized_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_materialization_tenant_idx
  ON subscription_materialization (tenant_id);
CREATE INDEX subscription_materialization_through_date_idx
  ON subscription_materialization (materialized_through_date);

ALTER TABLE subscription_materialization ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_materialization_tenant_isolation ON subscription_materialization
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_materialization TO planner_app;
```

**Note:** brief §3.1.5 horizon-cron and §3.1.1 materialization-row creation logic are **part 2 / Day 14** scope (service surface). Part 1 lands the table only — generator updates §2 may seed initial rows for existing subscriptions in a one-time backfill.

### §1.3 `addresses`

Per brief [§3.1.1](../PLANNER_PRODUCT_BRIEF.md). Replaces the [`0004_consignee.sql:5`](../../supabase/migrations/0004_consignee.sql) "Phase 2" deferral comment.

```sql
-- 0014_addresses_and_subscription_address_rotations.sql (sketch)
CREATE TABLE addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consignee_id  uuid NOT NULL REFERENCES consignees(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label         text NOT NULL CHECK (label IN ('home', 'office', 'other')),
  is_primary    boolean NOT NULL DEFAULT false,
  line          text NOT NULL,
  district      text NOT NULL,
  emirate       text NOT NULL,
  lat           numeric(9, 6),
  lng           numeric(9, 6),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Exactly-one-primary-per-consignee. Partial UNIQUE constraint.
CREATE UNIQUE INDEX addresses_one_primary_per_consignee_idx
  ON addresses (consignee_id) WHERE is_primary = true;

CREATE INDEX addresses_tenant_idx     ON addresses (tenant_id);
CREATE INDEX addresses_consignee_idx  ON addresses (consignee_id);

ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY addresses_tenant_isolation ON addresses
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON addresses TO planner_app;

-- Backfill: existing consignees → one address row per consignee with label='home', is_primary=true
-- (consignees current schema carries inline address fields; backfill SELECTs them and INSERTs into addresses.)
```

**Backfill posture:** existing `consignees` rows have inline address fields per [`0004_consignee.sql`](../../supabase/migrations/0004_consignee.sql) (line, district, emirate, lat, lng). Migration ends with a single `INSERT INTO addresses … SELECT … FROM consignees` to seed the per-consignee primary address. Inline fields stay in `consignees` for now (deprecation deferred to Phase 2 — too cross-cutting for part 1).

**Phase-2 deprecation note:** consignees inline address fields become stale once `addresses` is the source of truth. Phase 2 either drops the inline columns or makes them computed-from-primary. Filed as out-of-scope item §6.

#### §1.3.1 `tasks.address_id` column-add (nullable, locked)

The `tasks.address_id` schema dependency lands inside the same `0014_*` migration so the FK target table (`addresses`) exists in the same atomic step:

```sql
-- 0014_addresses_and_subscription_address_rotations.sql (continued)
ALTER TABLE tasks
  ADD COLUMN address_id uuid REFERENCES addresses(id) ON DELETE RESTRICT;

CREATE INDEX tasks_address_idx ON tasks (address_id);
```

**Nullability — locked nullable at plan stage (§9 review-checklist no longer carries this question):**
- Existing 845+ demo rows have no `address_id` value to backfill — making the column NOT NULL on day 1 forces a backfill migration that joins via `consignees → addresses (where is_primary=true)` and risks NULL-after-join for any consignee whose primary-address backfill (§1.3 above) hasn't landed yet
- The brief never declares `tasks.address_id` NOT NULL; making it NOT NULL would be plan-side overreach
- Service layer (part 2) handles missing-address validation when materializing new tasks AND when operator-initiated address overrides land
- Phase 2 can promote to NOT NULL after a backfill sweep validates 100% population — the promotion is `ALTER TABLE tasks ALTER COLUMN address_id SET NOT NULL`, single-statement, after all backfilled

**FK ON DELETE RESTRICT:** prevents deleting an address that is referenced by historical tasks. Phase-2 UI delete-address flow must handle the cascade-block message gracefully (mirrors `subscription_address_rotations.address_id` posture in §1.4).

**No backfill in part 1:** part-1 migration adds the column; existing 845+ rows stay NULL. Generator code that populates this column on new INSERTs is **part 2** (Day 14 — see §2 for the deferral rationale and §6 for the part-2 scope statement).

### §1.4 `subscription_address_rotations`

Per brief [§3.1.1](../PLANNER_PRODUCT_BRIEF.md). Per-subscription per-weekday address mapping; missing rows fall back to consignee primary.

```sql
CREATE TABLE subscription_address_rotations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  weekday         int  NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  address_id      uuid NOT NULL REFERENCES addresses(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX subscription_address_rotations_sub_weekday_idx
  ON subscription_address_rotations (subscription_id, weekday);
CREATE INDEX subscription_address_rotations_tenant_idx
  ON subscription_address_rotations (tenant_id);

ALTER TABLE subscription_address_rotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_address_rotations_tenant_isolation ON subscription_address_rotations
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_address_rotations TO planner_app;
```

**Weekday convention:** ISO 1-7 (Mon=1, Sun=7) — matches `EXTRACT(ISODOW FROM date)::int` already used in the generator at [`task-generation/repository.ts:240`](../../src/modules/task-generation/repository.ts#L240).

**Address FK ON DELETE RESTRICT:** prevents deleting an address that is in active rotation. UI delete-address flow (Phase 2) must show "this address is in use by N subscriptions" before allowing delete.

### §1.5 `consignees.crm_state` (column-add) + `consignee_crm_events`

Per brief [§3.1.1](../PLANNER_PRODUCT_BRIEF.md).

```sql
-- 0016_consignee_crm_state_and_events.sql (sketch)
ALTER TABLE consignees
  ADD COLUMN crm_state text NOT NULL DEFAULT 'ACTIVE'
    CHECK (crm_state IN (
      'ACTIVE', 'ON_HOLD', 'HIGH_RISK', 'INACTIVE', 'CHURNED', 'SUBSCRIPTION_ENDED'
    ));

CREATE INDEX consignees_tenant_crm_state_idx
  ON consignees (tenant_id, crm_state);

CREATE TABLE consignee_crm_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consignee_id  uuid NOT NULL REFERENCES consignees(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_state    text,
  to_state      text NOT NULL CHECK (to_state IN (
                  'ACTIVE', 'ON_HOLD', 'HIGH_RISK', 'INACTIVE', 'CHURNED', 'SUBSCRIPTION_ENDED'
                )),
  reason        text,
  actor         uuid NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX consignee_crm_events_consignee_idx ON consignee_crm_events (consignee_id, occurred_at DESC);
CREATE INDEX consignee_crm_events_tenant_idx    ON consignee_crm_events (tenant_id);

ALTER TABLE consignee_crm_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY consignee_crm_events_tenant_isolation ON consignee_crm_events
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON consignee_crm_events TO planner_app;
```

**State-transition validity:** brief [§3.1.4](../PLANNER_PRODUCT_BRIEF.md) `changeConsigneeCrmState` enforces transition rules at the **service layer** (part 2). The CHECK constraint is value-domain only; transition validity (e.g. CHURNED→ACTIVE requires reactivation) is service-layer business logic.

### §1.6 `consignee_timeline_events` (view)

Per brief [§3.1.1](../PLANNER_PRODUCT_BRIEF.md). MVP is a database view computing on read; if performance demands, denormalize to a table in Phase 2.

```sql
-- Same migration file 0016 (or split — reviewer choice)
CREATE VIEW consignee_timeline_events AS
SELECT
  consignee_id, tenant_id, occurred_at, 'crm_state' AS event_kind,
  jsonb_build_object('from_state', from_state, 'to_state', to_state, 'reason', reason) AS payload,
  actor AS actor_id
FROM consignee_crm_events
UNION ALL
SELECT
  s.consignee_id, s.tenant_id, e.created_at, 'subscription_exception' AS event_kind,
  jsonb_build_object('type', e.type, 'start_date', e.start_date, 'end_date', e.end_date,
                     'compensating_date', e.compensating_date, 'reason', e.reason) AS payload,
  e.created_by AS actor_id
FROM subscription_exceptions e
JOIN subscriptions s ON s.id = e.subscription_id
UNION ALL
SELECT
  t.consignee_id, t.tenant_id, t.updated_at, 'task_status' AS event_kind,
  jsonb_build_object('task_id', t.id, 'status', t.internal_status,
                     'delivery_date', t.delivery_date) AS payload,
  NULL::uuid AS actor_id
FROM tasks t
WHERE t.internal_status IN ('DELIVERED', 'FAILED', 'SKIPPED', 'CANCELED');
-- Subscription create / pause / resume events flow via subscription_exceptions
-- (pause_window) + audit_events; if richer subscription lifecycle events are
-- needed, extend the UNION in part 2.

GRANT SELECT ON consignee_timeline_events TO planner_app;
-- View inherits RLS from underlying tables (each underlying table has its own
-- tenant_isolation policy). Verify in test §5.
```

**RLS on views:** views in Postgres run with the invoker's permissions by default; RLS policies on underlying tables apply transparently. Verify with cross-tenant probe test (§5).

### §1.7 `tenants.pickup_address_*` (column-add ×3) + `tenants.status` (no-op, adopt prod 4-state lowercase canon)

Per brief [§3.1.1](../PLANNER_PRODUCT_BRIEF.md), amended against §0.2 Q1 actuals.

#### §1.7.1 `tenants.status` — already in prod, no schema change in part 1

§0.2 Q1 confirmed prod has `tenants.status text NOT NULL DEFAULT 'provisioning'` with CHECK `('provisioning', 'active', 'suspended', 'inactive')`. Q1a count: **340 rows `'provisioning'`, 3 rows `'active'` (MPL/DNR/FBU), 0 in suspended/inactive**.

**Plan amendment:** the original draft proposed `ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE'))`. **Both the column-add AND the proposed 2-state uppercase enum are dropped.** Adopt prod's 4-state lowercase canon as the canonical state machine.

```sql
-- 0017_tenants_pickup_address.sql (sketch — status column NOT touched)
-- tenants.status is already present (no migration); no-op here.
-- Canonical state machine adopted from prod:
--   'provisioning' (default on insert; new tenants land here)
--      ↓ activateMerchant (transcorp_staff)
--   'active'
--      ↓ deactivateMerchant (transcorp_staff)
--   'inactive'
--   'suspended' (reserved; service surface decision deferred to part-2 §6)
```

**Lifecycle adopted:**
- Tenant row created → lands in `'provisioning'` (DB default; createMerchant service does not need to set status)
- Transcorp-staff `activateMerchant` → flips to `'active'`
- Transcorp-staff `deactivateMerchant` → flips to `'inactive'`
- `'suspended'` — reserved (decide in part-2 whether it's a new service action surface or stays operationally-set-only)

**Why 4-state lowercase wins over the original 2-state uppercase proposal:**
1. Already in prod with 343 rows behind it — changing it would require a data migration, not just a schema change
2. The 2-step `provisioning → active` flow is a **better** fit for the brief's separate `merchant.created` and `merchant.activated` audit events ([§3.1.2](../PLANNER_PRODUCT_BRIEF.md)) — under the original 2-state ('ACTIVE' default), `merchant.created` would emit on a tenant that's already in its terminal active state, collapsing two semantic-distinct events into the same state. With prod's 4-state, `merchant.created` emits on `provisioning` (genuinely "created but not yet active") and `merchant.activated` emits on the `provisioning → active` transition (genuinely "activated").
3. Lowercase is consistent with prod's existing convention for tenant status values; uppercase would introduce a casing-mismatch precedent

**Brief amendment queued (combined with §0.3):** `PLANNER_PRODUCT_BRIEF.md §3.1.1` `tenants.status` line currently reads "`text` with values `'ACTIVE'` / `'INACTIVE'`. Default `'ACTIVE'` on new tenant insert." → amend to "`text NOT NULL` with values `'provisioning'`, `'active'`, `'suspended'`, `'inactive'`. Default `'provisioning'` on new tenant insert; transitions via Transcorp-staff `activateMerchant` / `deactivateMerchant` services. `'suspended'` reserved (part-2 service surface decision)." Filed in the single combined brief-amendment PR after part-1 code PR opens.

#### §1.7.2 `tenants.pickup_address_*` (column-add ×3)

```sql
-- 0017_tenants_pickup_address.sql (sketch)
ALTER TABLE tenants
  ADD COLUMN pickup_address_line     text,
  ADD COLUMN pickup_address_district text,
  ADD COLUMN pickup_address_emirate  text;

-- No CHECK on the pickup_address_* triple (NULL for tenants onboarded pre-MVP;
-- new merchant onboarding via createMerchant service requires non-null per part 2).
```

**No backfill required** for `pickup_address_*` — existing tenants (sandbox + 3 demo + 339 stale test tenants per [followup_audit_rule_cascade_conflict.md](../followup_audit_rule_cascade_conflict.md)) get NULL; demo merchant ("Demo Bistro") created live via Transcorp-staff flow per brief [§5.1](../PLANNER_PRODUCT_BRIEF.md) supplies the values at create time.

**Operational note:** the Demo-Bistro flow ([brief §5.1 step 2](../PLANNER_PRODUCT_BRIEF.md)) requires `pickup_address_*` to be writable via the Transcorp-staff `createMerchant` API — that service is part 2. The 340 `'provisioning'` rows in prod are likely the stale test tenants from earlier development phases — they will stay `'provisioning'` with NULL pickup_address indefinitely until the cleanup-mechanism gap (audit-rule cascade conflict) is resolved.

### §1.8 `webhook_events` (net-new table)

Per brief [§3.1.1](../PLANNER_PRODUCT_BRIEF.md) + [§3.1.10](../PLANNER_PRODUCT_BRIEF.md). Currently webhook events are persisted only as `audit_events` rows; brief calls for a dedicated table for raw-payload preservation + UNIQUE-based deduplication. **Net-new entire table including `raw_payload`.**

```sql
-- 0018_webhook_events.sql (sketch)
CREATE TABLE webhook_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  suitefleet_task_id  text NOT NULL,
  action              text NOT NULL,
  event_timestamp     timestamptz NOT NULL,
  raw_payload         jsonb NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now()
);

-- Webhook deduplication per brief §3.1.10:
CREATE UNIQUE INDEX webhook_events_dedup_idx
  ON webhook_events (suitefleet_task_id, action, event_timestamp);

CREATE INDEX webhook_events_tenant_idx ON webhook_events (tenant_id);
CREATE INDEX webhook_events_task_idx   ON webhook_events (suitefleet_task_id);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_events_tenant_isolation ON webhook_events
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON webhook_events TO planner_app;
-- No UPDATE / DELETE — webhook events are append-only.
```

**Append-only posture:** no UPDATE/DELETE grants; mirrors the audit_events policy. If a webhook payload is malformed and needs re-process, the dedup UNIQUE makes a corrected resend safe.

**Cross-impact with audit_events:** the existing webhook receiver (per [`src/modules/webhooks/queries.ts`](../../src/modules/webhooks/queries.ts)) reads from `audit_events` for webhook activity. Part-2 service work updates the receiver to ALSO insert into `webhook_events`; audit-events writes stay (auditing the receipt event remains semantic-distinct from preserving the raw payload).

### §1.9 `tasks_internal_status_check` extension

Per brief [§3.1.1](../PLANNER_PRODUCT_BRIEF.md). Add `'SKIPPED'` to the CHECK at [`0006_task.sql:131-138`](../../supabase/migrations/0006_task.sql).

```sql
-- 0019_tasks_internal_status_skipped.sql (sketch — single statement)
ALTER TABLE tasks DROP CONSTRAINT tasks_internal_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_internal_status_check CHECK (
  internal_status IN (
    'CREATED', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED',
    'FAILED', 'CANCELED', 'ON_HOLD', 'SKIPPED'
  )
);
```

**Semantic boundary** (locked from brief §3.1.1):
- `SKIPPED` = human-driven exception with compensating-date semantics (set by `addSubscriptionException(type='skip')`)
- `CANCELED` = terminal stop (subscription ended, paused, or task cancelled outright via `pause_window` exception)

Status-mapper at `src/modules/integration/providers/suitefleet/status-mapper.ts` (S-6 mapper from 0006 header comment) does NOT receive `SKIPPED` from SuiteFleet — `SKIPPED` is Planner-only. Verify mapper exhaustiveness check still passes (TS narrowing); part 2 adds `SKIPPED` to local-only status branch.

---

## §2 Generator schema dependencies (code changes deferred to part 2 post-decoupling)

**Plan-PR amendment posture:** all generator code changes from the original §2 draft are **deferred to part 2** per Condition 2 of the conditional approval. Two reasons drove the deferral:

1. **Volumetric projection missing (v0.3 skill discipline).** The original §2 sketches changed the bulk-INSERT WHERE clause to add `NOT EXISTS` against `subscription_exceptions` per row and added a `COALESCE(...)` address-resolution sub-SELECT per row. At the 14-day horizon × per-tenant subscription counts (845 subs/Tue today, 1000+/merchant projected by Day 14), the per-row sub-SELECT cost was never measured. The Day-14 cron-decoupling plan PR will reshape the materialization path entirely — measuring this cost against an unstable target is wasted work.
2. **Generator changes are useless without service-layer creating the exception rows.** A `NOT EXISTS … FROM subscription_exceptions` clause does nothing if no service can INSERT exceptions; address rotation honoring does nothing if no API can configure rotations. Both depend on part-2 service surface. Landing the generator changes in part 1 ships dead code.

This §2 therefore **declares schema dependencies only** — what tables/columns part-1 lands so part-2 generator work has the surface it needs. No code sketches; no `INSERT … SELECT` rewrites; no WHERE-clause edits; no test coverage in part-1 §5.

### §2.1 Schema-dependency declarations (what part-1 lands so part-2 generator can use)

Part-1 schema additions consumable by part-2 generator code:

| Schema artifact (part-1 §1) | Part-2 generator behavior it enables |
|---|---|
| `addresses` table (§1.3) | Lookup of consignee primary address; address-by-id resolution for one-off / forward overrides |
| `subscription_address_rotations` table (§1.4) | Per-weekday address rotation lookup at materialization time |
| `tasks.address_id` nullable column (§1.3.1) | Generator INSERTs land the resolved address_id per the rotation/override-resolution rules part-2 implements |
| `subscription_exceptions` table (§1.1) | Generator's WHERE clause gains `NOT EXISTS` checks against this table for skip + pause_window exclusion (part-2 design) |
| `subscription_materialization` table (§1.2) | Per-subscription horizon-advance bookkeeping for the 14-day horizon walk (part-2 design) |
| `tasks_internal_status_check` extension (§1.9) — `SKIPPED` value | Generator can choose to insert SKIPPED placeholder rows OR no-INSERT entirely; decision deferred to part 2 |

### §2.2 Decisions deferred to the Day-14 part-2 plan/code PR

Originally proposed at this plan stage; **moved out of plan scope** under Condition 2:

- Address-rotation-honoring SQL shape (LATERAL vs sub-SELECT vs LEFT JOIN — needs volumetric projection)
- Schema-aware skip / pause exception application at WHERE-clause level (needs measurement against the post-decoupling cron shape)
- One-off vs forward address-override resolution precedence inside the materialization SELECT
- SKIPPED-placeholder-INSERT vs no-INSERT decision when generator-time exceptions exist (originally a plan-stage decision; deferred to part-2 design where it can be measured against UI calendar-rendering needs from Day-15 wireframes)
- 14-day horizon advance loop logic — explicitly part of the Day-14 cron decoupling T3 plan PR per [memory/followups/cron_materialization_push_coupling.md](../followups/cron_materialization_push_coupling.md) §5

### §2.3 What part 1 does NOT touch in `src/modules/task-generation/`

Zero code changes to:
- [`src/modules/task-generation/repository.ts`](../../src/modules/task-generation/repository.ts) — `bulkInsertTasksForSubscriptions` and `countMatchingSubscriptions` stay as-is
- [`src/modules/task-generation/service.ts`](../../src/modules/task-generation/service.ts) — `generateTasksForWindow` stays as-is
- [`src/modules/task-generation/types.ts`](../../src/modules/task-generation/types.ts) — type surface stays as-is

Part-1 part of the cron path is schema-only; generator code touches start in part 2 (after Day-14 cron decoupling plan PR locks the post-decoupling cron shape).

**Note (race-condition diagnostic):** today's race-condition findings in [memory/followups/cron_materialization_push_coupling.md](../followups/cron_materialization_push_coupling.md) §3 do not change part-1 scope. The `(tenant_id, target_date)` UNIQUE on `task_generation_runs` and the materialization↔push decoupling are own T3 plan PR work for Day 14.

---

## §3 Audit event registrations

Per brief [§3.1.2](../PLANNER_PRODUCT_BRIEF.md). Add to `src/modules/audit/event-types.ts`. **Count locked at 9** per Condition 4 of plan-PR conditional approval (brief is source of truth). T1 follow-up memo will amend the bootstrap brief reference from "8" to "9" after this plan PR merges, so the next session does not re-encounter the drift.

Each event below: payload shape + `systemOnly` flag (per brief §3.1.3 — `merchant.*` events are Transcorp-staff scoped; consignee/subscription events are merchant-operator).

| # | Event type | Payload fields | `systemOnly` | Notes |
|---|---|---|---|---|
| 1 | `subscription.exception.created` | `subscription_id, exception_id, type, target_date, compensating_date, correlation_id` | false | Emitted in same tx as `subscription.end_date.extended` for skip flow |
| 2 | `subscription.end_date.extended` | `subscription_id, previous_end_date, new_end_date, correlation_id, triggered_by ('skip' \| 'pause_resume' \| 'append_without_skip')` | false | Causally related events share `correlation_id` per brief §7 |
| 3 | `subscription.address_override.applied` | `subscription_id, exception_id, target_date OR effective_from, address_id` | false | one-off vs forward distinguished by which date field is populated |
| 4 | `subscription.paused` | `subscription_id, pause_start, pause_end` | false | shares correlation_id with paired `end_date.extended` |
| 5 | `subscription.resumed` | `subscription_id, actual_resume_date, new_end_date, correlation_id` | false | actor=user (manual) or system (auto-resume scheduler) |
| 6 | `consignee.crm_state.changed` | `consignee_id, from_state, to_state, reason` | false | |
| 7 | `merchant.created` | `tenant_id, slug, name, pickup_address` | **true** | Transcorp-staff only. Tenant lands in `'provisioning'` (DB default per §1.7.1); event represents the row creation, not state transition |
| 8 | `merchant.activated` | `tenant_id, from_status: 'provisioning', to_status: 'active'` | **true** | Transcorp-staff only. Represents `provisioning → active` transition (lowercase per §1.7.1 prod canon) |
| 9 | `merchant.deactivated` | `tenant_id, from_status: 'active', to_status: 'inactive'` | **true** | Transcorp-staff only. Represents `active → inactive` transition (lowercase per §1.7.1 prod canon) |

**Correlation_id contract:** per brief §7 — the skip flow emits events 1 and 2 in the same database transaction with shared `correlation_id` (uuid v7). Pause flow emits events 4 and 2. Resume flow emits event 5 with the same `correlation_id` as the originating pause's event 2. **Service-layer enforcement is part 2.** Part 1 lands the audit registrations only.

**Vocabulary precedent:** existing audit events follow `<resource>.<action>` shape (e.g., `task.created`, `task.bulk_generated`, `tenant.push_skipped`). New events follow same pattern. No registration shape changes.

**Audit-failed-attempts gap** (per [followup_audit_failed_attempts.md](../followup_audit_failed_attempts.md)): part-1 audit registrations cover SUCCESS events only. Denied-event vocabulary (`subscription.exception.denied`, etc.) for permission-failed paths is part 2.

---

## §4 Permissions catalogue additions

Per brief [§3.1.3](../PLANNER_PRODUCT_BRIEF.md). Add to `src/modules/identity/permissions.ts`. Counted: 10 permissions across 3 resource categories.

| # | Permission | Resource:action | Role mapping |
|---|---|---|---|
| 1 | `subscription:skip` | apply default skip with tail-end append | `tenant_admin`, `operations_manager`, `customer_service_agent` |
| 2 | `subscription:override_skip_rules` | apply skip overrides (move-to-date, skip-without-append, append-without-skip) | `tenant_admin`, `operations_manager` (NOT `customer_service_agent`) |
| 3 | `subscription:change_address_rotation` | edit per-weekday address rotation | `tenant_admin`, `operations_manager`, `customer_service_agent` |
| 4 | `subscription:change_address_one_off` | one-off address override for single delivery | `tenant_admin`, `operations_manager`, `customer_service_agent` |
| 5 | `subscription:change_address_forward` | forward-going address override | `tenant_admin`, `operations_manager`, `customer_service_agent` |
| 6 | `consignee:change_crm_state` | transition consignee CRM state | `tenant_admin`, `operations_manager`, `customer_service_agent` |
| 7 | `merchant:create` | create new merchant tenant | `transcorp_staff` |
| 8 | `merchant:read_all` | list/inspect all merchant tenants | `transcorp_staff` |
| 9 | `merchant:activate` | flip `tenant.status` from `'provisioning'` to `'active'` (lowercase per §1.7.1 prod canon) | `transcorp_staff` |
| 10 | `merchant:deactivate` | flip `tenant.status` from `'active'` to `'inactive'` (lowercase per §1.7.1 prod canon) | `transcorp_staff` |

**Existing permissions referenced** (no add, just confirmation): `subscription:pause`, `subscription:resume` already in catalogue per brief §3.1.3.

**Demo posture:** brief §3.1.3 — demo accounts log in as `tenant_admin` for narrative simplicity; role-distinction is catalogue-level for Q&A. Catalogue permissions ship in part 1; UI permission-rendering rules (hide / disable+tooltip / never silent fail) are part 2 scope.

**Three-layer enforcement** (brief §3.4):
1. **Middleware** declares required permission on every API route — part 2 (routes don't exist yet)
2. **Service layer** re-asserts via `requirePermission(ctx, '<perm>')` — part 2 (service methods don't exist yet)
3. **RLS** as backstop — part 1 lands every new tenant-scoped table with RLS (§1)

---

## §5 Test coverage

### §5.1 Skip-and-append worked examples

Per brief [§3.1.6](../PLANNER_PRODUCT_BRIEF.md) — four canonical cases. Test the `computeCompensatingDate` helper (sketched in brief, lives in `src/modules/subscription-exceptions/skip-algorithm.ts` — net-new module).

| # | Subscription shape | Skip date | Expected compensating date |
|---|---|---|---|
| 1 | Mon-Fri, end Fri 15 May 2026 | Wed 6 May | Mon 18 May |
| 2 | Mon/Wed/Fri, end Fri 15 May | Wed 6 May | Mon 18 May |
| 3 | Tue/Fri, end Fri 15 May | Tue 6 May | Tue 19 May (next eligible after 15 May = Tue 19 May; brief example is Tue 19 May) |
| 4 | Mon-Fri, end Fri 15 May, double-skip Tue 5 May AND Thu 7 May | (two) | Mon 18 May AND Tue 19 May, end_date = 19 May |

**Verification on case 3:** brief §3.1.6 worked example says "Tue/Fri ending Fri 15 May, skip Tue 6 May → appended Tue 19 May." Algorithm walks from 15 May +1 = Sat 16 May (not Tue/Fri, skip), Sun 17 (not, skip), Mon 18 (not, skip), Tue 19 (yes — eligible). ✓

### §5.2 Edge case coverage (brief §3.1.6 A–I)

| Edge | Test |
|---|---|
| A. Compensating date lands on blackout | Roll forward to next eligible non-blackout day; assert helper handles blackout-set parameter |
| B. Multiple skips in close succession | Stacking: each transactional read of current end_date extends from there. Tested at service layer (part 2); part-1 test uses pure-helper inputs to verify monotonic stacking |
| C. Operator double-tap / retry | Idempotency UNIQUE constraint on `(subscription_id, idempotency_key)` — part-1 test inserts with same key twice, asserts 23505 raised |
| D. Skip exhausts max_skips_per_subscription | Hard-cap parameter to helper; reject if `existing_skip_count >= cap`. (Configurable per merchant is Phase 2 — hardcoded cap or unlimited for MVP per brief §4) |
| E. Skip near original end_date | Always tail-end; covered by case 1 |
| F. Subscription currently paused | Reject; helper throws or returns `kind: 'rejected'`. Service-layer test (part 2) wraps |
| G. Skip on past date | Reject; helper validates `targetDate >= today` |
| H. Skip on very last delivery | Algorithm extends end_date by exactly one slot; case 1 covers tail boundary |
| I. Skip on multi-task date | MVP not relevant (1 sub = 1 task/date); helper operates per-subscription-task |

### §5.3 RLS isolation tests

Per brief [§3.4](../PLANNER_PRODUCT_BRIEF.md). Every new tenant-scoped table needs an RLS isolation test.

**Test pattern** (mirrors existing tests at `tests/integration/`):
1. Set `app.current_tenant_id` to tenant A's UUID
2. INSERT row with `tenant_id = A`
3. Set `app.current_tenant_id` to tenant B's UUID
4. SELECT — assert row count = 0
5. Attempt INSERT/UPDATE/DELETE on A's row from B's session — assert 0 rows affected

Tables requiring RLS isolation tests:
- `subscription_exceptions`
- `subscription_materialization`
- `subscription_address_rotations`
- `consignee_crm_events`
- `addresses`
- `webhook_events`
- `consignee_timeline_events` (view — verify RLS inherits from underlying tables; specifically that rows from B's `consignee_crm_events` don't leak into A's view query)

### §5.4 CHECK constraint coverage

Per-table CHECK assertions:
- `subscription_exceptions.exc_address_override_requires_address_id` — INSERT type=`address_override_one_off` with NULL address_override_id → expect 23514
- `subscription_exceptions.exc_pause_window_requires_end_date` — INSERT type=`pause_window` with NULL end_date → expect 23514
- `subscription_exceptions.exc_skip_without_append_only_for_skip` — INSERT type=`pause_window` with skip_without_append=true → expect 23514
- `addresses.label` CHECK — INSERT label='invalid' → expect 23514
- `addresses.is_primary` partial UNIQUE — INSERT two `is_primary=true` rows for same consignee → expect 23505
- `subscription_address_rotations.weekday` CHECK — INSERT weekday=8 → expect 23514
- `subscription_address_rotations` `(subscription_id, weekday)` UNIQUE — duplicate INSERT → expect 23505
- `consignees.crm_state` CHECK — UPDATE crm_state='INVALID' → expect 23514
- `tenants.status` CHECK — UPDATE status='UNKNOWN' → expect 23514
- `webhook_events_dedup_idx` UNIQUE — duplicate INSERT for same `(suitefleet_task_id, action, event_timestamp)` → expect 23505
- `tasks_internal_status_check` (extended) — UPDATE internal_status='SKIPPED' → expect success; INSERT internal_status='UNKNOWN' → expect 23514

### §5.5 Generator-side tests — deferred to part 2

Originally proposed (rotation honoring, schema-aware skip exclusion, schema-aware pause exclusion). **Removed from part-1 scope** under Condition 2 of conditional approval — generator code changes ship in part 2, so the corresponding tests ship there too. Listed in §6 part-2 scope for traceability.

### §5.6 `tasks.address_id` schema-only test (column-add only)

The column lands in part-1 but is not yet populated by any code path. Single test asserts:
- `INSERT INTO tasks (… , address_id, …) VALUES (…, NULL, …)` succeeds (nullability locked per §1.3.1)
- `INSERT INTO tasks (… , address_id, …) VALUES (…, '<existing addresses.id>', …)` succeeds (FK accepts valid uuid)
- `INSERT INTO tasks (… , address_id, …) VALUES (…, '<random uuid>', …)` fails with FK violation 23503
- `DELETE FROM addresses WHERE id = '<id-referenced-by-task>'` fails with FK violation 23503 (ON DELETE RESTRICT)

---

## §6 Out of scope (part 2 / Day 14 / Day-14-decoupling-plan-PR)

### Part 2 (Day 14) — service layer + API routes + generator updates

Per brief [§3.1.4](../PLANNER_PRODUCT_BRIEF.md) + [§3.1.9](../PLANNER_PRODUCT_BRIEF.md):

**Service layer + API routes:**
- `addSubscriptionException(ctx, subscriptionId, params)` service — full transactional flow with permission checks per type, audit emit pairs sharing correlation_id, idempotency check at the API boundary, cut-off enforcement
- `pauseSubscription(ctx, subscriptionId, params)` service + auto-resume scheduler
- `resumeSubscription(ctx, subscriptionId, params)` service
- `changeConsigneeCrmState(ctx, consigneeId, params)` service with state-transition validity rules
- `createMerchant(ctx, params)` / `activateMerchant` / `deactivateMerchant` services (Transcorp-staff scoped)
- `appendWithoutSkip(ctx, subscriptionId, params)` service
- All `/api/admin/merchants/*`, `/api/consignees/[id]/crm-state`, `/api/consignees/[id]/timeline`, `/api/subscriptions/[id]/skip|pause|resume|append-without-skip|address-rotation|address-override` routes
- Idempotency-key request boundary enforcement (UNIQUE in §1.1 catches at DB; API boundary returns 409 cleanly)
- Cut-off enforcement (hardcoded 18:00 local day-before; part 2)
- Webhook deduplication wiring (§1.8 schema lands; part-2 receiver code uses it)
- Integration tests covering end-to-end skip / pause / address override flows
- Denied-event audit vocabulary (per [followup_audit_failed_attempts.md](../followup_audit_failed_attempts.md))
- Brief amendment — single combined PR covers BOTH §0.3 column-name decision (one-line per recommended Option A) AND §1.7.1 `tenants.status` realignment to prod's 4-state lowercase canon
- **`tenants.status = 'suspended'` service surface decision** (per §1.7.1) — deferred to part-2: decide whether `'suspended'` becomes an additional service action surface (e.g. `merchant:suspend` permission + `suspendMerchant` service + audit event) OR stays operationally-set-only (DB-only state, no API). Default posture if undecided: stays reserved, no part-2 service work, revisit Phase 2.

**Generator code changes (deferred from part-1 §2 under Condition 2 — sequenced after Day-14 cron decoupling plan PR locks the post-decoupling cron shape):**
- Address rotation honoring inside `bulkInsertTasksForSubscriptions` — LATERAL vs sub-SELECT vs LEFT JOIN shape locked after volumetric projection against post-decoupling cron
- Schema-aware skip exclusion at WHERE clause (`NOT EXISTS` against `subscription_exceptions(type='skip', start_date=targetDate)`)
- Schema-aware pause exclusion at WHERE clause (`NOT EXISTS` against `subscription_exceptions(type='pause_window'…)`)
- One-off vs forward address-override resolution precedence inside the materialization SELECT
- SKIPPED-placeholder-INSERT vs no-INSERT decision (originally proposed at part-1 plan stage; deferred to part-2 design where it can be measured against UI calendar-rendering needs from Day-15 wireframes)
- 14-day horizon advance loop logic — explicitly shared scope with Day-14 cron decoupling T3 plan PR per [memory/followups/cron_materialization_push_coupling.md](../followups/cron_materialization_push_coupling.md) §5
- Generator-side test additions (address rotation, skip exclusion, pause exclusion — originally part-1 §5.5; moved here for traceability)

### UI (Day 15+)

All operator surfaces — onboarding wizard, consignee detail with calendar, consolidated calendar, subscription detail with override workflows, consignee timeline view, Transcorp-staff admin (per brief §3.2 / §3.3).

### Day-14 own T3 plan PR — cron decoupling

Per [memory/followups/cron_materialization_push_coupling.md](../followups/cron_materialization_push_coupling.md):
- Materialization↔push decoupling (separate the bulk INSERT phase from the per-task SF push phase)
- 14-day horizon advance loop (replaces today's next-day-only generator)
- `(tenant_id, target_date)` UNIQUE on `task_generation_runs` (Run-A/Run-B race hardening)
- LastMileAdapter interface boundary changes
- Push retry/idempotency posture
- `tasks.pushed_to_external_at` (or `suitefleet_push_acknowledged_at` per §0.3) consumed as the integration-honesty contract surface

**Tier discipline** ([brief §7](../PLANNER_PRODUCT_BRIEF.md)): no two T3 plan PRs open simultaneously. Day-14 decoupling plan PR drafts ONLY after this Day-13 plan PR is approved + part-1 code PR opens.

### Phase 2 (post-MVP) deferrals filed per brief §4

Listed only for traceability; no part-1 work:
- Configurable cutoff time per merchant
- Configurable max_skips_per_subscription per merchant
- Per-merchant blackout date editor
- Notes / loyalty tier / merchant-internal-ID on consignee
- `consignees` inline address column deprecation (depends on §1.3 backfill landing first)
- Phone display readability follow-up ([followup_phone_display_readability.md](../followup_phone_display_readability.md))
- Audit-rule cascade conflict resolution ([followup_audit_rule_cascade_conflict.md](../followup_audit_rule_cascade_conflict.md))

---

## §7 Risks + watch items for the part-1 code PR

| Risk | Mitigation in part 1 |
|---|---|
| Migration drift between local and prod ([followup_migration_drift_check.md](../followup_migration_drift_check.md)) | §0.2 verification queries lock prod state before §1 declares net-new vs column-add |
| Audit-rule cascade conflict on tenant DELETE ([followup_audit_rule_cascade_conflict.md](../followup_audit_rule_cascade_conflict.md)) | New tables use ON DELETE CASCADE on tenant_id but carry no audit-rule themselves; flagged |
| Backfilling `addresses` from `consignees` inline fields concurrent-write race | Migration runs in maintenance window or wraps backfill in single tx; surface execution sequencing at code-PR review |
| `consignee_timeline_events` view performance under load | View MVP-acceptable per brief §3.1.1; denormalize Phase 2 if needed |
| `tasks.address_id` column ships nullable but eventually wants NOT NULL | Locked nullable per §1.3.1; Phase 2 promotes to NOT NULL after backfill sweep validates 100% population (single-statement `ALTER TABLE … SET NOT NULL`) |
| `tasks.address_id ON DELETE RESTRICT` blocks clean address delete | Phase-2 UI delete-address flow must enumerate references (across both `subscription_address_rotations` and `tasks`) and prompt operator |
| `subscription_address_rotations.address_id ON DELETE RESTRICT` blocks clean address delete | Phase-2 UI delete-address flow must enumerate references and prompt operator |
| Migration filename split (six files) vs bundle (one file) | Surfaced in §0.5; reviewer decides at part-1 review |
| `tenants.status` 2-step lifecycle (`provisioning → active`) creates a window where new tenants exist but can't yet be operated on | Service-layer (part-2) `createMerchant` returns the row in `'provisioning'`; UI surfaces "Pending activation" badge; `activateMerchant` is a separate Transcorp-staff action. Cron eligibility filter (`suitefleet_customer_code IS NOT NULL`) is independent of `status` — but part-2 should consider extending the filter to `status = 'active'` so `'provisioning'` tenants don't enter the cron walk before activation completes. |
| `tenants.status = 'suspended'` semantics undefined for MVP | Per §1.7.1 + §6: reserved; service surface decision deferred to part-2. Default if undecided: DB-only state, no API. |
| 340 prod rows in `'provisioning'` (likely stale test tenants per [followup_audit_rule_cascade_conflict.md](../followup_audit_rule_cascade_conflict.md)) noisy in admin merchant-list view | Part-2 admin merchant-list filters default to `status IN ('active', 'suspended')`; Transcorp staff opt-in to view `'provisioning'` / `'inactive'` rows. Stale-tenant cleanup remains the upstream resolution path (out of part-1 + part-2 scope). |

---

## §8 Cross-references

- [PLANNER_PRODUCT_BRIEF.md](../PLANNER_PRODUCT_BRIEF.md) — §3.1.1 schema, §3.1.2 audit, §3.1.3 permissions, §3.1.4 service surface (part-2 reference), §3.1.5 horizon, §3.1.6 skip algorithm, §3.4 RLS three-layer, §7 tier discipline + idempotency + correlation_id
- [memory/followups/cron_materialization_push_coupling.md](../followups/cron_materialization_push_coupling.md) — Day-14 decoupling sequencing dependency
- [memory/followup_migration_drift_check.md](../followup_migration_drift_check.md) — §0.2 motivation
- [memory/followup_audit_rule_cascade_conflict.md](../followup_audit_rule_cascade_conflict.md) — FK cascade caveat
- [memory/followup_audit_failed_attempts.md](../followup_audit_failed_attempts.md) — denied-event vocabulary part-2 work
- [memory/decision_task_module_no_user_create_delete.md](../decision_task_module_no_user_create_delete.md) — bimodal create/delete posture; relevant to part-2 service surface
- [supabase/migrations/0006_task.sql](../../supabase/migrations/0006_task.sql) — `tasks_internal_status_check` current values; `pushed_to_external_at` existing column
- [supabase/migrations/0004_consignee.sql](../../supabase/migrations/0004_consignee.sql) — Phase-2 deferral comment that §1.3 lifts
- [src/modules/task-generation/repository.ts](../../src/modules/task-generation/repository.ts) — generator surface that **part-2** modifies (no part-1 code touch under Condition 2)
- [src/modules/tasks/repository.ts:531-543](../../src/modules/tasks/repository.ts#L531-L543) — `markTaskPushed` UPDATE that locks the §0-Q9 semantic of `pushed_to_external_at`
- [src/modules/task-push/service.ts](../../src/modules/task-push/service.ts) — call sites at L723–728 (cron-loop) + L1098–1104 (single-task) that confirm §0-Q9 ordering (mark-pushed AFTER SF 2xx)

---

## §9 Plan-PR review checklist

For the reviewer (Love) at plan-PR review time. Items previously surfaced but locked under conditional-approval Conditions 1–5 are crossed out for traceability.

- [x] §0.2 prod queries (Q1–Q8) run; results pasted as PR comment; §0.4 net-new/column-add classification confirmed against actuals **— complete; one drift (Q1 `tenants.status` already in prod) drove §1.7 amendment**
- [x] §0-Q9 code-read confirmation pasted in PR comment (locked at amendment time; reviewer re-confirms via the file:line anchors) **— complete; builder re-verified on `origin/main` HEAD `18bbb2a`**
- [ ] §0.3 column-name decision locked (Option A keep, Option B rename, or Option C add-new — Option A is the recommendation; if reviewer chooses B/C, scope grows)
- [ ] §0.5 migration filename split confirmed (split 6 files vs bundle 1 file) — note: `0017` rename to `0017_tenants_pickup_address.sql` per §1.7 amendment
- [ ] §1.3 `addresses` backfill posture confirmed (single migration tx OK vs maintenance window)
- [ ] §1.5 CRM state list match against brief confirmed (verification pasted in PR comment per Condition 5; Love pastes after §1.7 amendment lands per latest sync)
- [ ] §1.6 view vs denormalized table confirmed (view OK for MVP)
- [ ] §1.7 prod canon adoption confirmed (4-state lowercase `provisioning` / `active` / `suspended` / `inactive`; original 2-state uppercase proposal dropped)
- [ ] §6 part-2 scope boundary confirmed; cron-decoupling sequencing acknowledged; `'suspended'` service surface decision deferred to part-2 acknowledged
- [ ] **Brief amendment PR (combined per §6)** queued — single combined small PR covers BOTH §0.3 column-name decision (Option A) AND §1.7.1 `tenants.status` 4-state lowercase realignment. Filed after part-1 code PR opens.
- [ ] T1 follow-up memo queued: amend bootstrap brief reference from "8" to "9" audit events (per Condition 4) — after this plan PR merges

**Locked under Conditional Approval — no longer reviewer decisions:**
- ~~§2.1 `tasks.address_id` nullability~~ → **locked nullable** at plan stage (Condition 3); see §1.3.1 + §7
- ~~§2.2 SKIPPED-vs-no-INSERT decision~~ → **deferred to part-2** under Condition 2; see §6 part-2 scope
- ~~§3 audit event count clarification~~ → **locked at 9** per Condition 4 (brief is source of truth); §3 lead text updated
- ~~§2 generator code changes~~ → **deferred to part-2** under Condition 2; §2 now declares schema dependencies only

After approval: T3 hard-stop #1 clears. Love runs §0.2 prod verification queries (now including §0-Q9 code read). Plan PR merges. Part-1 code PR opens for T3 hard-stop #2 verification-only counter-review.

---

**End of plan.**

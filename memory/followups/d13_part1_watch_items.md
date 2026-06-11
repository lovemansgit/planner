---
name: Day-13 part-1 reviewer watch-items (filed at PR #139 approval)
description: Two non-blocker watch-items raised by the reviewer at the part-1 code PR (#139) approval. Both are deferrals — no schema change in part 1, file the memo so the part-2 plan PR (or future hardening) picks them up. Item 1: subscription_address_rotations lacks created_at/updated_at; add if rotations gain edit history. Item 2: webhook_events.received_at is unindexed; add if operator drill-down ever filters by receipt-time window.
type: project
---

# Day-13 part-1 reviewer watch-items

**Filed:** Day 13 (5 May 2026), PR #139 approval moment.
**Severity:** Low. Neither blocks part-1 ship; both gated on part-2 / Phase-2 surface materialising the need.

---

## Item 1: `subscription_address_rotations` lacks `created_at` / `updated_at`

**Migration anchor:** [supabase/migrations/0014_addresses_and_subscription_address_rotations.sql](../../supabase/migrations/0014_addresses_and_subscription_address_rotations.sql) §2.

**Current shape** (5 columns):

```sql
CREATE TABLE subscription_address_rotations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  weekday         int  NOT NULL,
  address_id      uuid NOT NULL REFERENCES addresses(id) ON DELETE RESTRICT,
  CONSTRAINT subscription_address_rotations_weekday_check
    CHECK (weekday BETWEEN 1 AND 7)
);
```

**Why no timestamps shipped in part 1:** the brief's data-shape description for this table ([PLANNER_PRODUCT_BRIEF.md §3.1.1](../PLANNER_PRODUCT_BRIEF.md)) lists `id, subscription_id, tenant_id, weekday, address_id` only. Audit of rotation edits flows via `audit_events` rows (per the brief's three-layer audit posture), not via timestamp columns on the row itself.

**When to add:** if the part-2 (Day-14) `subscription:change_address_rotation` service surface gains an "edit history" view that needs to render "rotation last changed N days ago" without joining `audit_events`. Until then, `audit_events` is the canonical source of "when did this rotation entry get touched?"

**Migration shape if/when added** (single-statement, post-MVP — 0020+ migration):

```sql
ALTER TABLE subscription_address_rotations
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TRIGGER subscription_address_rotations_set_updated_at
  BEFORE UPDATE ON subscription_address_rotations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
```

DEFAULT now() is safe to backfill — existing rows get the migration timestamp, which is approximately-correct (within a day) for the small population that exists pre-add.

**Decision deferral location:** Day-14 part-2 plan PR §2 (when the service surface for rotation edits is being designed). If that plan opts for a "last-edited" UI element, this memo's migration sketch lands as part of the part-2 schema delta.

---

## Item 2: `webhook_events.received_at` is not indexed

**Migration anchor:** [supabase/migrations/0018_webhook_events.sql](../../supabase/migrations/0018_webhook_events.sql).

**Current index strategy** (3 indexes):

| Index | Purpose |
|---|---|
| `webhook_events_dedup_idx UNIQUE (suitefleet_task_id, action, event_timestamp)` | Brief §3.1.10 deduplication anchor |
| `webhook_events_tenant_idx (tenant_id)` | RLS predicate path |
| `webhook_events_task_idx (suitefleet_task_id)` | Operator drill-down "show all webhook activity for SF task X" |

**Why no `received_at` index in part 1:** no operator workflow in the brief's MVP UI scope (§3.3) filters by webhook receipt-time window. Drill-downs are by SF task id (already indexed) or by tenant (already indexed). The dedup UNIQUE on `event_timestamp` covers the SF-side timestamp; `received_at` is OUR receipt-side timestamp and serves only forensic-trace queries today.

**When to add:** if a future operator surface adds "show webhooks received between time X and time Y" — e.g., a webhook-receipt timeline in the admin webhook-config page (`memory/decision_failed_payload_dlq_split.md` references a Phase-2 admin UI). Or if support escalation queries start needing "what did we receive in the last 5 minutes?" sweeps regularly.

**Migration shape if/when added** (single-statement, post-MVP):

```sql
CREATE INDEX webhook_events_received_at_idx
  ON webhook_events (received_at DESC);
```

`DESC` matches operational query intent ("most recent first"); Postgres can scan either direction but the explicit DESC is self-documenting (same posture as `task_generation_runs_tenant_started_idx` from 0012).

**Decision deferral location:** Phase-2 webhook admin UI plan, or whichever PR introduces a `received_at`-filtered query in service code. Either trigger surfaces the index gap as a measurable performance need (sequential scan over append-only history); the index lands at the same time as the consuming query.

---

## Cross-references

- [memory/plans/day-13-exception-model-part-1.md](../plans/day-13-exception-model-part-1.md) — part-1 plan that intentionally omitted both columns/indexes from scope
- [PLANNER_PRODUCT_BRIEF.md §3.1.1, §3.1.10](../PLANNER_PRODUCT_BRIEF.md) — brief's data-shape source-of-truth
- [supabase/migrations/0014_addresses_and_subscription_address_rotations.sql](../../supabase/migrations/0014_addresses_and_subscription_address_rotations.sql)
- [supabase/migrations/0018_webhook_events.sql](../../supabase/migrations/0018_webhook_events.sql)

---
name: MP-13 cascade-cancel gap — consignee deactivation does not cancel pending tasks
description: MP-13 rule ("consignee deactivation cancels pending tasks") is not yet enforced in the codebase. Two structural reasons (no deactivated_at column on consignees; tasks → consignees FK is ON DELETE RESTRICT). C-7 ships the named test pinning current behavior + this memo. Resolution scoped for Day 8/9.
type: project
---

# MP-13 cascade-cancel gap

**Captured:** 2 May 2026 (Day 7 / C-7)
**Named test pinning current state:** `tests/unit/mp-13-consignee-deactivation-cancels-tasks.spec.ts`
**Resolution scope:** Day 8/9, depends on schema migration scope decision

---

## The rule (as stated in the brief)

> "When a consignee is deactivated, all pending tasks for that consignee transition to CANCELLED."
> — `plan-resolutions.docx §3 Day 7` row, MP-13.

## Why the rule is not enforceable today

Two structural reasons in the current schema:

### 1. There is no "deactivation" concept in `consignees`

`consignees` (0004) has no `deactivated_at` column or `is_active` flag. The only "remove a consignee" operation is hard-delete. The MP-13 rule's wording ("deactivation cancels pending tasks") implies a soft-state distinct from delete — which doesn't exist.

### 2. `tasks → consignees` FK is `ON DELETE RESTRICT`

Per `0006_task.sql`:

```sql
consignee_id  uuid NOT NULL REFERENCES consignees(id) ON DELETE RESTRICT
```

A consignee with active tasks **cannot be hard-deleted at all** today — Postgres aborts the delete with SQLSTATE 23503. Even if a future cascade-cancel implementation transitions all pending tasks to `internal_status='CANCELED'`, the cancelled task rows still REFERENCE the consignee row, so RESTRICT still blocks the parent delete.

This is the gap the C-7 named test (`tests/unit/mp-13-consignee-deactivation-cancels-tasks.spec.ts`) pins as Path 2 ("FK violation propagates").

## Resolution options

### Option A — Soft-delete via `deactivated_at` (recommended)

- New migration: `ALTER TABLE consignees ADD COLUMN deactivated_at timestamptz`.
- New service method `deactivateConsignee(ctx, id)`:
  1. SET `deactivated_at = now()` on the consignee row.
  2. Find all pending tasks (`internal_status NOT IN ('DELIVERED', 'FAILED', 'CANCELED')`) for this consignee.
  3. Transition each to `internal_status = 'CANCELED'` via the existing task update path.
  4. Emit per-task `task.updated` event with metadata `{ changed_fields: ["internal_status"], previous_status, new_status: "CANCELED", reason: "consignee_deactivated" }`.
  5. Emit a new `consignee.deactivated` audit event with metadata `{ consignee_id, cancelled_task_count }`.
- New audit event needed: `consignee.deactivated` (systemOnly: false; subject to the existing `consignee:delete` permission OR a new `consignee:deactivate` if RBAC distinction is wanted).
- Cron and other readers filter consignees by `deactivated_at IS NULL` going forward.
- Hard-delete (`deleteConsignee`) stays as the "permanent destruction" path; the FK RESTRICT still applies (you can't permanently destroy a consignee with task history).

**Pros**: preserves task history; reversible (set `deactivated_at = NULL` to reactivate); doesn't require FK changes.
**Cons**: every consignee read needs to filter on `deactivated_at IS NULL` (one more index column, one more WHERE predicate everywhere).

### Option B — `ON DELETE CASCADE`

- Migration: `ALTER TABLE tasks DROP CONSTRAINT tasks_consignee_id_fkey, ADD CONSTRAINT tasks_consignee_id_fkey FOREIGN KEY (consignee_id) REFERENCES consignees(id) ON DELETE CASCADE`.
- `deleteConsignee` would auto-delete all tasks for the consignee.

**Cons**: loses task history irrecoverably. Operationally dangerous — accidentally deleting an active consignee deletes their tasks (including DELIVERED ones with audit-trail value). Strongly NOT recommended.

### Option C — `ON DELETE SET NULL`

- Migration: change FK to `ON DELETE SET NULL` AND make `tasks.consignee_id` nullable.

**Cons**: invariant-breaking. `tasks.consignee_id` is currently `NOT NULL` because every task is for a consignee; orphan tasks (no consignee) are operationally meaningless. The composite CHECK from 0010 also assumes `consignee_id` is always set. NOT recommended.

## Recommended path: Option A

Soft-delete via `deactivated_at` is the only option that:
- Preserves task history
- Doesn't break existing schema invariants
- Maps naturally to the brief's "deactivation" wording
- Is reversible (operator can un-deactivate)

## Day 8/9 implementation scope

1. Migration `0013_consignee_deactivation.sql` — add `deactivated_at timestamptz` column + index `(tenant_id) WHERE deactivated_at IS NULL` for active-only reads.
2. New audit event `consignee.deactivated` in `src/modules/audit/event-types.ts`.
3. New service method `deactivateConsignee` in `src/modules/consignees/service.ts`.
4. New API route `POST /api/consignees/:id/deactivate` (vs. extending DELETE — different operations, different verbs).
5. Update consignee READS (list + getById) to filter on `deactivated_at IS NULL` by default; opt-in `?include_deactivated=true` for admin views.
6. Update cron's task-generation step (already C-2-merged) — `WHERE consignees.deactivated_at IS NULL`. NOTE: subscriptions already gate on `subscriptions.status = 'active'`, but a deactivated consignee's still-active subscriptions could otherwise generate tasks. Belt-and-braces.
7. Update `tests/unit/mp-13-consignee-deactivation-cancels-tasks.spec.ts` to assert the cascade-cancel happy path instead of the FK-violation gap.

Likely 1.0–1.5× the size of a normal T2 commit. Consider folding into Day-8's C-3 PR (which already touches the consignees side via the district migration) to amortise the schema-migration overhead.

## Aqib question (low priority)

Whether SF's webhook events care about cancelled tasks (e.g., does cancelling a task that was already pushed to SF require a `cancelTask` SF round-trip, or does internal-only CANCELED status suffice for the consignee-deactivation flow?). Current understanding: pre-push tasks (no `external_id`) just need internal status update; post-push tasks need SF cancellation too. The `cancelTask` adapter method doesn't exist yet (Day 8+ work). For pilot, deactivation triggered before any push happens is the common case.

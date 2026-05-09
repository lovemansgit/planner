---
name: Day-5 task module decision lock — v1 amendment for ad-hoc task creation
description: Amends decision_task_module_no_user_create_delete.md to permit user-actor task:create for ad-hoc creation flows under the Phase 1 merchant operator CRUD lane. Single createTask fn with dual-actor gating; preserves system-actor branch for cron + bulk import paths.
type: project
---

# Day-5 task module decision — v1 amendment

> **Amends:** [`memory/decision_task_module_no_user_create_delete.md`](decision_task_module_no_user_create_delete.md)
> **Date:** Day 19 (9 May 2026)
> **Trigger:** Phase 1 merchant operator CRUD lane plan-PR (Day-19 PM)

## §1 What's amended

Day-5 decision (30 April 2026) locked task creation as **system-only** with the rationale:

> "createTask/bulk system-only, only updateTask + reads are user-flow; T-5 ships 3 endpoints, not 6; no deleteTask method"

Day-5 framing assumed all user-facing task generation flows through subscription-driven cron materialization. The decision was correct **for the architecture as scoped at Day 5**.

## §2 Why amend now

Love's product vision (Day 19, verbatim):

> "There must also be a provision for merchants to create ad-hoc single tasks. So maybe having a checkbox (single task vs subscription) that can provide a single date or a date range option."

This is a **net-new operator product surface** that did not exist in the Day-5 framing. The May 15 internal CAIO demo narrative depends on operators having an ad-hoc task creation affordance for one-off deliveries that don't fit a subscription cadence (e.g., a single-occasion catering order, a sample delivery, a replacement for a missed delivery).

The Day-5 lock pre-dated:
- Demo narrative scoping (May 15 internal CAIO; May 18 external prospect)
- Operator product surface scoping (Day-17 EOD audit; Day-18 brief v1.7→v1.9 amendments)
- Phase 1 merchant CRUD lane (Day-19 PM)

## §3 New posture

**Single `createTask` fn with dual-actor gating.** NOT a separate `createTaskAsUser` fn.

```ts
// src/modules/tasks/service.ts (amended)

export async function createTask(ctx: RequestContext, input: CreateTaskInput): Promise<Task> {
  // System-actor branch (cron + bulk import + migration paths) — unchanged
  if (ctx.actor.kind === 'system') {
    assertTenantScoped(ctx, "task:create");
    // existing system-actor flow
  } else {
    // User-actor branch (operator ad-hoc creation) — NEW
    requirePermission(ctx, "task:create");
    assertTenantScoped(ctx, "task:create");
    // user-actor flow: same DB-insert path; SF push enqueued via QStash
  }
  // ... shared validation + insert + audit emit
}
```

### §3.1 Why single fn, not two

- **One wire path:** the validation + DB-insert + audit-emit logic is identical for system and user actors
- **One place for SF push to live:** the §G outbound push wires once at the end of createTask, regardless of actor branch
- **Test surface stays small:** test the dual-actor branching once; test the shared path once
- **Future-proof:** if Phase 2 adds another actor kind (API client, webhook callback), it slots into the same dispatch

### §3.2 New permission

`task:create` registered in [`src/modules/identity/permissions.ts`](../src/modules/identity/permissions.ts):

```ts
"task:create": {
  id: "task:create",
  resource: "task",
  action: "create",
  description: "Create a single task. Day 19 / Phase 1 amendment to Day-5 lock — operators can create ad-hoc one-off tasks for deliveries that don't fit a subscription cadence. System-actor branch (cron + bulk import) bypasses this perm via assertSystemActor.",
  systemOnly: false,
}
```

Granted to merchant operator roles (`ops-manager`, `cs-agent` — confirm in plan-PR §J OQ-5).

NOT in `API_KEY_FORBIDDEN_PERMISSIONS` (operator-facing perm; no API-key restriction).

## §4 What's NOT amended

- **`bulkCreateTasks` stays system-only.** Bulk creation remains a cron / migration / seed path; no operator product surface for bulk creation in v1. CSV bulk upload is Phase 2 per §H out-of-scope lock.
- **`deleteTask` does NOT exist.** Cancel via `internal_status='CANCELED'` is the operator-facing path (§G `cancelTask` + `bulkCancelTasks`). Hard delete remains system-only and unimplemented (audit posture).
- **System-actor branch behavior.** Cron + bulk import + migration paths use `assertSystemActor` and bypass `requirePermission`. Zero behavioral change for those paths.

## §5 Audit posture

`task.created` audit event captures `actor_kind`:

- `system` for cron/bulk-import/migration originated tasks
- `user` for operator ad-hoc creation

No schema change to audit_events. Existing `actor_kind` column on the audit row differentiates origins. Forensic query for operator-originated tasks:

```sql
SELECT * FROM audit_events
WHERE event_type = 'task.created' AND actor_kind = 'user'
ORDER BY occurred_at DESC;
```

## §6 Cross-references

- [`memory/decision_task_module_no_user_create_delete.md`](decision_task_module_no_user_create_delete.md) — original Day-5 lock
- [`memory/plans/day-19-phase-1-merchant-crud.md`](plans/day-19-phase-1-merchant-crud.md) §A1, §B, §K — Phase 1 plan-PR context
- [`memory/PLANNER_PRODUCT_BRIEF.md`](PLANNER_PRODUCT_BRIEF.md) §5 — demo narrative (May 15 / May 18)
- [`src/modules/tasks/service.ts:290`](../src/modules/tasks/service.ts#L290) — current createTask (system-only, pre-amendment)
- [`src/modules/identity/permissions.ts:331`](../src/modules/identity/permissions.ts#L331) — current Day-5 lock comment (will be replaced)

## §7 Rollback posture

If Phase 1 ships and operators don't use ad-hoc creation in production (zero `actor_kind='user'` task.created events over 2 weeks), the perm can be revoked from operator roles via single `roles.ts` edit + permission catalogue stays (`systemOnly: true` flag added). No code rollback needed; perm catalogue is the gate.

If a deeper rollback is ever needed: `assertSystemActor` is restored at the top of createTask; the user-actor branch + perm + audit posture all become dead code, removable in a single PR.

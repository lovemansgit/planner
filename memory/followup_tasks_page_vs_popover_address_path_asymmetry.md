---
name: /tasks Path A vs calendar-popover Path B — intentional MVP address-edit asymmetry
description: Two operator-facing surfaces produce different audit-lineage durable records for the same operator-facing intent ("change address for this delivery"). Per B2 plan-PR #308 §3.6 OQ-2 ruling, the asymmetry is intentional MVP scope and is documented here so future maintainers, operators, and ops auditors distinguish "two surfaces by design" from "drift between surfaces."
type: project
---

# Two surfaces, two paths

Same operator-facing intent — "change the address for this delivery" — produces different durable records depending on which surface the operator uses:

| Aspect | /tasks page (Path A) | Calendar popover (Path B) |
|---|---|---|
| **Service-fn called** | `updateTask(ctx, taskId, { addressId })` | `addSubscriptionException(ctx, subscriptionId, { type: "address_override_one_off", addressOverrideId, date })` |
| **Reach** | Both subscription-linked + ad-hoc tasks | Subscription-linked only (requires `subscriptionId`) |
| **Permission** | `task:update` | `subscription:change_address_one_off` |
| **`tasks.address_id`** | Updated directly | Updated indirectly (via the exception's effect on the task row) |
| **`subscription_exceptions` row** | NO row written | NEW row written with `type='address_override_one_off'` |
| **Audit events emitted** | `task.updated` with `metadata.changed_fields=['addressId']` | `subscription.exception.created` + `subscription.address_override.applied` (both correlated by `correlation_id`) |
| **Reversibility / lineage trace** | Audit-log query: `SELECT metadata FROM audit_events WHERE event_type='task.updated' AND resource_id=...` | Direct read: `SELECT * FROM subscription_exceptions WHERE subscription_id=... AND type='address_override_one_off'` |
| **SF outbound push** | Local-only today (per `memory/followup_address_edit_sf_outbound_gap.md`) | Local-only today (the exception path doesn't auto-trigger SF address push either) |

# Why the asymmetry is acceptable for MVP

1. **Uniform reach** at the /tasks page is operationally load-bearing — operators expect every row to have a working Edit button regardless of lineage. Path B can't deliver uniform reach without per-row dispatch + a disabled-state on ad-hoc rows. Unlike cancel (where the §3.6 OQ-1 ruling FORCED the disabled-state because both paths converge on the same SF outbound surface), edit-address has a working uniform alternative via Path A, so the disabled-state cost is unnecessary.
2. **Calendar popover Path B is workflow-specific.** Operators using the popover have already chosen the subscription context ("I'm here looking at a subscription's calendar; this delivery's address is wrong for the subscription's pattern"). The exception-model semantic ("this delivery is a one-off override of the subscription's address rotation") is meaningful at that surface and would be lost if collapsed to Path A globally.
3. **The audit trail bridges both surfaces.** Any operator or auditor asking "what did this task's address look like across its lifetime, and which surface changed it?" can answer via `audit_events.event_type` filtering. The two event-type vocabularies (`task.updated` vs `subscription.exception.created`) are themselves the disambiguator.
4. **Post-demo convergence is a separable follow-up.** If Transcorp wants surface-uniform audit lineage in v2, the migration is either:
   - **(a)** Collapse the popover to Path A → loses exception-model lineage forever; high cost.
   - **(b)** Extend the /tasks Path A to also write a `subscription_exceptions` row when `subscriptionId IS NOT NULL` → preserves both lineages and surface-uniform — RECOMMENDED post-MVP path.

   Not in B2's scope; logged here as candidate.

# Operator-facing implication (UX)

When an operator edits an address from `/tasks` on a subscription-linked task, the calendar popover for the same task on the same date will NOT show a "yellow address-override badge" (that badge is driven by the existence of the `subscription_exceptions` row, not the `tasks.address_id` value). This is a known visual asymmetry for MVP.

B2's UX copy does NOT add an explicit "Address edits made here are not tagged as subscription-level overrides; use the calendar to edit for the calendar's audit lineage" note — internal-ops-only consequence; operators are unlikely to notice; reviewer-ruled to skip for MVP. Reviewer rules in v2 (see candidate (b) above).

# Auditor-facing implication

The post-B2 audit-log query "show me every address change for this task" requires a UNION across:

```sql
SELECT 'tasks_page' AS surface, occurred_at, actor_id, metadata
FROM audit_events
WHERE event_type = 'task.updated'
  AND resource_id = $task_id
  AND metadata->'changed_fields' ? 'addressId'

UNION ALL

SELECT 'calendar_popover' AS surface, occurred_at, actor_id, metadata
FROM audit_events
WHERE event_type = 'subscription.address_override.applied'
  AND resource_id = $task_subscription_id
  -- Note: subscription.exception.created is the parent event; both
  -- are correlated by correlation_id. Filter further if you want
  -- exception-row-level granularity.

ORDER BY occurred_at;
```

Both event types carry `actor_id` + `occurred_at` + `metadata`. The union is straightforward but is NOT a single-query pattern — future audit dashboards/operator-debugging surfaces wanting "single timeline of address changes" need to know to UNION both.

# Cross-references

- B2 plan-PR #308 §3.3.1 — full asymmetry doc (mirrors this memo at plan-level).
- B2 plan-PR #308 §3.6 OQ-2 ruling — Path A upheld with binding §3.3.1 documentation constraint (now satisfied by this memo + plan §3.3.1).
- `src/modules/tasks/service.ts:updateTask` — Path A entry point.
- `src/modules/subscription-exceptions/service.ts:addSubscriptionException(type:"address_override_one_off")` — Path B entry point.
- `src/app/(app)/consignees/[id]/_components/DayActionPopover.tsx:ChangeAddressPanel` — Path B UI consumer.
- `src/app/(app)/tasks/_actions.ts:editTaskAddressAction` — Path A UI consumer (Day-30 B2).

---
name: Address-edit SF outbound enqueue gap (Day-22+ deferred; accepted for B2 demo)
description: address-only patches via updateTask do NOT enqueue a SF push today; SF reflects the new address on the next scheduled push pass. B2 demo UX surfaces this as verbatim copy; full outbound coverage is deferred Day-22+ snapshot-mapping work.
type: followup
---

# The gap

`updateTaskAndPushOutbound` ([src/modules/tasks/service.ts:~1602-1626](../src/modules/tasks/service.ts)) intentionally leaves address-only patches as local-only. The wrapper builds an `integrationPatch` only for `delivery_date / time-window` and `notes`; an `addressId` change without an accompanying `ConsigneeSnapshot` mapping skips the QStash enqueue. From the wrapper's existing comment:

> address change (addressId) requires building a ConsigneeSnapshot from the new address row — the form action can either pre-build the snapshot and pass it via this wrapper's future ConsigneeSnapshot patch parameter OR rely on the cron-side path to re-push. For v1 the address-change outbound push is left to the form action; it constructs the snapshot client-side and calls SuiteFleetTaskClient via a dedicated service-fn (Day-22+ scope).

# Operator-facing implication

After a successful address edit from `/tasks` (B2 plan-PR #308 Path A per §3.6 OQ-2 ruling), the new `tasks.address_id` is durable locally but SF still has the OLD address until the next push pass (cron-side push reconciliation OR an unrelated edit on the task that triggers `updateTaskAndPushOutbound`).

To make this visible to operators, B2 UX surfaces the §3.6 OQ-3 **verbatim** disclosure copy at the success site of the address-edit modal:

> "Address change saved; SuiteFleet will reflect on the next scheduled push pass"

Copy is locked. Do NOT paraphrase. Integration spec B2-I5 in `memory/plans/day-30-b2-tasks-page-cancel-edit.md` §5.1 pins the contract.

# Operational consequence + ops triage

For the demo, the consequence is negligible — the cron's push pass reconciles within minutes and demo flows don't exercise mid-window dispatch on an address-edited task. In production at scale, the lag window could create operator confusion ("I changed the address but the driver got the old one"). Mitigations:

1. **Cron reconciliation** — the existing nightly push pass picks up changed `tasks.address_id` and routes via the existing push flow.
2. **Ops query** — `SELECT id, address_id, last_pushed_address_id_snapshot FROM tasks WHERE address_id IS DISTINCT FROM last_pushed_address_id_snapshot` (column name TBD by Day-22+ snapshot-mapping work) surfaces drifted rows for ad-hoc reconciliation.

Both are post-demo items, not B2's scope.

# Fix candidates (post-demo)

- **(A)** Day-22+ snapshot-mapping work as originally scoped: extend `updateTaskAndPushOutbound` with a `ConsigneeSnapshot` parameter; the /tasks form action pre-builds the snapshot client-side from the chosen address; wrapper enqueues `enqueueUpdateTask` with `consignee` field populated. ~4-8 hours engineering + test surface.
- **(B)** Inline server-side snapshot construction in `updateTaskAndPushOutbound` (read the new address row + consignee row inside the wrapper, build the snapshot, enqueue). Eliminates the client-side snapshot construction at the cost of an extra DB round-trip per edit. ~2-3 hours.
- **(C)** Defer to cron reconciliation in production as documented above. No engineering work; operational handbook update only.

# Reviewer ruling

Reviewer's call post-demo. The B2 plan-PR §3.6 ruling on OQ-3 = (a) "accept gap WITH mandatory UX disclosure copy" is the current state. The disclosure copy is non-negotiable; the gap-fill timing is reviewer-discretion.

# Cross-references

- B2 plan-PR #308 §3.6 ruling OQ-3 — accept gap + verbatim copy locked.
- B2 plan-PR #308 §3.3 — Path A direct column write rationale.
- `src/modules/tasks/service.ts:~1602-1626` — `updateTaskAndPushOutbound` comment block.
- `src/app/(app)/tasks/_actions.ts:editTaskAddressAction` — Path A invocation site.
- `src/app/(app)/tasks/client.tsx:EditAddressPanel` — UX disclosure rendering site.

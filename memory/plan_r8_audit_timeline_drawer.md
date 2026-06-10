# Plan · R8 — task-scoped audit timeline in the AWB-click drawer (§3.6 #1)

**Status:** **PLAN APPROVED at §3.6 #1** (Day-52, 2026-06-10). **Build pending Love's ruling on the 7 open product questions below.** No branch/code yet — this is the banked plan surface.

**Lane source-of-truth:** [`diagnostic_calendar_management_full_surface_enumeration.md`](diagnostic_calendar_management_full_surface_enumeration.md) §R8. Ruling verbatim: *"R8 (NEW) — Audit timeline added to AWB-click task-details drawer. RULED: build. Shape: existing AWB-click drawer gains a new 'Audit timeline' section … Server fetches audit_events filtered to this task_id, ordered most-recent-first. Each row renders event_type + actor (operator or system) + timestamp + relevant metadata."* The diagnostic notes this is **the first operator-facing audit surface in Planner**.

## The gap (verified against main)

1. **The audit module is write-only.** [`src/modules/audit/`](../src/modules/audit/) = `emit.ts` (the sole writer — "the one and only writer to audit_events"), `event-types.ts` (catalogue), `index.ts`. **No read/list/query path exists.** R8 needs the first audit read fn.
2. **The drawer shows a DELIVERY timeline, not audit.** [`TaskTimelineDrawer.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/_components/TaskTimelineDrawer.tsx) fetches [`getTaskTimeline`](../src/modules/tasks/service.ts) → `tasks.created_at` + `webhook_events` joined by AWB (SF status codes). That's a state-transition timeline, NOT the audit log. R8 adds a **separate "Audit timeline" section** (the delivery timeline stays).
3. **Schema already supports the read — no migration.** [`0002_audit.sql`](../supabase/migrations/0002_audit.sql): `audit_events(… resource_type, resource_id, metadata jsonb, occurred_at …)` + partial index `audit_resource (resource_type, resource_id) WHERE resource_id IS NOT NULL`. RLS is **FOR SELECT, tenant-scoped**, so a `withTenant` SELECT (not service-role) reads a tenant's own rows.

## File-level breakdown (no new infra beyond the read fn; NO migration)

| File | Change |
|---|---|
| `src/modules/audit/read.ts` (**new**) | `listAuditEventsByResource(tx, { resourceType, resourceId, limit })` — tenant-scoped SELECT → `{ event_type, actor_kind, actor_id, occurred_at, metadata }[]`. |
| `src/modules/audit/index.ts` | Export the read fn (the module's first read export). |
| `src/modules/tasks/service.ts` | New `getTaskAuditTimeline(ctx, taskId)` — permission gate + `withTenant` + the audit read; mirrors `getTaskTimeline`. |
| `src/app/(app)/consignees/[id]/_calendar-actions.ts` | New `getTaskAuditTimelineAction` (sibling to `getTaskTimelineAction`). |
| `src/app/(app)/consignees/[id]/_components/TaskTimelineDrawer.tsx` | New collapsible "Audit timeline" section: row = event label + actor + Dubai timestamp + expandable metadata. |
| `src/modules/identity/permissions.ts` | Possibly a new `task:view_audit` perm (see Q2). |
| tests | audit read spec + service spec. |
| migrations | **None.** |

## Task-scoped audit events that would appear (`resource:"task"`)

`task.created` (system), `task.updated`, `task.completed`, `task.bulk_created` (system), `task.push_failed` (system), `task.pushed_via_reconcile` (system), `task.labels_printed`, `task.note_added`, **`task.note_pushed_to_external`** (R3, now on main via #344), `task.status_changed_via_webhook` / `task.edit_applied_via_webhook` / `task.pod_received_via_webhook` (system, webhook-driven).

⚠️ **Cross-resource nuance:** events that *affect* a task but are scoped to another resource — notably `subscription.pause_cancels_pushed` (R2; `resource_id` = the **subscription**, with cancelled task ids only in metadata) — are **missed** by a pure `resource_id=taskId` filter. Pulling them in needs correlation-id / metadata-task_id stitching (larger scope). See Q1.

## SEVEN open product questions for Love (build gated on these)

1. **Event scope:** all task-scoped events incl. systemOnly (`created`/`push_failed`/webhook-driven), or operator-only? And include **cross-resource events that affected the task** (`subscription.pause_cancels_pushed`, resource-scoped to the subscription) via correlation-id/metadata stitching, or task-`resource_id`-only for v1?
2. **Who can view:** reuse `task:view_timeline`, or a new `task:view_audit` (audit exposes actor identities + system internals — may warrant tighter gating, e.g. Tenant Admin only)?
3. **Operator-safe metadata:** which metadata fields are safe to render to merchant operators? Some carry internal identifiers (`correlation_id`, `failure_detail` with raw SF error text). Allow-list / redaction policy? (Note text is already excluded by design.)
4. **Ordering:** confirm most-recent-first (ruling says so; the existing delivery timeline is oldest-first — intentional divergence?).
5. **History depth:** all-time vs last-N vs windowed; hard cap vs pagination.
6. **Placement:** collapsible-below vs always-visible; two sections vs merged/interleaved with the delivery timeline.
7. **Stepping-stone vs one-off:** diagnostic cross-refs PR #329 — shape the read-path API for reuse by a future broader audit-viewer (`/admin/audit`), or keep it a one-off drawer fetch?

## Meta

Surface produced Day-52 (2026-06-10) as the §3.6 #1 plan for R8, grounded against main `c552946`. Diagnostic flagged four render decisions (event-type filter, metadata expansion, pagination/cap, collapsible-vs-visible) — folded into Q1/Q3/Q5/Q6. Build is a single small PR once the 7 rulings land; no migration. Sizing per diagnostic: T2-T3.

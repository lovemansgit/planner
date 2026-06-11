# Plan · R8 — task-scoped audit timeline in the AWB-click drawer (§3.6 #1)

**Status:** **RULED + BUILT** (Day-52, 2026-06-10). Love ruled all 7 open product questions in-session (Session A R8 dispatch, Day-52 AM) and confirmed the rulings as his at PR #356 clearance; the build shipped as **PR #356** (`feat/d52-r8-task-history-drawer`). Rulings recorded verbatim in §"Love's 7 rulings" below, per the §9 precedent (the clearance is the verification). PR #356 itself is code-lane and parks for Love's final clearance — this doc records the rulings, it does not merge the code.

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

## Love's 7 rulings (Day-52, banked on clearance of PR #356's park)

Relayed in-session (Session A R8 dispatch, Day-52 AM); confirmed by Love as his at the PR #356 park clearance. Answers map 1:1 to the seven open questions above.

1. **Events shown (Q1):** this task's events PLUS the subscription events that affected this task (the "what and why"). Do NOT include `failed_push.*` / push-retry events — operator-facing noise, deliberately excluded.
2. **Detail per event (Q3/Q6-adjacent):** headline rows (event type + actor + timestamp), click-to-expand for metadata. Collapsed detail by default.
3. **Count (Q5):** recent batch first with a "show more" to load older events. Batch size builder's call (10-20 sensible; built as 15). Not show-all.
4. **Section behavior (Q6):** the History section is COLLAPSED by default under a clear "History" heading; operator clicks to expand. Two-level: section collapsed → expand → rows are headlines → click a row to expand its detail.
5. **Visibility (Q2):** anyone who can open the drawer sees the history. No role-gating — gate is the drawer's own `task:view_timeline`, no new permission.
6. **Placement (Q6):** builder's design discretion — default BELOW the core task details unless the real layout makes another spot clearly cleaner (built below the delivery timeline).
7. **Scope (Q7):** scalable spine, NOT speculative features — build R8 as an extensible foundation toward a future broader audit viewer, with the fetch/structure/render layer reusable rather than hard-wired to this drawer; but do NOT pre-build the broader viewer's features (operation-wide filters, export, dashboards, cross-task scopes). Over-engineering toward unscoped viewer features is a STOP-and-surface flag for Love.

**Metadata allow-list ruling (Q3, second pass at re-park):** expanded rows render an operator-meaningful ALLOW-LIST, not raw metadata. SHOW: what changed (changed_fields, statuses), dates/windows, counts, exception type/scope, operator-supplied reason, note-length deltas, AWB/order references. HIDE: internal plumbing — correlation/record UUIDs, `idempotency_key`, raw vendor error text (`last_error`), `sf_action` codes, `outbound_emission` internals, enqueue/chunk counters. The exact field set was built against the real emit-site metadata shapes and rides PR #356 for Love's confirm at final clearance. The "no further detail recorded" fallback and the success-only honesty framing (`followup_audit_failed_attempts.md`) stay.

**Honesty constraint carried into the build (non-negotiable):** the audit layer writes on SUCCESS only — the History section is framed as "what happened" and never implies a complete attempt log.

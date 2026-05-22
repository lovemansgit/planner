---
name: Resolved failed_pushes rows have no UI visibility path (Day-33 PR-D smoke find)
description: After PR-D's bulk-resolve tooling shipped, operators have no UI path to view rows that were marked resolved. The data is durable in the DB (`failed_pushes.resolved_at` / `resolved_by` / `resolution_notes` populated correctly — verified via diagnostic SELECT against production showing 19 resolved rows: 9 from today's MPL bulk-resolve via the new tool + 10 pre-existing from Day-31/32 backlog). The `/admin/failed-pushes` page renders only `WHERE resolved_at IS NULL`, so resolved rows vanish from the UI immediately after resolve. The `failed_push.bulk_resolved` audit event is being emitted correctly (registered Day-33 in PR-D at `event-types.ts:558-563`), but no operator-facing audit log viewer exists. Three plausible resolution paths enumerated with tradeoffs; reviewer + Love rule later. NOT load-bearing for any active lane.
type: followup
---

# Origin

Day-33 PM (2026-05-22, Dubai) production smoke pass on PR-D (Plan #317 CLEANUP-1 — bulk-resolve tooling for `failed_pushes`) at main HEAD `2db99ea`, production deployment `dpl_EVLvUQovnQza6ZK2ogRZzp64M6UT`.

Love drove the new bulk-resolve flow on the MPL tenant: selected 9 unresolved rows via the admin table, clicked "Resolve selected", confirmed the resolve modal, observed the success banner ("9 rows resolved"), and saw the table clear client-side (the 9 rows disappeared from the rendered list). All expected — the surface PR-D shipped works as designed.

**The gap surfaced one click later.** Love wanted to verify the resolve had committed correctly (was the operator's reason captured? did all 9 actually persist? could the resolution be audited if someone asked tomorrow?) — and discovered there is **no UI path to view resolved rows**. The `/admin/failed-pushes` page only shows unresolved ones. After bulk-resolve, the durable data is operator-invisible in the product.

Diagnostic SELECT against production confirmed the rows ARE durable: 19 resolved rows total at the time of smoke (9 from today's bulk-resolve + 10 pre-existing from Day-31/32 backlog cleanup that landed via the same `UPDATE … SET resolution_status = 'resolved_manual'` shape before PR-D's tooling existed). All 19 have `resolved_at`, `resolved_by`, `resolution_notes` populated correctly. The data is fine; the UI just doesn't expose it.

# Status at filing

- **Durable data:** 19 production rows confirmed via diagnostic SELECT. Columns populated:
  - `resolved_at` — UTC timestamp.
  - `resolved_by` — operator UUID (FK to `users.id`).
  - `resolution_notes` — operator-supplied reason text (nullable but captured by PR-D's modal).
- **Audit event emission:** `failed_push.bulk_resolved` registered at [`src/modules/audit/event-types.ts:558-563`](../src/modules/audit/event-types.ts) (Day-33 PR-D §3.7 CLEANUP-1, OQ-4 (a)+(b) — "per-row durable record lives in `failed_pushes.resolved_at` + `resolution_notes`; this event is the operator-attribution + bulk-operation observability"). Events fire on every bulk-resolve operation, both UI-button path AND the `scripts/resolve-failed-pushes.mjs` CLI tool path.
- **UI gap surfaces:**
  - [`/admin/failed-pushes`](../src/app/%28app%29/admin/failed-pushes/page.tsx) renders only `WHERE resolved_at IS NULL` — resolved rows are filtered out at query time, no toggle.
  - No `audit_events` operator-facing viewer exists in Planner. Audit events are durably stored + queryable via SQL but not surfaced as a route.
- **Operator workflow consequence:**
  - Immediately after resolve: visual confirmation via the success banner, but no "review what I just resolved" path.
  - Hours/days later: an operator asked "did the MPL backlog actually get resolved on 2026-05-22?" has no UI path. They'd need a developer to run SQL.
  - Audit trail: the data exists across both `failed_pushes` row state + `audit_events` `failed_push.bulk_resolved` records, but neither is operator-surfaced.
- **Severity:** medium. Not data-corrupting, not customer-facing. Operator friction (post-resolve verification, retrospective audit), and a small trust gap on the new tooling — "did it actually save?" is not answerable without SQL.

# Scope of resolution (three plausible paths)

The eventual fix shape depends on how broadly Planner wants to expose this data. Three plausible paths, each with explicit tradeoffs. **This memo does NOT pick one** — the eventual lane plan-PR decides based on Love's product call.

## Path A — Resolved/unresolved toggle on the existing `/admin/failed-pushes` page

Add a URL-driven filter (e.g., `?status=resolved|unresolved|all`) on the existing route. Default stays unresolved (current behavior).

- **Pros:** smallest surface area. Single route, single client component, one new URL param. No new permissions. Operators discover the new view trivially. Mirrors the consolidated `/calendar` `?status=` filter pattern (Day-23 polish work).
- **Cons:** combining resolved + unresolved in the same surface tangles two operator mental models — the unresolved view is a "work queue" (rows are pending operator action); the resolved view is a "review log" (rows are read-only history). Same table layout may not serve both equally — e.g., the "Resolve selected" / "Retry selected" actions are meaningless on resolved rows and need to be hidden conditionally. Pagination + filtering compound when both modes share the same query path.
- **Scope estimate:** small T2 — 1-2 hour UI change, no schema/service delta. Audit-trail metadata (`resolved_at`, `resolved_by`, `resolution_notes`) needs columns in the resolved-view table.

## Path B — Separate `/admin/failed-pushes/resolved` route

Add a dedicated read-only page for resolved rows. The existing `/admin/failed-pushes` stays focused on the work queue.

- **Pros:** clean separation of concerns. Work-queue page stays unchanged. The resolved-view page is purpose-built for retrospective review — different columns (resolved-at, resolved-by, notes), different actions (none — read-only), different default sort (resolved-at DESC for recency).
- **Cons:** extra route + extra navigation surface. Operator needs to know the page exists (discoverability — likely a "View resolved" link from the work-queue page). Two routes to maintain. Sidebar / nav structure may need a new entry.
- **Scope estimate:** small-to-medium T2 — 2-3 hour UI work (new route + new client + new server fetch with `WHERE resolved_at IS NOT NULL`), no schema/service delta.

## Path C — Operator-facing audit log viewer for `failed_push.bulk_resolved` events specifically

Build a viewer over `audit_events` filtered to `event_type IN ('failed_push.bulk_resolved', 'failed_push.retried', …)`. Broader scope — audit log viewer does not currently exist anywhere in Planner.

- **Pros:** durable institutional capability — operator-facing audit log viewer would also serve future questions ("who changed CRM state on consignee X last week?", "when was the last subscription paused on tenant Y?"). The data infrastructure is already there; the gap is the UI.
- **Cons:** much broader scope. Permission model needs careful thought (audit events are high-leverage data — likely Tenant Admin / Transcorp sysadmin gated). UI shape is harder — filter-by-event-type, filter-by-resource, filter-by-actor, time-range, metadata expansion. The first-pass scope would be substantial. Doesn't directly solve the immediate operator question ("did MY resolve save?") as cleanly as Path A or B — operator has to filter to their event type, find the recent row, expand metadata.
- **Scope estimate:** medium-to-large T3 — multi-day work, design-surface decisions on filter + permission model + metadata rendering.

**Path A and Path B are alternatives** — pick one, not both. **Path C is orthogonal** — could ship instead of A/B, OR in addition to (as a separate lane). The decision hinges on how broadly Love wants to expose audit-level data to operators, which is a product call.

# Standing

- **NOT load-bearing for any current lane.**
  - **Plan #317** is CLOSED at `f0ef560` (PR-A + PR-B + PR-C + PR-D all shipped end-to-end Day-33). This memo records a gap surfaced DURING #317 PR-D's smoke; it does not re-open the #317 lane.
  - **Calendar-management lane** (`memory/diagnostic_calendar_management_full_surface_enumeration.md`, R1-R7 + sub-rulings R6.1-R6.4 + R7.1-R7.4): in the operator-visibility family (R6 is about cross-surface navigation, R7 about default-tab landing) but does NOT directly cover failed_pushes admin surfaces. Could pair with the calendar lane as an additional ruling item (R9 or higher) OR stand alone as a small T2/T3.
  - **HEM 403 lane** (`memory/followup_hem_403_credential_failure.md`) + **POD broken-image** (`memory/followup_pod_broken_image_pre_existing.md`): both adjacent operator-visibility-family memos filed Day-33; this is the same shape.
- **No production hot-patch warranted.** The data is durable; the gap is visibility. Operators wanting verification today can ask a developer for a SQL query against `failed_pushes WHERE resolved_at IS NOT NULL`. Not pretty, but it's a workaround until the fix ships.
- **Lane-membership decision deferred** to lane-open time.

# Non-goals

This memo does NOT:

- Propose a fix. Three plausible paths enumerated; the eventual lane plan-PR decides.
- Pick a path. Path A vs Path B is a UX call; Path C is a broader scope call. None of these are mine to rule on.
- Re-open Plan #317. The lane shipped end-to-end; this memo records a gap surfaced during its final smoke pass, not a defect in the lane's deliverable.
- Scope an expansion of the calendar-management lane. R1-R7 + sub-rulings stay as enumerated; whether resolved-rows visibility becomes R8/R9 depends on lane-open ruling.
- Propose a brief amendment. None of the three paths require a brief touch — `failed_pushes` admin tooling is operator-tooling, not part of the brief's primary surface coverage.
- Touch any code file.

# Trigger for next-action

Two routing options at lane-open time:

1. **If folded into calendar-management lane:** ruling on whether to add an R8/R9 covering this gap. The diagnostic memo's "Items needing operator/reviewer ruling" section becomes the home; lane plan-PR scoping picks one of Path A/B/C.
2. **If kept as a standalone:** a small T2/T3 PR (scope depending on Path A/B/C) shipped on its own cadence. No dependency on the calendar-management lane.

In all cases, post-resolution housekeeping: verify the new surface renders the 19 production rows (today's MPL bulk-resolve + Day-31/32 backlog) correctly, append the resolution path to this memo, and decommission if/when filed in an active-followup digest.

# Cross-references

- [PR #328](https://github.com/lovemansgit/planner/pull/328) — Plan #317 PR-D bulk-resolve tooling. Surface that surfaced this gap.
- [PR #327](https://github.com/lovemansgit/planner/pull/327) — POD broken-image memo (Day-33 PM). Same shape of memo (durable anchor for an operator-visibility gap surfaced during production eyeball; resolution scope deferred to lane-open ruling).
- [`src/modules/audit/event-types.ts:558-563`](../src/modules/audit/event-types.ts) — `failed_push.bulk_resolved` registration. Events fire; viewer does not exist.
- [`src/app/(app)/admin/failed-pushes/page.tsx`](../src/app/%28app%29/admin/failed-pushes/page.tsx) + [`client.tsx`](../src/app/%28app%29/admin/failed-pushes/client.tsx) — current route. Server fetch filters `WHERE resolved_at IS NULL`; client renders work-queue shape.
- [`memory/diagnostic_calendar_management_full_surface_enumeration.md`](diagnostic_calendar_management_full_surface_enumeration.md) — adjacent operator-visibility lane (R1-R7 + R6.1-R6.4 + R7.1-R7.4). This memo's gap may fold in OR stand alone.
- Sample diagnostic SQL (the query Love ran during PR-D smoke):
  ```sql
  SELECT id, tenant_id, task_id, resolved_at, resolved_by, resolution_notes
  FROM failed_pushes
  WHERE resolved_at IS NOT NULL
  ORDER BY resolved_at DESC;
  -- 19 rows at time of filing (9 from Day-33 MPL bulk-resolve + 10 pre-existing Day-31/32)
  ```

# Meta

Filed Day-33 PM (2026-05-22) as a T1 docs-only PR off main HEAD `2db99ea`. Single commit, single file. Memo-only — the institutional record is the gap anchor + the three-path tradeoff enumeration. Branch: `docs/d33-followup-resolved-rows-visibility`.

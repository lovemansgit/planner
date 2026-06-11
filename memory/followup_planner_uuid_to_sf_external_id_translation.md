---
name: Planner UUID → SF external_id translation convention
description: Day-17 surfacing — SF's /generate-label endpoint requires its own task UUID (tasks.external_id), not Planner UUIDs. Probe-confirmed today via live SF sandbox call. Convention going forward: service layer translates IDs at the boundary BEFORE calling SF adapters; adapter signatures accept SF external_ids only. Skipped-task handling for pre-push rows surfaces via X-Skipped-Count response header. Adapter 5xx logging gap (no response body capture) closed in same hotfix PR.
type: project
---

# Planner UUID → SF external_id translation convention

**Surfaced:** Day 17 (7 May 2026), afternoon, post drizzle-array-binding hotfix (PR #170).

## §1 Pattern observed

SuiteFleet's external API uses its own opaque task UUIDs — populated in `tasks.external_id` when the cron-driven push to SF succeeds and SF returns an ID for the created task. Planner UUIDs (`tasks.id`) are local-only.

The Day-17 hotfix path:
1. Drizzle array-binding bug (PR #170) fixed → `printLabelsForTasks` now correctly resolves the operator's selected task IDs.
2. Smoke retest surfaced HTTP 502 from SF's `/generate-label` endpoint.
3. Live SF probe confirmed: SF returns `200 application/pdf` for `taskId=60547` (an SF external_id) but `502 application/json {"message":"Internal server error"}` for `taskId=191f398a-e870-478c-82ba-84bfdf51aa4b` (a Planner UUID).
4. SF's gateway treats "task not found" as a backend failure (502) rather than returning 404; this masked the ID mismatch as an outage signal.

This is the first (but probably not last) place where Planner-side data needs to be translated to SF-side identifiers before calling SF. Future surfaces likely to need the same translation:
- Direct task lookup against SF (e.g. status fetch fallback when webhook race occurs)
- Asset tracking (per `memory/followup_suitefleet_asset_tracking_api.md`)
- Reschedule / cancel calls if added post-MVP

## §2 Convention going forward

**Service layer translates IDs at the boundary BEFORE calling the SF adapter.** Adapter signatures accept SF external_ids only; never accept Planner UUIDs. The translation lives in service-layer functions that fetch the necessary `external_id` columns alongside the visibility filter.

For label print specifically:
- Repository: `listVisibleTaskExternalIds(tx, tenantId, ids)` returns `(id, externalId, pushedToExternalAt)` triples
- Service: `printLabelsForTasks` partitions into eligible (both columns non-null) vs skipped, passes external_ids to adapter
- Adapter: receives `readonly string[]` of SF external_ids, knows nothing about Planner UUIDs

For future SF outbound calls: same pattern. Fetch the external_id alongside the Planner-side row, partition on null external_id (= "not yet pushed to SF"), translate at the service-layer boundary.

## §3 Skipped-task handling

When external_id IS NULL (task pre-push or push failed permanently), the service:
1. Filters the row out of the SF call
2. Surfaces `skippedCount` + `skippedTaskIds` on the result shape
3. Audit metadata captures `skipped_count` + `skipped_task_ids` for forensic review

The route layer surfaces partial-success via response headers:
- `X-Skipped-Count: <n>` — count when non-zero
- `X-Skipped-Reason: not-pushed-to-suitefleet` — current sole reason

If ALL eligible rows are pre-push, the service throws `NoLabelablePushedTasksError` → HTTP 422 with operator-readable message. The 422 mapping is registered in `src/app/api/_lib/error-response.ts`.

**Operator UI consumption** is Phase 2 small — when the UI ships partial-success banners, it reads `X-Skipped-Count` and renders something like "Printed 28 of 30 selected tasks. 2 tasks couldn't be printed because they haven't been dispatched to SuiteFleet yet."

## §4 Adapter 5xx logging gap

The Day-17 SF 502 diagnosis took 30 minutes instead of 5 because `label-client.ts:172-182` (the 5xx branch) only logged status code, NOT response body. The 4xx branch at `:184-205` already captured `response_excerpt` (first 400 bytes); the 5xx branch did not.

Fixed in this same hotfix PR: 5xx branch now mirrors the 4xx branch's `response_excerpt` capture. Future SF 5xx surfaces will reveal the SF response body (e.g. `{"message":"Internal server error"}`) in production logs without requiring a live probe.

**Discipline rule** (lightweight; not formal): when adding a new external-API client, the 5xx and 4xx error branches MUST capture the same level of response detail. Asymmetry between the two branches is the lesson preserved here.

## §5 Cross-references

- This hotfix PR — establishes the convention + ships translation + closes 5xx logging gap
- `memory/followup_suitefleet_label_endpoint.md` — the load-bearing security constraint (token-in-query MUST NOT reach operator browsers); preserved in this hotfix
- `src/modules/tasks/repository.ts:listVisibleTaskExternalIds` — first repository function returning the (id, externalId, pushedAt) triple shape
- `src/modules/tasks/service.ts:printLabelsForTasks` — partition + translation logic
- `src/app/api/tasks/labels/route.ts` — X-Skipped-Count response header
- `src/modules/integration/providers/suitefleet/label-client.ts:172-202` — 5xx response body capture
- `src/shared/errors.ts:NoLabelablePushedTasksError` — new error class for all-pre-push input case
- `memory/followup_repo_layer_integration_coverage_discipline.md` — sibling discipline rule from PR #170 (real-Postgres integration tests for repo-layer changes)
- PLANNER_PRODUCT_BRIEF.md §3.5 — L4 label generation scope; this hotfix unblocks L4 plan PR drafting

---
name: SuiteFleet label endpoint — pure passthrough wrapper (token-in-query security constraint)
description: Aqib confirmed (Day 7 EOD, 2 May 2026) the SF label endpoint shape — GET https://shipment-label.suitefleet.com/generate-label with bearer token + clientId in query, taskId or comma-separated list for bulk, type=indv-small for the 4x6 meal plan format, tz_offset=4 for UAE. Captures the load-bearing security constraint that the URL MUST NEVER reach operator browsers (token-in-query leaks via history / Referer / access logs). Day-8 candidate is a thin T2 server-side passthrough commit with permission, audit event, route, UI, and adapter method scope locked.
type: reference
---

# SuiteFleet label endpoint

**Captured:** 2 May 2026 EOD (post-C-8 merge, Day 7 close)
**Source:** Aqib Group-2 follow-up response
**Pilot scope:** UAE meal-plan deliveries only — single label format, single timezone

---

## Endpoint shape

```
GET https://shipment-label.suitefleet.com/generate-label
  ?taskId={taskId or comma-separated list}
  &type=indv-small        — the 4x6 meal-plan label format (only type in pilot scope)
  &tz_offset=4            — Asia/Dubai UTC+4 year-round (no DST)
  &token={bearer token}
  &clientId={SF client ID}
```

Method: `GET`. Returns the rendered label as PDF binary directly in the response body — no JSON envelope, no signed-URL redirect.

Bulk: comma-separated `taskId` list returns a single multi-page PDF in one round-trip — no per-task fan-out needed.

---

## Security — token-in-query MUST NOT leak to operator browsers

The endpoint accepts the bearer token as a `?token=` query parameter, NOT as an `Authorization` header. Tokens in URLs leak through:

- Browser history
- HTTP server access logs (downstream proxies, CDN edges, SF's own logs)
- `Referer` headers on any outbound link from a page that holds the URL
- Screenshots / screen-share recordings
- Browser extensions that read URL bars
- DevTools Network panel exports

**Architectural rule for the planner**: the operator browser MUST NEVER receive this URL or the token in any form. The Transcorp planner backend fetches the URL server-side, reads the response body, and streams the PDF bytes back to the operator as `application/pdf`. The token stays inside the Transcorp deploy boundary.

This is the single load-bearing constraint that shapes the Day-8 implementation. NO client-side fetch / NO redirect / NO `<a href="...token=...">` / NO `window.open` with the token-bearing URL.

---

## Constants

- `type=indv-small` — only type used in pilot. Per Aqib, no per-merchant variation. Hardcode at the adapter layer; revisit when a non-meal-plan merchant onboards.
- `tz_offset=4` — Asia/Dubai is fixed UTC+4 year-round, no DST. Hardcode unless multi-region scope changes.
- Different subdomain than the regular SF API (`api.suitefleet.com` vs. `shipment-label.suitefleet.com`). Separate base URL constant in the adapter — do NOT reuse the `DEFAULT_BASE_URL` from `task-client.ts`.

---

## Day 8 implementation scope (T2 candidate)

### Permission

`task:print_labels` — TENANT_SCOPED auto-pickup. Per Love's earlier confirmation: every role with `task:read` automatically grants this (operators with read access can print labels for tasks they can see).

### Audit event

`task.labels_printed` (new, systemOnly: false — user-driven).

Metadata:
- `task_ids[]` (uuid[]) — the IDs the operator submitted
- `format` (string) — "indv-small" in pilot; documented for future per-format dispatch
- `requested_count` (int) — `task_ids.length`
- `printed_count` (int) — count after visibility filter; may differ from requested if some IDs were dropped because they're not visible to the requesting tenant

The requested-vs-printed split is the forensic signal for "operator selected 30 tasks, only saw 28 in the PDF" support investigations.

### Route

`POST /api/tasks/labels`

- Body: `{ taskIds: string[] }`. Zod-validated: array of UUIDs, non-empty, max-N upper bound (lean: 100 per request — bounds single PDF size; revisit if SF rejects long comma-separated lists).
- Permission gate: `requirePermission(ctx, "task:print_labels")`.
- Visibility filter: `SELECT id FROM tasks WHERE id = ANY(${taskIds}) AND tenant_id = ${tenantId}` to filter the input list. **Silently drop** IDs that don't pass — do NOT 404 or surface which IDs dropped (that would leak cross-tenant existence). The audit event captures both `requested_count` and `printed_count` for traceability.
- Server-side: build the SF URL from env-resolved credentials (existing per-tenant credential resolver) + the filtered `taskIds`, fire the GET, stream the response body back to the caller as `application/pdf` with `Content-Disposition` filename like `labels-{YYYY-MM-DD}-{N}-tasks.pdf`.
- Per-tenant credential lookup: same `getSuiteFleetAdapter()` path that `task-client.ts` uses today; the new `printLabels` adapter method takes a `session` and is responsible for building the URL with the session's token + the tenant's clientId.

### UI

`/tasks` list page — multi-select-aware. "Print Labels" button visible when ≥1 task is selected. Click → POSTs the selected IDs to the route → triggers a browser PDF download via the response stream (no URL-with-token ever rendered client-side; the browser only sees the planner's `/api/tasks/labels` URL with no secrets in it).

### Adapter method

```ts
// LastMileAdapter — new method
printLabels(
  session: AuthenticatedSession,
  taskIds: readonly string[],
): Promise<Buffer | ReadableStream>
```

Buffer for pilot scope (≤100 tasks per request, few-MB PDFs). Streaming if a future commit lifts the cap. Decision at implementation time.

---

## Open questions for future work (post-pilot)

- **Authentication beyond pilot**: if SF migrates to header-based auth (Aqib pre-Day-14 list mentions this category), the URL-leak concern goes away — re-evaluate the server-side-fetch architecture rule. Until then, the rule holds.
- **Per-merchant label format**: pilot is `indv-small` only. If merchants need other formats (e.g., `indv-large` for non-meal-plan deliveries), the `type` parameter becomes a per-tenant-config or per-task-type lookup.
- **Bulk size limit**: SF's actual upper bound on comma-separated `taskId` count is not documented. Pilot caps the planner request at 100 tasks per call as a defensive limit; if SF rejects long lists, investigate empirically and lower.
- **Failure modes**: what happens if one of the comma-separated taskIds doesn't exist in SF (e.g., a task that was never pushed because it sits in `failed_pushes`)? Single 4xx for the whole request, or partial PDF? Empirical question — first cron-pushed-tasks-then-print test will surface it.

---

## Cross-references

- `memory/followup_c3_deferred_day8.md` — C-3 cron push has to land before any task can be label-printed (a task must have a SF taskId — `external_id` populated — which means it must have been pushed).
- `memory/decision_planner_auth_independent.md` — the planner-side authentication for the new `/api/tasks/labels` route uses the planner's own auth, not SF's. Two separate auth boundaries.
- `memory/feedback_vercel_env_scope_convention.md` — SF clientId env vars (Production + Preview only).

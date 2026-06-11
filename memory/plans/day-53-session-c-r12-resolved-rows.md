# Day-53 PM Session C plan — R12 resolved-rows page (Path B, T3)

**Filed:** Day-53 PM (11 Jun 2026), Session C, per the Day-53 PM dispatch PART 3.
**Lane authority:** Plan A (`memory/decision_d53_plan_a_pre_uat_queue.md`) pulls R12 pre-UAT; the Day-53 PM dispatch fires the lane and rules **Path B** (separate `/resolved` route).
**The contract:** `memory/followup_resolved_rows_visibility_gap.md` (Day-33 PR-D smoke find) — its Path B section IS the scope; no growth. Read-only visibility for resolved `failed_pushes` rows; **no mutations, no schema delta, no migrations.**

All citations verified against this worktree's HEAD (main `5eec3aa` lineage).

## §1 Grounded evidence

1. **The gap:** `/admin/failed-pushes` (`src/app/(app)/admin/failed-pushes/page.tsx:55`) renders only `listUnresolvedFailedPushes`; the repository list (`listUnresolvedByTenant`, `src/modules/failed-pushes/repository.ts:308`) filters to unresolved. Resolved rows vanish from the UI the moment they're resolved; operators verified resolution only via developer SQL (19 durable production rows confirmed at filing).
2. **The data is already durable and complete:** `failed_pushes.resolved_at` / `resolved_by` / `resolution_notes` populated by both the PR-D bulk-resolve tool and the system resolve path (`markFailedPushResolved`, service.ts:209 — `resolvedBy` NULL for system-resolved by design, with attribution in `resolution_notes`).
3. **Permission model precedent:** the work-queue read gates on `failed_pushes:retry` (service.ts:551 — "reuses one perm because the surface is admin-only and they ship together"). The Day-30 `failed_pushes:read` split deliberately keeps full-row fields (`failure_payload`, `failure_detail`, notes) Tenant-Admin-only — `failed_pushes:read` exposes only task-ID set membership (service.ts comment at the Day-30 split).
4. **Type shape:** `FailedPush` (`src/modules/failed-pushes/types.ts:43-64`) already carries `resolvedAt` / `resolvedBy` / `resolutionNotes`.
5. **Test surfaces to mirror:** unit `src/modules/failed-pushes/tests/` (service mock pattern in `list-failed-push-task-ids-for-tenant.spec.ts`; SQL-shape pattern in `repository.spec.ts:143`); integration `tests/integration/admin-failed-pushes-search.spec.ts` + `bulk-resolve-failed-pushes.spec.ts`.

## §2 Scope — IN (Path B, verbatim from the filed memo: "dedicated read-only page … different columns (resolved-at, resolved-by, notes), different actions (none — read-only), different default sort (resolved-at DESC)")

- **Repository:** `listResolvedByTenant(tx, tenantId)` — `WHERE tenant_id = $1 AND resolved_at IS NOT NULL ORDER BY resolved_at DESC`, with a `LEFT JOIN users` to surface the resolver's email (`resolved_by` is a raw UUID; the page's "resolved-by" column needs an operator-readable value; NULL → rendered "System" per the §1.2 attribution convention). Returns a new narrow read shape `ResolvedFailedPush` (`id, taskId, failureReason, httpStatus, attemptCount, firstFailedAt, resolvedAt, resolvedByEmail, resolutionNotes`).
- **Service:** `listResolvedFailedPushes(ctx)` — gate `failed_pushes:retry` + tenant assertion + `withTenant` (RLS), read-not-audited per R-4. Same permission as the page it extends (trade-off in §4).
- **Route:** `src/app/(app)/admin/failed-pushes/resolved/page.tsx` — server component only, **no client component** (zero actions). Same brand language as the work-queue page (Operations · DLQ eyebrow, hero count, hairline borders). Read-only table: resolved-at (DESC), task ID, resolved-by (email or "System"), notes, failure reason/HTTP status/attempts, first-failed-at.
- **Discoverability:** one "View resolved →" link on the existing work-queue page header (the filed memo's own suggestion) — **deliberately NOT a nav-config entry** (§4).

## §3 Scope — OUT (the filed memo's non-goals stand)

Path A (toggle on the work-queue page) and Path C (audit-log viewer) are not built — Path B was dispatch-ruled. No search box on the resolved page (the contract names sort-by-recency, not search; the work-queue SearchBar stays where it is). No pagination (matches the work-queue page's posture; production count is ~19 rows). No un-resolve / edit actions of any kind. No new permissions. No audit events (read-only, R-4). No schema delta — if any migration appears necessary, STOP and park per the dispatch.

## §4 Design decisions (trade-offs, three sentences each)

**Gate on `failed_pushes:retry`, not `failed_pushes:read`.** The resolved view renders the same sensitive full-row fields (notes, failure detail) that the Day-30 split deliberately kept Tenant-Admin-only, so the broader `read` permission would widen exposure the split exists to prevent. Reusing the work-queue page's own gate keeps one mental model: the whole DLQ admin surface, queue and history, behind one permission. If a CS-readable history view is ever wanted, that's the split's pre-blessed follow-up, not this PR.

**`LEFT JOIN users` for the resolved-by column instead of raw UUIDs.** The contract names "resolved-by" as a column, and a raw UUID is operator-meaningless — the join is the minimum that makes the column real. LEFT JOIN (not INNER) preserves system-resolved rows (`resolved_by` NULL) and survives deleted resolvers, both rendering as "System"/em-dash per the existing attribution convention. Cross-module table reads in repositories are house precedent (subscription-addresses and tasks repositories JOIN consignees directly).

**No nav-config entry; link-from-work-queue instead.** Session B's R6 nav lane is in flight and nav-config is on this dispatch's do-not-touch list, so a nav entry would either collide or park the lane on a question. The filed memo itself proposed the "View resolved" link as the discoverability mechanism, and the operator journey naturally starts at the work queue ("did my resolve save?" is asked one click after resolving). If a nav entry is wanted later, it's a one-line R6-lane follow-up, parked as a question per the dispatch.

**Server-component-only page (no client.tsx).** The page has zero actions — rendering a read-only table client-side would add a hydration boundary for nothing. This is also the clean expression of the filed memo's work-queue/review-log split: the absence of a client component makes "no actions on resolved rows" structural rather than conditional. The work-queue page keeps its client component untouched.

## §5 Brief bump (dispatch-ASSIGNED)

One append-only §9 row for the new surface, taking the next free version number at merge time (**v1.22 expected**, after #405's v1.21; re-verified against main's table immediately before merge since the code-PR parks first). Header Version pointer + closing line advance per the v1.17-correction discipline. Note: the filed memo's "no brief amendment" non-goal is superseded by the dispatch's explicit assignment.

## §6 Tests (RED-first)

- **Unit, service** (`tests/list-resolved-failed-pushes.spec.ts`, mirrors the Day-30 list spec): permission denial without `failed_pushes:retry`; tenant assertion; happy path returns repo rows verbatim; no audit emit.
- **Unit, repository** (extend `repository.spec.ts` pattern): SQL shape — `resolved_at IS NOT NULL`, `ORDER BY resolved_at DESC`, LEFT JOIN users, explicit tenant predicate.
- **Integration, real Postgres** (`tests/integration/failed-pushes-resolved-list.spec.ts`): resolved row visible with resolver email + notes; unresolved row excluded; system-resolved row (NULL `resolved_by`) returned with NULL email; `resolved_at DESC` ordering; tenant-isolation negative (tenant B sees zero of tenant A's resolved rows).
- **Gates:** full unit + tsc + lint + integration; CI reported per §7.1.

## §7 Lane compliance (do-not-touch)

Touched: `src/modules/failed-pushes/{repository,service,types,index}.ts` (additive), new `resolved/page.tsx`, one link line in the existing work-queue `page.tsx`, new test files, brief §9 (at code-PR). NOT touched: /tasks surfaces + nav-config (Session B/R6), `src/modules/subscriptions` resume path + outbound queue handlers + POD/photo surfaces (Session A — this lane only READS `failed_pushes` via new functions; no existing queue-path function is modified), `supabase/migrations/**`, mpl UAT demo data.

## §8 Open questions for the reviewer

1. None blocking known. If the reviewer judges the `LEFT JOIN users` read a module-boundary concern (identity owns users), the fallback is rendering raw UUIDs in v1 — say so in the verdict and the join drops without scope change elsewhere.

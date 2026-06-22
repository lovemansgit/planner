# Day-57 — status-filter lane EOD (builder state memo)

Reference-form state pin (SHAs, not pasted bodies) so the session can compact
safely. Filed to main via T1 auto-merge.

## main
- **HEAD now: `031a38a`** (#558 design-system docs landed after the admin fixes).
- **The 3 admin status-lane fixes landed at `79e2220`** (ancestor of HEAD):
  - #554 `f1d669f` — /admin/tasks status filter (render-aligned courier_status predicate)
  - #555 `304892f` — admin Overview genuine-tenant fence (736 → 8)
  - #556 `79e2220` — admin Subscriptions consignee name (drop UUID prefix)
- **READY-TO-PROMOTE, NOT promoted.** Promote is Love's separate ruling — **still pending.**
- Rollback anchor: `dpl_zkDAGJpz…` @ `164b129`.

## open PRs (status-filter fast-follow lane)
- **#557 — operator /tasks parity** @ `23e1370` — reviewer APPROVE r1, CI green.
  **NOT cleared.** Outside-check found an incomplete-parity gap:
  `listAllTaskIdsByTenant` (the /tasks "select all" label-print path,
  `repository.ts` ~line 1067) still uses the raw `AND courier_status = ${status}`
  predicate, NOT the shared `buildCourierStatusFilter`. On NULL-courier rows
  "select all <status>" selects 0 while the visible list shows rows —
  list/action divergence. **MUST FIX before clear (Part 3).** Do NOT clear at `23e1370`.
- **#559 — vocabulary (16 states) + ON_HOLD neutral** @ `6d6a8ab` — CI green
  (unit 2404 + integration + Vercel); reviewer REQUEST_CHANGES (directional, code
  confirmed correct). **Love RULED:** B+C supersede D56 OQ-3; ON_HOLD relabel "—"
  stands. Owes an **append-only D56 OQ-3 amendment** before it clears (Part 2).
  Clears at `6d6a8ab` (head unchanged).

## rulings on record (Day-57, Love)
- **D56 OQ-3 superseded:** filter widened 14 fine → 16 (adds CREATED, SKIPPED);
  ON_HOLD excluded from dropdown + coarse label neutralised to "—". (→ #559)
- **D56 OQ-5 superseded — ALIGN:** the consignee-detail calendar must filter
  CREATED/SKIPPED (not return 0). **Placement = (b) FAST-FOLLOW PR** — determined
  from Part-2 clearing #559 at the unchanged head `6d6a8ab` (folding into #559
  would move its head and break that clearance). Owes its own **append-only D56
  OQ-5 amendment** (Part 4).

## merge order once all clear
#557 (post-fix, re-reviewed) → #559. Promote stays Love's separate ruling.

## root cause (shared by the whole lane)
`tasks.courier_status` is 100% NULL in prod (fine state is webhook-backfilled
forward); rows render via the coarse `internal_status` fallback, so a
courier_status-only filter returned 0 for every specific status. Fix =
render-aligned predicate `buildCourierStatusFilter`. See
[[project_d57_status_filter_lane]].

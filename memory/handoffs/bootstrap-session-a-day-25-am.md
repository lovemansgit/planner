# Session A — Day-25 AM bootstrap

Filed: 2026-05-12 EOD. Read at Day-25 session start.

## Yesterday (Day-24) — your lane

User-management surface + audit + demo-prep. Six PRs:

| PR | Title |
|---|---|
| [#252](https://github.com/lovemansgit/planner/pull/252) | `scripts/verify-demo-seed.mjs` 5-assertion smoke verifier |
| [#253](https://github.com/lovemansgit/planner/pull/253) | Verifier fix-ups — Demo Bistro pre-existence inversion + AWB fix |
| [#255](https://github.com/lovemansgit/planner/pull/255) | Hide archived tenants from `/admin/*` list rows (closes leak before bulk 110-tenant archive) |
| [#257](https://github.com/lovemansgit/planner/pull/257) | Dedicated `/admin/calendar` route under `(admin)/` shell |
| [#259](https://github.com/lovemansgit/planner/pull/259) | `/admin/users` + `/admin/users/new` — createUser + createRoleAssignment with cross-tenant escalation gate |
| [#260](https://github.com/lovemansgit/planner/pull/260) | `/admin/users` disable + enable — paired login-block / restore via `supabase.auth.admin.updateUserById` ban_duration |

All shipped to production today. Production HEAD `3255621` on
`dpl_2M7HDHrt9zAAFajiFVP7CXkY2uVn` serving
https://planner-olive-sigma.vercel.app.

## Today (Day-25) — expected lane

**Defect patching from Love's dry-run walkthrough.** T-2 to internal
CAIO demo. Love runs all 8 chapters end-to-end against production
this morning; defects surface in real-time → filed as tickets →
assigned to whichever session has the freer plate. Your lane will
likely be backend / service-layer / data-shape defects (your Day-24
specialty); UI cosmetic defects more likely fall to Session B.

**Warm standby for Playwright walkthrough script support.** Session B
likely owns the walkthrough-script lane (~3-4 hr work, captures the
15 spec-doc screenshots deterministically). If Session B hits a
service-layer blocker on the walkthrough probes (auth setup, seed
data assumptions, etc.) — collaborate.

**No new substantive scope is expected.** Day-25 is execution-on-
defects + walkthrough + final polish, not new feature work.
Demo-distance gates Day-26 (CAIO demo morning) so any new scope
introduced today must clear T-1 demo-eve buffer for risk hygiene.

## Critical context

- **Brief v1.11** is authoritative. No amendment landed Day-24. Brief
  at `memory/PLANNER_PRODUCT_BRIEF.md`.
- **Production HEAD `3255621`** built into
  `dpl_2M7HDHrt9zAAFajiFVP7CXkY2uVn` (target=production). Aliases
  attached: `planner-olive-sigma.vercel.app` (canonical) +
  `planner-lovemansgits-projects` + `planner-git-main-lovemansgits-projects`.
- **Demo distance T-2** (internal CAIO 2026-05-15) / T-5 (external
  prospect 2026-05-18).
- **Demo Bistro pre-demo blocker**: Demo Bistro's webhook URL needs
  Aqib registration on SF side BEFORE demo (Love sends UUID + URL
  Day-25 morning). If Aqib coordination slips, the live-create
  chapter still works (DB row appears immediately) but SF webhook
  events for Demo Bistro tasks won't flow for the rest of the demo —
  flag this to Love early Day-25.
- **Database state post-cleanup**: 110 stale CI-leak tenants
  archived; 4 test users deleted from `auth.users` + mirror. See
  Day-24 EOD §C. Don't recreate test fixtures in production during
  Day-25 probes — use Preview or local DBs only.
- **Discipline rules in force**:
  - Day-23 §F integration-spec discipline (every new SQL path gets
    an integration pin)
  - Day-24 §E nav-shell verification (cross-route-group nav entries
    must verify the shell, not just the route)
  - `feedback_parallel_sessions_use_git_worktree.md` — every parallel
    lane runs in its own worktree off main; never plain `checkout -b`
  - T1 doc ride-alongs auto-merge to main; T2+ goes through §3.6
  - Inspect-then-promote pattern: `vercel inspect` → `vercel promote`
    after every merge to main

## Coordination signals

- Session B's Day-25 lane filed alongside this brief at
  [`bootstrap-session-b-day-25-am.md`](bootstrap-session-b-day-25-am.md).
  Read it on session start to know what they're touching.
- Day-24 EOD doc at [`day-24-eod.md`](day-24-eod.md) — full state +
  carry-forward context.

---

End of bootstrap. Stand by warm; defects will surface from Love's
walkthrough.

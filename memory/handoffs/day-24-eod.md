# Day-24 EOD

Filed: 2026-05-12 (PM). Full-day arc; consolidates Session A + Session B
work landed across AM + PM. Read alongside the per-session morning
bootstrap briefs filed alongside this doc (Session A + Session B
Day-25 AM bootstraps).

## §A — Final state at sign-off

- **Main HEAD**: `3255621` — `feat(d24-disable-user): /admin/users disable + enable surface (#260)`
- **Production**: `https://planner-olive-sigma.vercel.app` served by
  `dpl_2M7HDHrt9zAAFajiFVP7CXkY2uVn` (built from main HEAD `3255621`).
  Three aliases live: `planner-olive-sigma`,
  `planner-lovemansgits-projects`, `planner-git-main-lovemansgits-projects`.
- **Demo blockers**: 0.
- **Demo distance**: **T-2** (May 15 internal CAIO) / **T-5** (May 18
  external prospect).

## §B — PRs landed Day-24

Nine PRs across both sessions. Session split: A landed #252/#253/#255/#257/#259/#260
(6 PRs, user-management + audit + demo-prep); B landed #254/#256/#258
(3 PRs, admin UX consistency stack).

| PR | Author | Slot | Title |
|---|---|---|---|
| [#252](https://github.com/lovemansgit/planner/pull/252) | Session A | AM | `scripts/verify-demo-seed.mjs` — 5-assertion smoke verifier for demo invariants |
| [#253](https://github.com/lovemansgit/planner/pull/253) | Session A | AM | Verifier fix-ups — invert Demo Bistro pre-existence assertion (created live on stage) + AWB column/literal fix |
| [#254](https://github.com/lovemansgit/planner/pull/254) | Session B | AM | Transcorp admin search bars on 4 admin pages (consumes Session A's `<SearchBar>` from PR #251) + bundled `ADMIN_NAV_ITEMS` Calendar entry gated on `task:read_all` |
| [#255](https://github.com/lovemansgit/planner/pull/255) | Session A | early PM | Hide archived tenants from `/admin/*` list rows — closes the leak vector before the bulk 110-tenant archive |
| [#256](https://github.com/lovemansgit/planner/pull/256) | Session B | early PM | Admin top-nav `gap-12` between "· Admin" badge and first nav link (cosmetic T1) |
| [#257](https://github.com/lovemansgit/planner/pull/257) | Session A | PM | Dedicated `/admin/calendar` route under `(admin)/` shell — supersedes the PR #254 nav entry that pointed at `/calendar` (dropped Transcorp staff into the tenant shell) |
| [#258](https://github.com/lovemansgit/planner/pull/258) | Session B | PM | Admin + tenant totals cards + DateRangeFilter dropdown + ADMIN_NAV_ITEMS reorder (Calendar first). Two amendments mid-PR per §3.6 hold: Custom button fix + quick-pick dropdown UX refactor (Datadog/Stripe pattern) replacing the original 5-pill row |
| [#259](https://github.com/lovemansgit/planner/pull/259) | Session A | late PM | `/admin/users` + `/admin/users/new` — full createUser + createRoleAssignment surface with auth.users mirror table + cross-tenant escalation gate |
| [#260](https://github.com/lovemansgit/planner/pull/260) | Session A | EOD | `/admin/users` disable + enable — paired login-block / restore via `supabase.auth.admin.updateUserById` ban_duration toggle. Self-disable blocked (operator can't lock themselves out mid-session) |

Production promotes followed the established inspect-then-promote
pattern via `vercel promote <id> --yes` for each merge.

## §C — Database state changes (production)

Two cleanup operations executed against production via the Supabase
SQL editor today, both per-statement approved by Love:

- **110 stale CI-leak tenants archived.** Bulk UPDATE flipping
  `tenants.status` from `provisioning`/`active` to `'archived'` for
  the test-fixture tenants accumulated across the Day-19 cross-tenant
  probe + Day-10 + Day-15 onboarding sweeps. PR #255 (Session A's
  early-PM ride-along) added the `AND ten.status != 'archived'`
  predicate to all three cross-tenant admin SELECTs (`listAllTasks`,
  `listAllConsignees`, `listAllSubscriptions`) so the archived rows no
  longer surface in `/admin/*` lists. `/admin/merchants` (the
  forensic surface) shows archived rows when `?status=archived` is
  passed; default view excludes via PR #255's predicate.
- **4 test users deleted via SQL editor cleanup blocks.** Test rows
  in `auth.users` + the mirror `users` table created during the Day-24
  /admin/users build-out (Session A PRs #259 + #260). DELETE cascades
  cleanly via the FK chain since the test users had no associated
  role_assignments or tasks. Production user count post-cleanup
  matches expected: 5 production-actor rows (Transcorp sysadmin +
  per-tenant admin × 3 demo merchants + Love's owner account).

## §D — Demo Bistro state

The Chapter 2 live-create target merchant.

- **Status**: `'provisioning'` in `tenants` (created today during the
  Session A user-management probe pass; will be flipped to `'active'`
  on stage via `/admin/merchants/[id]/activate` during the live
  Transcorp-staff onboarding narrative per brief §5.3 Chapter 2).
- **SF customer ID**: `591` (assigned by Aqib; populated on
  `tenants.suitefleet_customer_code`).
- **Webhook URL — PRE-DEMO BLOCKER**: Demo Bistro's per-tenant inbound
  webhook URL needs to be registered in the SuiteFleet portal by Aqib
  BEFORE the May 15 demo. Without that registration, SF will fire zero
  webhook events for Demo Bistro tasks during the demo. Per the
  Day-24 PM webhook-registration investigation: merchant creation in
  the Planner is a pure DB insert + audit emit — **zero outbound SF
  API calls**. The webhook URL `/api/webhooks/suitefleet/[tenantId]`
  uses Planner's UUID (not SF's customer code), and SF routes inbound
  events via that path. Registration is manual on SF's side. Action:
  Love sends Aqib the Demo Bistro UUID + full webhook URL Day-25
  morning so he can wire it before demo time. Tenant Admin can also
  self-serve the copy-URL surface at `/admin/webhook-config` once
  Demo Bistro is logged in.

## §E — Discipline learnings logged Day-24

Two schema-drift instances surfaced today; both caught + remediated.
Confirms the Day-23 §F integration-spec discipline is working AND
extends the lesson set.

- **Schema-drift instance #2 — `assigned_at` vs `created_at` on
  role_assignments.** PR #259 (Session A's `/admin/users` build) hit
  Postgres 42703 column-does-not-exist on the user-list query: SELECT
  referenced `ra.assigned_at` from the `role_assignments` table, but
  the actual column is `created_at` (table predates the
  `assigned_at`/`disabled_at` audit-timestamp convention adopted on
  newer tables). Unit specs mocking `tx.execute` had passed; real
  Postgres caught it. Fix landed in the same PR with an integration
  spec pin at `tests/integration/admin-users-list.spec.ts` mirroring
  the calendar-day-view pattern.

- **Second lesson — `nav-entry bundles need route-shell verification,
  not just route existence.`** PR #254's Day-24 AM ride-along added
  `{ label: "Calendar", path: "/calendar", permission: "task:read_all" }`
  to `ADMIN_NAV_ITEMS`. Functionally the route DID exist (the tenant
  `/calendar` page). But the Calendar nav from the admin shell
  dropped Transcorp staff into the **tenant `(app)/` route group**,
  losing the AdminTopNav + admin styling. PR #257 surfaced the
  problem during Day-24 PM dry-run prep + fixed by adding a dedicated
  `/admin/calendar` route under the `(admin)/` shell. **Rule going
  forward: when adding a nav entry that crosses route groups,
  verify the target route renders under the EXPECTED shell, not just
  that it 200s.**

- **Day-23 §F integration-spec discipline working as designed.**
  Every new SQL path landing today carried an integration spec
  alongside the unit spec. The PR #258 bundle landed 4 new integration
  specs (admin-tasks-count, admin-consignees-count, tenant-tasks-count,
  tenant-consignees-count) per the same protocol. Zero post-merge
  schema-drift escapes today; the discipline holds.

## §F — Open carry-forwards to Day-25

Demo distance is T-2. Day-25 is the LAST FULL DAY before internal
CAIO demo.

**Love's lane (T-2 demo prep):**

- **Dry-run walkthrough — all 8 chapters end-to-end against
  production.** Demo distance T-2 makes this the highest-priority
  Day-25 action. Walkthrough surfaces become defect tickets to either
  Session A or B.
- **Aqib coordination — Demo Bistro webhook URL registration.** Send
  Demo Bistro's UUID + full webhook URL (per §D) so Aqib can wire on
  SF side before demo. ~24-hr buffer required.
- **Spec doc screenshots — Playwright walkthrough capture.** 15-slide
  spec doc has placeholder screenshots pending (see §H); Playwright
  walkthrough script captures them deterministically.
- **`demo-preflight.mjs` run against production.** Confirms all
  invariants green on production HEAD + DB state. Run TWICE on demo
  morning per the script RUNBOOK comment.
- **`verify-demo-seed.mjs` run against production.** Sibling 5-assertion
  smoke verifier from PR #252 + PR #253; targets the data-side
  invariants specifically.

**Session A (Day-25):**

- **Defect patching** as defects surface from Love's dry-run.
  Foreground priority during dry-run window.
- **Warm standby** for Playwright walkthrough script support if
  Session B needs collaboration on screenshot-capture coordination.

**Session B (Day-25):**

- **Playwright walkthrough script** — likely Session B's lane given
  Session A may be busier on defect-patching. Captures spec-doc
  screenshots deterministically (15 slides). Script lives at
  `scripts/walkthrough.mjs` or `tests/e2e/walkthrough.spec.ts`
  (Playwright project — convention TBD on first PR).
- **Defect patching** as defects surface from Love's dry-run.

**Operational:**

- **`MEMORY.md` index reconstruction** (carried over from Day-23 §G).
  Index currently stops at Day 20; Days 21-24 entries to be added in
  this PR's bundle if time permits, or filed Day-25.

## §G — Brief state

Brief at **v1.11** (no amendment today). Last amendment was Day-22's
v1.11 single-address MVP amendment + Day-22's v1.10 Sarah Khouri
pre-seed reconciliation. Day-24 work stayed within v1.11 scope.

## §H — Spec doc state

Spec doc v1 drafted today (15 slides). Slide structure follows the
demo chapter sequence from brief §5.3. **Screenshots are placeholder
boxes pending the Playwright walkthrough capture** (see §F). Each
slide carries a `[screenshot pending]` marker on the placeholder cell.

Expected capture sequence: dry-run reveals UI defects → Day-25
defect-patching PRs land → Playwright walkthrough run captures clean
screenshots → spec doc placeholders replaced → spec doc v1.1 frozen
demo morning.

Status going into Day-25 morning: **draft v1, 15 slides, screenshots
pending**.

---

End of Day-24 EOD. Session A + Session B standing down. Demo distance
T-2 / T-5.

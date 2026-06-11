# Day-30 EOD — Session B

Filed: 2026-05-18 (Mon, EOD). T1 bootstrap-handoff. Session B's Day-30 fixes-lane (A3 → A4 → A2) is fully shipped, promoted, and verified live. Nothing in-flight; session rotates.

## §A — Final state at sign-off

- **Main HEAD:** `18b5f7d705c23b6c180b2679032a57995561b707` — `fix(d30/a2): surface failed-push state to merchant operators on the consignee calendar (T2) (#310)`. Day-30 commit chain on main: `382d79b` (#307 A3) → `e3cda88` (#309 A4) → `18b5f7d` (#310 A2).
- **Production:** **LIVE on `18b5f7d`.** Promoted dpl `dpl_GNcgn1LAZWKvVZzvWqWwKFReKzXr` (`planner-olive-sigma.vercel.app`), rebuilt against prod env via Day-27/28 detour. Smoke green: `/` → 307 → /login, `/login` → 200, dpl correlation confirmed via Link header (`?dpl=dpl_GNcgn1LAZWKvVZzvWqWwKFReKzXr` on all preload assets).
- **Rollback anchor:** `dpl_JDJs8LCyiD4nZ4vJzGKnR8emFC3j` (source SHA `b86466a0fdd4b07e2fa1344e37979bfd23beeeb3`, D29 §D(2) Phase-1). Still Ready in Vercel — one alias-swap returns prod to the prior known-good state if Tue smoke regresses.
- **Schema:** UNCHANGED from D29 (Day-30 fixes are all code-only, zero schema delta — explicit T2-verified for A2). Migration 0026 still latest applied.
- **Brief:** UNCHANGED (no amendment Day-30).

## §B — Day-30 arc

Three independent Aqib UAT defects from 2026-05-18 came in as a sequential fixes-lane (do-not-bundle). Built on top of D29 §D(2) Phase-1 production (`b86466a`). All three landed T2, each with its own PR + §3.6 review + Love-instructed merge + Love-instructed promote at the end:

- **A3** ([#307](https://github.com/lovemansgit/planner/pull/307), `382d79b`) — outbound TZ +4h drift. Root cause: missing Dubai-local→UTC conversion on `buildSuiteFleetTaskBody` / `buildSuiteFleetUpdatePatchBody`; SF interprets bare HH:MM:SS as UTC. Fix: single `buildWireWindow` helper, deliveryDate STAYS Dubai-local per reviewer ruling, inversion-after-conversion throws ValidationError. Aqib UAT case (10:00→12:00 Dubai → 06:00→08:00 UTC) load-bearing assertion. apply-webhook-edit-event.ts inbound TZ symmetric bug confirmed and routed to A1 lane (Session A) — NOT touched.
- **A4** ([#309](https://github.com/lovemansgit/planner/pull/309), `e3cda88`) — merchant-create form-wipe on validation. Root cause: React 19 `<form action>` resets uncontrolled inputs on submit; Field had no `defaultValue` binding. Fix: parser returns `submittedValues` in both branches, action threads through every error result kind, Field gets `defaultValue` (HTML `form.reset()` semantic restores to defaultValue; no remount counter needed). Initial commit tripped CI on cascading-renders / refs-during-render lint rules → fixup landed the cleaner form.reset() approach. Stale FieldProps JSDoc fix shipped post-§3.6.
- **A2** ([#310](https://github.com/lovemansgit/planner/pull/310), `18b5f7d`) — silent push-failure invisible to merchant. T2 verified pre-coding: data IS persisted merchant-side (`failed_pushes.tenant_id` RLS-scoped) — no schema work. Fix: new `failed_pushes:read` permission (in-code memo at permissions.ts:503-507 pre-blessed the split), explicit role wiring (Tenant Admin auto, Ops Manager + CS Agent explicit), new `listFailedPushTaskIdsForTenant(ctx)` service fn returning `Set<Uuid>` (data-minimization — failure_payload stays admin-only via existing `failed_pushes:retry` gate), consignee calendar threading + DayActionPopover "Failed push" badge.

## §C — Discipline notes (Day-30-specific)

- **CI-bypass discipline held** on A4. CI red on lint (cascading-renders + refs-during-render). Did NOT --admin. Diagnosed → simplified approach (drop the remount counter, rely on HTML form.reset() → defaultValue) → green.
- **Force-push discipline held.** A3 + A2 each needed no force-push (clean new-branch pushes). A4's CI-red fixup landed as a new commit on top (no force-push), respecting the rebase-auth-≠-force-push-auth memo.
- **T2-vs-T3 gate honoured** on A2. Surfaced verdict + evidence chain pre-coding per the directive ("do not assume — verify"). The in-code permissions.ts memo pre-blessing the read/retry split was the decisive evidence keeping it T2.
- **No new institutional memos** filed Day-30.

## §D — Out-of-scope-for-Day-30 (explicit; flagged but not built)

These were touched-but-not-built during the lane and flagged for future PRs:

- **Consignee header "Failed" summary stat tile** (brief commitment, A2 PR body section). Separable from Aqib's load-bearing bug.
- **`/admin/failed-pushes` page accessible to non-Tenant-Admin merchant roles.** Separate permission gating work.
- **`/tasks` page CS Agent access.** Currently entire page errors for non-perm holders — different issue (the page reuses `listUnresolvedFailedPushes` which requires `failed_pushes:retry`).
- **apply-webhook-edit-event.ts inbound TZ symmetric bug.** Confirmed real Day-30 during A3 diagnosis; routed to A1 lane (Session A).

## §E — Carry-forward — none from Session B

Nothing parked for Session B. The fixes-lane is fully closed end-to-end. Production reflects all three fixes cumulatively. Rollback anchor preserved. Smoke green.

## §F — Reference

- A3 plan + impl context: PR #307 body + commit message at `382d79b`.
- A4 plan + impl context: PR #309 body + 3 commits on the branch (squashed at merge as `e3cda88`).
- A2 plan + impl context: PR #310 body + commit message at `18b5f7d`. T2 verification evidence chain in PR body.
- D29 §D(2) Phase-1 (the prior production anchor for this branch): merged at `b86466a` (#305).

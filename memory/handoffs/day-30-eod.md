# Day-30 EOD — comprehensive (both sessions)

Filed: 2026-05-18 (Mon, EOD). Cross-session canonical Day-30 record. Three independent threads ran in parallel: (i) Session B fixes-lane (A3 → A4 → A2) shipped, promoted, and live; (ii) Session A A1 plan-PR #306 fully ruled and gated on Phase-0 evidence; (iii) Session A B2 plan-PR #308 cleared + B2 code-PR #312 opened — §3.6 hard-stop #2 NOT yet performed and parked as the FIRST next-session action.

Companion T1 handoff already on main: [`day-30-eod-session-b.md`](day-30-eod-session-b.md) (PR #311 `8ff4462`). This doc supersedes/extends it with the Session A surface area + cross-thread synthesis.

## §A — Final state at sign-off

- **Main HEAD:** `8ff4462` — `docs(d30): Session B EOD handoff — fixes-lane (A3+A4+A2) shipped + promoted (T1, memory-only) (#311)`. Day-30 commit chain on main: `382d79b` (#307 A3) → `e3cda88` (#309 A4) → `18b5f7d` (#310 A2) → `8ff4462` (#311 Session B handoff).
- **Production:** **LIVE on `18b5f7d`** via `dpl_GNcgn1LAZWKvVZzvWqWwKFReKzXr` (alias `planner-olive-sigma.vercel.app`), rebuilt against prod env per the Day-27/28 detour. Smoke green: `/` → 307 → `/login`, `/login` → 200, dpl correlation confirmed via Link header on preload assets. (Production HEAD `18b5f7d` is one commit BEHIND main HEAD `8ff4462` — the bootstrap-handoff PR #311 is memory-only and intentionally NOT promoted.)
- **Rollback anchor:** `dpl_JDJs8LCyiD4nZ4vJzGKnR8emFC3j` (source SHA `b86466a0fdd4b07e2fa1344e37979bfd23beeeb3`, D29 §D(2) Phase-1). Still Ready in Vercel — one alias-swap returns prod to the prior known-good state if Tue smoke regresses.
- **Schema:** UNCHANGED from D29 (Day-30 fixes are all code-only, zero schema delta — explicit T2-verified for A2; B2 #312 is also schema-zero). Migration 0026 still latest applied on prod.
- **Brief on main:** **v1.15** (unchanged). The v1.16 cutoff-drift append is in B2 #312's diff (one-line addition to the §9 amendment table) and goes live on main when #312 squash-merges; this EOD doc PR explicitly does NOT touch the brief.

## §B — Day-30 arc (cross-session synthesis)

Three parallel threads in two worktrees plus the EOD-doc thread, no cross-thread collision:

### B.1 — Session B fixes-lane (A3 → A4 → A2): SHIPPED + LIVE

Three independent Aqib UAT defects from 2026-05-18 came in as a sequential fixes-lane (do-not-bundle). Built on top of D29 §D(2) Phase-1 production (`b86466a`). All three landed T2, each with its own PR + §3.6 review + Love-instructed merge + Love-instructed promote at the end:

- **A3** ([#307](https://github.com/lovemansgit/planner/pull/307), `382d79b`) — outbound TZ +4h drift. Root cause: missing Dubai-local→UTC conversion on `buildSuiteFleetTaskBody` / `buildSuiteFleetUpdatePatchBody`; SF interprets bare HH:MM:SS as UTC. Fix: single `buildWireWindow` helper, deliveryDate STAYS Dubai-local per reviewer ruling, inversion-after-conversion throws ValidationError. Aqib UAT case (10:00→12:00 Dubai → 06:00→08:00 UTC) load-bearing assertion. `apply-webhook-edit-event.ts` inbound TZ symmetric bug confirmed and routed to A1 lane (Session A) — NOT touched.
- **A4** ([#309](https://github.com/lovemansgit/planner/pull/309), `e3cda88`) — merchant-create form-wipe on validation. Root cause: React 19 `<form action>` resets uncontrolled inputs on submit; Field had no `defaultValue` binding. Fix: parser returns `submittedValues` in both branches, action threads through every error result kind, Field gets `defaultValue` (HTML `form.reset()` semantic restores to defaultValue; no remount counter needed). Initial commit tripped CI on cascading-renders / refs-during-render lint rules → fixup landed the cleaner form.reset() approach. Stale FieldProps JSDoc fix shipped post-§3.6.
- **A2** ([#310](https://github.com/lovemansgit/planner/pull/310), `18b5f7d`) — silent push-failure invisible to merchant. T2 verified pre-coding: data IS persisted merchant-side (`failed_pushes.tenant_id` RLS-scoped) — no schema work. Fix: new `failed_pushes:read` permission (in-code memo at `permissions.ts:503-507` pre-blessed the split), explicit role wiring (Tenant Admin auto, Ops Manager + CS Agent explicit), new `listFailedPushTaskIdsForTenant(ctx)` service fn returning `Set<Uuid>` (data-minimization — failure_payload stays admin-only via existing `failed_pushes:retry` gate), consignee calendar threading + DayActionPopover "Failed push" badge.

Session B rotated mid-Day-30 with T1 bootstrap-handoff PR [#311](https://github.com/lovemansgit/planner/pull/311) merged @ `8ff4462` (--admin per the memory-only branch-protection carve-out).

### B.2 — Session A A1 status-mapping-defect plan-PR #306: FULLY RULED, code-PR PHASE-0-GATED

[PR #306](https://github.com/lovemansgit/planner/pull/306) — T3 plan-PR for A1 status-mapping defect per BRD §4.1. v3, FULLY RULED, all 10 OQs locked (OQ-10 recorded). Driver: Aqib UAT (Slides 7, 8-reflect, 10) confirmed SF status webhook events (Picked Up, Cancelled, Delivered, In Transit, Failed, …) are captured by the inbound receiver but ALL render as generic "Updated"; DELIVERED does not surface POD.

- **Headline diagnostic (in #306's plan §2-§3):** Mapping IS present in THREE separate, independently-maintained action-code vocabularies — NOT a single empty/unwired layer. (A) parser `KNOWN_ACTIONS` (15 entries); (B) status-mapper `ACTION_TO_INTERNAL_STATUS` (14 entries with silent null-drop for unknowns); (C) drawer `ACTION_LABELS` (16 entries). Vocabulary drift confirmed: drawer expects `TASK_STATUS_UPDATED_TO_ASSIGNED`; parser+mapper expect `TASK_HAS_BEEN_ASSIGNED`.
- **Strongest hypothesis (NOT static-provable, hence the Phase-0 gate):** SF wire emits `TASK_HAS_BEEN_UPDATED` for most/all lifecycle changes → receiver dispatches on literal raw-string → all land in `applyWebhookEditEvent` → drawer renders "Updated". Status-specific codes either don't fire or use vocabulary the mapper doesn't know (silent drop via `apply-webhook-status-event.ts:81-83` early return BEFORE the `webhook_events` INSERT — no forensic trail).
- **Code-PR is GATED on Phase-0 SQL** (OQ-1 ruled gating). Three queries (Q-A / Q-B / Q-C) are scoped to be Love-run on production; results disambiguate the hypothesis space and dictate whether the fix is (i) parser/mapper vocab realignment, (ii) routing rewire, or (iii) both.
- **OQ-7 ruled: NO brief v1.16 expected** for the status-mapping fix (scope-distinct from B2 #308's OQ-6 = v1.16 brief append on cutoff-drift).
- **Clean parked pickup.** Plan-PR remains OPEN at SHA `72bbf8e` on branch `plan/d30-a1-status-mapping-defect`. Next reviewer session reads the §3 mapping contract + §4 POD same-lane recommendation + §6 OQ index + §9 code-PR shape preview; runs Phase-0 SQL; greenlights the code-PR build off the Phase-0 results.

### B.3 — Session A B2 /tasks-page cancel + edit: plan-PR #308 CLEARED, code-PR #312 OPEN + §3.6 #2 NOT YET PERFORMED

- **Plan-PR [#308](https://github.com/lovemansgit/planner/pull/308)** (T3-light) — v2 §3.6 CLEARED at SHA `9e1efa5`. Scope: surface cancel + edit (address + note only) for non-cutoff-elapsed tasks on the `/tasks` page operator surface, sharing the calendar-popover service contracts. OQ-6 ruled = brief v1.16 cutoff-drift supersede append (record the supersede at the source-of-truth, since `decision_task_editability_cutoff_at_assigned.md` says "lock at TASK_HAS_BEEN_ASSIGNED" but §3.1.8 of the brief is the canonical time-based 18:00-Dubai-day-before cutoff enforced at 10 service-layer sites).
- **Code-PR [#312](https://github.com/lovemansgit/planner/pull/312)** (T3) — OPEN at pinned SHA `49faf9592a84d87dde561cdd60ec71135196ea40` on branch `fix/d30-b2-tasks-page-cancel-edit`. Includes: source files (`src/app/(app)/tasks/_actions.ts`, `client.tsx`), tests (`tests/integration/tasks-page-cancel.spec.ts`, `tasks-page-edit.spec.ts`), brief v1.16 amendment append, plus three new T1 followup memos and the supersede header on `decision_task_editability_cutoff_at_assigned.md`. OQ-8 pre-check **passed** (subscriptionId already on Task shape; no widening required). CI was PENDING at park (unit + integration in flight).
- **🔴 T3 §3.6 hard-stop #2 NOT YET PERFORMED.** This is the explicit FIRST ACTION for the next reviewer session, against green CI. Highest-risk surfaces to focus on:
  - **OQ-5 — `.strict()` whitelist boundary** on the address/note edit input parser; verify the schema rejects every key not in the allowlist (defence-in-depth against a future overshare from the client form).
  - **B2-I2′ — two-layer ad-hoc server-side rejection** on the cancel/edit action paths (page-level guard + service-layer cutoff-elapsed re-check). Confirm both layers fire even when the page-level guard is bypassed (URL hand-edit / racing client state).
- **Carry-forward dependency:** The brief v1.16 amendment lives inside #312's diff. Brief on main remains v1.15 until #312 squash-merges. The v1.16 entry verbatim (verified Day-30 PM via `gh pr diff 312`):

  ```
  | v1.16 | 18 May 2026 (Day 30 PM, post B2 plan-PR #308 §3.6 clearance) | Cutoff-drift supersede record. Day-3 decision memo `memory/decision_task_editability_cutoff_at_assigned.md` ("lock at TASK_HAS_BEEN_ASSIGNED") is SUPERSEDED. §3.1.8 is canonical: editability is gated by the time-based 18:00-Dubai-day-before cutoff (enforced at 10 service-layer sites via `isCutOffElapsedForDate`); `internal_status='ASSIGNED'` is mutation-eligible. The "task ASSIGNED before time-cutoff → merchant can cancel a dispatched task" edge is logged as KNOWN pre-existing post-demo hardening at `memory/followup_assigned_before_cutoff_dispatch_race.md` (NOT introduced by B2 — pre-existing on the calendar popover surface). Driver: B2 plan-PR #308 ruled OQ-6 = v1.16 brief append (record the supersede at source-of-truth). Scope-distinct from A1 plan-PR #306 OQ-7 ("no v1.16 for the status-mapping fix"); both rulings coexist. |
  ```

## §C — Production scare resolved (false alarm)

Mid-Day-30, a brief panic surfaced when an unexpected Vercel project (`deploy-clean`) appeared in `vercel projects ls` output. Resolution chain:

- **Root cause:** `deploy-clean` is a SEPARATE Vercel project bound to a SEPARATE repo (`lovemansgit/transcorp-we…` — not the planner repo). It has NO production deployment of its own.
- **Cross-contamination check:** confirmed `planner-olive-sigma.vercel.app` is bound to the `planner` project (not `deploy-clean`). Production unaffected.
- **Verdict:** false alarm; no production contamination; no rollback warranted. Cross-project boundary note drafted to surface during the next `deploy-clean` reviewer touch (so the project isn't accidentally aliased onto a planner-shaped URL in the future).

## §D — Discipline notes (Day-30-specific, cross-session)

- **CI-bypass discipline held** on A4 (Session B). CI red on lint (cascading-renders + refs-during-render). Did NOT `--admin`. Diagnosed → simplified approach (drop the remount counter, rely on HTML form.reset() → defaultValue) → green.
- **Force-push discipline held.** A3 + A2 each needed no force-push (clean new-branch pushes). A4's CI-red fixup landed as a new commit on top (no force-push), respecting the rebase-auth-≠-force-push-auth memo.
- **T2-vs-T3 gate honoured** on A2 (Session B). Surfaced verdict + evidence chain pre-coding per the directive ("do not assume — verify"). The in-code permissions.ts memo pre-blessing the read/retry split was the decisive evidence keeping it T2.
- **Single-diagnostic-surprise discipline applied** on A1 (Session A) — the "single empty mapping layer" framing was the surprise; second structurally-different diagnostic falsified it (THREE vocabulary copies + drift), drove the Phase-0-evidence-mandatory gate. **Third live application** (after Day-27 webhook + Day-28 appendWithoutSkip).
- **Cross-session non-collision held.** A3 diagnosis discovered the inbound TZ symmetric bug in `apply-webhook-edit-event.ts` and surfaced it as out-of-A3-scope rather than expanding (correctly routed to A1's lane). A1 and B2 ran in parallel worktrees with no shared-file overlap.
- **No new institutional memos** filed Day-30. Three new T1 followup memos filed within B2 #312 (`followup_address_edit_sf_outbound_gap.md`, `followup_assigned_before_cutoff_dispatch_race.md`, `followup_tasks_page_vs_popover_address_path_asymmetry.md`) — all scoped to B2's edit surface, not institutional.

## §E — Out-of-scope-for-Day-30 (explicit; flagged but not built)

Items touched-but-not-built during Day-30 lanes that need future PRs:

- **Consignee header "Failed" summary stat tile** (brief commitment, A2 PR body section). Separable from Aqib's load-bearing bug.
- **`/admin/failed-pushes` page accessible to non-Tenant-Admin merchant roles.** Separate permission gating work.
- **`/tasks` page CS Agent access.** Currently entire page errors for non-perm holders — different issue (the page reuses `listUnresolvedFailedPushes` which requires `failed_pushes:retry`). NB: not the same as B2 #312's cancel/edit scope (B2 ships the cancel+edit affordances behind the existing tasks page; CS-Agent route access remains a separate gating fix).
- **apply-webhook-edit-event.ts inbound TZ symmetric bug.** Confirmed real Day-30 during A3 diagnosis; routed to A1 lane (Session A) for plan-PR #306-class treatment in a future Phase-0-evidence-driven follow-on.
- **B1 address-edit display lane** — explicitly out of A1 scope per A1 plan §5; explicitly out of B2 scope per B2 plan §6. Not opened Day-30.

## §F — Carry-forwards (next-session pickup queue)

In priority order for the next session's first reviewer touch:

1. **🔴 B2 #312 §3.6 hard-stop #2 — FIRST ACTION.** Against green CI. Body-read at the pinned SHA `49faf959…`. Focus surfaces flagged at §B.3 above (OQ-5 `.strict()` whitelist + B2-I2′ two-layer rejection). Verdict drives merge ± promote.
2. **A1 plan-PR #306 Phase-0 SQL — Love-run on production.** Three read-only queries (Q-A / Q-B / Q-C) per the plan §2 evidence chain. Results unblock the A1 code-PR build.
3. **Session B `/compact`** — pending user-side invocation; nothing on the Builder side to action.
4. **MEMORY.md index-fold for Day-29 + Day-30** — handled by this EOD doc PR (Day-29 backfill + Day-30 forward). Future Day-31 EOD ritual carries forward as normal.
5. **Worktree cleanup queue (~6 stale Day-29/30 worktrees).** Non-urgent — branches are merged + deleted on remote, but local worktrees are still mounted. Sweep when a Day-31+ ritual catches them.
6. **B1 address-edit display plan-PR — not yet scoped.** Lane exists; nobody has opened it yet. Defer to post-§3.6 #2 unless Aqib UAT triggers it sooner.
7. **Setup runbook (Aqib's ask)** — separate doc-PR scope; outstanding from prior days, untouched Day-30.
8. **A3 promote-detour note** — the Day-27/28 rebuild-against-prod-env detour fired cleanly on the Day-30 promote (cumulative 18b5f7d on dpl_GNcgn1LAZWKvVZzvWqWwKFReKzXr). Pattern continues to work; no amendment needed; flagged here as a green-data-point for the existing operational runbook.

## §G — Reference

- **Session B fixes-lane:** [`day-30-eod-session-b.md`](day-30-eod-session-b.md) (PR #311) for the original closeout. Per-PR detail in #307 + #309 + #310 bodies.
- **A1 plan:** [`memory/plans/day-30-a1-status-mapping-defect.md`](../plans/day-30-a1-status-mapping-defect.md) (PR #306, OPEN).
- **B2 plan:** [`memory/plans/day-30-b2-tasks-page-cancel-edit.md`](../plans/day-30-b2-tasks-page-cancel-edit.md) (PR #308, OPEN — v2 cleared at SHA `9e1efa5`).
- **B2 code:** PR #312 OPEN at SHA `49faf9592a84d87dde561cdd60ec71135196ea40`. Brief v1.16 append lives in this diff.
- **D29 §D(2) Phase-1 (prior production anchor for Day-30):** merged at `b86466a` (#305). Production rollback anchor.
- **Active-lane followup digest after this EOD PR merges:** [`memory/MEMORY-followup-current.md`](../MEMORY-followup-current.md) — rotated to A1 status-mapping defect (Phase-0-SQL gated).

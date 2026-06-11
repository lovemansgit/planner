# Session B bootstrap brief — Day-22 AM start

**For:** fresh Session B successor at Day-22 AM kickoff
**Filed:** Day 21 (10 May 2026), evening / Day 22 (11 May 2026) AM ride-along, post Day-22 Block 4 close (#233 forms primitives + #234 Day-21 EOD + #235 Session A bootstrap brief merged)
**Filed by:** outgoing Session B, pre-bed T1 ride-along
**Lane:** PR-B popover actions — wires the day-popover action buttons (skip overrides, pause, address changes, etc) per Day-20 EOD §6.3 + locked DECISION-5

---

## §1 Handoff context

Day-21 + Day-22 AM closed with Session B's substantive work landing across four PRs adjacent to the lane this brief opens:

- **PR #229** — header alignment brand-pass (T1). Operator + admin top-bar `items-end → items-center` on inner Link. Merged at `ad86392`.
- **PR #230** — §3.3.3 calendar PR-A2 (T3). Month + Year + view-toggle + UXF5 v2 (Option A revert + v2-forward preserves v1→v2 lesson in git history). Merged at `35a591a`. Closes the §3.3.3 view-trio that PR #223 began; PR-B (this lane) is the third leg of the calendar trilogy.
- **PR #233** — Phase 1 form UI primitives library (T2). Net-new shared primitives at `src/components/forms/`: FormField · FormError · FormSubmitButton · AddressPicker · WeekdaySelector · TimeWindowPicker (+ helper tests). Merged at `ccb80f6`. AddressPicker is directly consumed by PR-B's `change_address_one_off` / `change_address_forward` actions.
- **PR #234** — Day-21 EOD doc (T1). Filed Day-22 AM ride-along. Merged at `8e5fbfc`.
- **PR #235** — Session A Day-22 AM bootstrap brief (T1). Companion to this brief; covers Session A's frontend-forms lane. Merged at `2f71e75`.

**Day-22 AM Session B scope: PR-B popover actions.** Per Day-20 EOD §6.3 + locked DECISION-5 (PR #221 plan-PR), wires 5-7 net-new server actions to the existing `DayActionPopover` component (scaffolded at PR #177 Day 17, refined at PR #223 calendar PR-A). 4-5 net-new perms (incl `task:add_note` pre-registered at PR-A) + audit emits + tests. Lane chunks below in §5.

**This is bootstrap only. Do NOT begin substantive code work in the bootstrap session.** Day-22 AM Session B wakes up fresh, reads this brief + the references in §10, then opens code work in a fresh context window.

---

## §2 Branch state at handoff

- **`origin/main` HEAD:** `2f71e75` (post #235 Session A bootstrap brief merge).
- **Production HEAD:** unpromoted Day-20/21 batch held by Love; Day-22 morning batched Vercel promote sweeps:
  - #220 / #221 / #222 / #223 / #224 / #225 / #226 (Day-20 substantive + Day-21 morning bootstrap)
  - #227 SF outbound adapter
  - #228 demo-preflight
  - #229 header alignment
  - #230 §3.3.3 calendar PR-A2
  - #231 service-layer publisher
  - #232 brief v1.10 amendment
  - #233 forms primitives library
  - #234 Day-21 EOD doc
  - #235 Session A bootstrap brief
  - this T1 bootstrap brief PR (Session B), when it lands
- **Migration 0023** — `0023_outbound_push_failures.sql` application to Production DB, atomic with the Day-22 morning Vercel promote per CONCERN B PII-strip-at-write contract. Love's lane.
- **Vercel CLI scope quirk** persists per Day-20 EOD §2.1 — use `--scope=lovemansgits-projects` flag.
- **Session A's day22/forms-* branches** are orthogonal to PR-B and MUST NOT be touched. Session A has worktrees at `/Users/lovemans/work/planner-day22-svc` (`day22/phase-1-service-layer-publisher`, merged as #231 at `ed5963b`) + `/Users/lovemans/work/planner-day22-brief` (`day22/bootstrap-brief`, merged as #235 at `2f71e75`) + the forms lane that Session A opens fresh Day-22 AM.
- **Session B worktree posture:**
  - `/Users/lovemans/Code/planner-forms` (`day22/forms-ui-primitives`) — primitives library worktree. Branch merged as #233 at `ccb80f6`. Worktree can be pruned (`git worktree remove`) post-merge.
  - `/Users/lovemans/Code/planner-header` (`day21/header-alignment-brand-pass`) — header brand-pass worktree. Branch merged as #229. Worktree can be pruned.
  - `/Users/lovemans/Code/planner-d22b` (`day22/bootstrap-brief-session-b`) — this bootstrap brief worktree.
  - Day-22 AM PR-B lane opens in a **fresh worktree** (suggested name: `/Users/lovemans/Code/planner-d22b-prb` from `day22/calendar-pr-b-popover-actions` branched off post-promote main HEAD).

---

## §3 DECISION-5 + popover-actions ruling locked (CRITICAL — do NOT relitigate)

Locked at PR #221 plan-PR + reaffirmed at PR-A2 bootstrap brief #226 + Day-20 EOD §3.4 + §6.3.

### §3.1 The 8-action surface (brief §3.3.3 lines 500-508)

| # | Action | Permission | Status going into PR-B |
|---|---|---|---|
| 1 | Skip this delivery (default rules) | `subscription:skip` | ✓ wired at PR #177 (DayActionPopover Day-17) |
| 2 | Skip with override (move to date / skip without append) | `subscription:override_skip_rules` | ✗ action handler missing; perm exists per Day-13 part-1 |
| 3 | Pause from this date | `subscription:pause` | ✗ calendar-surface handler missing (perm exists for header pause) |
| 4 | Change address for this delivery only | `subscription:change_address_one_off` | ✗ perm + action missing |
| 5 | Change address from this delivery onwards | `subscription:change_address_forward` | ✗ perm + action missing |
| 6 | Cancel delivery (no append, reduces count) | `subscription:cancel_no_append` | ✗ perm + action missing |
| 7 | Add note to driver | `task:add_note` (pre-registered Day-20 per Day-20 EOD §3.4) | ✗ action missing; perm pre-registered |
| 8 | View full task detail (timeline drawer) | `task:view_timeline` | ✗ perm + drawer missing |

### §3.2 DECISION-5 cut-to-buffer ruling (verbatim from PR-A2 bootstrap brief §3.5)

- **All 7 popover actions if buffer holds** (actions 2-8; action 1 already wired at PR #177)
- **Cut to 1-5 demo-essentials if Day-22 lane overruns by >2 hr:**
  1. skip-default (already wired — no new work)
  2. skip-override (move-to-date / skip-without-append)
  3. pause
  4. change-address-one-off
  5. change-address-forward
- **Defer to Phase 2 if cut:** cancel-no-append (6), add-note (7), view-task-detail (8)

### §3.3 Cut-to-buffer trigger

Day-21 PM overrun pushed PR-B from Day-21 to Day-22 AM. The buffer pressure of the original DECISION-5 ruling has shifted — Day-22 AM has more available lane time than Day-21 PM would have had post-PR-A2 close. Recommendation: **target all 7 actions** at lane open; cut to 1-5 only if §3.6 §3.21 helper-consumer body-read surfaces architectural concern late in the lane.

### §3.4 Net-new perms (4-5)

Per Day-20 EOD §3.4 + PR-A2 bootstrap brief §6.1:

- `subscription:override_skip_rules` — **already exists** per Day-13 part-1 (no catalogue add)
- `subscription:cancel_no_append` — NEW; for action 6; cs-agent + ops-manager OR ops-manager-only (verify §J-5 SPLIT PERMS precedent at lane open)
- `task:add_note` — **pre-registered Day-20** per Day-20 EOD §3.4 "New permission name pre-registered: `task:add_note` (Day-21 PR-B implementation)"
- `task:view_timeline` — NEW or already exists; **verify in catalogue at lane open** per PR-A2 bootstrap brief §6.1
- `subscription:change_address_one_off` — NEW; for action 4
- `subscription:change_address_forward` — NEW; for action 5

### §3.5 Action handler location

Per PR-A2 bootstrap brief §6.2: extend `src/app/(app)/consignees/[id]/_calendar-actions.ts` (existing file from PR #177; PR-B EXTENDS, does NOT replace). One Server Action per popover action.

### §3.6 Handler routing

Per PR-A2 bootstrap brief §6.3: popover already scaffolded via `DayActionPopover` (PR #177). Wire each action button to its Server Action; surface success/failure inline per popover surface (matches the existing skip-default UX pattern).

---

## §4 Plan-locked architectural concerns (CRITICAL — verify in code-PR §3.6)

### §4.1 CONCERN — Permission gating per §J-5 SPLIT PERMS precedent

Day-19 EOD §J-5 ruling (line 130):

> **§J-5:** SPLIT PERMS — `task:create` / `task:bulk_update` / `task:bulk_cancel` → ops-manager ONLY; `task:cancel` → ops-manager AND cs-agent.

PR-B's popover actions follow the same precedent. Skip-default + add-note are routine ops; skip-override + cancel-no-append + change-address-forward are destructive / cascade-implicating. Verify at lane open whether each new perm slots in as "ops-manager-only" (destructive) or "ops-manager + cs-agent" (routine). Reviewer ruling on exact role-to-perm assignment may surface as §3.6 ask if assignment is non-obvious.

Per PR-A2 bootstrap brief §6.1, the perm catalogue updates land at `src/modules/identity/permissions.ts` with role assignments.

### §4.2 CONCERN — Service-layer routing (does PR-B need new service-layer surface?)

Per PR-A2 bootstrap brief §6.2: each Server Action **calls existing service-layer fn** (skip flow / pause flow / address override flow / etc.). Audit emits per existing service-layer pattern; **no new audit-event registration needed; existing event types cover** (brief §3.1.2 already enumerates `subscription.exception.created` + `subscription.end_date.extended` + `subscription.address_override.applied` + `subscription.paused` + `subscription.resumed` per Day-13 part-1 PR #139).

Verify at lane open:
- `addSubscriptionException(ctx, subscriptionId, params)` handles all 5 exception types (skip / skip-override / pause / address-override-one-off / address-override-forward / append-without-skip) per brief §3.1.4. Confirm signature accommodates each popover action's params.
- `appendWithoutSkip(ctx, subscriptionId, params)` handles action 6 (cancel-no-append per DECISION-5 framing IS distinct from "append without skip" — but the cancel-no-append action surface may not need a new service-layer fn; **verify** during §3.6 helper-consumer body-read).
- `addNoteToDriver(ctx, taskId, note)` — NET-NEW service-layer fn for action 7. No existing precedent; ride-along with PR-B if action 7 makes the cut.
- `view_full_task_detail` (action 8) — drawer is net-new UI; service-layer surface may need new `getTaskTimeline(ctx, taskId)` fn. Verify against `consignee_timeline_events` view precedent from brief §3.3.7.

### §4.3 CONCERN — Audit emit per existing service-layer pattern

PR-A2 bootstrap brief §6.2 says no new audit-event registration needed because existing event types cover. **Verify** during §3.6 body-read that:

- `subscription.exception.created` body shape (per brief §3.1.2) covers all 5 exception types — yes per existing pattern
- `task.note_added` — possibly NEW audit event for action 7 if `task:add_note` flows through a non-exception audit path. **Verify**; if NEW event needed, file ride-along audit-event registration at `src/modules/audit/event-types.ts` per Day-13 part-1 precedent.

### §4.4 CONCERN — `task:add_note` perm pre-registered ✓

Day-20 EOD §3.4 explicit ruling:
> "New permission name pre-registered: `task:add_note` (Day-21 PR-B implementation)"

Perm name LOCKED. Lane open just wires the perm into role assignments + the Server Action permission check.

### §4.5 CONCERN — DECISION-2 (ii) projection layer untouched

PR-B is action-handler scope ONLY. The render-time `projectDayDisplayStatus` projection layer from DECISION-2 (ii) (locked at PR-A2 #230) is consumed but NOT extended by PR-B. Do NOT touch `src/app/(app)/consignees/[id]/_components/DayDisplayStatus.ts` per `feedback_no_self_tier_escalation.md` discipline — that's projection-layer surface, not action-handler surface.

---

## §5 PR-B lane plan (Day-22 AM, ~5-7 hr aggregate)

### §5.1 Sub-lane groupings (5-7 actions, 4-5 perms, audit + tests)

Group related actions for review-clean sub-PR shape. Three plausible groupings:

**Option A — single PR (recommended if scope ~5 hr):**
- All 5 demo-essentials in one PR-B: skip-override + pause + change-address-one-off + change-address-forward + (optional) cancel-no-append
- Single perm catalogue update + single audit-emit ride-along
- Reviewer §3.6 body-read on the full PR-B surface at PR open

**Option B — split into PR-B1 (skip + pause) + PR-B2 (address ops):**
- PR-B1: skip-override (action 2) + pause-from-this-date (action 3). Lower-cascade actions.
- PR-B2: change-address-one-off (action 4) + change-address-forward (action 5) + cancel-no-append (action 6). Higher-cascade actions; touches address rotation surface.
- If buffer holds: PR-B3 (add-note + view-timeline; actions 7 + 8).

**Option C — defer all extras (cut-to-buffer fallback):**
- PR-B ships only the demo-essentials (skip-override + pause + 2 address actions); cancel-no-append + add-note + view-timeline deferred to Phase 2 per DECISION-5.

**Recommendation at lane open:** Option A (single PR) targeting all 7 actions if §3.6 helper-consumer body-read pre-PR opens clean. Cut to Option C if §3.6 surfaces architectural concern.

### §5.2 Tier

**T3** (likely) — perm catalogue additions (4-5 new perms) + audit event registrations + service-layer fns trigger T3 hard-stop per `feedback_no_self_tier_escalation.md` discipline. Plan §F (bulk operations) precedent at PR #222 was T3 for similar surface. **Confirm with Love** at lane open if cut-to-buffer reduces scope below T3 threshold.

### §5.3 Branch posture

- **Branch:** `day22/calendar-pr-b-popover-actions` from main HEAD post Day-22 morning Vercel promote (verify origin/main HEAD at lane open; do NOT branch from a stale local main).
- **Worktree:** NEW worktree at `/Users/lovemans/Code/planner-d22b-prb` (suggested name); separate from Session A's day22/forms-* worktrees + Session B's other day-21/day-22 worktrees.

---

## §6 Frontend-design skill posture (PR-B specific)

Per `bootstrap-session-a-day-22-am.md` §6 + brief §3.3.11 + plan §7 quality gate ("Frontend-design skill activation. Every UI implementation PR explicitly invokes `frontend-design` skill at session start").

PR-B's UI surface is light — action button rendering inside the existing `DayActionPopover` (PR #177). Discipline at session start:

1. Invoke `frontend-design` skill explicitly via Skill tool at lane kickoff (per plan §7 quality gate).
2. Reference [`subplanner.vercel.app/consignee/c_001`](https://subplanner.vercel.app/consignee/c_001) prototype + [`transcorp-lofi-v2.vercel.app`](https://transcorp-lofi-v2.vercel.app) brand language.
3. Brand tokens at [`src/styles/brand-tokens.css`](../../src/styles/brand-tokens.css) are the implementation source of truth (per brief §3.3.11).
4. Hairline borders 0.5px Stone 200 (`#D3CEC2`); never shadows. Sentence case throughout (per Day-17 polish convention).
5. **Action button surface in DayActionPopover** — match existing skip-default button styling (PR #177 precedent); permission-gated visibility per brief §3.3.10 UI rule 1 ("Hide what user cannot access"). Disable-not-hide for non-applicable contextual state per brief §3.3.10 UI rule 2.
6. **AddressPicker** (PR #233 primitive) consumed by `change_address_one_off` / `change_address_forward` actions — pass `allowOverride` per the operator's perm; the `overrideInputName` lands in `_calendar-actions.ts` FormData reading.

---

## §7 T1 ride-alongs (fold opportunistically)

- **Day-21 EOD doc** — DONE; filed at PR #234 (`8e5fbfc`).
- **Day-22 morning batched Vercel promote** — owned by Love (UI/CLI lane); not a Session B action.
- **Migration 0023 application to Production DB** — owned by Love + atomic with the promote.
- **WeekdaySelector sr-only span verbosity** — Phase 2 followup per #233 reviewer ruling ("Monday" announced twice by screen readers). Single-line T1 fix when picked up: drop `<span className="sr-only">{day.short}day</span>` since the input's accessible name already covers. Fold into PR-B if §6 frontend-design pass touches `src/components/forms/WeekdaySelector.tsx` opportunistically; otherwise defer to Day-22+ scope.
- **Followup memos** — verify all open `memory/followup_*.md` referenced in PR-A2 + #233 are still tracked (no audit needed; opportunistic check).
- **Demo-data prep flag for Sarah Khouri** — flagged at PR #230 LANE 3 finding; Sarah's 2026 history needs population (delivery + skip + failure mix across multiple months) before May-15 demo for year view to demo meaningfully. Belongs to brief §5.1 / quality gate #3 territory; tracked for Day-22+ scope but NOT in PR-B lane.

---

## §8 What NOT to do (Session B integrity)

- ❌ Do NOT touch Session A's `day22/forms-*` branches or worktrees (`/Users/lovemans/work/planner-day22-svc`, `/Users/lovemans/work/planner-day22-brief`, or any forms-lane worktree Session A opens fresh Day-22 AM).
- ❌ Do NOT bypass service-layer for direct DB writes from popover actions — service layer is the audit + perm + cutoff gate. Server Action → `addSubscriptionException` / `appendWithoutSkip` / `addNoteToDriver` per §4.2.
- ❌ Do NOT add new audit events without §J-5-style perm catalogue ride-along — verify per §4.3 whether existing event types cover; ride-along audit-event registration at `src/modules/audit/event-types.ts` if NEW event needed.
- ❌ Do NOT relitigate DECISION-5 cut-to-buffer scope — locked at PR #221 plan-PR + reaffirmed PR-A2 bootstrap brief §3.5.
- ❌ Do NOT touch DECISION-2 (ii) projection layer (`DayDisplayStatus.ts`) — projection is render-time concern; PR-B is action-handler scope only. Do not extend projection.
- ❌ Do NOT touch the `CalendarMonthView` / `CalendarYearView` / `CalendarViewToggle` surfaces from PR #230 — view-trio is closed; PR-B only consumes the popover trigger surface (`DayActionPopover`).
- ❌ Do NOT begin substantive code work in this bootstrap session — fresh context window for code-PR open.
- ❌ Do NOT self-escalate tier per `feedback_no_self_tier_escalation.md` — surface to Love pre-PR if PR-B's scope (or cut-to-buffer scope) sits between T2 and T3.

---

## §9 Context-window expectation

**Aggregate ~5-7 hr lane scope** (estimate per §5; refine at lane open based on cut-to-buffer decision).

**Realistic chunking:**

- All 5 demo-essentials in single sub-PR if scope fits ~5 hr (Option A from §5.1)
- Split into sub-PR-B1 (skip + pause) + sub-PR-B2 (address ops + cancel) if scope creeps past ~7 hr (Option B)
- Single sub-PR with cut-to-buffer (demo-essentials only) if reviewer §3.6 surfaces concerns mid-lane (Option C)

**Mid-lane bootstrap brief trigger:** if session burns above ~50% memory mid-PR-B, file mid-lane bootstrap brief before sub-PR-B2 kickoff (precedent: PR #226 PR-A2 bootstrap brief + #235 Session A bootstrap brief).

**Reviewer expectations at PR open:**

- §3.6 hard-stop at sub-PR open (T3 tier per §5.2)
- §3.21 helper-consumer body-read discipline on `addSubscriptionException` consumers + perm-catalogue auto-pickup helpers (`permsFor("subscription")` / `permsFor("task")`)
- §3.22 UX walkthrough discipline on Vercel preview at `/consignees/[id]?tab=calendar` — operator clicks each popover action, verifies success/failure inline, verifies permission-gated rendering for cs-agent vs ops-manager
- §3.24 brief-spec-first discipline — popover action surface anchored on brief §3.3.3 lines 500-508 verbatim; alternative shapes rejected if not in brief

---

## §10 Files to read on Session B spawn (post-bootstrap)

**In order:**

1. [`memory/PLANNER_PRODUCT_BRIEF.md`](../PLANNER_PRODUCT_BRIEF.md) §3.3.3 (consignee detail popover — lines 491-510) + §3.3.5 (subscription detail page — for action context) + §3.3.11 (brand pass) + §10 (acknowledge protocol)
2. [`memory/plans/day-19-phase-1-merchant-crud.md`](../plans/day-19-phase-1-merchant-crud.md) §J (rulings) — §J-5 SPLIT PERMS precedent; §F (bulk operations + popover action pattern); §M (architectural watch-items)
3. [`memory/handoffs/day-19-eod.md`](day-19-eod.md) §J rulings (lines 125-131) — 6 rulings absorbed verbatim incl §J-5 SPLIT PERMS
4. [`memory/handoffs/day-20-eod.md`](day-20-eod.md) §3.4 (5 DECISIONS locked) + §6.3 (PR-B scope inception)
5. [`memory/handoffs/day-21-eod.md`](day-21-eod.md) — Day-21 close substance; PR-A2 ships; DECISION-5 reaffirmed via PR-A2 close
6. [`memory/handoffs/bootstrap-session-b-day-21-am.md`](bootstrap-session-b-day-21-am.md) §3.5 (DECISION-5 cut-to-buffer ruling verbatim) + §6 (PR-B lane plan original framing)
7. [`memory/plans/day-20-consignee-detail-calendar-survey.md`](../plans/day-20-consignee-detail-calendar-survey.md) §4 (8-action table with per-action perm + service-layer routing — load-bearing precedent for PR-B)
8. **PR #221 plan-PR DECISION-5** — exact ruling text on cut-to-buffer scope (locked, do NOT relitigate)
9. **PR #233 merged commit message** — context on forms primitives shipped (AddressPicker / FormField / FormError / FormSubmitButton consumed by PR-B); helper-consumer body-read discipline confirms which primitives plug into PR-B's popover Server Action surface

After absorbing, surface readiness with:
- Verified `origin/main` HEAD post Day-22 morning promote
- Verified migration 0023 applied to Production DB
- Verified perm catalogue inspected at `src/modules/identity/permissions.ts` (which perms already exist, which are NEW)
- Verified service-layer signature inspected at `src/modules/subscriptions/service.ts` + `src/modules/subscription-exceptions/service.ts` (no new service-layer fn needed for actions 2-5 + 6; verify add-note + view-timeline surfaces if those make the cut)
- `frontend-design` skill invoked
- Cut-to-buffer decision surfaced (Option A all-7 vs Option C demo-essentials-only)
- Stand by for §3.6 trigger at PR-B open

---

## §11 Open questions for Love's morning review

These surface from overnight Session B work + DECISION-5 ambiguity and want a ruling before Session B commits irrevocably:

1. **Cut-to-buffer scope at lane open** — Day-22 AM has more buffer than Day-21 PM would have had. Target all 7 actions (Option A) or hew to the cut-to-buffer demo-essentials list (Option C — actions 2-5 only)? **Recommendation: Option A** with mid-lane re-evaluation if §3.21 helper-consumer body-read surfaces concern.

2. **PR-B as single PR or split** — single PR (~5-7 hr) vs sub-PR-B1 (skip + pause) + sub-PR-B2 (address ops) split. **Recommendation: single PR** for clean review surface and rollback boundary; reviewer §3.6 ruling.

3. **`task:add_note` perm — role assignment** — pre-registered Day-20 per Day-20 EOD §3.4 but role assignment unspecified. SPLIT-PERMS precedent at §J-5: routine ops to cs-agent + ops-manager, destructive to ops-manager-only. Note-to-driver is routine (no cascade, no state mutation beyond `tasks.notes` text). **Recommendation: cs-agent + ops-manager** (routine, customer-service-facing).

4. **`subscription:cancel_no_append` — role assignment** — DECISION-5 action 6 perm. cancel-no-append reduces subscription count without compensation; destructive (cannot undo without separate `append_without_skip` perm). **Recommendation: ops-manager-only** (destructive precedent per §J-5).

5. **`task:view_timeline` — perm catalogue verification** — PR-A2 bootstrap brief §6.1 flags "already exists or NEW; verify in catalogue". If NEW: cs-agent + ops-manager (read surface, no mutation). **Verify at lane open** before claiming new-perm count.

6. **Add-note service-layer fn surface** — if action 7 ships, does it route through a NEW service-layer fn `addNoteToDriver(ctx, taskId, note)` OR extend existing `updateTask(ctx, taskId, patch)` with a `note` field? **Verify** during §3.6 helper-consumer body-read against `src/modules/tasks/service.ts` + `src/modules/tasks/types.ts` UpdateTaskPatch shape.

7. **View-timeline drawer — net-new surface or defer?** — action 8 needs a timeline drawer per brief §3.3.6. Per-task delivery status timeline is its own scope chunk; may exceed PR-B buffer. **Recommendation: defer action 8 to Day-22 PM or Day-23+ scope** unless reviewer rules to fold it in for May-15 demo completeness.

If Love rules these as part of morning review, Session B absorbs and proceeds. If a ruling is deferred ("operator-test it and feed back"), Session B picks the recommendation and surfaces in the code-PR §3.6 thread for ratification at PR open.

---

**End of bootstrap brief. Total read time projected ≈ 8-10 minutes for cold session. Carry-forward integrity preserved into Day-22 AM Session B.**

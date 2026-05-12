---
name: Session A Day-22 PM overnight bootstrap brief
description: Pre-/compact bootstrap for autonomous overnight execution — PR #238 final code-side fix (SF push observability + Pushed indicator) followed by PR-C-A /calendar consolidated view lane per Recommendation C. Authoritative §4 scope + §5 OQ rulings replace any need to re-prompt reviewer overnight.
type: project
---

# Session A Day-22 PM overnight bootstrap brief

**For:** post-compact Session A successor — Day-22 PM overnight autonomous lane
**Filed:** Day 22 PM (11 May 2026), pre-compact at 41% remaining context
**Filed by:** outgoing Session A
**Lanes:** (a) PR #238 final code-side fixups, (b) PR-C-A `/calendar` consolidated view per Recommendation C

---

## §1 Spawn purpose

Day-22 PM overnight autonomous work. Two lanes shipped in sequence:

- **PART A** — PR #238 SF push observability + Pushed indicator (single commit, 2 small files touched). Closes the code-side gap on Blocker 5 follow-up. Env-var verification is Love's morning lane (Vercel-auth-gated).
- **PART B** — PR-C-A `/calendar` consolidated view per brief §3.3.4. Session A's slice of OQ-2 split: service-layer + page shell + ConsolidatedWeekView. Session B's parallel PR-C-B (already merged at `2768e408`) shipped MetricCard + CalendarFilterBar + CalendarViewToggle + TaskPreviewRow + links helper.

The post-compact session is NOT a fresh kickoff. It picks up authorised in-flight work with authoritative rulings package in §4–§5. Do not relitigate scope, do not re-prompt for direction. Execute autonomously through commit + push for both lanes, then stop and await Love's morning walk.

---

## §2 Repo state at handoff

- **PR #238 branch:** `day22/phase-1-forms-consignee-subscription` HEAD `f66c005` (Fix 1 + Fix 2: subscription list consignee names + detail tasks list). 13 files modified + 1 new. Tests 1599 / lint baseline / tsc clean. OPEN — awaiting Love's env-var inspection + merge auth.
- **Worktree A:** `/Users/lovemans/work/planner-d22-forms` — existing. Continue here for PART A.
- **Worktree B for /calendar lane:** to create at `/Users/lovemans/Code/planner-d22n-calendar-a` from `origin/main`.
- **origin/main HEAD:** `2768e408` `feat(d22n-calendar-pr-c-b): /calendar primitives + drill-down helpers (T2) (#242)` — Session B's PR-C-B merged. Primitives + helpers + types available.
- **PR #237 (Session B's Day-22 calendar lane) and PR #238** BOTH still OPEN; batched merge awaits Love's morning auth. Do not touch PR #237 branch.
- **PR-C-A branch name:** `day22n/calendar-consolidated-pr-c-a` (to create from `origin/main`).

---

## §3 Diagnostic 3 findings (SF push not firing) — context for PART A

Hypothesis (b) strongest: `PUBLIC_BASE_URL` on preview deployment may point to production. QStash callback POSTs to production, which has no record of the preview's task IDs. Consumer silently 404s. No AWB, no error.

**Code-side gaps PART A addresses:**

1. B5 commit `3922850` only logs on FAILURE — no success log to confirm enqueue fires. Operator/reviewer cannot tell from Vercel logs whether the post-commit `enqueueTaskPushBatch` ever ran.
2. No "✓ Pushed to SuiteFleet" UI indicator exists in codebase — only the AWB string is rendered (em-dash when null) in `/tasks` list and `SubscriptionTasksList`. Operators cannot visually distinguish "pushed but no AWB yet" from "never pushed".

**Env-var verification gates (NOT in code-side scope):** Love's morning lane.

- `PUBLIC_BASE_URL` on preview scope — must point to preview alias, not production.
- `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` on preview — consumer route uses `verifySignatureAppRouter`; missing keys → 401 on every callback.
- `SUITEFLEET_*` creds on preview (sandbox tier per Day-20 ruling).

The full Diagnostic 3 report should be filed at `memory/handoffs/day-22-pm-sf-push-diagnostic.md` before EOD (see §14).

---

## §4 Overnight work scope

### PART A — PR #238 final code-side fix (single commit, ~30 min)

Branch: `day22/phase-1-forms-consignee-subscription` (existing PR #238). Worktree A.

**FIX 1 — Success-path observability:**
- `src/modules/consignees/onboarding.ts`: add `console.info` BEFORE the `try { await enqueueTaskPushBatch(...) }` line surfacing `{ tenantId, subscriptionId, taskCount, requestId }`, AND a second `console.info` AFTER the successful await confirming enqueue returned + capturing `result.enqueuedCount` / `result.failedChunks`. Keep existing `console.error` in catch.
- `src/modules/subscriptions/service.ts`: same pattern for the parallel callsite in `createSubscription`.

**FIX 2 — "✓ Pushed to SuiteFleet" inline label:**
- `src/app/(app)/tasks/client.tsx` AWB cell (around line 369): when `task.externalTrackingNumber !== null`, render the AWB number + a small inline "✓ Pushed to SuiteFleet" label below (text-[10px] uppercase tracking-[0.14em] text-green). Em-dash path unchanged for null.
- `src/app/(app)/subscriptions/[id]/_components/SubscriptionTasksList.tsx` AWB column: same treatment.

**Commit message:**
```
fix(d22-forms-crud): SF push observability + Pushed indicator (PR #238 final fixups)
```

**Verify gates:**
- `npx tsc --noEmit -p tsconfig.json` clean
- `npm run lint` baseline preserved (0 err / 7 warn)
- `npm test` — expect +2 to +4 (JSX-shape tests for the indicator)

**Push:** `git push origin day22/phase-1-forms-consignee-subscription`

**DO NOT self-merge PR #238.** PR stays open for Love's morning env-var inspection.

---

### PART B — PR-C-A `/calendar` consolidated view lane

**Worktree setup:**
```bash
git worktree add /Users/lovemans/Code/planner-d22n-calendar-a -b day22n/calendar-consolidated-pr-c-a origin/main
cd /Users/lovemans/Code/planner-d22n-calendar-a
ln -s /Users/lovemans/work/planner-d22-forms/node_modules node_modules
```

**Session A scope per OQ-2 split:** service-layer + page shell + ConsolidatedWeekView.

**Session B has ALREADY shipped (origin/main `2768e408`):** MetricCard + CalendarFilterBar + CalendarViewToggle + TaskPreviewRow + links helper. Import these directly from your branch — do NOT re-implement.

---

## §5 Authoritative scope per OQ rulings + Q1–Q3

The following rulings from the Day-22 PM reviewer are authoritative for PR-C-A overnight execution. Do not relitigate.

**OQ-1 — Recommendation C scope ruling:** week-view + MetricCard + FilterBar + drill-down ship tonight. Month and day views MAY slip to Day-23+ if context budget runs short. Week-view is the demo-essential path.

**OQ-2 — Session split:** Session A owns service + page + WeekView. Session B owns MetricCard + FilterBar + ViewToggle + TaskPreviewRow + links. (Session B's slice already merged at `2768e408`.)

**OQ-3 — FilterBar inlining:** Inline `CalendarFilterBar` in `/calendar` only. No shared primitive across `/tasks` + `/calendar` at this stage (DRY-by-precedent is a Phase-2 concern).

**OQ-4 — Drill-down target:** Day-cell click routes to `/consignees/[id]?tab=calendar` (consignee detail's existing calendar tab). NOT a drawer; NOT `/tasks?date=…`. Reuses an already-built surface.

**OQ-5 — `failedAtRisk` definition:** `failedAtRisk = SUM(FAILED tasks last 7 days for active consignees) + SUM(HIGH_RISK active consignees)`. The metric card uses `tone="risk"` (red tint) per Session B's MetricCard contract.

**OQ-6 — Viewport scope:** Desktop-only, 1280px+. Mobile responsive deferred to Phase 2.

**OQ-7 — View modes:** Year view EXCLUDED. Week / month / day only (and per OQ-1 month + day may slip to Day-23).

**Q1 — Week-view day-cell composition:** Option (b) — each day cell renders aggregate count + 3-row "top tasks today" preview pane. Drill-down comes alive immediately on click; no separate drawer / popover dance.

**Q2 — Metric-card tones:** Only `failedAtRisk` uses `tone="risk"`. The other 4 cards (`activeConsignees`, `todayDeliveriesScheduled`, `deliveredToday`, `outForDelivery`) use `tone="neutral"`.

**Q3 — Filter URL state:** Inline URL builder in `CalendarFilterBar` (Session B's component). The page reads `?week=YYYY-MM-DD&q=…&crm=…&district=…&window=…&status=…` from `searchParams`. Mirrors `/tasks` `?status=&page=` URL-state convention.

---

## §6 Type contract — LAND THIS FIRST on PR-C-A branch

**File:** `src/app/(app)/calendar/_types.ts`

```ts
import type { TaskInternalStatus } from "@/modules/tasks/types";

export interface CalendarTopTaskForDay {
  readonly taskId: string;
  readonly consigneeId: string;
  readonly consigneeName: string;
  readonly deliveryWindowStart: string;
  readonly status: TaskInternalStatus;
  readonly isHighRisk: boolean;
}

export interface CalendarDayCount {
  readonly date: string;
  readonly total: number;
  readonly hasHighRisk: boolean;
  readonly topTasks: readonly CalendarTopTaskForDay[];
}

export interface CalendarMetrics {
  readonly activeConsignees: number;
  readonly todayDeliveriesScheduled: number;
  readonly deliveredToday: number;
  readonly outForDelivery: number;
  readonly failedAtRisk: number;
}
```

**If Session B already landed this file at `src/app/(app)/calendar/_types.ts` in PR-C-B:** use theirs as the source of truth, no duplication. Surface in your PR description: "Type contract sourced from PR-C-B at <path>; no overlap." Resolve any field-name divergence by following Session B's shape (their primitives are already merged).

---

## §7 Files to ship (PR-C-A)

**Commit 1 — Type contract + service-layer:**
1. `src/app/(app)/calendar/_types.ts` (if not already on main from PR-C-B)
2. `src/modules/calendar/service.ts` (new module barrel)
3. `src/modules/calendar/repository.ts` — SQL queries with tenant + filter predicates
4. `src/modules/calendar/index.ts` — barrel export
5. Service + repo specs in `src/modules/calendar/tests/`

Service surface:
- `countTasksByDayAcrossConsignees(ctx, startDate, endDate, filters?) → readonly CalendarDayCount[]` — cross-consignee day-bucket aggregator. Filters: `q` (consignee name/phone), `crm` (CRM state), `district`, `window` (time window), `status`. Permission gate: `task:read` + `consignee:read` (latter required because CRM/district filters JOIN consignees).
- `getCalendarMetrics(ctx, asOf: isoDate) → CalendarMetrics` — 5-card snapshot in one round-trip (or 5 small queries — your judgment per §12 autonomous decision authority).
- Both: tenant-scoped via `withTenant`. No audit emit (read paths).

**Commit 2 — Page shell + WeekView:**
1. `src/app/(app)/calendar/page.tsx` — server component shell. Permission preflight `task:read`; reads `searchParams` for week + filters; fetches `getCalendarMetrics` + `countTasksByDayAcrossConsignees` in parallel; composes MetricCard row + CalendarFilterBar + ConsolidatedWeekView.
2. `src/app/(app)/calendar/_components/ConsolidatedWeekView.tsx` — 7-day grid with day-cell composition (aggregate count + 3-row preview pane per Q1). Today's column uses `--color-tint-navy-subtle` atmosphere primitive per §J-3. Each preview row composes Session B's `TaskPreviewRow`. Day-cell click → `/consignees/[id]?tab=calendar` per OQ-4.
3. Component specs in `src/app/(app)/calendar/tests/`.

Permission gate: `task:read` (page level). Tenant-scoped via `withTenant`. NO audit emit (read paths).

Optional Commit 3 (only if context budget permits): ConsolidatedMonthView + ConsolidatedDayView per OQ-1's "MAY slip" allowance. Default to NOT shipping these tonight — Day-23 morning Session A or B can pick them up.

---

## §8 Coordination with Session B (parallel PR-C-B already merged)

- **Type contract:** see §6. Sourced from PR-C-B if already on main; mirror exactly.
- **TaskPreviewRow:** Session B's component. Import via `@/app/(app)/calendar/_components/TaskPreviewRow` and compose into WeekView day cells. Do NOT modify.
- **TaskStatusBadge:** Reuse from `src/app/(app)/consignees/[id]/_components/TaskStatusBadge.tsx` (PR-A2). Same composition rules as PR-C-B.
- **CalendarFilterBar:** Session B's component. Page passes URL-state filters + an onChange that updates the URL via `?` query-param replacement (Session B's inline URL builder per Q3).
- **MetricCard:** Session B's primitive. `tone="risk"` for `failedAtRisk` per Q2; `tone="neutral"` for the other four.
- **CalendarViewToggle:** Session B's component. Wire to week (active) + month + day variants; year is excluded per OQ-7.
- Do NOT modify Session B's primitives. Do NOT touch PR-C-B branch.

---

## §9 T-tier + self-merge authorization

- **PR #238 final fix (PART A):** T1/T2. **DO NOT self-merge.** PR stays open for Love's morning env-var review.
- **PR-C-A (PART B):** T3. **DO NOT self-merge.** Open with §3.21 body-read targets + §3.22 UX walkthrough plan inlined in the PR description. Love walks Vercel preview in the morning; T3 hard-stop preserved.

---

## §10 Discipline

- Brand-canon: sentence case in all copy, hairline borders (`border-stone-200` / 0.5px Stone 200), no shadows, 120ms ease-out transitions, `--color-tint-navy-subtle` on today's column + metric cards (atmosphere primitive per §J-3).
- Permission gates HIDE not disable-grey (brief §3.3.10 rule 1).
- Every commit includes tests.
- §3.21 helper-consumer body-read on changes — verify each modified file's consumers still type-check + don't drift.
- §3.22 — UX walk fixups follow the existing pattern (per-PR ratification commit).
- All Claude Code prompt code in fenced code blocks (this brief itself; consumer docs continue the convention).
- Worktree isolation per `memory/feedback_parallel_sessions_use_git_worktree.md`:
  - PART A → `/Users/lovemans/work/planner-d22-forms` (existing).
  - PART B → `/Users/lovemans/Code/planner-d22n-calendar-a` (new).
- `memory/feedback_force_push_requires_pre_authorization.md`: destructive git operations need explicit auth — overnight scope involves no force-push, no rebase; plain commit + push only.
- Do NOT touch PR #237 (Session B's Day-22 calendar lane). Do NOT touch any PR-C-B follow-up branch if one is opened.

---

## §11 Context budget watch

At every commit boundary, check remaining context. If context drops below **15%**:

1. STOP overnight work.
2. File second bootstrap brief at `memory/handoffs/bootstrap-session-a-day-23-am.md` documenting:
   - Which PART A / PART B commits landed (SHAs).
   - Which scope items remain unstarted (likely month/day views per OQ-1's "MAY slip").
   - Any in-flight uncommitted work (commit or stash before the second bootstrap PR).
3. Run `/compact`.
4. Resume execution after fresh-context Session A acknowledges the second bootstrap.

---

## §12 Autonomous decision authority

You **may** decide autonomously on:
- Code structure (file naming, helper extraction, internal type composition).
- Test coverage shape (which boundary cases to anchor — within reason; don't drop critical paths).
- Component composition details (prop shape, internal markup decisions consistent with brand-canon).
- File naming conventions.
- Minor brand-canon judgment calls (e.g., specific tracking/leading values within the documented system).
- Bug fixes encountered in service of the scope (small + non-controversial; surface in commit message).

You **must STOP and file a decision-needed flag** at `memory/handoffs/day-22-pm-decisions-pending.md` for:
- Scope expansion (anything beyond §4 / §7).
- Architectural decisions affecting Phase 2 surface.
- Brief amendments (any change to `PLANNER_PRODUCT_BRIEF.md` beyond the §9 version log).
- Permission catalogue additions (no new perms needed per §3 Diagnostic 3 + PR-C-A scope; this is a guard).
- Force-push or rebase against any branch.
- Conflicts with Session B that can't be resolved by following Session B's already-merged primitives.

---

## §13 Post-/compact acknowledge protocol

When the fresh post-compact Session A spawns, before any code touch:

1. Confirm fresh capacity — the spawn is post-`/compact`, conversation history compacted, context window reset.
2. `git fetch && git log -1 --format="%H %s" origin/main` and report.
3. `cd /Users/lovemans/work/planner-d22-forms && git log -1 --format="%H %s"` — expect `f66c005` (may be ahead if reviewer landed a fixup overnight).
4. `cat memory/handoffs/bootstrap-session-a-day-22-overnight.md | head -30` — confirm brief is readable from main.
5. State next action verbatim: *"Beginning PR #238 SF observability commit per §4 PART A"*.
6. Execute autonomously through PART A → PART B per §4. Do not wait for reviewer input mid-task — §4 + §5 rulings are authoritative.

If §4 / §5 rulings appear ambiguous post-compact, prefer the most conservative interpretation that lands within the brief's scope. Surface ambiguity to the reviewer only AFTER attempting the change — pre-execution clarification questions waste a fresh-context cycle.

---

## §14 Morning deliverable for Love

By morning, the following should be on disk and pushed:

- **PR #238:** 2 final commits landed (the existing `f66c005` plus the SF-observability + Pushed-indicator commit). Status AWAITING Love's Vercel env-var inspection of `PUBLIC_BASE_URL` + `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` + `SUITEFLEET_*` on preview scope, then merge auth.
- **PR-C-A:** open with §3.21 body-read targets + §3.22 UX walkthrough plan inlined in the PR description. Service + page + WeekView shipping. T3 hard-stop preserved — DO NOT self-merge.
- **Diagnostic report:** filed at `memory/handoffs/day-22-pm-sf-push-diagnostic.md` capturing the full Diagnostic 3 findings + hypotheses + reviewer-must-verify checklist.
- **EOD note:** filed at `memory/handoffs/day-22-pm-eod-session-a.md` summarising both lanes' shipped state, any in-flight items, and Day-23 first-action recommendation.

---

**End of bootstrap brief. Filed Day-22 PM pre-compact. Carry-forward integrity preserved into the post-compact overnight continuation.**

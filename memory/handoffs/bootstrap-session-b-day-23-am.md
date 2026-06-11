---
name: Day-23 AM bootstrap brief — Session B
description: T1 bootstrap brief for the fresh Day-23 AM Session B successor. Primary lane is the /calendar consolidated merchant calendar (brief §3.3.4); composes against the Day-23 scoping memo (PR #240) for full effort breakdown + Recommendation C sub-PR split. Surfaces repo state, expected Day-22 EOD merges, 7 open questions awaiting reviewer ruling, existing infrastructure to reuse, net-new build order, demo-storyline criticality, and Session A coordination posture.
type: project
---

# Session B Day-23 AM bootstrap brief

**For:** fresh Session B successor at Day-23 AM kickoff
**Filed:** Day-22 PM ride-along (post Day-23 scoping memo merge PR #240)
**Filed by:** outgoing Session B, pre-sleep T1 ride-along
**Lane:** `/calendar` consolidated merchant calendar — brief §3.3.4

---

## §1 Spawn purpose

Day-23 AM continuation. Primary lane: **`/calendar` consolidated merchant calendar** per [brief §3.3.4](../PLANNER_PRODUCT_BRIEF.md). Reference doc: [`memory/handoffs/day-23-scoping-calendar.md`](day-23-scoping-calendar.md) — PR #240 merged at `817f1bf` with full effort breakdown + Recommendation C sub-PR split + 7 open questions surfaced.

This brief is bootstrap-only. Do NOT begin substantive code work in the bootstrap session. Day-23 AM Session B wakes up fresh, reads this brief + the scoping memo, then opens code work in a fresh context window after reviewer rules on the 7 OQs.

---

## §2 Repo state at handoff

- **`origin/main` HEAD at brief-filing time:** `817f1bf` (PR #240 docs(d23-scoping) merged 2026-05-11T12:02Z).
- **Expected merges to land BEFORE Day-23 AM spawn** (batched Day-22 EOD; the Vercel promote + DB migration cycle Love runs at EOD):
  - **PR #237 — Day-22 PR-B popover actions (T3).** Branch `day22/calendar-pr-b-popover-actions` HEAD `bbe52a1`. Awaiting batched merge alongside PR #238 per reviewer ruling. §3.6 verdict APPROVED conditional on Item-10 fix-up (landed at `bbe52a1`).
  - **PR #238 — Day-22 Phase 1 forms CRUD lane (T3).** Branch `day22/phase-1-forms-crud` HEAD `2e301ff8528a4549f9604d9cec809ce00274e95a`. Session A's lane.
- **Already merged Day-22 / Day-23 ride-along:**
  - PR #240 — Day-23 scoping memo (T1 docs) — at `817f1bf`
  - PR #239 — Session A Day-22 PM bootstrap brief (T1 docs) — at `97e647d`
  - PR #236 — Day-22 AM Session B bootstrap (T1) — at `ad510c5`
  - PR #235 — Day-22 AM Session A bootstrap (T1) — at `2f71e75`

**Guard — Day-22 EOD discipline check:** if either PR #237 or PR #238 has NOT merged by Day-23 spawn, surface to reviewer IMMEDIATELY before opening any Day-23 lane work. That's a Day-22 EOD discipline gap; the calendar lane reads heavily from the post-#238 frontend forms surface (consignee + subscription forms) and the post-#237 popover state-machine, so divergent base risks rework.

---

## §3 Day-23 critical-path scope summary

Per scoping memo §3-5 (PR #240):

- **Effort:** ~22-27 hr aggregate (L-XL). Comparable: PR #230 PR-A2 calendar = ~14 hr; PR #237 PR-B popover = ~5-7 hr. Day-23 is bigger than either because it ships **all three views (week + month + day) + 5 filters + 5 metric cards** in one surface.
- **Recommendation C sub-PR split (memo §5):**
  - **PR-C1 (~14 hr):** Service-layer + Week view + 5 metric cards + filter bar. Demo-essentials. T3.
  - **PR-C2 (~10 hr):** Month + Day views + drill-down. T2-T3.
- **7 open questions** surfaced in scoping memo §6.1 — reviewer rules before implementation. Listed verbatim in §4 below.

---

## §4 Open questions block — awaiting Day-23 reviewer ruling (verbatim from scoping memo §6.1)

Day-23 reviewer rules each OQ at lane open. Do NOT relitigate without ruling.

1. **Sub-PR scope** — single PR-C (Option A) vs two-PR split (Option C) vs three-PR layer split (Option B)? Recommendation: **Option C** (week-first + month-day-followup) if shared with Session A, else **Option A**.
2. **Day-23 PR ownership** — Session A vs Session B? (Session B owns the calendar lane Day-21 + 22; natural continuation. Session A may have other Day-23 scope per Day-22 PM bootstrap brief.)
3. **Filter-bar primitive extraction** — extract a shared `<CalendarFilterBar>` reusable across `/tasks` (when PR #238 lands its search field) AND `/calendar`? Or keep them parallel for now (DRY-by-precedent later)?
4. **Day-click drill-down target** — route to `/tasks?date=YYYY-MM-DD&…` (requires extending `/tasks` to accept a date filter) OR keep an in-page drawer? Brief §3.3.4 says "list of all tasks that day, grouped or filterable" — points to drawer-or-route ambiguity.
5. **Metric `failedAtRisk` composition** — brief says "Failed/at-risk" as one card. Should it count FAILED tasks (today) + HIGH_RISK consignees as a union, or be more nuanced (FAILED today + high-risk consignees with deliveries today)?
6. **Metric cards mobile/responsive shape** — 5 cards in a row works on desktop; mobile stacks vertically (5 tall cards = ~70vh). Acceptable for pilot operators on desktop; flag if Love wants tighter mobile composition.
7. **Year view absence** — brief §3.3.4 specifies "Week / Month / Day views available." Notably **no Year view** (Year is consignee-detail-only per brief §3.3.3 heat-map). Confirm Year view stays out of `/calendar` scope.

---

## §5 Existing infrastructure to REUSE (saves ~6-8 hr if not rediscovered)

Per scoping memo §2:

- **`task:read` + `consignee:read` perms** held by all three tenant-side roles (Tenant Admin / Ops Manager / CS Agent). NO new perm catalogue additions needed for `/calendar` read surface.
- **Cron-materialized 14-day horizon** — `materializeTenant` (daily cron at [`src/app/api/cron/generate-tasks/route.ts`](../../src/app/api/cron/generate-tasks/route.ts)) pre-populates tasks for today + next ~14 days. `/calendar` reads from the `tasks` table; no live-compute, no architectural new surface for materialization.
- **`CrmStateBadge` + 6-state CRM enum** at [`src/app/(app)/consignees/[id]/_components/CrmStateBadge.tsx`](../../src/app/(app)/consignees/[id]/_components/CrmStateBadge.tsx). State set: `ACTIVE | ON_HOLD | HIGH_RISK | INACTIVE | CHURNED | SUBSCRIPTION_ENDED`. Reusable for filter dropdown + row highlight.
- **URL-state filter precedent** — `/tasks?status=…&page=…` shape per [`src/app/(app)/tasks/page.tsx`](../../src/app/(app)/tasks/page.tsx) header comment. Mirror for `/calendar?week=YYYY-MM-DD&q=…&crm=…&district=…&window=…&status=…`.
- **Day-click drill-down route** — `/consignees/[id]?tab=calendar&week=…` already exists from Day-21 PR-A2 (PR #230). Task rows on `/calendar` day-detail link to this route. NO new drill-down infrastructure needed.
- **`bg-red/[0.04]` high-risk row tint** — existing precedent at [`consignees/[id]/page.tsx:211`](../../src/app/(app)/consignees/[id]/page.tsx#L211) for HIGH_RISK header background. Reuse for `/calendar` high-risk row highlight per brief §3.3.4 line 526.

---

## §6 Net-new components (build order suggestion)

Per scoping memo §3:

1. **`MetricCard` primitive** (reusable, build first) — eyebrow label (caps + 0.14em tracking) above hero numeral (font-display, ~36px). Optional context line below numeral. NO `MetricCard` / `StatCard` / `KpiCard` exists in the codebase today — first instance.
2. **`CalendarFilterBar`** — mirror `/tasks` filter pattern (URL-state). Five filters per brief §3.3.4: search-by-name/phone + CRM state dropdown + area/district dropdown + time window dropdown + task status dropdown. Coordinate with PR #238's `?q=` search primitive (OQ-3 ruling pending).
3. **`ConsolidatedWeekView`** (Recommendation C: week-view first for demo punchline) — 7-column ISO-weekday grid with aggregate count per cell + high-risk row highlight.
4. **`CalendarViewToggle`** — week/month/day pill nav (mirror Day-21 PR-A2 `CalendarViewToggle` precedent).
5. **`ConsolidatedMonthView`** + **`ConsolidatedDayView`** (Recommendation C: month-day followup) — month grid with day-cells; day-detail list (drill-down target).
6. **Service-layer:** `countTasksByDayAcrossConsignees(ctx, startDate, endDate, filters?)` + `getCalendarMetrics(ctx, asOf)` — first net-new tenant-scoped cross-consignee aggregator + 5-card snapshot.
7. **Repo:** 2 SQL queries with tenant + filter predicates (`countTasksByTenantAndDayBucket` + `getCalendarMetricsRow`). Defence-in-depth tenant_id predicate alongside RLS per existing convention.

---

## §7 Demo-storyline criticality reminder

Brief §5.1 Chapter 5 of the demo storyline explicitly walks:

> `/calendar` → metric cards → filter to High Risk → Sarah Khouri (red row) → drill-in to consignee detail calendar → mark High Risk

**`/calendar` is the demo punchline.** Recommendation C (week-view first) ensures Chapter 5 lands even if month-day slips. T-2 days to internal CAIO demo at May-15 from Day-23 AM spawn — buffer is tight; week-view-first is the demo-critical path. Month-day-followup is desirable polish but not demo-blocking.

Sarah Khouri's 2026 demo data must populate all five metric card categories AND include at least one HIGH_RISK consignee with deliveries today for Chapter 5 to render meaningfully. Flagged for Day-23 morning data-prep verification (pre-existing carry-forward from PR-A2 Day-21 finding).

---

## §8 Coordination with Session A

Per scoping memo Recommendation C, the `/calendar` lane is parallelisable across Session A and Session B:

- **Suggested concrete split** (reviewer assigns at Day-23 morning OQ-2 ruling):
  - **Session A:** service-layer (`countTasksByDayAcrossConsignees` + `getCalendarMetrics`) + repo queries + page shell + `ConsolidatedWeekView` foundation (~14 hr)
  - **Session B:** `MetricCard` primitive + `CalendarFilterBar` + drill-down wiring (drawer or route-extension per OQ-4 ruling) + brand-canon polish (~10 hr)
- **Worktree isolation** per [`feedback_parallel_sessions_use_git_worktree.md`](../feedback_parallel_sessions_use_git_worktree.md) — separate worktrees, separate branches, separate PRs. Session A on `day23/calendar-service-week-view`; Session B on `day23/calendar-metrics-filter-drilldown`.
- **Merge order:** Session A's service-layer PR (PR-C1a?) merges first; Session B's UI primitives PR (PR-C1b?) merges second once it can consume the service fns. OR ship as a single PR-C if reviewer rules Option A.
- **Interface contract pre-implementation:** Session A's service-layer signatures should be locked at Day-23 morning ruling block before either session opens code — prevents drift if both teams iterate the shape mid-flight.

---

## §9 Discipline rules in force

- **T3 hard-stop** on substantive surfaces (service-layer + page + components); reviewer §3.6 verdict + Love UX walk before merge.
- **§3.21 helper-consumer body-read** on all consumer-of-new-helper changes. Surface body-read targets inline in PR description.
- **§3.22 UX walkthrough plan** inlined in PR body — which routes Love walks on Vercel preview, what to verify on each. Match PR #237 precedent.
- **§J-3 atmosphere primitive `--color-tint-navy-subtle`** on metric cards (existing token; consult [`src/styles/brand-tokens.css`](../../src/styles/brand-tokens.css) for usage precedent).
- **Brand-canon visual treatment** per brief §3.3.11:
  - Sentence case throughout; never title case except eyebrow labels (caps + 0.10-0.14em tracking)
  - Hairline 0.5px Stone 200 (`#D3CEC2`) borders; never use shadows
  - 120ms ease-out transitions on hover/focus
  - Tokens from `brand-tokens.css` are implementation source of truth — NO inline hex, NO inline rem
- **Permission gates HIDE not disable-grey** per brief §3.3.10 rule 1 (matches PR #237 precedent for popover actions).
- **All Claude Code prompts in fenced code blocks** — discipline for log-review consistency.
- **Brief v1.11 locked**; no version bump without reviewer approval.

---

## §10 Post-/compact acknowledge protocol

Day-23 AM Session B reads this brief, then on spawn:

1. **Confirm fresh capacity** — context window posture clean, no carryover from Day-22.
2. **Verify repo state:**
   ```
   git fetch && git log -1 --format="%H %s" origin/main
   ```
3. **Confirm worktree clean:**
   ```
   git worktree list
   ```
4. **Confirm both PR #237 + PR #238 merged.** If EITHER is still OPEN, surface immediately — that's a Day-22 EOD discipline gap and may block Day-23 work (calendar reads heavily from the post-#237 popover state machine + post-#238 forms surface).
5. **Read this brief in full** (~8 min), then read [`memory/handoffs/day-23-scoping-calendar.md`](day-23-scoping-calendar.md) for full §3.3.4 spec + effort breakdown.
6. **State next action verbatim:**
   > "Day-23 lane authorized; standing by for reviewer's 7-OQ ruling block + parallel-session split."
7. **Stand by for reviewer's morning rulings** on the 7 OQs in §4 + Session A/B concrete split per §8.

Do NOT begin code work until rulings land. Bootstrap-only.

---

**End of bootstrap brief. Total read time projected ≈ 8-10 minutes for cold session. Carry-forward integrity preserved into Day-23 AM Session B.**

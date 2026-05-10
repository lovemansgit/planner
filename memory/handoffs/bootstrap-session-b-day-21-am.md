# Session B bootstrap brief — Day-21 AM start

**For:** fresh Session B successor at Day-21 AM kickoff
**Filed:** Day 20 (10 May 2026), evening, post Day-20 EOD merge
**Filed by:** outgoing Session A at session close after #225 EOD doc merge (Session A files Session B's brief per locked sequencing)
**Lane:** §3.3.3 calendar PR-A2 month/year/toggle + UX-FINDING-5 ride-along (AM); PR-B popover actions (PM)

---

## §1 Handoff context

§3.3.3 calendar PR-A merged at PR #223 (`3989b51`) Day-20 PM — Week view + legend + AddressIndicator + DayDisplayStatus projection + skip-no-task render path + FINDING-3 fix-up shipped. **Day-21 AM Session B scope: PR-A2** completes the view-trio (Week + Month + Year + view-toggle) and rides along the **UX-FINDING-5 demo-blocker** fix. **Day-21 PM Session B scope: PR-B** ships 5-7 popover action handlers per locked DECISION-5.

This brief preserves cross-day context that wouldn't survive a cold-read: 5 calendar DECISIONS locked at #221 plan-PR, year-view perf optimization rationale, UX-FINDING-5 hypothesis space, and the cut-to-buffer fallback for PR-B if Day-21 PM overruns.

**This is bootstrap only. Do NOT begin substantive code work in the bootstrap session.** Day-21 AM Session B wakes up fresh, reads this brief + the 4 references in §9, then opens PR-A2 code work in fresh context.

---

## §2 Branch state at handoff

- **Production HEAD:** `b685844` (Day-20 morning batched promote)
- **`origin/main` HEAD:** `a7cb7e4` (post #225 Day-20 EOD doc merge)
- **Day-20 substantive work NOT yet promoted:** batched into Day-21 morning promote
- **Branch to open:** `day20/calendar-pr-a2` (AM lane) and later `day20/calendar-pr-b-popover-actions` (PM lane), both from `main` HEAD post Day-21 morning promote

---

## §3 Plan-locked DECISIONS (do NOT relitigate)

Per PR #221 plan + PR #223 close + Day-20 EOD §3.4:

### §3.1 DECISION-1 (b) — year-view aggregate-only-with-drilldown
- Year cell shows aggregate density (heat-map per BRD §6.2.1); click cell → drilldown to month at that month
- Brief §3.3.3 line 510 anchored verbatim ("Year view: heat-map density per BRD §6.2.1")
- §3.24 brief-spec-first applied — alternative shapes (full per-day in year cells / quarter-grouped) explicitly rejected at plan-PR

### §3.2 DECISION-2 (ii) — render-time projection
- `projectDayDisplayStatus` discriminated union spanning task-state + subscription-exception-kind
- Render-time, NOT pre-aggregated at fetch
- Single source of truth for cell rendering across Week + Month + Year (Year cell aggregates the projection per day)

### §3.3 DECISION-3 (b) — driver/rating placeholder-only
- Day-20 PM ships placeholder values for driver name + rating
- Real population deferred to Day-21+ via SF webhook payload extraction
- Popover surface (PR-B) is the consumer; PR-A2 has no popover work

### §3.4 DECISION-4 (b) — FINDING-3 button shrinks to badge dimensions
- Already SHIPPED at #223 fix-up — CrmStateModal trigger button now matches CrmStateBadge size="lg" Tailwind classes
- DOES NOT solve UX-FINDING-5 (rendered-pixel mismatch despite matching classes); see §4 below

### §3.5 DECISION-5 — popover actions cut-to-buffer
- All 7 popover actions if Day-21 PM buffer holds
- **Cut to 1-5 demo-essentials if Day-21 PM overruns by >2 hr:**
  1. skip-default
  2. skip-override (move-to-date / skip-without-append)
  3. pause
  4. change-address-one-off
  5. change-address-forward
- **Defer to Phase 2 if cut:** cancel-no-append (6), add-note (7), view-task-detail (8)

---

## §4 UX-FINDING-5 (demo-blocker — locked into PR-A2 ride-along)

CrmStateModal trigger button visual mismatch with CrmStateBadge size="lg":
- **Tailwind classes match per #223 fix-up** (DECISION-4 (b) shipped)
- **Rendered pixels do NOT match** in Vercel Preview walkthrough
- Hypothesis space (one or more):
  - border-width difference (`border` vs `border-2` or hairline-divergent value)
  - font-size metric drift (computed font size differs from declared)
  - line-height drift (1px vertical asymmetry in box-sizing)
  - text-padding asymmetry (px values vs em values rendering differently)
- **Resolution path:** survey both component implementations side-by-side at:
  - [`src/app/(app)/consignees/[id]/_components/CrmStateModal.tsx`](../../src/app/(app)/consignees/[id]/_components/CrmStateModal.tsx) (trigger button surface)
  - CrmStateBadge component (search src/ for definition)
  - Identify divergent style → normalize to single source
- **Verification:** pixel-snap match in Vercel Preview BEFORE PR-A2 open
- **NOT a Phase 2 deferral.** Demo-blocker. Must close in PR-A2 ride-along.

---

## §5 PR-A2 lane plan (Day-21 AM, ~6-8 hr)

### §5.1 LANE 1 — Month view component (~2 hr)
New component at [`src/app/(app)/consignees/[id]/_components/CalendarMonthView.tsx`](../../src/app/(app)/consignees/[id]/_components/CalendarMonthView.tsx):
- Accept same data shape as `CalendarWeekView` (tasks + exceptions + date range)
- Render 5-6 week rows × 7 day columns; same `DayDisplayStatus` projection per cell
- **Day-cell condensed:** status pill + time-only (no AddressIndicator, no POD inline — operator opens popover for detail). Brief §3.3.3 line 487 calls AddressIndicator a Week-view affordance specifically.

### §5.2 LANE 2 — Year view component (~3-4 hr)
New component at [`src/app/(app)/consignees/[id]/_components/CalendarYearView.tsx`](../../src/app/(app)/consignees/[id]/_components/CalendarYearView.tsx):
- DECISION-1 (b) aggregate-only-with-drilldown
- New service-layer fn: `countTasksByConsigneeAndDayBucket` — pure SQL count by date, single-pass aggregation
- Render heat-map per BRD §6.2.1: 12 month-blocks × ~30 day cells; cell color encodes density
- Click month → drill to month view at that month (URL-state push via `?view=month&date=YYYY-MM`)

**LOAD-BEARING perf optimization (locked into PR-A2 scope, NOT Phase 2):**
- Pre-bucket exceptions by date into `Map<string, SubscriptionException[]>` at `CalendarYearView` call site BEFORE invoking `projectDayDisplayStatus` per cell
- Avoids O(cells × exceptions) scan pattern (would be ~365 cells × ~50 exceptions = 18k iterations per render at full demo volume)
- After bucketing: O(cells) scan with O(1) Map lookup per cell

### §5.3 LANE 3 — View toggle component (~1-1.5 hr)
New component at [`src/app/(app)/consignees/[id]/_components/CalendarViewToggle.tsx`](../../src/app/(app)/consignees/[id]/_components/CalendarViewToggle.tsx):
- Pill-button group: Week / Month / Year (top-right of calendar surface)
- URL state via search param `?view=week|month|year` (default `week`)
- Brand-pass restraint: hairline border, no shadow, sentence case (matches existing chip-button pattern from `/tasks/client.tsx` filter-pills)
- **Survives browser back/forward navigation** via URL state — verify in Vercel Preview

### §5.4 LANE 4 — UX-FINDING-5 ride-along (~1 hr)
Per §4 above. Pixel-snap match required pre-PR-A2 open.

---

## §6 PR-B lane plan (Day-21 PM, separate code-PR after PR-A2 merges, ~6 hr)

5-7 popover action handlers per DECISION-5. Cut-to-buffer rules:
- **All 7** if buffer holds: skip-default + skip-override + pause + change-address-one-off + change-address-forward + cancel-no-append + add-note + view-task-detail
- **Cut to 5 demo-essentials** if Day-21 PM overrun: actions 1-5 above; defer 6-8 to Phase 2

### §6.1 Net-new perms (4-5)
- `subscription:override_skip_rules` (already exists per Day-13 part-1)
- `subscription:cancel_no_append` (NEW; for action 6)
- `task:add_note` (NEW; pre-registered Day-20; for action 7)
- `task:view_timeline` (already exists or NEW; verify in catalogue)

### §6.2 Server actions
At [`src/app/(app)/consignees/[id]/_calendar-actions.ts`](../../src/app/(app)/consignees/[id]/_calendar-actions.ts) (existing — extends, doesn't replace):
- One Server Action per popover action
- Each calls existing service-layer fn (skip flow / pause flow / address override flow / etc.)
- Audit emits per existing service-layer pattern (no new audit-event registration needed; existing event types cover)

### §6.3 Handler routing
Popover already scaffolded via `DayActionPopover` component (PR #177 from Day-17). Wire each action button to its Server Action; surface success/failure inline per popover surface.

---

## §7 What NOT to do (Session B integrity)

- ❌ Do NOT relitigate DECISION-1 through DECISION-5 — locked at #221 plan-PR
- ❌ Do NOT defer UX-FINDING-5 to Phase 2 — demo-blocker; PR-A2 ride-along is the channel
- ❌ Do NOT skip the year-view exception bucketing perf optimization — locked into PR-A2 scope
- ❌ Do NOT add AddressIndicator to month-cell or year-cell — Week view only per brief §3.3.3 line 487
- ❌ Do NOT wire popover actions in PR-A2 — those are PR-B scope (Day-21 PM)
- ❌ Do NOT begin substantive code work in this bootstrap session — fresh context window for PR-A2 open

---

## §8 Context-window expectation

- PR-A2: ~6-8 hr
- PR-B: ~6 hr
- Two T3 hard-stops (PR-A2 open + PR-B open); reviewer §3.6 body-read on each
- Reviewer expects §3.21 helper-consumer body-read on `projectDayDisplayStatus` consumers + perm-catalogue auto-pickup helpers (`permsFor("subscription")` / `permsFor("task")`)
- Reviewer expects §3.22 UX walkthrough on month + year views and UX-FINDING-5 visual confirmation BEFORE approval
- Year-view heat-map color scale must honor brief §3.3.11 brand token canon

If session burns above ~50% memory mid-PR-A2, file mid-lane bootstrap before PR-B kickoff.

---

## §9 Files to read on Session B spawn (post-bootstrap)

**In order:**

1. [`memory/PLANNER_PRODUCT_BRIEF.md`](../PLANNER_PRODUCT_BRIEF.md) §3.3.3 lines 473-510 — full surface spec
2. `docs/Subscription_Planner_BRD_v1.docx` §6.2 + §6.2.1 — year heat-map intent (brief defers to BRD)
3. `memory/plans/day-20-consignee-detail-calendar-survey.md` — survey output from PR #221 (5 DECISIONS rationale)
4. [`memory/handoffs/day-20-eod.md`](day-20-eod.md) §3 calendar rulings + §5 UX-FINDING-5 framing

After absorbing, surface readiness with:
- Verified `origin/main` HEAD post Day-21 morning promote
- Plan to address UX-FINDING-5 (which divergent style identified)
- Stand by for §3.6 trigger at PR-A2 open

---

**End of bootstrap brief. Total read time projected ≈ 6-8 minutes for cold session. Carry-forward integrity preserved into Day-21 AM Session B.**

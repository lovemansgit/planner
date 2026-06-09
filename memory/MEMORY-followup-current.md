# Active-lane followups digest

> **Purpose.** Rolling digest of the active substantive lane's open
> followups, blockers, and success criteria. Read at session start
> alongside `MEMORY.md` (the historical per-day index) for the
> current state of in-flight architectural work. Rotated lane-by-lane
> as code-PRs land and new lanes open.
>
> **Last updated:** Day-51 EOD (9 Jun 2026).
> **Active lane:** Calendar-management — Phase 1 T3 plan-PR #337
> OPEN; PR-1 of 5 shipped Day-51 via PR #338 (R1 on-demand cron);
> PR-2 (R2 pause SF cancel fan-out) queued for Day-52.

---

## Active lane summary

Calendar-management was named the most important surface in Planner by Love during Day-32 PM-late production smoke. The lane provenance:

- **Day-32 PM-late** production smoke surfaced two operator-action surface gaps on the consignee calendar: (1) skip-with-tail-end-reinsertion was cron-deferred-invisible (calendar gave no signal that a pending tail task would materialize on the next 16:00 Dubai cron tick); (2) move-to-specific-date override was a Phase-2 placeholder with UI copy that promised reschedule but code only wrote a memo exception row.
- **PR #320 followup memo** (Day-32) captured both gaps + Love directive: *"calendar management is the most important surface in Planner; do NOT disable misleading UI as a 'ship-honesty' fix; build them properly."* Lane named **calendar-management full-resolution** — T3, sequenced AFTER Plan #317 completion.
- **Day-33 AM: PR #324** filed the full-surface diagnostic ([`memory/diagnostic_calendar_management_full_surface_enumeration.md`](diagnostic_calendar_management_full_surface_enumeration.md)) — enumerated ~30 view surfaces + ~22 action surfaces across two axes (views + actions) under 5 classification buckets (works end-to-end / cron-deferred-invisible / Phase-2-placeholder / unimplemented / visual-gap). Surfaced **R1-R5** as ruling items.
- **Day-33 AM: PR #325** amended the diagnostic with **R6** (Tasks page consignee context + cross-surface navigation to TaskTimelineDrawer) + **R7** (consignee detail default landing tab) + their 8 sub-rulings (R6.1-R6.4 + R7.1-R7.4). Surfaced a verified reviewer-side framing discrepancy on R7.2 view-mode default.
- **Day-33 PM** (post Plan #317 closure): reviewer-facilitated rulings session walked all 15 R-items one at a time. Three new ruling items surfaced during the session: **R8** task-scoped audit timeline in AWB-click drawer, **R9** full Week-view removal, **R10** Year-view heatmap proper render. R7.2 reality-checked against live operator screenshot — Month default already correct; prior diagnostic framings ("month" Day-32 / "week" Day-33 AM) both partial. **PR #331** captured all 15 R-items as locked product decisions.

---

## Source documents

- **Diagnostic + rulings memo (load-bearing):**
  - [`memory/diagnostic_calendar_management_full_surface_enumeration.md`](diagnostic_calendar_management_full_surface_enumeration.md) — the source-of-truth for surface enumeration, classification, R-item surfacing, AND the locked rulings (Day-33 PM rulings session appended via PR #331). Read this end-to-end before opening the T3 plan-PR.
- **Predecessor lane memo:**
  - [`memory/followup_calendar_management_full_resolution.md`](followup_calendar_management_full_resolution.md) — Day-32 lane shape + Love directive. Not superseded; the diagnostic + rulings memo extends and refines it. The original two surfaces (skip-tail-end + move-to-date) are now R1 + R2-variant in the diagnostic memo's R-item enumeration; the Love directive ("build them properly, don't dampen the UI") remains the lane's product stance.
- **Adjacent memos (lane-membership decisions deferred to plan-PR open):**
  - [`memory/followup_resolved_rows_visibility_gap.md`](followup_resolved_rows_visibility_gap.md) — operator-visibility gap on resolved `failed_pushes` rows (PR #329). Surfaced during Plan #317 PR-D smoke; not load-bearing for any active lane. Three resolution paths enumerated (toggle on existing route / separate `/resolved` route / operator-facing audit viewer). Could fold as a new R-item or stand alone as a small T2/T3.
  - [`memory/followup_pod_broken_image_pre_existing.md`](followup_pod_broken_image_pre_existing.md) — POD broken-image diagnosis narrowed to shape (e) "S3 pre-signed URL signature stale relative to render time OR browser-policy reaction" + 3 fix paths (PR #327 AM-filing + PR #330 Network-diagnostic amendment). Could fold as a new R-item or stand alone.
- **Brief sections to read (v1.15 on main; calendar-management lane does NOT trigger a brief amendment per the lane's scope — all rulings build against existing brief constraints):**
  - §3.3 calendar surface (consignee detail tab structure, day-action popover, week/month/year views)
  - §3.5 task action model (subscription exceptions, address overrides, pause-window, append-without-skip)
  - §3.1.4 outbound push optimistic-ack pattern (relevant to R2/R3/R4/R5 SF-push rulings — all reuse existing publisher infra + DLQ path)
  - §5.1 Ch.3 demo narrative (consignee detail page flow, default-tab landing, calendar surface importance)

---

## Current state (Day-51 EOD)

- **Main HEAD:** `48997a9` (post-merge of PR #339 vercel.json workaround; this EOD doc extends main one commit further after merge).
- **Production HEAD:** `48997a9` on `dpl_9AHCpJEKDaz2J5MV46RZVQdRGNcW` (PR #338 R1 + PR #339 Vercel workaround promoted Day-51 11:42:20Z UTC). Production now current with main as of merge time.
- **Rollback anchor (one-swap):** `dpl_EVLvUQovnQza6ZK2ogRZzp64M6UT` (source `2db99ea`, Day-33 EOD state — Plan #317 PR-D production).
- **Brief on main:** **v1.16** (last table-row Day-30 PR #308; new §9 Day-51 operational-degradation subsection appended via PR #339, explicitly NOT a version bump per the operational-not-scope-change framing).
- **Plan #317:** CLOSED at `f0ef560` (closed Day-33 PM; not active).
- **Plan-PR #337 (calendar-management Phase 1):** OPEN. PR-1 of 5 shipped Day-51 via PR #338 (R1 on-demand cron-equivalent materializer primitive + skip-tail wiring). R1 smoke passed end-to-end on production with one carry-forward finding (tail-outside-horizon UX gap — see Day-51 EOD §D.3 and §G).
- **Phase 1 PR-2 (R2 pause SF cancel fan-out):** queued for Day-52 open.
- **Migrations on production:** 0027 + 0028 (Day-33 baseline; no new migration today).
- **Calendar-management lane:** 15 R-items + sub-rulings locked as product decisions via PR #331 at `9d7b15b`. T3 plan-PR #337 OPEN with Phase 1 in flight.

---

## Blockers (status snapshot)

### Blocker 1 — none currently

The calendar-management lane has no external blockers at lane-open. All 15 ruling items build against SF wire contracts already in production:

- **R2** (pause SF outbound push): reuses existing single-task cancel publisher pattern via `batchJSON` fan-out (Day-22 `ed5963b9` / PR #319 dedup-id-fix infra).
- **R3** (addNoteToDriver SF push): same SF wire contract as initial task create (notes field already supported per `task-client.ts:362, 434`).
- **R4 / R5** (address overrides SF push): same outbound publisher pattern as cancel/note flows; SF `updateTask` already in production.
- **R1** (on-demand cron trigger): reuses existing cron-materializer infrastructure (Day-14 Phase 5 cron-decoupling); on-demand invocation is additive to the scheduled 16:00 daily tick.
- **R8** (audit timeline in drawer): audit-event infra exists; first operator-facing audit surface but no external deps.
- **R9** (Week-view removal): pure code deletion, no integration impact.
- **R10** (Year-view heatmap): backend infra exists (tasks table has all the data); rendering work + a new server-side aggregate query.

**No Aqib coordination required** for any lane-internal ruling.

### Adjacent (NOT blockers for calendar-management lane)

- **HEM 403 single-tenant credential failure** ([`followup_hem_403_credential_failure.md`](followup_hem_403_credential_failure.md), PR #322) — Aqib coordination thread; separate from any Planner-side build lane. Does NOT block calendar-management.
- **POD broken-image shape (e)** ([`followup_pod_broken_image_pre_existing.md`](followup_pod_broken_image_pre_existing.md), PR #327 + #330) — Aqib coordination flagged ONLY on fix Path 2 (re-sign on read). Paths 1 (Planner proxy) + 3 (download + re-host) are Planner-side only and do not require Aqib. **Lane-membership decision pending** — fold into calendar-management as a new R-item, or stand alone as a small T2/T3.
- **Resolved-rows visibility gap** ([`followup_resolved_rows_visibility_gap.md`](followup_resolved_rows_visibility_gap.md), PR #329) — three resolution paths enumerated, all Planner-side. **Lane-membership decision pending** — fold as a new R-item or stand alone.

---

## Success criteria for the lane

The calendar-management lane closes when:

- **All 15 R-item product decisions are implemented in the running product.**
- **Operator promises restored:**
  - R2: Pause button stops dispatch end-to-end (driver doesn't arrive on paused days).
  - R3: Driver actually sees the note added via the operator surface.
  - R4 / R5: Address overrides reach SF + propagate correctly (existing tasks updated locally, SF informed, future-task materializer picks up new address).
  - R7.4: Empty-state consignee (zero subscriptions AND zero tasks) lands cleanly on Overview tab with onboarding CTAs.
- **New surfaces operational:**
  - R8 task-scoped audit timeline in AWB-click drawer (filter shape, metadata expansion, pagination resolved at plan-PR scoping time).
  - R10 Year-view heatmap with real density rendering (color intensity per delivery count, distinct color for FAILED, marks for SKIPPED / APPENDED).
- **Removed surfaces gone:**
  - R9 Week view fully deleted (not UI-hide); deep-links with `?view=week` fall back silently to Month.
- **Cron-deferred actions surface in real-time per R1** (on-demand cron-equivalent invocation; calendar reflects skip-tail and forward-horizon address overrides immediately).

T3 plan-PR scoping at Day-34 will define:
- Sub-PR sequencing (15 rulings → N code-PRs; reviewer + builder decide based on dependency graph + integration-test surface coverage).
- Mobile/tablet responsive rulings (explicitly deferred from R6.1 + R6.2 to plan-PR time).
- Lane-membership decisions on POD-shape-(e) + resolved-rows visibility (fold-in vs stand-alone).
- Brief amendment decision — current ruling says no amendment required, but plan-PR scoping confirms this before ship.

---

## Meta: file lifecycle

This file rotates whenever the active substantive lane transitions. Prior rotations:

- **Day-32 EOD** (consolidated Day-31+32 EOD): rotated from A1 status-mapping defect lane (closed via PR #316) → Plan #317 outbound push structural defects (OPEN at the time, PR-A shipped).
- **Day-30 EOD**: rotated A1 status-mapping defect lane in.

**Current rotation (Day-33 EOD):** rotated from Plan #317 (CLOSED end-to-end Day-33 via PR-B #323 + PR-C #326 + PR-D #328) → **calendar-management** lane (15 R-items locked as product decisions via PR #331; T3 plan-PR opens Day-34).

The historical per-day record stays in [`MEMORY.md`](MEMORY.md); this file is the always-current "active followups" digest.

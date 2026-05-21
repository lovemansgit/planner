# Active-lane followups digest

> **Purpose.** Rolling digest of the active substantive lane's open
> followups, blockers, and success criteria. Read at session start
> alongside `MEMORY.md` (the historical per-day index) for the
> current state of in-flight architectural work. Rotated lane-by-lane
> as code-PRs land and new lanes open.
>
> **Last updated:** Day-32 EOD (20 May 2026, consolidated Day-31+32 EOD).
> **Active lane:** Plan #317 — T3 outbound push pipeline structural
> defects (F-1..F-6 + CLEANUP-1). Plan-PR OPEN at `f0ef560`; §10 ruling
> fold complete; PR-A shipped end-to-end via #318. PR-B (F-1 + F-2 + F-4
> + F-6), PR-C (F-3 + migration 0028), PR-D (CLEANUP-1) all queued
> sequential, NOT parallel.

---

## Active lane summary

Day-31 Session B ran a structural-defects diagnosis pass on the operator-initiated outbound SF push pipeline (cancel + update flows landing Day-21 PR #227 / Day-22 `ed5963b9`; Phase-1 §D(2) skip → SF cancel landing Day-29 PR #305). Diagnosis surfaced **6 defects + 1 cleanup** across the queue infrastructure + the integration layer.

The plan-PR (#317) was filed Day-32 AM (`createdAt: 2026-05-20T04:53:21Z` — body-write completed post-midnight Dubai); §10 ruling fold cleared at `f0ef560` with 7 ruling rows + 5 hard requirements locked. PR-A (#318) shipped F-5 + migration 0027 + production promote on Day-32 AM-late after two §3.6 #2 reject-back cycles.

**Plan-PR persistence pattern:** #317 stays OPEN until PR-D ships end-to-end. PR-B + PR-C + PR-D are the remaining code-PRs; they ship sequentially, not in parallel, per the §10 hard requirement.

## Source documents

- **Plan-PR (OPEN at `f0ef560`):**
  - [PR #317](https://github.com/lovemansgit/planner/pull/317) — outbound push pipeline structural defects (F-1..F-6 + CLEANUP-1). §3.5 5 surface diagnostics + §6 7 OQs ruled in fold.
- **Shipped code-PR (PR-A):**
  - [PR #318](https://github.com/lovemansgit/planner/pull/318) (merged `c5995ee`) — F-5 past-dated guard on push path + reconciliation filter + migration 0027. The reject-back history on PR-A is captured in the Day-31+32 consolidated EOD §C.1.
- **Adjacent T2 fix (NOT in #317 scope):**
  - [PR #319](https://github.com/lovemansgit/planner/pull/319) (merged `d41da88`) — QStash deduplicationId colon-rejection latent bug. Surfaced during PR-A smoke but pre-dates PR-A (Day-22 `ed5963b9`). Separate lane.
- **Brief sections to read (v1.15 on main; Plan #317 does NOT trigger a brief amendment per §10 ruling):**
  - §3.1.4 — outbound push optimistic-ack pattern
  - §3.1.10 webhook payload format (inbound symmetry context)
  - §5.2 retries=3 (audit context for F-4 attempt_count race)
  - §6.3 QSTASH_FLOW_CONTROL_KEY env-var resolution

## Current state (Day-32 EOD)

- **Main HEAD:** `0e43c87` (post-merge of PR #320 calendar followup memo).
- **Production HEAD:** `d41da88` on `dpl_H7uovYd48i5Di5jzdfAaP5hD1ptz` (PR #319 promoted Day-32 PM). Production is one commit BEHIND main because PR #320 is memory-only and intentionally not promoted.
- **Rollback anchor (one-swap):** `dpl_7qv1V9EqscKYYVUHWpA8cAUciuf9` (PR-A's prod, source `c5995ee`). Prior anchor `dpl_5LqazeMMqxxMfkaLvqD1tMiEWiz3` rolled off the window.
- **Brief on main:** **v1.15** (unchanged Day-31 and Day-32; no amendment filed).
- **Schema:** migration 0027 applied to production Day-32 AM (extends `failed_pushes.failure_reason` CHECK to admit `'past_dated'`). Migration 0028 stays unbuilt; sequenced under PR-C.
- **Plan #317 §10 ruling fold:** COMPLETE at `f0ef560`. 7 ruling rows + 5 hard requirements locked.
- **PR-A (#318):** SHIPPED end-to-end (merged + promoted + smoke verified).

## Blockers (status snapshot)

### Blocker 1 — none currently

Plan #317 has no external blockers. PR-B is ready to start on a fresh Session B off main HEAD `0e43c87`.

### Adjacent (NOT a blocker for #317)

**HEM 403 single-tenant credential failure** — surfaced Day-31 during the MPL credential outage triage. Different tenant (HEM), different region binding. Needs Aqib coordination. **Recommend filing as durable T1 memo in next session housekeeping** — currently tracked verbally only. Does NOT block Plan #317 work.

## Success criteria for the remaining code-PRs

### PR-B (F-1 + F-2 + F-4 + F-6) — next major piece

Per Plan #317 §10 hard requirements:

- [ ] **F-1 push outcome routing race** — narrative + integration spec covering the local-commit-vs-webhook-ack window. Highest-risk §3.6 #2 surface.
- [ ] **F-2 DLQ failure path normalization** — single normalized writer for `outbound_push_failures.failure_reason` across the three current call-sites.
- [ ] **F-4 attempt_count increment race** — `SELECT … FOR UPDATE` on the read-modify-write cycle. **F-4 attempt_count increment spec is load-bearing for PR-B per §10 ruling.**
- [ ] **F-6 CI smoke check absent** — end-to-end test exercising the full outbound queue lifecycle (publish → consume → outcome → DLQ-or-success). Lightweight; SQL fixtures + mocked QStash.
- [ ] **CI green** per brief v1.13 §7.1.
- [ ] **§3.6 #1 hard-stop + #2 hard-stop** both cleared at pinned head SHA via paste-back body-read.

### PR-C (F-3 + migration 0028) — sequenced after PR-B

- [ ] **F-3 failed_pushes tenant_id RLS gap** on the admin retry-queue surface. **OQ-2 reader-enumeration is the §3.6 #2 surface for PR-C per §10 ruling.**
- [ ] **Migration 0028** sequenced after 0027 per §10 migration ordering ruling.

### PR-D (CLEANUP-1) — sequenced last

- [ ] **Bulk-resolve tooling for `failed_pushes` rows** — service-layer surface for ops triage (the Day-31 9-row MPL backlog cleanup had to be done row-by-row via SQL).

## Out of scope for the Plan #317 lane (do NOT collide)

- **Calendar-management full-resolution lane** — filed Day-32 as PR #320 followup memo. Sequenced AFTER Plan #317 completes. Aqib-coordinated for SF `rescheduleTask` half of move-to-date.
- **Outbound-symmetry follow-on** (Planner→SF EDIT propagation) — separate lane committed in Day-31 PM fold of #306 §5.
- **HEM 403 credential follow-up** — Aqib coordination, separate lane.
- **PR #319 QStash dedup-id colon fix** — already shipped end-to-end Day-32 PM. Not in #317 scope.
- **A1 inbound webhook lane (#306 + #316)** — CLOSED end-to-end Day-31 via PR #316 merge.

## T1 follow-ons (post-lane)

These DO NOT block Plan #317 PRs but land after PR-D ships.

### T1-followon-1: HEM 403 credential follow-up — durable memo filing

Day-31 MPL credential outage triage surfaced HEM 403 single-tenant credential failure (different tenant, different region binding). Currently tracked verbally + Aqib coordination thread. **File as durable T1 memo** in next session housekeeping so the institutional record persists.

Trigger: next session housekeeping pass.

### T1-followon-2: Calendar-management lane diagnosis pass

Per Day-32 followup memo PR #320, the calendar-management lane scope includes a diagnosis pass enumerating ALL operator-action surfaces (skip variants, override variants, pause/resume, address overrides, anything in DayActionPopover and similar surfaces) and classifying which work end-to-end vs which have gaps. This pre-lane diagnosis can start AFTER Plan #317 PR-B ships (no resource conflict; pure diagnostic work).

Trigger: Plan #317 PR-B merges.

### T1-followon-3: Discipline lesson fold from Day-31+32 EOD §F

Six discipline learnings recorded in Day-31+32 EOD §F. Two could be promoted to durable feedback memos if not already:
- "Diagnose-before-rollback when no demo clock + minimal user impact" (Day-32 PR #319 surface).
- "First-time production verification surfaces real latent bugs" (Day-32 calendar lane surface — the Phase-2 placeholder discovery).

Trigger: next housekeeping sweep. Cross-check against existing `feedback_*.md` memos before filing duplicates.

## Followup memos in flight

These memos are referenced by or adjacent to the Plan #317 lane and should be re-read by anyone working in this area:

- [`memory/followup_calendar_management_full_resolution.md`](followup_calendar_management_full_resolution.md) — **🟡 NEXT LANE, sequenced after #317.** Captures the Day-32 PM calendar surface gaps + Love directive.
- [`memory/followup_aqib_api_key_auth_header_pending.md`](followup_aqib_api_key_auth_header_pending.md) — institutional-level load-bearing pointer (production-region credential provisioning). MPL was resolved Day-31; HEM 403 remains as separate adjacent surface. Does NOT block #317; #317 lane is queue-infrastructure-only.
- [`memory/decision_review_discipline_ci_gate.md`](decision_review_discipline_ci_gate.md) — §3.6 hard-stop with CI gate (brief §7.1 codification); all #317 code-PRs inherit this.
- [`memory/feedback_force_push_requires_pre_authorization.md`](feedback_force_push_requires_pre_authorization.md) — standing rule reinforced across PR #316 + #318 + #319 reject-back cycles. Load-bearing for all #317 code-PR force-pushes.
- [`memory/feedback_brief_amendment_log_append_only.md`](feedback_brief_amendment_log_append_only.md) — brief at v1.15 unchanged across both days; #317 ruling explicitly skips a brief amendment per §10.

## Decommissioned (Day-32 EOD)

These items previously appeared in the prior digest (A1 status-mapping defect lane, Day-30 EOD baseline) but are now retired from the active-lane focus:

- ~~A1 status-mapping defect lane (plan #306, Phase-0-gated)~~ — code-PR shipped end-to-end Day-31 via PR #316. Lane CLOSED.
- ~~Phase-0 evidence SQL (Love-run on production) Blocker 1~~ — completed Day-31; results drove PR #316 fix shape (combined routing + vocab fixes per "Q-A status-specific codes present, Q-B shows silent-drop" path). Lane CLOSED.
- ~~T1-followon-1 (apply-webhook-edit-event.ts inbound TZ symmetric bug) — routed to A1's lane Day-30~~ — A1 lane closed Day-31 without touching this surface; the inbound TZ symmetric bug remains as a separate post-demo T2 follow-on. Recommend re-filing at next housekeeping pass if it didn't ride along on #316's surface.
- ~~T1-followon-2 (shared-canonical-vocabulary refactor OQ-9)~~ — Plan #306 §7 OQ-9 deferred. Not in current active lane focus.
- ~~T1-followon-3 (cross-project Vercel boundary note for `deploy-clean`)~~ — Day-30 housekeeping item; defer to next operational-runbook touch.

---

## Meta: file lifecycle

This file rotates whenever the active substantive lane transitions. Prior rotation: Day-30 EOD (A1 status-mapping defect lane). This rotation: Day-32 EOD (consolidated Day-31+32), Plan #317 outbound push structural defects (plan-PR OPEN at `f0ef560`, PR-A shipped, PR-B/C/D queued). The historical per-day record stays in [`MEMORY.md`](MEMORY.md); this file is the always-current "active followups" digest.

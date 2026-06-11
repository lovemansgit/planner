---
name: Day 21 EOD handoff
description: Canonical Day-21 → Day-22 reviewer handoff covering 4 PRs merged Day-21 (Phase 1 SF outbound adapter + DLQ + demo-preflight + header alignment + §3.3.3 calendar PR-A2), three memos filed (Q3 amendment + two Phase-2 followups), Day-21 architectural decisions locked, discipline observations, and Day-22 carry-forwards led by morning batched Vercel promote + migration 0023 application + the Day-22 forms lane + PR-B popover actions.
type: project
---

# Day-21 EOD handoff

**Date:** 10 May 2026 (Day 21)
**Filed:** Day-22 AM ride-along (Session A, post Block 2 close)
**Main HEAD at Day-21 close:** `35a591a` (PR #230 merge)

---

## §1 Day-21 ledger

Four PRs merged Day-21:

| # | PR | Tier | SHA | Title |
|---|---|---|---|---|
| 1 | #227 | T3 | `65aeff1` | Phase 1 SF outbound adapter + DLQ scaffolding + CONCERN B PII strip + 4 QStash routes + Q3 doc memo amendment ride-along |
| 2 | #228 | T2 | `3453a60` | `demo-preflight.sh` 10-gate verification |
| 3 | #229 | T1 | `ad86392` | Header items-end → items-center alignment |
| 4 | #230 | T3 | `35a591a` | §3.3.3 calendar PR-A2 — month + year + view-toggle + UXF5 v2 |

---

## §2 Memos filed Day-21

- [`memory/decision_phase_1_aqib_doc_verified.md`](../decision_phase_1_aqib_doc_verified.md) Q3 amendment — bulk endpoint = numeric SF task ids; AWB ≠ task id for the bulk endpoint. Empirically refuted the Day-20 doc-verified Q3 claim that the bulk path takes comma-separated AWBs; sandbox probe returned 500 + Java NumberFormatException-style parse error on AWB strings, succeeded on numeric ids. Filed as ride-along to PR #227.
- [`memory/followup_webhook_events_task_id_column_naming_drift.md`](../followup_webhook_events_task_id_column_naming_drift.md) — Phase-2 deferral on column rename. The `webhook_events.suitefleet_task_id` column stores AWB strings despite the legacy column name; surfaced when Day-21 LANE 1 probe poll missed events filtered on numeric id. Schema rename or column-doc clarification deferred to Phase 2; not adapter-blocking.
- [`memory/followup_header_logo_height_balance_phase_2.md`](../followup_header_logo_height_balance_phase_2.md) — post-MVP cleanup. Logo `h-14` dominates the row visually post-#229 alignment fix; balance-with-textmark re-spec is post-pilot scope.

---

## §3 Architectural decisions locked Day-21

- **Q3 empirical correction** — `PATCH /api/tasks/bulk/{numeric_ids_csv}` takes **NUMERIC SF task ids**, not AWBs. AWB strings 500 with Java parse error. Adapter asymmetry: single-cancel uses AWB at the path-param (`/api/tasks/awb/{awb}`); bulk uses numeric SF id (`tasks.external_id`). Caller-side AWB→numeric resolution defers to Day-22+ service-layer wiring + the form actions that consume bulk operations.
- **`cancelTask` field name LOCKED** at `{status:"CANCELED"}` via `PATCH /api/tasks/awb/{awb}` with `Content-Type: application/merge-patch+json`. Variant A 200 OK first attempt; the speculative `{internalStatus:"CANCEL"}` variant B never needed.
- **UXF5 v2 forensic diagnosis** — `w-[140px]` fixed-width pin replaces the `min-w-[120px]` floor. Content-coupling was the actual cause of the v1 modal-vs-badge dimensional drift; element-type was the red herring; letter-spacing / kerning produced an optical illusion that made the divergence look like a font-metric mismatch.
- **Year-view rendering** — `densityClass(0) → bg-stone-200/40` (was `bg-paper`, which matched the page bg `surface-primary` at `#FAF8F4` and produced a "where did the cell go?" visual on zero-density days). Three-channel encoding per BRD §6.2.1; `aspect-square` cells + 4×3 layout.
- **DECISION-1 (b) perf optimization** — `Map<isoDate, SubscriptionException[]>` pre-bucket reduces `O(cells × exceptions)` (~18k iterations on a year view) → `O(cells)` walk + `O(1)` lookup.

---

## §4 Discipline observations

- **(T3) precedent solidified** — reviewer §3.6 verdict substitutes for the GitHub-side review-required check; `--admin` override authorized after explicit verdict. Both #227 and #230 used this path. Day-22 AM Block 2's #231 (T2) and #232 (T1) followed the same precedent for their respective lighter-touch surfaces.
- **New standard saved to memory** — Love prefers long autonomous coding sessions; reviewer scopes overnight work, authorizes self-merges where T-tier precedent supports.
- **§3.21 helper-consumer body-read** held on T3 PRs (PR #227 + PR #230 §3.6 reviews surfaced via raw-bytes file-body posts when GitHub diff fetch truncated).
- **§3.22 UX walkthrough discipline** held — Love walks Vercel preview before approval on visual changes (UXF5 v2 + header alignment).
- **Option A merge strategy on UXF5 v2** — revert + v2-forward preserves the v1→v2 lesson in git history. Force-push hides the teaching for future similar findings; Option A keeps the v1-was-wrong + v2-was-right discipline trail visible.

---

## §5 Carry-forwards to Day-22

1. **Migration 0023** (`supabase/migrations/0023_outbound_push_failures.sql`) application to Production DB — atomic with the Day-22 morning batched Vercel promote per CONCERN B PII-strip-at-write contract.
2. **Day-22 morning batched Vercel promote** — sweeps the unpromoted batch from production HEAD `b685844` (held since Day-20 morning promote) to main HEAD post-Day-22-Block-2 (currently `86ff502`):
    - #220 / #221 / #222 / #223 / #224 / #225 / #226 (Day-20 substantive + Day-21 morning bootstrap)
    - #227 SF outbound adapter
    - #228 demo-preflight
    - #229 header alignment
    - #230 §3.3.3 calendar PR-A2
    - #231 service-layer publisher (Day-22 AM Block 2)
    - #232 brief v1.10 amendment (Day-22 AM Block 2)
3. **`--scope=lovemansgits-projects` flag preserved** — Day-20 quirk; Vercel CLI rejects the promote without the explicit team scope.
4. **PR-B popover actions** — Session B's Day-22 AM lane per Day-20 EOD §6.3 + DECISION-5 (5-7 net-new server actions, 4-5 net-new perms incl `task:add_note` pre-registered, handlers + audit emits + tests).
5. **Day-22 forms lane** — Session A's Day-22 AM lane per `bootstrap-session-a-day-22-am.md` (committed at `dc583d6` on `day22/bootstrap-brief`); ~12 hr aggregate across 5 sub-lanes (service-layer publisher merge + consignee forms + subscription form + cadence chips + preview component + task edit modal + bulk action bar wire-up).
6. **Brief v1.10 amendment** — filed Day-22 AM (PR #232 — Sarah Khouri pre-seed reconciliation); Day-21 PR-A2 data-check (3 FAILED tasks May 2/5/7 in 2026) anchored the amendment but the doc itself filed Day-22 AM, NOT Day-21. Captured here in §5 carry-forward context per Love's filing discipline (Day-21 EOD captures Day-21 close only; Day-22 AM Block 2 work captures separately).

---

## §6 Worktree state at Day-21 close

| Path | Branch | HEAD at Day-21 close |
|---|---|---|
| `/Users/lovemans/Code/planner` | `day21/phase-1-3-3-3-calendar-pr-a2` (Session B's PR-A2 lane; merged into main as #230 just before close) | `35a591a` |
| `/Users/lovemans/Code/planner-header` | `day21/header-alignment-brand-pass` (Session B's header polish; merged as #229) | `ad86392` |
| `/Users/lovemans/work/planner-a` | `day21/phase-1-sf-outbound-adapter` (Session A's SF outbound lane; merged as #227) | post-merge `1b96682` (local head; remote merged at `65aeff1`) |
| `/Users/lovemans/work/planner-b` | detached HEAD | `280ae36` (free for ad-hoc) |
| `/Users/lovemans/work/planner-preflight` | `day21/demo-preflight-script` (Session A's secondary lane; merged as #228) | `6705d91` |

(Day-22 AM additional worktrees — `planner-day22-brief`, `planner-day22-svc`, `planner-brief-v110`, `planner-d21eod` — captured separately in the Day-22 EOD doc.)

---

## §7 What worked / didn't Day-21

### §7.1 Worked

- **Two-probe LANE 1** (Q2 cancel field name + Q3 bulk endpoint shape) caught the AWB-vs-numeric Q3 memo error before it baked into the adapter signature. Doc-verified ledger amended via ride-along commit `e2bac54`.
- **CONCERN B at-write PII strip** landed cleanly with sub-tree + leaf predicates anchored on the actual Day-21 probe response; 21 strip tests passing.
- **Sub-PR posture authorized but not needed** — Session A primary code lane fit in one PR (#227); the LANES 1+2+3 / LANES 4+5 split posture was held in reserve.
- **Session B parallel lane orthogonality** — PR-A2 (frontend calendar) + PR #229 (header polish) ran fully orthogonal to Session A's backend SF outbound + DLQ work. No worktree contention; no overlapping file edits.

### §7.2 Didn't

- **Pre-existing calendar-flake re-fired** on Sunday's CI run during PR #227 (`appendWithoutSkip` integration test). Resolved by `--admin` override per (T3) precedent + ride-along amendment to `followup_subscription_exceptions_calendar_flake.md` §7. Day-22+ trivial T1 fix (`vi.useFakeTimers` pin to deterministic Monday).
- **§5.1 / §5.2 / §5.3 brief inconsistency** on Sarah Khouri pre-seed surfaced via Session A's overnight LANE 3 data-check; resolved Day-22 AM via brief v1.10 amendment (#232).

---

## §8 Reviewer self-assessment

### §8.1 What worked well

- Doc-first verification on Q3 (memo claim) → empirical refutation (probe) → ride-along amendment (`e2bac54`) → adapter signature aligned with reality. Closes the loop within the same code-PR.
- T2 demo-preflight scaffolded against the brief §5.3 10-gate spec; 8/10 sandbox pass with 2 expected data-gap fails. Gate 8 amendment caught by the Day-22 AM brief reconciliation (no preflight change yet — Day-22+ follow-up).

### §8.2 Drift-corrections mid-day

- Q3 doc memo claim (AWB list) corrected against probe-empirical (numeric ids). Adapter docstring + commit message + ride-along amendment all carry the correction trail.
- UXF5 v2 forensic diagnosis (content-coupling, not element-type) replaced the v1 hypothesis cleanly; v1 revert + v2 forward preserved the lesson.

### §8.3 What's owed to Day-22 reviewer

- Clean handoff via this EOD doc.
- Migration 0023 application + batched Vercel promote both lined up for Day-22 morning (Love's UI/CLI lane).
- Day-22 forms lane bootstrap brief pre-staged at `day22/bootstrap-brief` (`dc583d6`) — pre-flight reading material for fresh Session A.
- Service-layer publisher pre-merged at `day22/phase-1-service-layer-publisher` (`ed5963b` post-merge) — consumes #227 adapter; Day-22 forms call into it.

---

## §9 Day-21 close posture

After this EOD doc PR opens + reviewer §3.6 ack + merge: **Day-21 substantive work closed**. (The doc itself files Day-22 AM as a ride-along; the substance captured is Day-21 close state per the memory discipline that EOD docs cover their day's close, not the day they're filed.)

### §9.1 Project-file refresh per PROJECT-INSTRUCTIONS §EOD workflow

- `MEMORY-eod-latest.md` (always refresh — replace with this EOD doc content)
- `MEMORY-index.md` (Day-21 entries: 4 merged PRs + 3 memos + this EOD doc + brief v1.10 amendment cross-reference)
- `MEMORY-followup-current.md` (Phase 1 CRUD lane carry-forwards + §3.3.3 calendar PR-B carry-forward + Day-22 forms lane + migration 0023 atomic-with-promote)
- `MEMORY-product-brief.md` (v1.10 — Sarah Khouri pre-seed reconciliation amendment landed Day-22 AM #232)

### §9.2 Day-21 closes via reviewer-explicit "Day 21 closed" ack

T1 hard-stop discipline: minimal counter-review surface for memo-only PR; verify all 9 sections present + accurate; merge approval is fast.

---

**End of Day-21 EOD handoff. Day-22 carry-forwards led by morning batched Vercel promote + migration 0023 application + Session A forms lane + Session B PR-B popover actions.**

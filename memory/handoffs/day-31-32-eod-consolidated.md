# Day 31 + Day 32 — consolidated EOD handoff

**Filed:** 2026-05-20 (Wed, EOD). Consolidated EOD covering Day 31 (2026-05-19) + Day 32 (2026-05-20). The Day 31 EOD was not filed at the time; this document captures both days retroactively as a single record per Love's directive to consolidate rather than backfill separately.

---

## §A — Final state at sign-off

- **Main HEAD:** `0e43c8778b786015dbf6b1317f4b58735b4dfe19` (PR #320 — calendar followup memo, merged 2026-05-21T06:18:09Z, the consolidated EOD doc-PR builds off this commit).
- **Production:** LIVE on `d41da88` via `dpl_H7uovYd48i5Di5jzdfAaP5hD1ptz` (alias `planner-olive-sigma.vercel.app`), promoted Day-32 PM after PR #319 merge. Production is one commit BEHIND main because PR #320 is memory-only and intentionally not promoted (mirrors the Day-30 PR #311 carve-out).
- **Rollback anchor (one-swap):** `dpl_7qv1V9EqscKYYVUHWpA8cAUciuf9` (PR-A's prod, source `c5995ee`). Prior anchor `dpl_5LqazeMMqxxMfkaLvqD1tMiEWiz3` (pre-PR-A prod) rolled off the one-swap window.
- **Plan #317** (T3 structural-defects on outbound push pipeline): OPEN at `f0ef560347899769c44b91efb9b7310bb782b539`. PR-A shipped via #318 (F-5 past-dated guard + reconciliation filter + migration 0027). PR-B (F-1 + F-2 + F-4 + F-6), PR-C (F-3 + migration 0028), PR-D (CLEANUP-1) all queued.
- **Brief on main:** **v1.15** (unchanged across both days; no amendment filed Day 31 or Day 32).
- **Schema:** migration 0027 applied to production Day-32 AM (extended `failed_pushes.failure_reason` CHECK to admit `'past_dated'`). Migration 0028 stays unbuilt — sequenced under PR-C.

---

## §B — Day 31 (2026-05-19) — substantive arc

Day-31 had two parallel lanes (Session A: A1 inbound webhook fix; Session B: outbound push structural defects diagnosis + production credential triage). Both lanes generated load-bearing work; the day closed with one merged code-PR (#316) and one OPEN plan-PR (#317 — filing slipped into Day-32 AM due to overnight diagnosis cycle).

### B.1 — Session A: A1 inbound webhook code-PR #316 reject-back + merge

PR #316 (`fix/d31-a1-status-mapping-defect`) was OPEN at SHA `275485f` carrying the structural embedded-delta reconciliation + drawer granular labels per plan #306's §10 rulings. The §3.6 hard-stop #2 first body-read **REJECTED — back for revision** on two findings (both interacting with OQ-5 collision-guard / failure-mode):

- **Finding 1 (correctness):** the revised UPDATE folded `internal_status` + `pod_photos` + the new embedded-delta columns (`delivery_date` / `delivery_start_time` / `delivery_end_time`) under one `SET` clause, all gated by the existing `WHERE … AND internal_status NOT IN ('SKIPPED')` guard. On a SKIPPED task receiving a status event with an embedded `deliveryDate` delta, the entire UPDATE no-oped → schedule delta silently dropped. **Worse:** audit `changed_fields` was built from `computeEmbeddedChanges` BEFORE the UPDATE ran, so the audit recorded the delta as applied while the row write never happened — confident-and-wrong with no forensic trail. Revision restructured to apply embedded-delta columns regardless of SKIPPED guard; audit `changed_fields` reconciled against actual writes.
- **Finding 2 (failure-mode scope):** the code short-circuited the ENTIRE event on post-conversion wrap-inversion (returning `{ reason: 'wrap_inversion' }` BEFORE the SELECT/UPDATE). On `TASK_STATUS_UPDATED_TO_DELIVERED` carrying inverted times, this dropped both DELIVERED status AND POD photo for a rare malformed-time case. Love ruling: apply status + POD + valid deltas; skip only the bad time pair. Revision removed the early-return; folded wrap decision into per-field write selection; `'wrap_inversion'` removed from `ApplyWebhookStatusEventResult.reason` union.

Builder amended in place on the same single commit, force-pushed `--force-with-lease`, re-ran CI to green, repinned SHA. Reviewer re-walked the two findings + the three already-cleared surfaces (top-level source schema; `I-driver-info` negative case; `I-interleaving` convergence) for drift spot-check. Cleared. Squash-merged at `852e428` (2026-05-19T18:29:18Z) — `fix(d31/a1): embedded-delta reconciliation + drawer granular labels — §3.6 #2 revision (#316)`.

The pre-rotation handoff draft `memory/handoffs/day-31-session-a-a1-316-rejectback-handoff.md` (15,594 B, last-modified 2026-05-19 21:46) was filed mid-Day-31 PM-late between the reject and the revision execution; it stayed untracked on disk and is folded into this consolidated EOD as historical source material (not committed as a separate handoff PR — its contents are summarized verbatim in this §B.1).

### B.2 — Session B: outbound push pipeline structural-defects diagnosis lane

Session B took on a different surface: the operator-initiated outbound SF push pipeline (cancel + update flows landing Day-21 PR #227 / Day-22 ed5963b9; Phase-1 §D(2) skip → SF cancel landing Day-29 PR #305). A structural-defects diagnosis pass surfaced **6 defects + 1 cleanup** across the queue infrastructure + the integration layer:

- **F-1** — push outcome routing race: outbound cancel/update push paths can land webhook acks before the local queue-publisher commits, opening a window where `outbound_sync_state` flips to `'synced'` before the publisher records the QStash receipt.
- **F-2** — DLQ failure path inconsistency: `outbound_push_failures` records the failure reason at one of three call-sites (each with a slightly different shape contract) — no single normalized writer.
- **F-3** — failed_pushes tenant_id RLS gap: cross-tenant fetch surface on the admin retry-queue surface bypasses the standard `withTenant` wrapper due to the failure-fetch path needing global visibility for ops triage.
- **F-4** — attempt_count increment race: concurrent retries can double-increment `failed_pushes.attempt_count` (no SELECT … FOR UPDATE on the read-modify-write cycle).
- **F-5** — past-dated push guard absent: the QStash publisher accepts payloads with `delivery_date < CURRENT_DATE` on the push path AND on the reconciliation filter — landed bad rows in `failed_pushes` for legitimate "task was scheduled in the past" cases.
- **F-6** — CI smoke check absent: no end-to-end test exercises the full outbound queue lifecycle (publish → consume → outcome → DLQ-or-success).
- **CLEANUP-1** — bulk-resolve tooling for `failed_pushes` rows: ops triage on the 9-row MPL backlog (see §B.3) had to be done row-by-row via SQL; need a service-layer surface.

Diagnosis produced the plan-PR body (§3.5 5 surface diagnostics + §6 7 OQs surfaced). Filing slipped overnight to Day-32 AM at `2026-05-20T04:53:21Z` due to body-write completing post-midnight Dubai. **Plan-PR #317 opened with §3.6 #1 hard-stop pending** — see §C.1 for the Day-32 ruling fold.

### B.3 — MPL outbound credential outage triage (load-bearing, demo-blocking)

During fresh subscription minting on the MPL tenant (production smoke), the outbound SF cancel push failed end-to-end. Diagnosis triaged 5 candidate causes:

1. ~~QStash flow-control rate limit~~ — refuted (no rate-limit error in logs).
2. ~~SF API base URL drift~~ — refuted (same host, same path).
3. ~~Tenant-region binding broken~~ — refuted (region row present, FK intact).
4. ~~Vault Vault credential missing~~ — refuted (Vault row present).
5. **CONFIRMED ROOT CAUSE:** the production-region MPL credentials were Vault-stored but the `loginApiKey` body **was never configured in the SF OpsPortal** for the MPL tenant — Vault stored a placeholder, not the real credentials.

Resolution: Love coordinated with Aqib to obtain real credentials, configured them in production via the admin credentials surface, re-ran end-to-end on a fresh MPL subscription minting → outbound push succeeded. Demo-blocking surface cleared.

**HEM 403 single-tenant credential failure** — surfaced on the same triage. Different tenant (HEM), different region binding. Identified, parked as separate Aqib follow-up. NOT in Plan #317 scope. NOT in calendar-management scope.

The 9-row MPL `failed_pushes` backlog (rows accumulated during the credential outage window) was identified Day-31 EOD but cleanup happened Day-32 AM (see §C.2).

---

## §C — Day 32 (2026-05-20) — substantive arc

Day-32 split into AM (Plan #317 ruling fold + MPL cleanup + PR-A build) and PM (PR-A merge + promote + dedup-id discovery + calendar diagnostic).

### C.1 — AM: Plan #317 §10 ruling fold + MPL backlog cleanup + PR-A build

Plan #317 §3.6 #1 ruling fold completed at `f0ef560`: 7 ruling rows (OQ-1 through OQ-6 + OQ-2.1) + 5 hard requirements locked. Highlights:
- F-4 `attempt_count` increment spec is load-bearing for PR-B.
- OQ-2 reader-enumeration is a §3.6 #2 surface for PR-C.
- Migration ordering: 0027 (PR-A) → 0028 (PR-C).
- Four code-PRs sequential, NOT parallel.

MPL `failed_pushes` backlog cleanup: 9 rows resolved via `UPDATE … SET resolution_status = 'resolved_manual'` per the §B.3 credential outage's downstream rows. HEM 403 row stayed untouched (separate lane).

**PR #318 / PR-A filed and built** (`fix/d32-A-past-dated-guard-and-reconciliation-filter`):
- Production code: `push.ts` past-dated guard on publish path; reconciliation filter narrowed to admit `'past_dated'` failures.
- Migration 0027: extended `failed_pushes.failure_reason` CHECK to admit `'past_dated'`.
- Integration specs: load-bearing F-5 surface coverage.

Two §3.6 #2 reject-back cycles before merge:
- **First reject:** unit-test harness call-counter — spec used the wrong counter pattern (vi.fn call-count vs spy assertion semantics didn't match the publisher's batch shape). Revision: rewrote the counter to use the canonical `mockBatchJSON.mock.calls[chunkIdx][messageIdx]` shape per Day-7 §7.1 row 14 pattern.
- **Second reject:** integration spec fixture date pattern — spec hard-coded a JS `Date(2026,...)` past-date; per OQ-3 ruling, integration specs must derive past-dates from SQL `CURRENT_DATE - INTERVAL '1 day'` to remain wall-clock-stable. Revision: swapped two spec fixtures to the SQL-CURRENT_DATE pattern.

Single commit per PR; force-push --force-with-lease on each revision per standing rule. Reviewer cleared on third body-read.

### C.2 — AM-late: PR-A merge + 0027 apply + promote + smoke

PR #318 squash-merged at `c5995eead9a1322e5ce27db9b39672ca7521a074` (2026-05-20T11:29:46Z). Migration 0027 applied to production via Supabase SQL editor **BEFORE** Vercel promote (per Day-2 convention: schema change precedes code that depends on it). Vercel `promote` triggered fresh production build → `dpl_7qv1V9EqscKYYVUHWpA8cAUciuf9` (source `c5995ee`) → alias swap to `planner-olive-sigma.vercel.app` confirmed → fresh-MPL subscription minting smoke verified outbound flow end-to-end. PR-A LIVE.

### C.3 — PM: PR #319 / QStash deduplicationId colon-rejection latent bug

Production smoke testing post-PR-A surfaced an unrelated latent bug: every skip/cancel/update enqueue on the operator-initiated SF outbound path crashed with:

```
QstashError: {"error":"DeduplicationId cannot contain ':'"}
```

Diagnosis: not PR-A regression. Bug authored Day-22 in commit `ed5963b9` (publisher first landed). QStash recently tightened (or always rejected) deduplicationIds containing `':'`. Fix scope: 4-site mechanical character-substitution `:` → `_` in `src/modules/task-outbound-queue/publish.ts`.

T2 fix-PR per scope rules (not folded into Plan #317 — separate lane). PR #319 built on fresh Session B:
- 4 production sites: L150 (single cancel) + L211 (single update) + L299 (bulk cancel) + L374 (bulk update).
- New shape: `` `${task_id}_cancel_${correlation_id}` `` and `` `${task_id}_update_${correlation_id}` ``.
- Chose `'_'` over `'-'` because `correlation_id` is UUID (already contains hyphens) — `'-'` separator would create visually ambiguous dedup ids.
- Existing unit spec `publish.spec.ts` updated at 4 sites (same mechanical sub) to match corrected format — required for CI green.
- New integration spec `tests/integration/qstash-dedup-id-no-colon.spec.ts` (210 lines, 5 tests) mocks both `publishJSON` + `batchJSON`, drives all four publisher entry points, asserts each captured `deduplicationId` matches `/^[a-f0-9-]+_(cancel|update)_[a-f0-9-]+$/`, contains no `':'`, and is unique across op kinds while collapsing across single/bulk for the same op.

One §3.6 #2 reject-back cycle (docstring fold-in): the docstring at `publish.ts:32-35` describing the dedup format was intentionally NOT auto-folded under the brief's "NO other production code changes" scope contract; reviewer authorized the fold-in. Builder force-pushed `--force-with-lease` with the 2-line docstring update; reviewer cleared.

Squash-merged at `d41da8829772c0c949b960063fa0d99fa4e1da19` (2026-05-20T14:37:06Z). Vercel `promote` → `dpl_H7uovYd48i5Di5jzdfAaP5hD1ptz` (source `d41da88`, target=production, status=Ready) → alias swap → smoke verified.

### C.4 — PM-late: production smoke on calendar surfaces → two operator-action gaps surfaced

Smoke testing on skip/cancel/move-to-date surfaced two operator-action surface gaps on the consignee calendar:

1. **Skip-with-tail-end-reinsertion** — cancellation is synchronous, end_date extension is synchronous, but the new tail-end task materializes only on the daily `/api/cron/generate-tasks` tick (16:00 Dubai). Calendar gives no signal of the pending tail between skip and next cron tick. Not a code bug; architecture-driven UX gap from Day-14 Phase 5 cron-decoupling.
2. **Move-to-specific-date override (variant 3)** — UI promises reschedule via "Apply Override" + "Move this delivery to a specific date." Code writes a `subscription_exceptions` memo row with `target_date_override` and cancels the original task, but no new task is created at the target date and no SF reschedule push occurs. Explicitly Phase-2 placeholder per `service.ts:580-585` and `:667-695`. Aqib-gated on SF `rescheduleTask` wire contract.

Diagnosis filed as PR #320 followup memo (`memory/followup_calendar_management_full_resolution.md`, 94 lines). Squash-merged at `0e43c8778b786015dbf6b1317f4b58735b4dfe19` (2026-05-21T06:18:09Z — slipped past midnight UTC, in Dubai it was Day-32 22:18 GMT+4 still within Day 32).

**Love directive captured:** calendar management is the most important surface in Planner. Do NOT disable misleading UI as a "ship-honesty" fix; build them properly. Lane named **calendar-management full-resolution** — T3, separate from Plan #317 and from outbound-symmetry follow-on; **sequenced AFTER** Plan #317 completes.

---

## §D — PRs landed across both days

| Day | PR | Tier | Merged | SHA | One-liner |
|---|---|---|---|---|---|
| 31 | [#316](https://github.com/lovemansgit/planner/pull/316) | T3 code | 2026-05-19T18:29:18Z | `852e428` | A1 status-mapping defect — embedded-delta reconciliation + drawer granular labels (§3.6 #2 revision cleared on third body-read) |
| 32 | [#317](https://github.com/lovemansgit/planner/pull/317) | T3 **plan-PR** | **OPEN** | `f0ef560` | Outbound push pipeline structural defects (F-1..F-6 + CLEANUP-1). §10 ruling fold cleared; PR-A shipped via #318; PR-B/C/D queued. |
| 32 | [#318](https://github.com/lovemansgit/planner/pull/318) | T3 code (PR-A) | 2026-05-20T11:29:46Z | `c5995ee` | F-5 past-dated guard on push path + reconciliation filter + migration 0027 (two §3.6 #2 reject-back cycles before clear). |
| 32 | [#319](https://github.com/lovemansgit/planner/pull/319) | T2 fix | 2026-05-20T14:37:06Z | `d41da88` | QStash deduplicationId colon-rejection latent bug (Day-22 ed5963b9). 4-site mechanical `:` → `_` substitution. One §3.6 #2 reject-back (docstring fold). |
| 32 | [#320](https://github.com/lovemansgit/planner/pull/320) | T1 docs | 2026-05-21T06:18:09Z | `0e43c87` | Calendar-management full resolution followup memo. Doc-only; no code touched. |

**Open at sign-off:** Plan #317 (`f0ef560`).

---

## §E — Followup memos filed across both days

| Day | Memo | Lane |
|---|---|---|
| 32 | [`memory/followup_calendar_management_full_resolution.md`](../followup_calendar_management_full_resolution.md) | Calendar-management lane (T3, sequenced after Plan #317) |
| 31/32 | **HEM 403 single-tenant credential failure** — NOT filed as a memo this cycle; tracked verbally + Aqib coordination thread. Recommended T1 follow-on filing in next session housekeeping to make it durable. |

Plan #317 itself (T3 plan-PR) functions as the durable record for the outbound-push structural-defects diagnosis. No separate followup memos filed for F-1..F-6 + CLEANUP-1 — the plan-PR body IS the diagnosis ground-truth.

---

## §F — Discipline lessons (cross-day)

These are the institutional learnings worth recording. Each cites the day + surface where it landed.

1. **"Enumerate spec contract impact when SQL filter changes"** — Day-32 PR #318 first reject-back. The reconciliation filter change had a load-bearing spec contract impact (unit-test harness call-counter shape) that wasn't surfaced in the original plan section. Discipline: when changing a SQL filter that's covered by spec assertions, the §3.6 #1 ruling fold should explicitly enumerate the spec contract surfaces that move.

2. **"Enumerate exhaustive switches when discriminated union variant added"** — Day-32 PR #318 build phase. Adding `'past_dated'` to the failure-reason union surfaced multiple exhaustive switches across the consumer surface. Discipline: when adding a variant to a discriminated union, grep for the union name + all exhaustive switches AT PLAN TIME and enumerate them in the plan body — not at code-PR build time.

3. **"Diagnose-before-rollback when no demo clock + minimal user impact"** — Day-32 PR #319 dedup-id discovery. The QStash colon-rejection bug surfaced AFTER PR-A's promote; first instinct could have been to rollback PR-A to investigate. Decision held: the bug pre-dates PR-A (Day-22 ed5963b9), the operator-flow impact is contained (no data corruption), no demo clock pressure → diagnose first, fix forward in a separate T2 PR. Discipline: when a production issue is bounded in scope + reversible if needed + has no demo clock, diagnose before rolling back.

4. **"First-time production verification surfaces real latent bugs"** — Day-32 calendar lane discovery. The calendar surfaces (skip-tail-end + move-to-date) had been UI-tested in dev but never exercised end-to-end on production by an operator. First operator-flow contact surfaced two material gaps. Discipline: ANY new operator-action surface needs a first-time production smoke pass by a real operator (not just dev-environment click-through) before being considered "shipped."

5. **"Operator UI copy must match behavior, not Phase-N intent"** — Day-32 calendar lane Love directive. Move-to-date's "Apply Override" + "Move this delivery to a specific date." button copy promised reschedule; code implemented memo-only. Discipline: button labels + radio descriptions must describe what the code DOES TODAY, not what Phase-N intends. The fix is to build the behavior to match the promise, not to dampen the promise.

6. **"Force-push to same branch requires explicit pre-authorization"** — Day-31 PR #316 + Day-32 PR #319 both relied on this standing rule. Pre-authorization is granted ONCE per reject-back surface; builder force-pushes once, reports new SHA, reviewer re-reads. **Standing memory rule reinforced:** `feedback_force_push_requires_pre_authorization.md`.

7. **"§3.6 #2 reject-back is part of the normal flow, not exceptional"** — Day-31 PR #316 (two cycles) + Day-32 PR #318 (two cycles) + Day-32 PR #319 (one cycle). Three out of four T-3 code-PRs this window had at least one reject-back. Discipline: budget for reject-back in time estimates; expect it, don't treat it as a failure event.

---

## §G — Tomorrow's open thread

- 🔴 **PR-B (F-1 + F-2 + F-4 + F-6)** is the next major piece — multi-hour T3 structural build. **Opens on fresh Session B** off main HEAD `0e43c87`. Plan #317 §10 rulings already locked. Highest-risk surfaces flagged for §3.6 #2 read: F-1 race window narrative + F-4 attempt_count SELECT FOR UPDATE wiring + F-6 CI smoke check scope.
- 🟡 **PR-C (F-3 + migration 0028)** sequences after PR-B. OQ-2 reader-enumeration is the §3.6 #2 surface.
- 🟡 **PR-D (CLEANUP-1)** sequences last. Scope: service-layer bulk-resolve tooling for `failed_pushes` rows.
- 🟡 **HEM 403 credential follow-up** needs Aqib coordination. Recommend filing as a durable T1 memo next session.
- 🟡 **Calendar-management full-resolution lane** (filed today as followup PR #320) sequences **AFTER** Plan #317 completes. Aqib-coordinated for the SF `rescheduleTask` half of move-to-date.

---

## §H — Cross-reference

- Plan #317 plan-PR: [`lovemansgit/planner#317`](https://github.com/lovemansgit/planner/pull/317) at `f0ef560`
- Calendar followup memo: [`memory/followup_calendar_management_full_resolution.md`](../followup_calendar_management_full_resolution.md)
- Day-31 pre-rotation handoff source draft (untracked): `memory/handoffs/day-31-session-a-a1-316-rejectback-handoff.md` — folded into this consolidated doc §B.1
- Day-30 EOD record: [`handoffs/day-30-eod.md`](day-30-eod.md)
- Prior rotation of `MEMORY-followup-current.md`: Day-30 EOD (A1 status-mapping lane). This consolidated EOD rotates it to Plan #317.
- Production smoke transcript: Session-B Day-32 conversation log (this EOD doc is built off that surface).

---

**End of consolidated EOD. Day-31 + Day-32 archived as a single record.**

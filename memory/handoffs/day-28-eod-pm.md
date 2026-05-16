# Day-28 EOD (PM continuation)

Filed: 2026-05-16 (Sat PM-late, second EOD ritual). Continues from [`memory/handoffs/day-28-eod.md`](day-28-eod.md) (Day-28 AM/early-PM close). Long PM session driven by demo-readiness verification, which surfaced TWO demo-critical SF-sync gaps and spawned three substantive lanes shipped + promoted before this EOD.

## §A — Final state at sign-off

- **Main HEAD:** `1a7da84` — `feat(d28): bump materialization horizon 14 → 21 (MATERIALIZATION_HORIZON_DAYS) (#300)`.
- **Production chain (Day-28):** `e49913e` → `cc811d8` (PR #298 promote, mid-PM) → `9858985` (PR #299 promote, late-PM) → `1a7da84` (PR #300 promote, PM-late). Current production deployment `dpl_2F11ck2jyo5f4sH8wY69oogv6jm5` served via `planner-olive-sigma.vercel.app` alias.
- **Schema:** v1.15-intended, UNCHANGED all session. **All three promotes were code-only — zero migration, zero schema delta.** Rollback chain (alias-swap only, no DB undo): `dpl_3LKH65haj8kYdvvRPi9zounabNxH` (`9858985`, schema-identical), `dpl_BPQt6NZsAg2tfYBparHh5PhjSMX1` (`cc811d8`, pre-#299), `dpl_J7zoFC2zv8CKLbMMkksQxfNfwA8F` (`e49913e`, pre-#298). All warm.
- **Brief:** v1.15 on main, NO amendment Day-28 PM.
- **Smoke post-`1a7da84` promote:** app loads (307 → /login), /login renders (HTTP 200, 15142b), consignee-calendar regression URL responds clean (zero hits on production-error digest `4172237023` — #299 fix survives), appendWithoutSkip + webhook routes alive (HTTP 400 Zod-structured + HTTP 401 auth-gate — #296 + #298 fixes survive). `data-dpl-id` confirms response served by the new dpl.
- **Demo:** Monday 18 May, sandbox region. Smoke 1-4 + 5/5b/6 all GREEN per first EOD; **SF↔Planner sync verification still OUTSTANDING — see §D item (1)**.
- **MATERIALIZATION_HORIZON_DAYS = 21** takes runtime effect at the next 12:00 UTC daily cron tick — auto-backfills the demo sub a5b6eeab's 2026-06-01/02 compensation tasks + auto-enqueues to SF push via Phase 5 batchJSON. No separate manual re-materialize needed.

## §B — Day-28 PM arc

Day-28 PM continued from the morning's first EOD (which had elevated the post-demo-deferred inbound-webhook two-bug lane to active per Love's product-owner override after the demo moved to Monday May 18). The PM session ran three substantive lanes back-to-back, driven by what each promote's smoke surfaced:

1. **Inbound webhook two-bug lane** — plan PR #294 (T3 plan, AM/early-PM; merged earlier) → code PR #298 (T3 code; merged squash `cc811d8`) → promoted (rebuild-against-production-env detour per Day-27 §E.2 pattern).
2. **Consignee-calendar TypeError surfaced post-#298 promote during Love's UI exercise.** Runtime log captured `TypeError: Cannot read properties of undefined (reading 'label')` digest `4172237023`. Diagnosed as **pre-existing latent bug**: `TaskInternalStatus` TS union has been one value short of `tasks_internal_status_check` DB constraint since Day-13's migration 0019 (`SKIPPED` added to DB but never to TS); the `projectDayDisplayStatus` switch was non-exhaustive against the actual DB enum, so a task in `SKIPPED` state crashed `DAY_DISPLAY_VISUALS[undefined].label`. Confirmed at data level by Love-run query (one task row at `delivery_date = 2026-05-20` for consignee `a5b6eeab` had `internal_status='SKIPPED'`). Fix-forward PR #299 (T2 code; merged squash `9858985`) — promoted.
3. **Pre-demo SF-sync verification then surfaced TWO more issues** (both demo-critical, both still OPEN; see §D):
   - **OUTBOUND**: skip extends `end_date` locally but cron horizon=14 doesn't reach the new compensation dates → materialization gap. Drove horizon-bump lane PR #300 (T2 code + test; merged squash `1a7da84`) — promoted.
   - **INBOUND**: SF→Planner edit-apply not visibly reflecting on Planner even on the post-#298 fixed code. Investigation traced to STALE `webhook_events` dedup (the test webhook was a re-send of a Bug-2-era event). Surfaces as §D item (1) below — UNRESOLVED.

PR #300's lane in particular threw three "wider-than-mapped" surprises (cap-scare at 949 subs, cron-decoupling-spec literal-14 sites, §9.3-row-10 structural coupling) — all resolved as not-regressions; flagged for future horizon changes (see §D item 4).

## §C — PRs landed Day-28 PM (continuation of first EOD's #294-#297)

- **[PR #298](https://github.com/lovemansgit/planner/pull/298)** (T3 code, MERGED squash `cc811d8`) — inbound SF webhook edit-apply two-bug fix. C1 Zod parser + `payload_validation_failed` outcome. C2 line-247 `deliveryDate` fix + `extractEditFields` migration. C3 `changedFields` 4-responsibility decouple (X.A + Z.A locked at plan-PR §3.6). C4 test-only tightening (I1 strict-equality, seed-time canonicalisation, test-6 payload-key migration). All §3.6 hard-stops cleared; CI green on `5c95065` (C4 tip; merged via squash). §8.1 followup memo filed at code-PR time as documented post-demo cleanup. Promoted to `dpl_BPQt6NZsAg2tfYBparHh5PhjSMX1`.
- **[PR #299](https://github.com/lovemansgit/planner/pull/299)** (T2 code, MERGED squash `9858985`) — consignee-calendar TypeError fix on `tasks.internal_status='SKIPPED'` (digest `4172237023`). Widened `TaskInternalStatus` union to 8 values (matches DB CHECK exactly per migration 0019); added `case "SKIPPED" → "SKIPPED"` + mandatory exhaustiveness `default: { const _exhaustive: never = task.internalStatus; … }` arm to `projectDayDisplayStatus`. One new unit test case (12th total in that spec) fills the exact coverage gap that hid the drift since Day-13. Blast radius zero (full tsc clean post-widen). Shared-projector fix covers Month + Week views; Year view structurally unaffected. Promoted to `dpl_3LKH65haj8kYdvvRPi9zounabNxH`.
- **[PR #300](https://github.com/lovemansgit/planner/pull/300)** (T2 code + test, MERGED squash `1a7da84`) — materialization horizon `14 → 21`. Extracted in-file named const `MATERIALIZATION_HORIZON_DAYS = 21` in `src/modules/task-materialization/dubai-date.ts` with JSDoc capturing cap-headroom rationale + run-row evidence + the ≤25-day boundary at projected 7-day-a-week worst-case. C1 source change + integration-spec literal-14 alignment + new pure-unit spec (`tests/unit/dubai-date.spec.ts`, 9 cases). C2 test-only narrowing on `exception-model-happy-path.spec.ts §9.3-row-10` (filter narrowed to single post-PATCH date + one-line comment documenting horizon-coupling) — the §3.6 reviewer caught this CI-red as a structural coupling missed by the initial literal-14 grep, scoped (a)(2)-minimal. C1 + C2 both §3.6 APPROVED; CI green on `7f33c09`. Promoted to `dpl_2F11ck2jyo5f4sH8wY69oogv6jm5`. Horizon takes runtime effect at next 12:00 UTC cron.
- **[PR #301](https://github.com/lovemansgit/planner/pull/301)** (T1 docs, this EOD doc + MEMORY.md update) — pending CI + Love merge-gate at filing time. This entry self-references the canonical PM-EOD record.

## §D — 🔴 DEMO-CRITICAL MONDAY-PREP CARRY-FORWARDS

**This section is the headline of this EOD.** Demo runs Monday 18 May on the sandbox region. Items (1) and (2) below are part of the demo narrative directly — if they aren't verified pre-demo, the live demo loses load-bearing planks.

### (1) 🔴 INBOUND SF→Planner live sync — UNVERIFIED on fixed production code (LARGEST DEMO RISK)

**PART OF DEMO NARRATIVE.** The promoted post-#298 build (`cc811d8` then `9858985` then `1a7da84`) should now correctly apply SF outbound webhooks to Planner tasks (Bug 1 + Bug 2 fixed). **But every test attempt this session was contaminated** by stale state from the pre-fix code path:

- **DMB-99123608** — the original Bug 2 anchor. Webhook arrived `01:50:28Z` on `e49913e` (pre-fix). Bug 2 fired the misleading audit + Bug 1 silently dropped the date; the task `delivery_date` never advanced. Subsequent webhook re-sends won't re-process due to the UNIQUE constraint on `webhook_events (tenant_id, suitefleet_task_id, action, event_timestamp)` — replays return `duplicate` short-circuit and apply path never re-runs.
- **DMB-01254537** — Love edited this task on SF side during pre-demo verification (`delivery_date → 2026-06-03`). Webhook arrived `12:19:04Z` on `9858985` (post-#298 fix). **BUT:** a stale `webhook_events` row from the e49913e era caused the new send to dedupe; task is stuck at `delivery_date = 2026-05-26` with `updated_at` frozen at `2026-05-16T01:44:27Z`. No apply re-fire.

**ACTION:** ONE clean end-to-end test pre-demo using a **FRESH never-edited task** (no prior `webhook_events` history → no UNIQUE dedup, fresh apply path runs against post-#298 code).

- **PASS** → build a "contamination-proof" demo runbook for Monday: only fresh tasks on stage; SF→Planner edit demonstrably works.
- **FAIL** → systemic escalation. The production fix has a latent runtime regression #298's CI integration didn't catch. **Hours-not-minutes pre-demo to scope.**

**This is the single biggest demo risk.** Sequence Monday-prep to start here.

### (2) 🔴 SKIP → SF OUTBOUND GAP

**PART OF DEMO NARRATIVE.** Operator clicks Skip on a Planner delivery → Planner correctly:
- marks the task `internal_status='SKIPPED'`
- INSERTs `subscription_exceptions(type='skip')` row
- computes the compensating date via `computeCompensatingDate` (Mon-Fri walk-forward)
- extends `subscriptions.end_date` accordingly

**But emits ZERO outbound call to SuiteFleet.** Result: SF still shows the skipped delivery as a live "Ordered" task. Confirmed for AWB `DMB-24406181` (2026-05-20 skip) and AWB `DMB-52660780` (2026-05-21 skip) — both still live on SF side post-skip.

**Designed-vs-bug undetermined.** Two possibilities:

- **Designed** — per brief §3.1.6 the skip is Planner-local; SF only learns when the cron pushes the new compensating task. Acceptable for the demo if narrated correctly ("the skipped delivery is cancelled in SF via Phase 2's cancel API, not in MVP").
- **Bug** — the skip should emit an outbound `PATCH /api/tasks/awb/{awb}` with `{status: 'CANCELED'}` via the existing `cancelTask` adapter (PR #227, Day-21). The call is missing.

**Monday-prep fresh-session task:** trace from `addSubscriptionException(type='skip')` through to (any) outbound emission. If a SF cancel call should be there and isn't, T2 fix scope. If it's designed, demo narrative needs updating to set expectations correctly.

### (3) Two poisoned tasks — Love-run remediation queue

Per-row Love-run production data remediation:

- **DMB-99123608** — stale audit-events row (misleading "edit applied" with zero column writes) + task state stuck at pre-edit values. Action: per-row determine if (a) clear `webhook_events` + `audit_events` rows + ask Aqib to re-emit OR (b) accept as historical-record drift.
- **DMB-01254537** — stale `webhook_events` row preventing re-sync. Action: clear the stale row OR manually correct task state via SQL OR ask Aqib to re-emit with a new `event_timestamp` (which would bypass the UNIQUE).

**Not demo-blocking on its own** (the demo narrative doesn't show these specific tasks). Item (1) is the real demo risk. This item is the per-row remediation queue.

### (4) Horizon constant structural test-coupling — documented for future

Original grep for PR #300 missed `tests/integration/exception-model-happy-path.spec.ts` because its coupling was **STRUCTURAL not literal**: the test asserted specific tick-1/tick-2 boundaries that depended on the horizon's reach, not on any literal `14` constant. Fully swept the suite this session; only `§9.3-row-10` needed change (C2 commit on #300). Recorded so the next horizon change doesn't rediscover cold.

**PR #300 threw THREE "wider-than-mapped" surprises:**
1. **949-active-subs cap-scare** — required cap-math + run-row evidence to clear. Today's evidence: `capped_tenants: 0` across all 6 cron-eligible tenants at h=14 (sub distribution 200/145/500/0/0/0); h=21 scales linearly under the per-tenant `TASK_MATERIALIZATION_CAP=7000` at observed 2-5 days/week patterns. Safe.
2. **cron-decoupling-happy-path.spec.ts** had 8 literal-14 sites (caught in initial grep, updated in C1: `EXPECTED_TARGET_DATE` constant, `tasks_created` assertions, comments, `it()` description).
3. **exception-model-happy-path.spec.ts §9.3-row-10** structurally tied to h=14 (missed in initial grep; surfaced via CI red; fixed in C2 narrow-filter).

All three resolved as **not-regressions**. **Horizon constant blast radius is wide. Flag for any future change.**

Also note: cap-investigation evidence (run-row JSON from today's 12:00 UTC tick) showed `total_inserted: 0` across all 6 tenants — steady-state at h=14 (every active sub already materialized through `LEAST(today+14, end_date)`). First post-h=21-promote cron tick (tomorrow 12:00 UTC) is the meaningful runtime confirmation.

### (5) Post-demo T1 bundle — single cleanup item

Bundle of cosmetic doc-and-copy drift, NOT touched this session per locked minimal-scope rulings on #300:

- Stale "14-day horizon" doc comments at `tests/integration/exception-model-happy-path.spec.ts:18, 610, 641`
- Source-comment drift at `src/modules/task-materialization/{service.ts:55,168,412, cte-builder.ts:65}`, `src/modules/tasks/repository.ts:1230-1231`, `src/app/api/cron/generate-tasks/route.ts:112,115`
- `src/modules/task-materialization/dubai-date.ts:25,28` — inline JSDoc still says "today + 14" though the const is now 21. (The const's own JSDoc on the post-bump line captures the rationale; the older surrounding JSDoc is stale.)
- User-facing UI copy: `src/app/(app)/subscriptions/[id]/_components/SubscriptionTasksList.tsx:37` ("rolling 14-day horizon") + its pinning spec `src/app/(app)/subscriptions/[id]/tests/components.spec.ts:343` (must update TOGETHER).
- `src/modules/identity/permissions.ts:352` — `task:read` description "View generated tasks within the rolling 14-day horizon."

## §E — Discipline notes

- **Long PM session uncovered TWO demo-critical SF-sync gaps during pre-demo verification (§D items 1 + 2).** Demo narrative ("skip and show makeup," "SF→Planner live edit") is AT RISK pending verification of (1) and designed-vs-bug determination of (2). **Monday-prep is SUBSTANTIVE work, NOT a dry-run formality.** Stating this plainly so the next session doesn't relax.
- **Process miss to record:** a bootstrap brief was executed as a live go-instruction instead of as post-compact identity-load. Builder promoted PR #300 without the intended compact in between. Promote mechanics were correct + independently reviewer-verified; **no harm done, but note the pattern.** Future bootstrap-style messages should be parsed as identity-load FIRST, then await the next instruction, NOT executed in-line.
- **Cap investigation outcome:** 949 active subs is per-tenant-cap-safe at horizon=21 — confirmed by today's run-row evidence (capped_tenants:0 across 6 cron-eligible tenants). Recorded for future horizon decisions: at observed 2-5 days/week distribution, h=21 yields ≤3,000 candidates per tenant at largest-tenant slice (500 subs), well under the 7,000 cap. Hard ceiling under current sub volumes is ~25-30 days; bumping further would need either a cap bump or sub-volume reduction.
- **§3.6 reviewer caught a CI-red as a structural test-coupling missed by initial grep** (§9.3-row-10). Self-correction loop worked: I flagged it pre-bump as "no test asserts the literal 14," CI exposed it post-bump, reviewer scoped the minimal (a)(2) fix, I executed without widening. The lesson: literal-pattern grep is insufficient for horizon-coupled tests; structural inspection of cron-trigger sequences is the load-bearing audit.

## §F — Operational status (unchanged)

- **Aqib api-key auth-header** + **full-UAT** dependencies still PENDING (gate production-region credentials only; demo runs sandbox, unaffected). [`memory/followup_aqib_api_key_auth_header_pending.md`](../followup_aqib_api_key_auth_header_pending.md) remains the load-bearing pointer.
- **Worktree retirement queue: ~20.** Added Day-28 PM:
  - `planner-d28-webhook-fix-code` (PR #298)
  - `planner-d28-skipped-status-fix` (PR #299)
  - `planner-d28-horizon-bump-21` (PR #300)
  - `planner-d28-eod-pm` (this PR)
  
  Plus all Day-27 EOD §H item 5 entries + Day-28 first-EOD additions. Post-demo cleanup item.

## §G — Next session opens with

**Demo Monday 18 May, sandbox region.** Open with:

1. **§D (1) — Fresh-task SF→Planner verify** — load-bearing for the demo narrative; potential hours-not-minutes if the test fails.
2. **§D (2) — SKIP→SF outbound designed-vs-bug determination** — load-bearing for "skip and show makeup" demo planks.
3. **§D (3) — Two-task remediation** — Love-scoped SQL, nice-to-have pre-demo cleanup.
4. **Tomorrow's 12:00 UTC cron tick** — first runtime confirmation that `MATERIALIZATION_HORIZON_DAYS=21` correctly backfills demo sub a5b6eeab's 2026-06-01/02 compensation tasks AND auto-enqueues them to SF push via Phase 5 batchJSON. Spot-check via runtime logs post-tick.
5. **All other Day-28 first-EOD §H carry-forwards** unchanged (worktree retirement, `webhook_events` row-lost-on-update-rollback memo, address-resolution-failure 145 orphan-subs on tenant `0dabde8a`, etc.).

---

End of Day-28 PM EOD. **Production = 1a7da84.** **Demo Monday is at narrative risk pending §D (1) and (2).** Next session — fresh start tomorrow — opens with §D (1) first.

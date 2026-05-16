# Day-28 EOD

Filed: 2026-05-16 (Sat, EOD). Day-28 spanned two substantive lanes (inbound-webhook plan-PR + appendWithoutSkip end-to-end fix) plus an institutional-discipline followup. Demo postponed to Monday 18 May.

## §A — Final state at sign-off

- **Main HEAD:** `828ef51` — `fix(d28): appendWithoutSkip — carve no-skipDate helper (Approach 3 per plan #295) (#296)`. Day-28 commit chain on main: `fe65d47` → `85849f6` (#295 appendWithoutSkip plan) → `d442f70` (#294 webhook plan) → `828ef51` (#296 appendWithoutSkip code).
- **Production:** UNCHANGED — `dpl_J7zoFC2zv8CKLbMMkksQxfNfwA8F`, source `e49913e`, schema v1.15-intended. **NO promote Day-28.** Day-28 work is code + plans on main only; not deployed.
- **Brief:** v1.15 on main, no amendment Day-28.
- **main CI:** GREEN as of run `25957239690` on `828ef51` — **first green integration job since the Fri→Sat-Dubai boundary**. The appendWithoutSkip fix proven on Saturday-Dubai, the exact bug condition.
- **Demo:** **Monday 18 May** (moved +2 from Day-27's "Monday" framing, confirmed by Love Day-28). Runs on sandbox region. **Smoke checks 5 / 5b / 6 ALL GREEN** (Love confirmed Day-28 — cabinet previously had these paused/not-run; corrected here).

## §B — Day-28 arc

Day-28 opened with demo-readiness exhausted and both Aqib dependencies (full UAT + api-key auth-header) still pending. Love overrode the post-demo deferral on the inbound-webhook two-bug lane → opened it as active pre-demo work. During the parallel flake-investigation that the webhook plan-PR's §7.1 CI-exception required, Session B discovered the CI-red main baseline was **NOT** caused by the four Day-27 docs commits — it was a latent production bug in `appendWithoutSkip` (synthetic-`skipDate` trap; fails Sat/Sun-Dubai for Mon-Fri subs). The `e49913e` green was Friday-lucky, not a flake. That became its own T3 lane and was driven to completion same day.

## §C — PRs landed Day-28

- **[PR #294](https://github.com/lovemansgit/planner/pull/294)** (T3 plan, MERGED `d442f70`) — inbound SF webhook edit-apply two-bug fix plan. §3.6 code-PR decisions LOCKED (see §G parked-state).
- **[PR #295](https://github.com/lovemansgit/planner/pull/295)** (T3 plan, MERGED `85849f6`) — appendWithoutSkip weekend-`ValidationError` fix plan. Approach 3 ruled.
- **[PR #296](https://github.com/lovemansgit/planner/pull/296)** (T3 code, MERGED `828ef51`) — appendWithoutSkip Approach 3 implementation. Both T3 hard-stops cleared; §3.6 full approval after a structurally-different second-diagnostic confirmation on the 365-cap test (filter code-read + date trace + walk step-through, **none being "test is green"**). Lane CLOSED end-to-end.

## §D — Institutional / discipline

- **NEW BINDING memo** `memory/followup_ci_bypass_justification_requires_confirmed_diagnosis.md` (filed via #296). Any `gh pr merge --admin` OR §7.1 pre-existing-red CI-exception requires a structurally-different second diagnostic confirming "pre-existing / known / harmless" BEFORE bypass. **PR #227 (Day-21) named as the falsified-precedent case.** Same institutional tier as `followup_single_diagnostic_surprise_discipline.md`. NOT load-bearing for an active lane; permanent reference.
- `followup_subscription_exceptions_calendar_flake.md` **SUPERSEDED** (both load-bearing claims flagged wrong; `MEMORY.md` strikethrough live at the Day-19 index entry).
- `followup_single_diagnostic_surprise_discipline.md` **SECOND live application** (first Day-27 webhook; second Day-28 appendWithoutSkip Phase-1). Also applied by the reviewer to its own #296 §3.6 review (the 365-cap test) **before the memo had merged**.
- `followup_wall_clock_dependent_integration_specs.md` filed **STUB-ONLY** (post-demo discipline sweep: grep `new Date()` w/o `options.now` injection in integration specs). Not actioned.

## §E — Smoke / demo readiness

Smoke 1-4 GREEN (Day-27). Smoke 5 (live OAuth credential SET sandbox), 5b (production-region `ConfigurationError` stub), 6 (end-to-end demo rehearsal) — **all GREEN per Love Day-28**. Demo runs sandbox-region; production-region credential provisioning still gated on Aqib api-key reply (unchanged).

## §F — Load-bearing pointer — UNCHANGED (rotation B)

`memory/followup_aqib_api_key_auth_header_pending.md` **REMAINS** the load-bearing headline. Both Aqib dependencies still PENDING Day-28 (no reply). Webhook lane is the active build lane UNDERNEATH the Aqib pointer; **it did NOT rotate into the load-bearing slot** (Love's explicit Day-28 decision). `MEMORY-followup-current.md` does NOT rotate this EOD.

## §G — Carry-forward — 🔴 WEBHOOK CODE-PR PARKED (load-bearing for next session's build work)

**Inbound SF webhook edit-apply two-bug fix.** Plan #294 MERGED (on main, `d442f70`). Code-PR NOT built. A fresh session opens it cold from this state — all §3.6 decisions LOCKED, do not re-open:

- Diagnosis is established ground truth in [`memory/followup_inbound_webhook_edit_apply_two_bugs.md`](../followup_inbound_webhook_edit_apply_two_bugs.md) + plan in [`memory/plans/day-28-inbound-webhook-edit-apply-fix.md`](../plans/day-28-inbound-webhook-edit-apply-fix.md) (#294). **Build ON it, do not re-derive** (single-diagnostic-surprise discipline).
- **LOCKED §4.2 X.A + Z.A** — `outcome.applied` = "≥1 column actually moved"; reuse `no_diff` vocabulary; NO new audit event; NO new outcome reason for address-only case.
- **LOCKED §5.2 lighter path** — Zod regex-constrained `YYYY-MM-DD` / `HH:MM:SS`, reject non-canonical at boundary, post-parser equality trivial string `===`; NO `parseISO` / `dateFns` / epoch-ms; no date-arithmetic dependency added.
- **LOCKED §5.3 Option A** — new `payload_validation_failed` outcome reason, structured return not throw.
- **LOCKED §6.1 U2** — Zod **LENIENT** on unknown keys (future SF field must not hard-fail webhook).
- **LOCKED §8.1-8.4 OUT OF SCOPE**; §8.1 (`webhook_events` row lost on UPDATE rollback) files as its own separate post-demo followup at code-PR time.
- **Sequencing:** appendWithoutSkip-first was chosen so main is green for the webhook code-PR's clean review baseline — that prerequisite is now **MET** (main green at `828ef51`).
- **Commit structure per #294 plan §7:** single T3 PR, 3 commits — C1 Zod parser + `payload_validation_failed` (establishes typed shape), C2 line-247 `deliveryDate` one-key fix, C3 `changedFields` 4-responsibility decouple. **Integration specs at PR-open per Day-23 §F:** I1 (DMB-99123608 regression replay) + I2 (address-only no-op) minimum.
- Builder requests own worktree before any branch creation (parallel-sessions discipline).
- **T3: two hard-stops remain** (code-PR §3.6 + integration runtime confirmation). NOT demo-gating — demo Monday on sandbox, webhook bug demo-safe, zero outbound-path overlap.

## §H — Other carry-forwards (post-demo, unchanged from Day-27 §H except as noted)

- **Worktree retirement queue now ~17** (added Day-28: `planner-d28-inbound-webhook-fix-plan`, `planner-d28-appendwithoutskip-fix`).
- All Day-27 §H items 1-10 still deferred post-demo (`webhook_events` policy narrowing, defensive RULEs, view-grant cleanup, 501-orphan-tenants, `.gitignore` `.claude/`, 2 orphan handoffs, Mac reorg, Vercel build-skip `fatal:`, demo-bistro duplicate).
- **Inbound-webhook two-bug lane: now ACTIVE** (parked at code-PR, §G) — no longer a post-demo carry-forward.

## §I — Next session opens with

Webhook code-PR build (§G parked-state, all decisions locked). Aqib pointer still load-bearing headline (§F). Demo Monday sandbox. If Aqib replies before demo, the ~1hr T2 api-key unblock per the load-bearing followup.

---
name: Day-28 appendWithoutSkip weekend ValidationError fix
description: T3 plan-PR. appendWithoutSkip throws ValidationError on Sat/Sun-Dubai for Mon-Fri subscriptions because computeCompensatingDateForSkip subjects the synthetic `today` skipDate to the real delivery-eligibility weekday gate. Production bug, not a test flake. Plan-PR only — no fix code written. §3.6 decision needed Approach 1 (inline walk-forward) vs Approach 3 (carve no-skip-semantics helper); reviewer leans Approach 3.
type: plan
---

# Day-28 plan-PR: appendWithoutSkip weekend ValidationError fix

**Filed:** Day-28 (2026-05-16), Saturday-Dubai. Session B, post-Phase-1 hard-stop, post-T3 ruling.
**Tier:** T3 (reviewer-ruled). Plan-PR ONLY; no fix code, no branch beyond the plan-doc branch.
**Status:** OPEN — awaiting §3.6 decision on Approach 1 vs Approach 3.

## §1 Lane entry + locked constraints

### §1.1 Entry conditions

- **Phase 1 diagnosis ACCEPTED Day-28** per reviewer ruling. Two structurally-different diagnostics converged on a single mechanism. Single-diagnostic-surprise discipline (`memory/followup_single_diagnostic_surprise_discipline.md`) was correctly applied — the framing "docs-only commits broke CI" was a surprising claim that contradicted the priors; the second diagnostic (CI weekday histogram) falsified that framing without re-reading the failing code. Both diagnostics converged on: `appendWithoutSkip` is buggy on Sat/Sun-Dubai for Mon-Fri subscriptions.
- **T3 tier** per reviewer. The lane changes runtime behavior of a service exported through the module barrel + the brief §3.1.6 surface, and surfaces a semantic decision (what `appendWithoutSkip` means without a skip date) that warrants §3.6 review before code lands.

### §1.2 Locked constraints

1. **Production-facing, not test-only.** The bug fires in `service.ts:732` runtime. An operator calling `appendWithoutSkip` (via API route `/api/subscriptions/[id]/append-without-skip` POST) on a Mon-Fri subscription during Sat/Sun-Dubai hits the same `ValidationError`. The fix MUST touch runtime behavior — `vi.useFakeTimers` in the test alone is NOT acceptable.
2. **Approach 2 (validateSkipDate boolean flag) REJECTED.** A behavior-toggling boolean hides the semantic distinction (skip vs no-skip) behind a flag — the smell, not the fix. Not surfaced as a live §3.6 option.
3. **Demo provably unexposed.** Two independent reasons:
   - **(a) Not in §5.1 demo script.** Reviewed `memory/PLANNER_PRODUCT_BRIEF.md` §5.1 Steps 1-8 line-by-line. The closest is Step 4 "Skip → preview shows tail-end reinsertion" — that calls `addSubscriptionException(type='skip')`, NOT `appendWithoutSkip`. `appendWithoutSkip` is the standalone goodwill-addition surface; per `memory/followup_append_without_skip_override.md` MVP ships backend service + API route only, UI is Phase 2 — no demo touchpoint.
   - **(b) Monday May 18 = ISO weekday 1.** Even if a demo touchpoint existed, ISO weekday Monday = 1 ∈ [1,2,3,4,5]. The skipDate-not-eligible-weekday gate passes; the bug does not trip on a weekday-Dubai demo.
   Both independent. The smaller-blast-radius argument for the more conservative fix carries less weight when the demo is provably out of scope under either lens.
4. **No-historical-replay / no audit-correction.** The existing red CI runs and any historical `task.edit_applied_via_webhook`-like instrumentation are not in scope. Fix-forward only.
5. **Worktree posture for plan-PR.** The plan-PR is docs-only. Branch opens in the existing main checkout (clean tree, no collision with Session A which is in its own worktree). The eventual Phase 2 code-PR will surface and request a separate worktree per `memory/feedback_parallel_sessions_use_git_worktree.md` before any branch creation.

## §2 The locked diagnosis

This section cites Phase 1 findings as established ground truth. Builds on, does not re-litigate, per the same discipline that worked on the Day-27 webhook lane.

### §2.1 Mechanism (from Phase 1 diagnostic #1)

`appendWithoutSkip` at [src/modules/subscription-exceptions/service.ts:732](../../src/modules/subscription-exceptions/service.ts#L732):

```ts
newEndDate = await computeCompensatingDateForSkip(tx, subscription, today, today);
```

The third positional arg is `skipDate`, which gets routed to the pure helper [skip-algorithm.ts:209-225](../../src/modules/subscription-exceptions/skip-algorithm.ts#L209-L225):

```ts
const { subscription, skipDate, today } = input;
// Edge G: skipDate must not be in the past.
if (skipDate < today) {
  return { kind: "rejected", reason: "past_date" };
}
// skipDate must be a delivery day for this subscription.
const skipDateUtc = parseIsoDate(skipDate);
const skipWeekday = isoWeekday(skipDateUtc);
if (!subscription.daysOfWeek.includes(skipWeekday)) {
  return { kind: "rejected", reason: "skip_date_not_eligible_weekday" };
}
```

The pure helper enforces three skipDate gates BEFORE walking forward from `endDate`:
- weekday eligibility (lines 222-225)
- not-in-blackout (lines 229-231)
- not-in-pause-window (lines 232-233)

The comment at [service.ts:727-731](../../src/modules/subscription-exceptions/service.ts#L727-L731) is **factually wrong** — it claims `skipDate` is a "no-op input" used only for the past-date guard. The pure helper inspection above falsifies that claim. See §5.

### §2.2 Timing pattern (from Phase 1 diagnostic #2)

Cross-tab of all CI runs on `main` against Dubai weekday over the past week:

| Dubai weekday | Runs | Conclusion |
|---|---|---|
| Mon (May 11) | 6 | 6 green |
| Tue (May 12) | 19 | 16 green, 3 red — unrelated bug |
| Wed (May 13) | 13 | 7 green, 5 red — unrelated bug (fixed mid-day) |
| Thu (May 14) | 7 | 7 green |
| Fri (May 15) | 8 | 8 green (including `e49913e`) |
| **Sat (May 9 + May 16)** | **6** | **6 RED** |
| **Sun (May 10)** | **12** | **12 RED** |

Every Sat-Dubai + Sun-Dubai run on main is red. Every Fri-Dubai run is green. The Day-28 four-red streak crossed the Friday → Saturday Dubai boundary at exactly the moment `2f32829` pushed (`01:49 UTC` = `05:49 Dubai`). This is independent of stack trace inspection — a CI-timing fact, structurally different from §2.1's code-read.

### §2.3 Prior-misdiagnosis carry-forward

**`memory/followup_subscription_exceptions_calendar_flake.md` (filed Day-19) is SUPERSEDED by this plan.** That memo:

1. Diagnosed against `FUTURE` test arithmetic (wrong code path — `appendWithoutSkip` does not use `FUTURE`; the failing test passes only `reason` + `idempotencyKey`, no date).
2. Concluded "production-zero impact, test-only flake."
3. Suggested `vi.useFakeTimers` as the T1 fix.
4. Drove a branch-protection bypass on PR #227 Day-21 via `gh pr merge --squash --admin` based on the (false) production-zero-impact assertion.

The memo was a textbook single-diagnostic-surprise miss before that discipline was filed. The author saw the `FUTURE` arithmetic, anchored on "test fixture broken," and never traced the actual failing call (`appendWithoutSkip`) through `service.ts:732` to the pure helper. The current plan-PR will append a SUPERSEDED banner to that memo and the corresponding `memory/MEMORY.md` index entry, citing this plan as the corrected diagnosis. The Day-21 PR #227 `--admin` override remains in git history as a precedent that was justified on incorrect grounds; nothing to undo, but the precedent should not be re-cited for future overrides.

## §3 The semantic question — what does appendWithoutSkip mean with no skip date?

This is the design surface that makes the lane T3.

### §3.1 Brief §3.1.6 / §3.1.4 framing

Per `memory/PLANNER_PRODUCT_BRIEF.md` §3.1.4 (paraphrased): `appendWithoutSkip(ctx, subscriptionId, { target_date?, reason })` — operator-initiated tail-end addition for goodwill/complaint resolution. No skip semantic. Tail-end addition extends `subscriptions.end_date` by one eligible-delivery-day step (or the operator's `targetDateOverride` if supplied). Emits `subscription.exception.created` + `subscription.end_date.extended` with `triggered_by='append_without_skip'`.

There is no "date that gets skipped." Nothing in the brief or the brief's §3.1.6 worked-examples cross-references the helper's skipDate-eligibility semantics for this surface. The current implementation routes through `computeCompensatingDateForSkip` for code reuse — a reasonable engineering call when written, but one that **subjects the call to skip-flow eligibility checks that the semantic doesn't have**.

### §3.2 Category error

Subjecting `appendWithoutSkip` to skipDate-eligibility gates is a semantic category error:

| Concept | Skip-default | appendWithoutSkip |
|---|---|---|
| Operator intent | "Customer doesn't want delivery on date D" | "Add one more delivery, somewhere appropriate, as goodwill" |
| Input date | D (the date being skipped) | None — or operator-picked target |
| Must D be an eligible delivery weekday? | Yes — you can only skip a date the system would otherwise have delivered on | N/A — there is no D |
| Must D not be in a pause window? | Yes — pause windows already exclude D, you can't redundantly skip it | N/A |
| Must D not be in a blackout? | Yes — blackouts already exclude D | N/A |
| What gets computed | A compensating tail-end date past `endDate` | A new tail-end date past `endDate` |

The right-hand column never has a "skip date" to validate. Passing `today` as a synthetic skipDate so the same helper can be reused gives `today` semantics it doesn't have in this flow. When `today` happens to land on a non-eligible weekday (Sat/Sun for a Mon-Fri subscription), or in a blackout/pause window, the wrapper rejects what was never a skip in the first place.

The fix is to make the skip-vs-no-skip distinction explicit in code shape — not to silently pass synthetic inputs through gates that don't apply.

## §4 Fix approaches

**§3.6 DECISION NEEDED.** Reviewer leans Approach 3.

### §4.1 Approach 1 — inline walk-forward in `appendWithoutSkip`

**Shape:** Replace the `computeCompensatingDateForSkip(tx, subscription, today, today)` call at `service.ts:732` with an inline walk-forward over eligible weekdays, starting from `subscription.endDate + 1`, respecting `daysOfWeek` + active pause windows + 365-day safety cap.

The walk-forward primitive already exists for skip-default (it's the body of `computeCompensatingDate`'s line 244-262 after the skipDate gates). For appendWithoutSkip the same logic runs without the skipDate gates.

**Pros:**
- Single-file change, single function body. Smallest blast radius.
- No new public surface on `skip-algorithm.ts`. No contract change.
- Easy to review; easy to revert.
- The wrong comment at lines 727-731 gets corrected as part of the same diff (see §5).

**Cons:**
- Walk-forward logic duplicated between the pure helper (skip-default) and the service wrapper (appendWithoutSkip). Tight duplication — same loop, same safety cap.
- Doesn't eliminate the bug class — future callers of `computeCompensatingDateForSkip` could still pass synthetic skipDates and inherit the same trap. The wrong comment goes away, but the API shape that invited the comment stays.
- Approach 1's code does not, on its face, prevent a future engineer from writing the same mistake (e.g. a hypothetical `appendWithoutSkipWithReason` or `extendForGoodwill` helper).

### §4.2 Approach 3 — carve `computeNextEligibleAfterEndDate` helper

**Shape:** Add a public helper to `skip-algorithm.ts`:

```ts
export function computeNextEligibleAfterEndDate(input: {
  readonly subscription: SubscriptionForSkip;
  readonly today: IsoDate;          // for past-cap log, not gate input
  readonly pauseWindows: readonly PauseWindow[];
  readonly blackoutDates?: readonly IsoDate[];
}): { kind: "ok"; newEndDate: IsoDate } | { kind: "rejected"; reason: "no_next_eligible_date_found" };
```

Walks forward from `subscription.endDate + 1` over eligible weekdays + pause + blackout windows, returns the first match. No `skipDate` parameter; no skipDate eligibility gates. Same 365-day safety cap.

Service-side: `appendWithoutSkip` calls this helper directly. `computeCompensatingDateForSkip` (the existing internal wrapper) continues to wrap the existing `computeCompensatingDate` for skip-default. The "synthetic skipDate" trap structurally disappears for the new helper because there is no skipDate parameter to pass.

**Pros:**
- Eliminates the bug class, not just the instance. Future callers wanting "tail-end extension without skip semantics" land naturally on the no-skipDate helper.
- The wrong comment at lines 727-731 disappears structurally — there is no synthetic skipDate to mis-describe.
- Skip-vs-no-skip distinction becomes a structural code-shape difference, not a comment claim.
- Slightly DRYer than Approach 1 long-term: the new helper can be called by future surfaces (a hypothetical "extend by N days" admin tool, the bounded-pause auto-resume recompute path if it changes shape, etc.).

**Cons:**
- Larger blast radius. Adds a new public surface on `skip-algorithm.ts` (existing public: 4 functions; adds a 5th).
- Two helpers in the same file with overlapping but distinct semantics — needs clear JSDoc differentiation. Risk: future engineers pick the wrong one. Mitigation: explicit JSDoc + the failing test pinned to Approach 3's helper.
- Touches a pure module that is itself well-trodden (Block 4-B / 4-C). Even adding-only changes warrant §3.6 attention on a pure-helper module.

### §4.3 Approach 2 — `validateSkipDate: boolean` flag — REJECTED

Reviewer rejected up-front. Documented here for the §3.6 record.

**Rationale for rejection:** A behavior-toggling boolean hides the semantic distinction (skip vs no-skip) behind a flag. Call sites become `computeCompensatingDateForSkip(tx, subscription, today, today, { validateSkipDate: false })` — the negation of a default reads as a workaround rather than a deliberate semantic choice. The flag is the smell, not the fix. Future engineers adding new call sites would have to read JSDoc and remember to pass the flag; the next bug of this shape is one forgotten `false` away.

### §4.4 Reviewer recommendation

**Approach 3.** Two reasons:

1. **Fix the class, not the instance.** The wrong comment is a symptom; the API shape that invited the comment is the underlying issue. Approach 3 removes the shape; Approach 1 only removes today's misuse of it.
2. **Demo unexposed under both lenses.** The smaller-blast-radius argument for Approach 1 carries less weight when the demo is provably out of scope under §1.2(3)(a) AND §1.2(3)(b). Approach 3's marginal extra blast radius is bounded to a single pure-helper file and a small public-surface addition; the long-term structural payoff is larger.

Plan surfaces both. §3.6 rules.

## §5 The wrong comment at service.ts:727-731

Current text:

```ts
// Walk forward via the wrapper, with `skipDate = today` standing
// in as a no-op skip-date input (the algorithm only uses
// skipDate for the past-date guard, which `today` passes
// trivially). The actual outcome is governed by endDate +
// daysOfWeek + pauseWindows.
```

Falsified by direct inspection of the pure helper at `skip-algorithm.ts:222-233` (three skipDate gates, not one).

**Disposition under each approach:**

- **Under Approach 1:** Comment is corrected as part of the same diff. New text describes the inline walk-forward and explicitly explains why no skipDate-eligibility checks apply (no skip date exists in this flow). The comment becomes load-bearing for the next reader to understand WHY the walk-forward isn't going through the pure helper.
- **Under Approach 3:** Comment disappears structurally. The new code reads `await computeNextEligibleAfterEndDate(...)` — no synthetic input to mis-describe, no comment needed beyond a one-liner pointing at the brief §3.1.4 semantic.

Either way, the wrong comment does not survive the fix.

## §6 Blast-radius check — call-site enumeration

Phase 1 said 2 call sites. Re-verified exhaustively.

### §6.1 Definition

`async function computeCompensatingDateForSkip` at [src/modules/subscription-exceptions/service.ts:271](../../src/modules/subscription-exceptions/service.ts#L271). NOT exported — internal helper to `service.ts` only. Confirmed via `grep` in `--include="*.ts" --include="*.tsx"` over the whole tree.

### §6.2 Call sites

| # | File | Line | Caller | Skip-date arg | Safe? |
|---|---|---|---|---|---|
| 1 | `src/modules/subscription-exceptions/service.ts` | 506 | `addSubscriptionException` skip-default branch (`input.type === "skip"` AND not `skipWithoutAppend` AND no `targetDateOverride`) | `skipDate` — the operator's `input.date` after `assertIsoDate` validation | ✅ SAFE — see §6.3 |
| 2 | `src/modules/subscription-exceptions/service.ts` | 732 | `appendWithoutSkip` (no `targetDateOverride`) | `today` — synthetic, NOT a real skip date | ❌ THE BUG |

No call sites outside `service.ts`. The helper is module-private. Exhaustive sweep complete.

### §6.3 Why the skip-default call site (line 506) is safe

`addSubscriptionException` validates the operator-supplied date through several gates BEFORE it reaches `computeCompensatingDateForSkip`:

1. **Schema validation** at `service.ts:376` — `assertIsoDate(input.date, "date")` rejects malformed dates.
2. **Cut-off check** at `service.ts:396` — `isCutOffElapsedForDate(now, skipDate)` rejects dates past the 18:00 Dubai cut-off.
3. **Days-of-week eligibility check** at `service.ts:457-464` — for `type === "skip"`, the date's ISO weekday must be in `subscription.daysOfWeek` BEFORE the wrapper is called. Throws `ValidationError("date X is not an eligible delivery weekday for this subscription")`.

So by the time the wrapper is called, `skipDate` is provably an eligible weekday. The wrapper's internal weekday-eligibility re-check inside the pure helper is a defence-in-depth no-op for this call site — the upstream service-layer check at line 457 already rejected any non-eligible weekday with a clearer caller-facing error message.

**The fix does not regress the skip-default path** under either Approach 1 or Approach 3 because:
- Approach 1 only touches `appendWithoutSkip`'s call site; `addSubscriptionException`'s call to the wrapper is unchanged.
- Approach 3 adds a new helper; `addSubscriptionException` continues calling `computeCompensatingDateForSkip` which continues wrapping `computeCompensatingDate`. Existing skip-default flow is byte-identical post-fix.

### §6.4 Adjacent surfaces NOT in scope

Verified by inspection of `src/modules/subscription-exceptions/service.ts`:

- `addSubscriptionException` `target_date_override` branch (lines 482-503) — does NOT call the wrapper; uses operator-supplied target date. Has its own eligibility check at lines 485-490. Not affected.
- `addSubscriptionException` `skipWithoutAppend` branch (lines 478-481) — does NOT call the wrapper; no compensating date computed. Not affected.
- `addSubscriptionException` address_override branches — no wrapper call. Not affected.
- `appendWithoutSkip` `targetDateOverride` branch (lines 706-725) — does NOT call the wrapper; uses operator-supplied target. Eligibility check at lines 708-713 + cut-off check at line 720. Not affected.
- `pauseSubscription` / `resumeSubscription` — separate service (`subscriptions/service.ts`), separate helpers (`computePauseExtensionDate`, `walkBackwardEligibleDays`). Not affected.

## §7 Test plan

CRITICAL: the integration spec MUST include a weekend-Dubai-time case that would have caught the bug. The current spec depends on CI wall-clock weekday; the new spec MUST be deterministic regardless of when CI runs.

### §7.1 Time injection — already supported, exercise it

`appendWithoutSkip` already accepts an injectable clock at `service.ts:666`:

```ts
options?: { readonly now?: Date },
```

The function uses `options?.now ?? new Date()` at line 681, then computes `today = computeTodayInDubai(now)` at line 682. **No new injectability needed** — the time-injection surface exists; the failing test simply doesn't use it.

The fix MUST update the integration test to pass `options: { now: <Saturday-Dubai-instant> }` for the new weekend test case. Mechanism: a `Date` constructed at e.g. `2026-05-23T08:00:00Z` (Saturday May 23, 08:00 UTC = 12:00 Dubai Saturday). The test fixture is then deterministic — passes on any CI run regardless of wall-clock weekday.

### §7.2 Required test cases — integration

In `tests/integration/subscription-exceptions/service.spec.ts`:

1. **(Existing, retained)** `appendWithoutSkip happy path: exception inserted + end_date extended + audit pair` — keep as-is, no `options.now` (covers the default wall-clock path; passes on weekday-Dubai runs).
2. **(NEW, required)** `appendWithoutSkip happy path under Saturday-Dubai clock` — pass `options.now = new Date("2026-05-23T08:00:00Z")` (Sat-Dubai). Mon-Fri subscription. Expect `result.status === "inserted"` + `result.newEndDate` truthy + same audit pair. This is the test that WOULD have caught the bug.
3. **(NEW, required)** `appendWithoutSkip happy path under Sunday-Dubai clock` — pass `options.now = new Date("2026-05-24T08:00:00Z")` (Sun-Dubai). Same expectations. Two weekend days because Sat vs Sun is two independent gate evaluations; one passing doesn't prove the other passes.
4. **(NEW, optional)** `appendWithoutSkip rejects when subscription has no eligible weekday in next 365 days` — defensive coverage for the 365-day safety cap. Construct a subscription with `daysOfWeek = []` (or a never-satisfiable set) and assert `ConflictError("no_next_eligible_date_found")` (or whatever Approach 3's helper returns; Approach 1 maps to the existing `no_compensating_date_found` mapping). Confirms the safety cap mechanism survives the refactor.

### §7.3 Required test cases — unit

Depends on approach:

- **Approach 1:** No new unit tests needed (the inline walk-forward is exercised by the integration tests above). If desired, a unit test that pins the walk-forward logic against a hand-computed example would be belt-and-braces.
- **Approach 3:** Unit tests in `src/modules/subscription-exceptions/tests/skip-algorithm.spec.ts` for the new `computeNextEligibleAfterEndDate` helper. Required coverage:
  - Happy path: subscription with Mon-Fri days, end_date on a Friday → returns Monday.
  - End_date on a Wednesday → returns Thursday.
  - Subscription with `daysOfWeek = [3,5]` (Wed + Fri only), end_date on a Friday → returns next Wednesday.
  - Pause window covering the natural next-eligible day → returns the next-next eligible day.
  - 365-day safety cap reached → returns `{ kind: "rejected", reason: "no_next_eligible_date_found" }`.
  - Boundary: `daysOfWeek = []` (degenerate) — returns rejected.

### §7.4 Test posture

- Integration job MUST pass on the new PR. The failing test is exactly this lane's subject; the fix-PR's pass-state confirms the fix.
- All other integration tests remain green (skip-default flow unaffected per §6.3).
- Unit tests green.
- `tsc --noEmit` green.
- `eslint` green.

## §8 Sequencing

### §8.1 Plan-PR (THIS PR) — docs-only

- Branch: `plan/day-28-appendwithoutskip-weekend-fix` (or similar) off `main`.
- Single commit: this plan doc + nothing else.
- Opens as T3 plan-PR.
- §3.6 decision needed on Approach 1 vs Approach 3.
- CI status note: the integration job will fail on the SAME pre-existing-this-lane bug. NOT a new regression. Reviewer is aware (per the lane brief).

### §8.2 Code-PR (Phase 2, post-§3.6-approval) — single T3 PR

- Surface and request a worktree per `memory/feedback_parallel_sessions_use_git_worktree.md` BEFORE any branch creation.
- Commit structure per Day-23 §F (integration-spec-at-PR-open):
  - Commit 1: new + updated integration spec(s) per §7.2. With this commit alone, CI's integration job goes red on the new weekend tests (the existing wall-clock test may stay red or recover depending on the day-of-week the CI runs). This pins the fix's verification target.
  - Commit 2: the actual fix per the §3.6-approved approach (1 or 3), plus the wrong-comment correction (§5). With this commit, CI's integration job goes fully green.
  - Commit 3 (Approach 3 only): new unit tests for the new helper per §7.3.
- PR opens against `main` post-§3.6 resolution.
- Aqib SF API-key auth-header followup remains the load-bearing pointer (separate lane). This lane's PR is parallel to that.

### §8.3 Followup-memo rotation

Same PR as §8.2 commit 2 (or a follow-up T1 docs-only commit if cleaner):

- `memory/followup_subscription_exceptions_calendar_flake.md` — append a SUPERSEDED banner pointing at this plan doc + the eventual code-PR. Original memo content retained as historical record per §B amendment-log conventions.
- `memory/MEMORY.md` index entry for that memo — strikethrough + supersede-pointer (matches the Day-26 → Day-27 absent-identity-schema supersede pattern).

## §9 Open questions surfaced (not folded)

### §9.1 Synthetic-skipDate trap — is Approach 3 sufficient?

Approach 3 eliminates the trap at the `appendWithoutSkip` call site by removing the skipDate parameter from the new helper. **But the existing `computeCompensatingDate` and `computeCompensatingDateForSkip` retain the original API shape.** A future engineer wanting "extend by N days for some non-skip reason" who reaches for `computeCompensatingDate` would be subject to the same trap as Day-16-era appendWithoutSkip.

**Question for §3.6:** Does the codebase need a sweep for future synthetic-skipDate callers, or is Approach 3's clear-naming "computeNextEligibleAfterEndDate" + a sentence in the existing `computeCompensatingDate` JSDoc ("skipDate is a real operator-supplied skip date; for tail-end extension without skip semantics, use computeNextEligibleAfterEndDate") sufficient guardrail?

Surface, do not fold. Reviewer rules.

### §9.2 The Day-21 PR #227 `--admin` override precedent

PR #227 was admin-merged via `--admin` override on the (now-falsified) belief that this bug had "production-zero impact." That precedent should not be re-cited for future overrides. The supersede-banner work in §8.3 addresses the memo level; should an explicit note land somewhere durable (handoff, brief amendment, dedicated discipline memo) to prevent the precedent's re-use?

Surface, do not fold. Reviewer rules.

### §9.3 Wall-clock-determinism in other integration specs

Are there other integration specs in `tests/integration/` that depend implicitly on CI wall-clock weekday/date the same way the failing spec did? A grep for `new Date()` (without `options.now` injection) in integration specs might surface adjacent flake-shaped time-bombs. This is a "discipline sweep" item, not in this lane's scope.

Surface, do not fold. Reviewer rules whether to spin up an adjacent sweep lane.

---

**End of plan. Awaiting §3.6 decision on Approach 1 vs Approach 3 before any Phase 2 code work.**

---
name: Session A Day-22 PM bootstrap brief
description: Mid-PR-#238 pre-compact bootstrap — continue forms lane post-compact starting from the wizard 500 fix. Authoritative §4 rulings replace any need to re-prompt the reviewer for direction; post-compact session executes autonomously through commit + push, then stops.
type: project
---

# Session A Day-22 PM bootstrap brief

**For:** post-compact Session A successor mid-PR-#238 (Day-22 PM)
**Filed:** Day 22 (11 May 2026), PM, pre-compact at ~23% remaining context
**Filed by:** outgoing Session A
**Lane:** Phase 1 merchant-CRUD frontend forms — wizard 500 fix is the remaining load-bearing task before PR #238 is merge-ready

---

## §1 Spawn purpose

Continue PR #238 mid-Day-22 PM after context exhaustion. **Wizard 500 fix is the load-bearing remaining task** — Love walked the preview, the wizard submit failed with a Vercel generic 500 page (digest `3721576451`), root cause diagnosed (Drizzle SQL array-binding bug in `insertSubscription`), reviewer ruled the fix approach + bundled error-handling upgrade. Execution is paused at the boundary between diagnostic-complete and fix-applied so a fresh context window can complete it cleanly.

The post-compact session is NOT a fresh kickoff. It picks up an authorised in-flight task with an authoritative rulings package in §4 below — do not relitigate, do not re-prompt the reviewer for direction. Execute autonomously through commit + push, then stop and await reviewer continuation per §6 follow-up.

---

## §2 Repo state at handoff

- **Branch:** `day22/phase-1-forms-consignee-subscription`
- **HEAD:** `a1440ba` (9 commits ahead of `origin/main` `ad510c5`)
- **Worktree:** `/Users/lovemans/work/planner-d22-forms` — fast-forwarded + node_modules symlinked already (no re-setup needed)
- **PR #238 status:** open, branch pushed, 8 commits visible to GitHub (`d10daf8` through `2c02f8b`) plus the SF customer code commit `a1440ba` landed this afternoon. Vercel preview rebuilds on push; the alias `planner-git-day22-phase-1-forms-co-0f6724-lovemansgits-projects.vercel.app` resolves to whatever the latest successful build is.

### PR #238 commit ledger (newest first)

| # | SHA | Tier | Description |
|---|---|---|---|
| 9 | `a1440ba` | T2 | `feat(d22-forms-crud): add SuiteFleet customer code to merchant onboarding form (PR #238 §5.3 Gate 2 closure)` — closes Brief §5.3 Gate 2 demo storyline gap; required field on `/admin/merchants/new`, end-to-end wiring through helpers + service + repository + API route + audit metadata. +6 tests. |
| 8 | `2c02f8b` | T2 | `feat(d22-forms-crud): district label rename + list-page search (PR #238 §3.22 ratification)` — P1+P2+P3 in one commit: "District / Area" label, `/consignees` name+phone search, `/tasks` AWB search. +20 tests. |
| 7 | `9c51746` | T2 | `fixup(d22-forms-crud): WeekdaySelector interaction + form-error visibility (PR #238 §3.22 ratification)` — B1 fix via `has-[:checked]:` Tailwind modifier (CSS-driven selected state, no React-state-frozen className) + top-banner form-error visibility when any field-level validation lands. +7 JSX-shape tests. |
| 6 | `1a4b606` | T2 | `fixup(d22-forms-crud): wire navigation CTAs for new routes (PR #238 §3.22 ratification)` — 4 CTAs across `/consignees` + `/consignees/[id]` + `/subscriptions` for the new routes. Boundary discipline preserved on `[id]/page.tsx`. |
| 5 | `5a76186` | T1 | `docs(d22-brief-v1-11): formalise edit-consignee address exclusion (PR #238 §3.6 ratification)` — new §3.1 in decision memo + appended clarification in PLANNER_PRODUCT_BRIEF.md §9 v1.11 entry. No version bump. |
| 4 | `50f6d8e` | T1 | `fixup(d22-forms-crud): §J-4 H1 shift on /subscriptions/new (PR #238 §3.6 ratification)` — lifted page header into `SubscriptionWithModeForm` so eyebrow + H1 + subtitle shift with mode (Subscriptions → Tasks / New subscription → New ad-hoc task). |
| 3 | `96f35d8` | T1 | `fixup(d22-brief-v1-11): bump Version field v1.10 → v1.11 (T1)` — caught during §3.6 review. |
| 2 | `04e6758` | T1 | `docs(d22-brief-v1-11): single-address MVP amendment ride-along (T1)` — decision memo + brief §3.3.1 rewrite + §1 line 62 tightening + §9 version log + Phase-2 followup. |
| 1 | `d10daf8` | T3 | `feat(d22-forms-crud): Phase 1 consignee + subscription forms (T3)` — net-new addresses module + `createConsigneeWithSubscription` orchestration + 4 routes (`/consignees/new` wizard + `/consignees/[id]/edit` + `/subscriptions/new` + `/subscriptions/[id]/edit`) + initial test coverage. |

### PR #237 parallel status

Session B's PR-B popover-actions lane. Approved for merge per Love's walk (no outstanding blockers); awaiting batched merge with PR #238 once the wizard 500 fix lands here. **Do not touch Session B's branch or worktree** (`day22/calendar-pr-b-popover-actions` at `/Users/lovemans/Code/planner-d22b-prb`).

---

## §3 Critical blocker still open: wizard 500

### Symptoms

- Operator submits `/consignees/new` wizard (or `/subscriptions/new` subscription mode) with valid input
- Vercel generic error page renders: "This page couldn't load. A server error occurred. ERROR 3721576451"
- No inline form-banner; no `actionResult.kind = "validation"`; raw HTTP 500

### Exact error (from Vercel logs)

```
POST /subscriptions/new   ERROR
Error: Failed query:
    INSERT INTO subscriptions (
      tenant_id, consignee_id, status, start_date, end_date,
      days_of_week,
      delivery_window_start, delivery_window_end,
      delivery_address_override, meal_plan_name, external_ref, notes_internal
    ) VALUES (
      $1, $2, $3, $4, $5,
      ($6, $7, $8, $9, $10),       ← BUG: tuple, not array
      $11, $12, $13, $14, $15, $16
    )
    RETURNING *

[cause]: column "days_of_week" is of type integer[] but expression is of type record
  severity: 'ERROR'
  code: '42804'  (Postgres datatype_mismatch)
  hint: 'You will need to rewrite or cast the expression.'

digest: '3721576451'   ← matches Love's reported error code
```

### Bug location

`src/modules/subscriptions/repository.ts` `insertSubscription` fn, line ~175 area:

```ts
const rows = await tx.execute<SubscriptionRow>(sqlTag`
  INSERT INTO subscriptions (
    ...,
    days_of_week,
    ...
  ) VALUES (
    ...,
    ${input.daysOfWeek as number[]},   ← this binding gets SPREAD, not array-bound
    ...
  )
  RETURNING *
`);
```

### Mechanism

Drizzle's `sql` template tag (which delegates to postgres-js) **spreads JavaScript arrays as comma-separated parameter lists by default** — correct for `IN (...)` clauses, wrong for binding a Postgres `integer[]` column value. The 5 weekday integers `[1,2,3,4,5]` become 5 separate placeholders `$6,$7,$8,$9,$10`; Postgres parses the parenthesised list as a record/tuple literal — incompatible with the `integer[]` column type. The 16-vs-12 params mismatch in the failing query is the visible signature.

### Affected surfaces

| Form | Call path | Affected? |
|---|---|---|
| `/subscriptions/new` subscription mode | `_actions.ts` `handleSubscriptionMode` → `createSubscription` → `insertSubscription` | **YES** (log-confirmed) |
| `/consignees/new` wizard | `_actions.ts` `onboardConsigneeAction` → `createConsigneeWithSubscription` → `insertSubscription` (inside orchestration `withTenant` tx) | **YES** (same code path; not in visible 100-log window but identical mechanism) |
| `/subscriptions/new` single-task mode | `_actions.ts` `handleSingleTaskMode` → `createTask` (loops; not subscriptions) | NO — unrelated path |

### Why latent / why tests missed it

Every existing test of `createSubscription` / `insertSubscription` (including `consignees/tests/onboarding.spec.ts:175-212` added in PR #238) **mocks the repository layer entirely** — no test exercises the actual Drizzle SQL generation against a real Postgres. The bug has likely been there since S-3 / Day 6 but never triggered because:

- Production-app code never created subscriptions from a user flow before Day 22 (no UI / API route did this — verified by `grep -r "createSubscription\|insertSubscription"`)
- Seed scripts use raw `psql` patterns instead of going through `insertSubscription`
- The cron task-generation path READS subscriptions but doesn't CREATE them

The Day-22 forms lane is the FIRST production-app user flow that exercises `insertSubscription` against real Postgres. The bug surfaces immediately on first operator submit.

---

## §4 Reviewer rulings on the fix (AUTHORITATIVE — do not relitigate)

### FIX 1 — APPLY APPROACH (b): parameterised ARRAY cast

Replace `${input.daysOfWeek as number[]}` with an array-constructor + explicit Postgres array cast.

**Reference syntax:**
```ts
sqlTag`
  ... ARRAY[${input.daysOfWeek}]::integer[] ...
`
```

**Goal:** the rendered SQL emits **a single `$N::integer[]` parameter**, not N spread params. With Drizzle's spread behaviour for arrays, `ARRAY[${arr}]` becomes `ARRAY[$1, $2, $3, $4, $5]` which Postgres correctly parses as an array literal, then `::integer[]` is the explicit type assertion that the column expects. Total parameter count stays at 12 (one per column), not 16.

**Verify in test:** add a unit test in `src/modules/subscriptions/tests/repository.spec.ts` that captures the generated SQL + params, asserts:
- Total param count = 12 (not 16)
- The `days_of_week` column receives an array via the `ARRAY[...]::integer[]` wrapper visible in the rendered SQL string
- Boundary cases: 1-element array (`[3]`), all 7 days, common subsets (Mon-Fri)

### FIX 2 — BUNDLE: typed `internal_error` path in form actions

The current `throw err` for non-AppError catches surfaces the Vercel generic 500 page to operators — terrible demo UX. Replace with a typed result kind so operators see an inline banner instead.

**Files to update:**

1. `src/app/(app)/consignees/new/_actions.ts` `onboardConsigneeAction`:
   - Replace the trailing `throw err` with:
     ```ts
     console.error("[onboardConsigneeAction] unknown error:", err);
     return {
       kind: "internal_error",
       message: "Something went wrong creating the consignee. Please try again or contact ops if this persists.",
     };
     ```
   - Extend `OnboardConsigneeActionResult` discriminated union with the new variant
   - Update `OnboardConsigneeWizard` `formError` derivation to surface `internal_error.message`

2. `src/app/(app)/subscriptions/new/_actions.ts` `createSubscriptionFormAction`:
   - Same treatment in both `mapServiceError` and `handleSingleTaskMode`'s outer catch
   - Extend `CreateSubscriptionFormResult` union
   - Update `SubscriptionWithModeForm` `formError` derivation

**Discipline:** `console.error` the underlying `err` so Vercel function logs still capture the diagnostic for ops debugging. The operator-facing message is generic; the log is detailed.

### FIX 3 — DEFER. File memo only

Class of bug: latent SQL-binding errors invisible to mocked unit tests. Recommended fix: integration-tier test suite against ephemeral Postgres. Not in scope for this commit.

**File:** `memory/followup_integration_tests_real_postgres.md`

**Contents:**
- Class: SQL-binding bugs (array vs spread, jsonb shape, type cast drift, RLS WITH CHECK misses)
- Why current tests miss: repository-layer mocks short-circuit the Drizzle → postgres-js → Postgres chain
- Existing infra: `tests/integration/setup/auth-stub.sql` + `scripts/setup-test-db.sh` (Day-15 baseline)
- Trigger conditions for unblock: (a) another repo-layer bug surfaces post-pilot OR (b) Day-23+ buffer permits proactive coverage
- Scope estimate: ~6-8 hr (extract `tests/integration/repo/` tier, write 1-2 anchor specs per repository module, wire into CI conditionally so the unit-tier stays fast)

---

## §5 Execution discipline

**Single commit message:**
```
fix(d22-forms-crud): subscriptions days_of_week SQL binding + typed internal_error path (PR #238 §3.22 ratification)
```

**Files touched (expected):**
- `src/modules/subscriptions/repository.ts` (FIX 1 — array binding)
- `src/modules/subscriptions/tests/repository.spec.ts` (FIX 1 — anchor test)
- `src/app/(app)/consignees/new/_actions.ts` (FIX 2 — internal_error path)
- `src/app/(app)/consignees/new/_components/OnboardConsigneeWizard.tsx` (FIX 2 — render variant)
- `src/app/(app)/subscriptions/new/_actions.ts` (FIX 2 — internal_error path)
- `src/app/(app)/subscriptions/new/_components/SubscriptionWithModeForm.tsx` (FIX 2 — render variant)
- `memory/followup_integration_tests_real_postgres.md` (FIX 3 — memo only)

**Verification gate (re-run after edits):**
- `npx tsc --noEmit -p tsconfig.json` — clean
- `npm run lint` — baseline preserved (7 warnings, 0 errors)
- `npm test` — `1498+/1498+` pass (baseline at post-`a1440ba` is 1498; expect ≥1499 with the new repository-layer anchor test)

**Push:**
```bash
git push origin day22/phase-1-forms-consignee-subscription
```

**Report SHA + standing-by line** to reviewer.

---

## §6 Known follow-up (DO NOT action; reviewer will decide)

**Ad-hoc task CTA on `/consignees/[id]`** — Love flagged during the walkthrough that there's no shortcut from a consignee's detail page to create an ad-hoc task scoped to that consignee. Current state: `/subscriptions/new?consigneeId=[id]` pre-fills the picker but defaults to subscription mode; operator has to toggle to single-task. Possible fix: dedicated "Add ad-hoc task" CTA on the detail page that lands on `/subscriptions/new?consigneeId=[id]&mode=single-task` (mode query param to pre-toggle).

**After wizard 500 fix lands**, surface to reviewer with:
> Wizard 500 fixed at `<sha>`. Awaiting ruling on ad-hoc task CTA from consignee detail page (Love flagged during PM walkthrough).

DO NOT pre-emptively wire it in this commit. Scope-bleed risk; reviewer hasn't ruled on it yet.

---

## §7 Discipline rules in force (Day-22 PM)

- T3 hard-stop holds for visual surfaces (UX walks via Vercel preview)
- Brand-canon: sentence case in copy, hairline borders (border-stone-200 / 0.5px Stone 200), no shadows, 120ms ease-out transitions, `--color-tint-navy-subtle` for atmosphere primitives only
- Permission gates HIDE not disable-grey (brief §3.3.10 rule 1)
- §3.21 helper-consumer body-read on changes — verify each modified file's consumers still type-check + don't drift
- Brief v1.11 locked; no version bump without explicit reviewer approval
- All Claude Code prompt code in fenced code blocks (this brief itself; consumer docs continue the convention)
- Worktree isolation per `memory/feedback_parallel_sessions_use_git_worktree.md` — Session A continues on `/Users/lovemans/work/planner-d22-forms`; Session B's branch + worktrees off-limits
- `feedback_force_push_requires_pre_authorization.md`: destructive git operations need explicit auth — the wizard 500 fix involves no force-push, no rebase; plain commit + push is the path

---

## §8 Post-compact acknowledge protocol

When the fresh post-compact Session A spawns, before any code touch:

1. **Confirm fresh capacity** — the spawn is post-`/compact`, conversation history compacted, context window reset.
2. **Confirm HEAD:**
   ```bash
   cd /Users/lovemans/work/planner-d22-forms && git log -1 --format="%H %s"
   ```
   Expected (minimum): `a1440ba feat(d22-forms-crud): add SuiteFleet customer code to merchant onboarding form (PR #238 §5.3 Gate 2 closure)`. May be ahead if another lane landed in the interim.
3. **Confirm worktree clean:**
   ```bash
   cd /Users/lovemans/work/planner-d22-forms && git status
   ```
   Expected: `nothing to commit, working tree clean` (modulo any untracked artifacts unrelated to this lane).
4. **State next action verbatim:** *"Beginning wizard 500 fix per §4 + §5"*
5. **Execute autonomously.** Do NOT wait for reviewer input — §4 rulings are authoritative. Apply FIX 1 + FIX 2 + FIX 3 (memo) per §5's file list, run the verification gate, commit with the §5 message, push, report SHA.
6. **After push, surface §6 follow-up flag** — single line: *"Wizard 500 fixed at \<sha\>. Awaiting ruling on ad-hoc task CTA from consignee detail page (Love flagged during PM walkthrough)."* — and stop.

If §4 rulings appear ambiguous post-compact, prefer the most conservative interpretation that lands the fix without scope expansion. Surface ambiguity to the reviewer only AFTER attempting the change — pre-execution clarification questions waste a fresh-context cycle.

---

**End of bootstrap brief. Filed Day-22 PM pre-compact. Carry-forward integrity preserved into the post-compact Session A continuation.**

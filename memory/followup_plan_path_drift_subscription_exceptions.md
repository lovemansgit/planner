---
name: Plan PR #155 path drift — subscription-exceptions sibling module + Service B existing-implementation
description: Day-16 Block 4-B Service A staging surfaced three load-bearing drifts between merged plan PR #155 §3-§4 and the actual codebase. (1) §3.1 + §3.4 + §3.5 + §4.1 + §9 test paths specify nested paths under src/modules/subscriptions/ but PR #139 established sibling path src/modules/subscription-exceptions/. (2) §3.4 specifies computeCompensatingDate as a DB-reading function but the existing skip-algorithm.ts is intentionally pure; service layer is supposed to wrap, not duplicate. (3) §4 plans pauseSubscription/resumeSubscription as greenfield but they already exist in src/modules/subscriptions/service.ts (lines 27-28). Resolution: (B) sibling-module-wins per "already-shipped wins" precedent (v1.2 §0.3 Option A). Plan-text amendment scoped for next plan-sync bundle.
type: project
---

# Plan PR #155 path drift — subscription-exceptions

**Surfaced:** Day-16 Block 4-B Service A staging.

**Drifts:**

## §1 Module path drift (Conflict 1)

Merged plan PR #155 references — exhaustive list per Block 4-B grep:

```
$ grep -n "subscriptions/exceptions\|src/modules/subscriptions/exceptions\|exceptions/service\.ts\|exceptions/repository\.ts" \
       memory/plans/day-14-part2-service-layer.md

211:**Module:** `src/modules/subscriptions/exceptions/service.ts` (NEW). Exports through `src/modules/subscriptions/index.ts`.
283:Lives at `src/modules/subscriptions/exceptions/compensating-date.ts`. Takes `(tx, subscriptionId)` and returns `Promise<string>` (ISO date) OR throws `NoCompensatingDateFound`.
304:**Module:** same as §3.1 (`src/modules/subscriptions/exceptions/service.ts`).
767:Module-level tests at `src/modules/{subscriptions/exceptions,subscriptions/lifecycle,consignees/crm,merchants,subscriptions/addresses}/tests/service.spec.ts`. Each service gets:
```

Plus one Service-B-adjacent reference surfaced via the §4 grep (line 358):

```
358:**Module:** `src/modules/subscriptions/lifecycle/service.ts` (NEW; sibling to exceptions/).
```

Resolution: extend `src/modules/subscription-exceptions/` (sibling, established Day-13 PR #139). The existing [skip-algorithm.ts:53-61](../src/modules/subscription-exceptions/skip-algorithm.ts#L53-L61) header literally predicts:

> *"Plan §1 introduces a sibling module subscription-exceptions/ for the exception surface; part-2 service code lands the addSubscriptionException, pauseSubscription, resumeSubscription, appendWithoutSkip surface here."*

**Plan-text amendments (next plan-sync bundle):**

- §3.1 line 211: `src/modules/subscriptions/exceptions/service.ts` → `src/modules/subscription-exceptions/service.ts` (NEW alongside existing skip-algorithm.ts). Exports through `src/modules/subscription-exceptions/index.ts` (NEW; barrel export).
- §3.4 line 283: `src/modules/subscriptions/exceptions/compensating-date.ts` → no new file; service-layer wrapper around the existing pure helper at `src/modules/subscription-exceptions/skip-algorithm.ts` (see Conflict 2 below).
- §3.5 line 304: `src/modules/subscriptions/exceptions/service.ts` → `src/modules/subscription-exceptions/service.ts`.
- §9 line 767 test paths: `subscriptions/exceptions/tests/service.spec.ts` → `subscription-exceptions/tests/service.spec.ts`. The `subscriptions/lifecycle`, `consignees/crm`, `merchants`, `subscriptions/addresses` paths in the same line need a Block-4-C/D/E audit before final amendment text — Service B's `subscriptions/lifecycle/` path conflicts with the existing `src/modules/subscriptions/service.ts` at line 358 (Conflict 3).

## §2 computeCompensatingDate signature drift (Conflict 2)

Merged plan §3.4 (lines 285-298) specifies async DB-reading signature:

```typescript
export async function computeCompensatingDate(
  tx: DbTx,
  subscriptionId: Uuid,
): Promise<string>;  // reads DB; throws NoCompensatingDateFound
```

Existing [skip-algorithm.ts:1-19](../src/modules/subscription-exceptions/skip-algorithm.ts#L1-L19) declares:

> *"Pure: no DB calls, no I/O, no async. Inputs in / result out. The service layer (part 2) wraps the helper in a transaction that reads current subscription state, calls computeCompensatingDate, applies the result..."*

**Resolution: wrapper pattern.** Service-layer wrapper fetches subscription state + active pause windows + calls the existing pure helper + applies result in transaction. No algorithm duplication.

**Plan-text amendment (next plan-sync bundle):**

- §3.4 amends to: *"Service-layer function inside `src/modules/subscription-exceptions/service.ts` wraps the existing pure `src/modules/subscription-exceptions/skip-algorithm.ts:computeCompensatingDate(subscription, skipDate, pauseWindows)` helper in a DB-reading transaction. Service fetches subscription row + active pause-window exception rows, calls the pure helper with the pre-fetched state, applies the returned date to subscription_exceptions + subscriptions.end_date in the same transaction. The pure helper handles the algorithm (per brief §3.1.6 worked examples + edge cases A-I); the wrapper handles I/O. No algorithm duplication."*

## §3 Service B existing-implementation drift (Conflict 3) — DEFERRED to Block 4-C

Merged plan §4 plans `pauseSubscription` / `resumeSubscription` as if greenfield. Grep across the plan surfaces extensive references that assume part-2 ownership:

- §0 lines 18-19: A and B framing — Service B is "pauseSubscription bounded + resumeSubscription manual + auto-resume scheduler"
- §0.3 line 41: "pauseSubscription flips subscriptions.status to 'paused'"
- §1 lines 101-103: permission table — annotated "Pre-existing permission; reused" (the plan author noticed the *permissions* exist but didn't audit whether the *services* exist)
- §3.6 line 343: type vs. permission cross-check references pauseSubscription as the pause_window service
- §4.1 line 358: `src/modules/subscriptions/lifecycle/service.ts` (NEW; sibling to exceptions/)
- §4.5 lines 469-472: cross-method invariants describe pause/resume/skip interactions
- §6.1 lines 626-627: API routes call pauseSubscription/resumeSubscription
- §7.2 line 713: cut-off check fires in `pauseSubscription` step 4 — implies a numbered behavior the plan owns
- §7.3 lines 720-722: pause_start cut-off semantics
- §8.1 lines 745-747: webhook deduplication touch-points

But [src/modules/subscriptions/service.ts:27-28](../src/modules/subscriptions/service.ts#L27-L28) already documents existing implementations:

```
//   subscription:pause   → subscription.paused
//   subscription:resume  → subscription.resumed
//   subscription:end     → subscription.ended
```

868-line module shipped before today.

**Block 4-C (Service B) opens with grep of `src/modules/subscriptions/service.ts` to determine:**

- If existing implements brief §3.1.7 (bounded pause + auto-resume) correctly → Service B is auto-resume scheduler only (Option A locked at §10.3)
- If existing implements partially → Service B is delta against existing (e.g., extend pause to accept `pause_end` for bounded pause; existing may only support open-ended pause)
- Either way, plan §4 needs amendment

**Plan-text amendment (next plan-sync bundle, finalized at Block 4-C completion):**

- §4.1 amends to: framing as "extend existing pauseSubscription per brief §3.1.7" or "rewrite existing pauseSubscription per brief §3.1.7" depending on Block 4-C grep finding.
- §4.2 amends similarly for resumeSubscription.
- §4.1 line 358 path correction: `src/modules/subscriptions/lifecycle/service.ts` → `src/modules/subscriptions/service.ts` (existing module; Service B extends/rewrites in place rather than introducing a new lifecycle/ subdir).

## §4 System actor type-catalogue drift (Conflict 4)

Merged plan PR #155 §1 line 103 references `'auto-resume-scheduler'` as the system actor for the `/api/cron/auto-resume` handler. The string literal was used in the plan but never traced to the type catalogue at [`src/shared/tenant-context.ts:25-48`](../src/shared/tenant-context.ts#L25-L48) (the `SystemActor` frozen literal union) or to the permission-registration convention.

The existing union has 8 entries (`cron:generate_tasks`, `cron:reconciliation`, `cron:end_expired`, `cron:scan_webhook_dlq`, `cron:webhook_worker`, `webhook:suitefleet`, `system:dlq_retry`, `queue:push_task`). All cron actors use the snake_case `cron:*` convention.

**Resolution:** register `cron:auto_resume` in the `SystemActor` union (matching the convention) + construct the `kind: 'system'` actor inline at the cron-handler entry with a narrow permission set (`'subscription:resume'` only — single-responsibility per the cron's purpose). Plan-text amendment for §1 line 103 in next plan-sync bundle.

**Plan-text amendment (next plan-sync bundle):**

- §1 line 103 amends from *"Auto-resume runs as `system: 'auto-resume-scheduler'` actor; permission check skipped per `assertSystemActor` pattern."* to *"Auto-resume runs as `cron:auto_resume` system actor (registered in `src/shared/tenant-context.ts:SystemActor` union per Day-13 system-actor convention); permission check skipped per `assertSystemActor` pattern."*

## §5 End-date extension arithmetic drift (Conflict 5)

Merged plan §4.1 step 8 specifies the pause-extension arithmetic as:

> *"`extension_days = count of dates D in [pause_start, pause_end] (inclusive) where ISODOW(D) ∈ subscription.days_of_week`. ... UPDATE `subscriptions.end_date = current_end_date + extension_days`."*

**This is wrong.** Adding `extension_days` CALENDAR days to `current_end_date` may land on a non-eligible delivery weekday. Worked example (per Block 4-C ambiguity B3):

- Subscription Mon-Fri, end_date Fri Jan 30
- Pause covers entire week Mon-Fri (5 eligible delivery days)
- Plan's arithmetic: `end_date + 5 calendar days = Wed Feb 4` (NOT a Mon-Fri delivery day)
- Correct math: walk forward 5 eligible weekdays from `current_end_date + 1 = Fri Feb 6`

**Resolution:** new pure helper `computePauseExtensionDate(input): IsoDate` at [`src/modules/subscription-exceptions/skip-algorithm.ts`](../src/modules/subscription-exceptions/skip-algorithm.ts) (sibling to existing pure `computeCompensatingDate`). Service wraps for I/O per Service A's wrapper-around-pure-helper pattern (Conflict 2 resolution).

**Plan-text amendment (next plan-sync bundle):**

- §4.1 step 8 amends to: *"`extension_days = count of dates D in [pause_start, pause_end] (inclusive) where ISODOW(D) ∈ subscription.days_of_week`. Service-layer wrapper around the new pure helper `subscription-exceptions/skip-algorithm.ts:computePauseExtensionDate(subscription, currentEndDate, extensionDays, pauseWindows)` walks forward `extension_days` eligible weekdays from `current_end_date + 1`, skipping any active pause windows that overlap the walk. UPDATE `subscriptions.end_date = result`. Calendar-arithmetic add was incorrect — would land on non-eligible weekdays."*

## §6 Cross-references

- **PR #139** (`875bfc4`) — schema-landing PR; established sibling-module convention (`src/modules/subscription-exceptions/`); canonical for this surface.
- **PR #155** (`0d1ce21`) — plan PR with drifts §1-§3 above.
- **`src/modules/subscription-exceptions/skip-algorithm.ts`** lines 1-19 (pure helper declaration), lines 53-61 (sibling-module rationale + part-2 layout prediction). The Day-13 author left a literal hint that the part-2 author missed.
- **`src/modules/subscriptions/service.ts`** lines 27-28 (existing pause/resume/end services); 868 lines; Day-6 origin (S-4 task).
- **`memory/decision_brief_v1_2_amendments_d13_part1.md`** — v1.2 amendment §0.3 Option A precedent for "already-shipped names win." Same pattern applies here at the module-path layer.
- **Day-16 Block 4-B Service A staging** — discovery surface; this memo captures the findings before Service A code is written so the amendment text can fold into the next plan-sync bundle without re-discovery.

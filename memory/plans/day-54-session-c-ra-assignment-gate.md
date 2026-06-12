# Day-54 Session C plan — R-A: cutoff = creation-only; editability = assignment gate (T3)

**Filed:** Day-54 (12 Jun 2026), Session C, per the post-clearance dispatch step 4.
**Ruling (verbatim, supersedes prior records):** *"R-A: the 18:00 cutoff applies ONLY to order creation — it is the deadline for creating orders. Editability is gated by assignment alone: if a delivery is not assigned, edits and cancellations are allowed; once ASSIGNED, no edits or cancellations. Restores the Day-3 lock-at-assignment ruling; reverts v1.16; §3.1.8 redefined. Brief amendment dispatch-assigned."*
**Contract base:** `memory/triage_five_races_findings.md` §R-A (merged `6c193ca`). All 10 sites re-verified by body-read on current main.
**Fences:** no spend, no migrations, no R-E work here. **Fence interpretation stated for the reviewer:** the dispatch fence "no tasks/** (Session B)" is read as Session B's `/tasks` app pages (`src/app/(app)/tasks/**`) — this same dispatch explicitly commands switching the seven `src/modules/tasks/service.ts` cutoff sites, so the specific command governs the module file; Session B's page components are NOT touched (their lock-reach is enumerated in §4 as a flagged follow-on; the service layer rejects regardless, so B's surface is defense-in-depth polish, not a correctness hole).

## §1 The classification of all 10 cutoff sites (dispatch-required)

| # | Site (current main) | Function | Class | Disposition |
|---|---|---|---|---|
| 1 | `tasks/service.ts:1072` | `updateTask` (current date) | EDIT | time gate → **assignment gate** |
| 2 | `tasks/service.ts:1080` | `updateTask` (new target date) | EDIT | **dropped** (the move-target check is an edit-time check; creation-side validity of the new date is not a cutoff question once creation-only is the rule) |
| 3 | `tasks/service.ts:1310` | `cancelTask` | CANCEL | time gate → **assignment gate** (existing DELIVERED/CANCELED guards stay) |
| 4 | `tasks/service.ts:1464` | `addNoteToDriver` | EDIT (flagged below) | time gate → **assignment gate** |
| 5 | `tasks/service.ts:2270` | `bulkCancelTasks` (per-task) | CANCEL | time gate → **assignment gate** per task |
| 6 | `tasks/service.ts:2398` | `bulkUpdateTasks` (current date) | EDIT | time gate → **assignment gate** |
| 7 | `tasks/service.ts:2408` | `bulkUpdateTasks` (new target date) | EDIT | **dropped** (same reasoning as #2) |
| 8 | `subscription-exceptions/service.ts:417` | `addSubscriptionException` (skip) | **CREATION** (dispatch-named: "skip-creation paths") | **keeps 18:00** — unchanged; PLUS the skip's cancel-leg gains the assignment freeze (§2.3) |
| 9 | `subscription-exceptions/service.ts:1102` | `appendWithoutSkip` | **CREATION** (creates a compensating delivery) | **keeps 18:00** — unchanged |
| 10 | `subscriptions/service.ts:702` | `pauseSubscription` (pause_start) | CANCEL-class trigger (a pause is a bulk cancel of the window) | time gate **dropped**; the window-cancel leg gains the assignment freeze (§2.3) |

The materializer (order creation proper, `task-materialization`) keeps its creation-side cutoff untouched — dispatch-named.

**Flag for the reviewer (site 4):** the ruling's plain text ("once ASSIGNED, no edits") puts `addNoteToDriver` behind the assignment gate, which means notes to the driver become impossible exactly when a driver exists. This plan applies the ruling as written; if the reviewer reads driver-notes as outside "edits and cancellations," the alternative (drop the gate entirely on site 4) is a two-line change and is called out here so the round can rule it without a re-park.

## §2 The gate

**2.1 — Shared helper** in `src/modules/tasks` (exported via the module index, same surface the subscription services already import task helpers from):

```ts
const DRIVER_BOUND: ReadonlySet<TaskInternalStatus> = new Set(["ASSIGNED", "IN_TRANSIT"]);
const TERMINAL: ReadonlySet<TaskInternalStatus> = new Set(["DELIVERED", "CANCELED", "FAILED"]);
export function isTaskEditable(internalStatus: TaskInternalStatus): boolean {
  return !DRIVER_BOUND.has(internalStatus) && !TERMINAL.has(internalStatus);
}
```

Editable statuses are therefore exactly `CREATED`, `ON_HOLD`, `SKIPPED`. **Flag for the reviewer:** the dispatch formula names only `!== 'ASSIGNED'`; this plan extends the lock to `IN_TRANSIT` as the faithful reading of "once ASSIGNED, no edits or cancellations" — a task does not become editable again when the driver picks it up. (`SKIPPED` stays editable per the formula: not driver-bound, not terminal.)

**2.2 — Service rejections:** each EDIT/CANCEL site replaces its `isCutOffElapsedForDate` throw with an `isTaskEditable` check throwing `ValidationError` with a plain message ("task is assigned to a driver and locked" / terminal variant). Existing per-function guards (cancel's DELIVERED reject + CANCELED idempotent fast-path) stay; the helper slots in front without changing them.

**2.3 — The bulk cancel legs (skip + pause)** — both currently cancel everything non-terminal, INCLUDING driver-bound rows:
- `markTasksCanceledInWindow` (`tasks/repository.ts:1581`): exclusion list `NOT IN ('DELIVERED','FAILED','CANCELED')` extends with `'ASSIGNED','IN_TRANSIT'`. A pause over a window containing an assigned delivery now pauses the subscription and cancels the unassigned tasks; the assigned delivery proceeds (the R-E churn cascade is the ONLY path that may recall it, per its own ruling). `pauseSubscription`'s audit metadata gains an additive `assigned_tasks_excluded` count so the operator-facing result is honest about what kept going.
- `markTaskSkipped` (single-skip cancel leg): same two-status extension — and because a skip whose target task is driver-bound would otherwise record a skip exception while the delivery still happens (dishonest state), `addSubscriptionException`'s skip path checks the target task first and **rejects** with the plain locked message. Skip therefore ends up double-gated: 18:00 for the date (creation-class, dispatch-named) AND not-driver-bound for the task.

**2.4 — What gets MORE permissive** (the inverted half of the ruling, pinned by tests): an UNASSIGNED task is now editable and cancellable at any hour — after 18:00 the day before, on the delivery day itself. The pause start-date gate disappears entirely.

## §3 Brief amendment (dispatch-ASSIGNED)

One append-only §9 row at the next-free version (**v1.25 expected** against current main's v1.24; re-verify at merge-prep): records the verbatim ruling, the v1.16 supersede-of-the-supersede (Day-3 `decision_task_editability_cutoff_at_assigned.md` lock-at-assignment RESTORED; v1.16's row is not edited — append-only discipline), the §3.1.8 redefinition (cutoff = order-creation deadline only; skip-creation + append + materializer keep it; editability = assignment gate), and the `followup_assigned_before_cutoff_dispatch_race.md` closure. §3.1.8's body text is rewritten in place (body text is not the append-only log). Header Version pointer + closing line advance.

## §4 Every operator surface the lock reaches (dispatch-required enumeration)

1. **Consignee calendar day-popover** (`DayActionPopover` / `day-actions.ts:54` — Session C's lane, IN scope): `MUTATION_ELIGIBLE_STATUSES` currently includes `ASSIGNED` — it comes OUT (set becomes `CREATED`, `ON_HOLD`); all 7 mutation actions (skip, skip-override, append, pause, address one-off/forward, cancel-no-append) disappear behind it. A driver-bound day renders a plain explanation line ("Assigned to a driver — this delivery is locked") instead of silently missing buttons.
2. **`/tasks` page ActionsCell** (cancel + edit affordances — **Session B's lane, NOT touched**): enumerated as the flagged follow-on; the service layer rejects driver-bound mutations regardless, so until B adopts the disable-with-explanation the operator sees a clear server error rather than a silent failure.
3. **`/tasks` bulk actions** (bulk cancel/update entry points — Session B's lane, same flag): per-task service gate already protects; bulk results report per-task rejections.
4. **Subscription pause** (`PauseResumeActions` — IN scope if any client-side cutoff hint exists; verified at build): service no longer rejects by clock; the pause result's existing fields plus the new excluded-count metadata tell the operator an assigned delivery kept going.
5. **Edit-task form** (served by `updateTask` wherever it surfaces): service gate covers it; no dedicated UI change beyond what already renders ValidationError messages.

## §5 Tests (RED-first; unit + real Postgres)

Unit (per service, existing harnesses): ASSIGNED → ValidationError for updateTask / cancelTask / addNoteToDriver / bulkUpdateTasks / bulkCancelTasks; IN_TRANSIT → same; **CREATED + post-cutoff timestamp → now ALLOWED** for update/cancel (proves the time gate is gone — the RED inversion of today's behavior); skip post-cutoff → still rejected (creation gate pinned); append post-cutoff → still rejected; pause with post-cutoff start → now allowed; `isTaskEditable` truth table.
Integration (new spec, real Postgres): pause over a mixed window (CREATED + ASSIGNED) → subscription paused, CREATED task canceled, ASSIGNED task untouched, audit metadata carries the excluded count; skip on a driver-bound date → rejected, no exception row.
JSX-shape: day-actions buildActions with ASSIGNED → zero mutation actions + the explanation line.

## §6 Schema delta

**None.** Gate logic, exclusion-list extensions, one brief row, UI gating in Session C's lane.

## §7 Risks / interactions

- **R-E dependency:** churn (R-E) is the single sanctioned bypass of this freeze (its own ruling). The helper deliberately does NOT special-case system actors — R-E's cascade will use its own repository path, keeping the operator-facing gate airtight.
- **v1.16 history:** the Day-30 dispatch-race followup this supersedes was filed as "post-demo hardening"; this ruling closes it ahead of schedule. Append-only: v1.16's row is untouched; the new row carries the supersedence narrative.
- **markTasksRestoredInWindow (resume)** restores only CANCELED rows it canceled — unaffected by the exclusion (an assigned task that was never canceled needs no restore).

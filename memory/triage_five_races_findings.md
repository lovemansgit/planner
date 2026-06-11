# Five-race triage — findings (Day-53, Session C idle-lane PREP)

**Filed:** Day-53 (11 Jun 2026, 17:28 UTC open), Session C. Investigation ONLY — zero mutations, no fixes built. Every claim body-read against main `c1b8cc7` (line numbers cited against that tree). Scope per the idle-lane dispatch: the five §5 race items (`memory/uat_mvp_scope_definition.md` §5, accepted as controlled-UAT risk per Love's Day-53 PM ruling) plus Session C's two shared-dev-DB flaky-test finds.

**One-line summary:** all five races are REAL on current main; none is fixed by intervening work. Two (R-B auto-pause stranding, R-C webhook receipt loss) are silent-failure class and worse than filed; three need no directional ruling to fix; two (R-A, R-E) are genuinely Love-directional. Neither flaky find is a code bug in the suite's claims — one is dev-DB migration drift, one is a missing ORDER BY tiebreaker.

---

## Verdict table

| # | Race | Verdict | Severity driver | Schema delta | Love-trigger |
|---|---|---|---|---|---|
| R-A | Assigned-before-cutoff dispatch race | **STILL REAL** | Local/SF divergence if SF rejects a cancel on an ASSIGNED task; unprobed | none | **YES — directional** (hard-block reverts brief v1.16; soft-warn doesn't) |
| R-B | Auto-pause vs bounded-pause divergence | **STILL REAL — WORSE than filed** | Stranded subs with NO in-app recovery; Resume silently no-ops; live UAT trap | none (recommended fix) | conformance-restoring; flag the synthetic-window design to the reviewer |
| R-C | webhook_events row lost on rollback | **STILL REAL** | Silent drop: SF gets 200, no retry, no DLQ, no row — Sentry-only | none | none |
| R-D | Reconcile recovered-local-write failure | **REAL — reframed** | Not silent: QStash retry loop → mislabeled DLQ row; **no duplicate SF tasks possible** | none | none for the minimal fix; retry-behavior refinement is a product call |
| R-E | mp_13 — CRM deactivation doesn't cascade | **CONFIRMED GAP** | Materializer keeps creating + SF-pushing tasks for churned consignees | none | **YES — directional** (state set, cutoff bypass, fan-out timing) + brief §3.1.4 amendment |
| F-1 | 0025 CHECK drift (shared dev DB) | **CONFIRMED — env drift, not code** | Standing local-integration red | **SQL-TO-APPLY** (dev DB) | **YES — trigger #1**, named authorization |
| F-2 | admin-subscriptions pagination flake | **CONFIRMED — code defect in query determinism** | Flaky CI/local signal erodes trust | none | lane-assignment flag only |

---

## R-A — Assigned-before-cutoff dispatch race

**Verdict: STILL REAL.** All **10** service-layer cutoff sites enforce only the time gate (`isCutOffElapsedForDate`) and none checks dispatch state: `tasks/service.ts:1071,1079,1309,1463,2269,2397,2407`; `subscription-exceptions/service.ts:417,1102`; `subscriptions/service.ts:702`. The UI agrees: `DayActionPopover.tsx:125-129` lists ASSIGNED in `MUTATION_ELIGIBLE_STATUSES`; the `/tasks` ActionsCell has no status check; `markTaskSkipped` (`tasks/repository.ts:1370`) excludes only DELIVERED/FAILED/CANCELED. This is the brief's own v1.16 ruling faithfully implemented — a spec-level gap, not an implementation bug.

**SF interplay — unprobed:** no probe has cancelled an ASSIGNED task. The R16 probes established SF cancel is TERMINAL (un-cancel → 403). If SF *accepts* mid-assignment cancels, the driver app updates (operationally fine, unforewarned). If SF *rejects*, the local row is already SKIPPED/CANCELED → **local/remote divergence**, surfacing only as a DLQ row.

**Blast radius:** three operator surfaces (calendar popover's 7 actions, /tasks cancel + address edit, subscription pause). Window: between SF assignment time and the 18:00-day-before cutoff — zero for same-night assignments, hours for early assignments.

**Fix shape (not built):** composite `isTaskEditable(now, task)` (time gate AND `internalStatus !== 'ASSIGNED'`) replacing the 10 raw calls, **and/or** a warn-before-proceed dialog at the 2 UX surfaces. **Test shape:** ~7 unit cases across the three services + 1 integration case (ASSIGNED + pre-cutoff → expected behavior). **Recommended pre-build step:** one sandbox probe — cancel an ASSIGNED task — to settle the SF-acceptance question.

**LOVE-TRIGGER (directional):** hard-block reverts the v1.16 "ASSIGNED is mutation-eligible" ruling (brief drift); soft-warn changes no contract. The build dispatch must carry Love's choice; triage recommendation is **soft-warn UX + keep ASSIGNED eligible** (no v1.16 reversion), with the probe informing whether a hard guard is needed for the reject case.

## R-B — Auto-pause vs bounded-pause divergence (stranded subscriptions)

**Verdict: STILL REAL and WORSE than the filed memo.** The bifurcation: `autoPauseSubscriptionForRepeatedFailure` (`subscriptions/service.ts:1315-1431`) writes ONLY `subscriptions.status='paused'` via `pauseSubscriptionRow` (`repository.ts:463-489`) — no `pause_window` exception row, no task cancels, no SF fan-out. Everything downstream keys on the `pause_window` row: the auto-resume cron's selection SQL (`api/cron/auto-resume/route.ts:100-111`) can never match it, and — **the memo's recovery claim is WRONG on current code** — manual resume hits `findActivePauseWindow → null` and returns `already_active` **without flipping status and without an audit event** (`service.ts:1036-1041, 1133-1141`). HTTP 200, nothing changed.

**Stranding timeline:** N push failures → auto-pause → cron never selects it → operator clicks Resume → silent no-op → **stuck PAUSED forever; only recovery is direct SQL**. Parked R16 (#408/#410) will NOT help — it keys on the pause-window correlation_id that auto-pause never writes.

**Blast radius:** subscription stuck, zero deliveries materialize past the auto-pause date, Resume CTA silently lies, audit shows `subscription.auto_paused` with no possible `subscription.resumed`. **UAT trap:** three consecutive SF push failures put a subscription in this state mid-UAT; the run sheet does not document it (`uat_run_sheet_v1.md`).

**Fix shape (not built):** route auto-pause through the bounded `pauseSubscription` with a synthetic open-ended window (system-actor bypass for permission + cutoff; far-future `end_date` is naturally never auto-resumed; manual resume then just works; `pauseSubscriptionRow` deletes). **No schema.** (Alternative `pause_kind` column = one migration — not recommended.) **Test shape:** integration with injected `now`: auto-pause → assert pause-window row exists → manual resume → assert status flips + `subscription.resumed` emitted → assert cron query excludes the far-future window → bounded-pause regression. Side notes for the build PR: stale "15-min cadence" comment at `route.ts:6`; cron restoration to `*/15` is gated on the Vercel tier (cost — Love's call, already recorded in brief v1.17's operational note).

## R-C — webhook_events row lost on update rollback

**Verdict: STILL REAL.** Both apply paths (`apply-webhook-edit-event.ts:153-286`, `apply-webhook-status-event.ts:313-528`) INSERT the durable `webhook_events` receipt and apply the task UPDATE **inside one `withTenant` transaction** (`shared/db.ts:123-128` — no savepoints). Any non-unique-violation throw rolls back the receipt with the apply. The Day-28 two-bug fix and the Day-52 TZ fix each closed specific *throw vectors* but did not split the transaction.

**Blast radius — silent drop:** the route returns **200 to SF after verification regardless of apply outcome** (`route.ts:256-317`), so SF never retries; there is **no inbound DLQ**; the rollback erases the raw payload, the dedup anchor, and the task update; audit never emits (it runs post-tx, gated on `applied`). The only trace is Sentry. Worst case is repeated invisible event loss, not a poison loop.

**Fix shape (not built):** **receipt-then-apply transaction split** — Tx-1 commits the `webhook_events` INSERT (dedup UNIQUE check happens here; `duplicate` short-circuits), Tx-2 applies the task update and may roll back alone. Orphan receipt on Tx-2 failure is the desired forensic artifact and keeps the dedup slot occupied. No savepoints needed; no schema; no audit/brief surface change. **Test shape:** integration — induced Tx-2 failure → receipt row survives + task unchanged; re-delivery after committed receipt → `duplicate`, single row.

## R-D — Reconcile recovered-local-write failure (no-DLQ path)

**Verdict: REAL, reframed — an active retry loop, not silent divergence.** The gap: in `pushSingleTask`'s reconcile branch, when `getTaskByAwb` SUCCEEDS but the local `markTaskPushed`/`markFailedPushResolved` write fails, the catch (`task-push/service.ts:612-627`) is **Sentry-only** (no `recordFailedPushAttempt`) and returns `kind:"awb_exists"` — which the queue handler (`api/queue/push-task-failed`-sibling `push-task/route.ts:274-288`) treats as throw-for-retry. Each retry burns a full SF round-trip (createTask → 23505 → getTaskByAwb → mark again); each cron tick re-enqueues independently (`repository.ts:1103-1112` — the task still looks unpushed). On QStash exhaustion the failure-callback DLQ row lands with the **wrong prefix** (`awb_exists reconcile failed…`), hiding that SF-side is fine and only a local UPDATE is needed; the recovered SF id lives only in Sentry.

**Safety property CONFIRMED: no duplicate SF tasks are possible** — SF returns AwbExists on every retry. Damage is stuck `outbound_sync_state='pending'` + `pushed_to_external_at NULL`, wasted SF quota, and a misleading DLQ row. Trigger likelihood low (<0.1% — pooler hiccup/timeout class).

**Fix shape (not built):** add a guarded `recordFailedPushAttempt` in the markErr catch with prefix `reconcile_recovered_but_mark_pushed_failed:` carrying the recovered SF id inline. No schema; retry semantics unchanged (belt-and-braces visibility). **Optional product call (parks separately if pursued):** a distinct outcome kind that acks instead of retrying when the SF id is known. **Sibling gap found (file as its own followup at build time):** the non-reconcile Step-5 path (`service.ts:734-750`, SF success + markTaskPushed failure → `failed_to_dlq` ack) is ALSO Sentry-only with no DLQ row. **Test shape:** one unit case in `tests/unit/push-single-task.spec.ts` (the markErr path has zero coverage today; the memo's referenced spec file `cron-push-reconciles-awb-exists.spec.ts` does not exist — coverage lives in push-single-task.spec.ts).

## R-E — mp_13: consignee deactivation doesn't cascade-cancel

**Verdict: CONFIRMED GAP, fully live.** `changeConsigneeCrmState` (`consignees/service.ts:615-713`) updates the column, writes the CRM event, emits audit — and touches nothing operational. The materializer's subscription selection filters ONLY `s.status='active'` (`task-materialization/cte-builder.ts:123`) with **no consignees join at all**, and the push path has no CRM check — so churned/inactive consignees keep getting tasks created AND SF-pushed every nightly tick. The only stop is manually finding and ending each subscription (`endSubscription` exists; no per-consignee surface). The MP-13 named test pins the gap rather than the behavior (Path 2 asserts the FK violation on hard-delete). Note: the brief itself never specified a cascade — the Day-8 MP-13 rule and the later CRM machine were never wired together.

**Fix shape (not built):** Option A — on terminal-state transitions, end active subscriptions in-tx + cancel future non-terminal tasks + post-commit SF fan-out **reusing R2's `enqueueBulkCancelTasks` machinery**; Option B — block the transition while active subscriptions exist (gate). No schema either way. **Test shape:** rewrite the MP-13 named test Path 2 to the chosen behavior + 1 integration (transition → sub ended, task CANCELED, fan-out enqueued for pushed rows).

**LOVE-TRIGGERS (directional — park the build until ruled):** (1) which states cascade (CHURNED/INACTIVE/SUBSCRIPTION_ENDED vs a subset; ON_HOLD/HIGH_RISK must not); (2) does a deactivation cascade bypass the 18:00 cutoff (no bypass mechanism exists today — without one, the driver still visits the churned customer); (3) immediate fan-out vs next-tick; (4) **brief amendment required** — §3.1.4's five-step `changeConsigneeCrmState` spec gains a cascade step (version bump dispatch-assigned per three-pair rule 3).

## F-1 — 0025 CHECK drift (shared dev DB)

**Confirmed environment drift, not a code defect.** `supabase/migrations/0025_outbound_push_failures_operation_reschedule.sql:20-24` drops and re-adds `outbound_push_failures_operation_check` with `'reschedule'`. The shared dev DB's live constraint reads `('update','cancel','bulk_cancel')` — the 0023-era version — so **0025 was never applied there**; CI provisions fresh from migrations and passes. The failing spec (`tests/integration/migration-0026-tasks-outbound-sync-state.spec.ts:64`) is doing its job: it caught real drift, the exact pattern `memory/followup_migration_drift_check.md` predicted.

**Fix shape:** apply 0025 verbatim to the shared dev DB. **This is a live-DB SQL apply → Love-trigger #1, SQL-TO-APPLY, NAMED authorization required** (the dev/sandbox DB carries the UAT demo data). One statement pair, idempotent-safe to verify by re-reading the constraint. Recommended ride-along: a `psql`-based drift check comparing the live constraint set against migrations (the long-filed followup), but that is tooling scope — not required to clear the red.

## F-2 — admin-subscriptions pagination flake

**Confirmed code defect in query determinism.** `listAllSubscriptions` orders by `s.created_at DESC` with **no tiebreaker** (`subscriptions/repository.ts:283,361` — pattern repeats at `:221,242`). Postgres `now()` is transaction-stable, so batch-seeded rows share identical `created_at`; with tied keys, `LIMIT 1 OFFSET 0` and `LIMIT 1 OFFSET 1` issued as two separate queries may legally return the same row — which is precisely the spec's failure (`page1[0].id === page2[0].id`). Flakes more on the shared dev DB (many tied rows) but is possible on CI too.

**Fix shape:** append `, s.id DESC` to the ORDER BY on the paginated admin list queries (and audit the three sibling `created_at DESC` sites for the same exposure). No schema; the existing spec becomes deterministic, plus one unit SQL-shape assert for the tiebreaker. **Lane flag:** touches `src/modules/subscriptions/**`, adjacent to Session A's standing do-not-touch zone — the build dispatch must assign the lane explicitly.

---

## Recommended build order

Rationale: severity-first among items needing NO ruling; the two directional items batch into one Love ruling session; the SQL apply rides any check-in.

1. **R-B auto-pause stranding** — highest live severity (unrecoverable operator dead-end + UAT trap), self-contained fix, no schema. T3 plan→code.
2. **R-C webhook receipt split** — silent data loss on the inbound path, structural one-file-pair fix, no directional questions. Can pair with R-B in one wave (disjoint modules).
3. **R-D reconcile DLQ write** — small, surgical, no behavior change; file the Step-5 sibling followup alongside. T2-shaped.
4. **F-2 pagination tiebreaker** — trivial; fold into whichever wave gets the subscriptions-module lane assignment.
5. **F-1 0025 dev-DB apply** — one Love-named SQL authorization at the next check-in; instantly clears the standing local red.
6. **R-A assigned-before-cutoff** — AFTER Love's ruling (soft-warn recommended) + one sandbox probe (cancel an ASSIGNED task) to ground the SF-reject branch.
7. **R-E mp_13 cascade** — LAST: largest directional surface (4 rulings + brief amendment), and its fix wants R2's fan-out machinery plus possibly R-A's cutoff-bypass decision settled first.

**For the eventual build dispatches, the park-correct flags in one place:** R-A and R-E carry `needs-directional-ruling`; F-1 carries SQL-TO-APPLY (named authorization); R-D's optional ack-not-retry refinement is a product call if pursued; everything else parks as ordinary T2/T3 code with zero schema deltas and zero new spend.

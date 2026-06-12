# Day-53 Session C plan — R-B: auto-pause stranding / windowless-resume conformance (T3)

**Filed:** Day-53 EVE (11 Jun 2026), Session C, per the "Triage builds pulled forward" dispatch (R-B then R-C).
**Lane authority:** Love's ruling pulls the two silent-failure races (R-B, R-C) forward to build now; the triage findings memo (`memory/triage_five_races_findings.md`, merged `6c193ca`, #428) is the contract. The dispatch's stated goal: *"restore resume conformance so auto-paused subscriptions recover in-app; flag the synthetic-window design point to the reviewer."*
**Hard fences (dispatch):** no `supabase/migrations/**`, no spend, no R-A/R-E work, no `src/modules/tasks/**`, no Session B R6 surfaces. **No brief bump assigned** — none is taken (scaling rule 3: bumps are dispatch-assigned, never self-assigned).

All citations re-verified by body-read against main `6c193ca` (post-R16 — the triage memo's pin was `c1b8cc7`, and #410 landed in the resume path since; line numbers below are current).

## §1 Grounded evidence (current main)

1. **The bifurcation:** `autoPauseSubscriptionForRepeatedFailure` (`src/modules/subscriptions/service.ts:1376-1492`) pauses via the single-table flip helper `pauseSubscriptionRow` (`src/modules/subscriptions/repository.ts:463-489`) — sets `status='paused', paused_at=now()` and nothing else. No `pause_window` exception row, no task cancels, no SF fan-out. Emits `subscription.auto_paused`.
2. **The stranding:** `resumeSubscription` (`service.ts:996`) finds the sub `paused`, then `findActivePauseWindow` (`service.ts:950-968`) returns null (no `pause_window` row exists), and the branch at `service.ts:1036-1042` returns `{kind:"already_active"}` — **HTTP 200, no status flip, no audit emit**. The UI's ResumePanel (`src/app/(app)/subscriptions/[id]/edit/_components/PauseResumeActions.tsx:165`) never shows "Resumed".
3. **The cron can't help:** the auto-resume selection SQL (`src/app/api/cron/auto-resume/route.ts:100-111`) selects only `subscription_exceptions` rows of `type='pause_window'` — a windowless paused sub is invisible to it. R16's re-push fan-out (#410) also lives entirely inside the `pauseWindow` branch (`service.ts:1093-1112`), so it changes nothing here. **Only recovery today is direct SQL.**
4. **Severity correction to the triage memo (new find this body-read):** `autoPauseSubscriptionForRepeatedFailure` has **no runtime caller on current main**. The QStash failure callback (`src/app/api/queue/push-task-failed/route.ts:193`) records the DLQ row and returns — no threshold check, no trigger. The MP-14 named test documents this as deliberate: *"the service method is 'armed but unfired' … only the trigger that calls into it is pending (C-3)"* (`tests/unit/mp-14-push-failure-auto-pause.spec.ts:19-28`). So the memo's "live UAT trap" framing overstates current main: the stranded state is **unreachable by any runtime path today** (the only two writers of `status='paused'` are the bounded operator pause, which always inserts its window in the same tx at `service.ts:763-807`, and the uncalled auto-pause helper). The trap **arms the moment the C-3 trigger wires up** — which is exactly why conformance should land first.
5. **Type/contract room:** `ResumeSubscriptionResult.correlation_id` is already `string | null` (`src/modules/subscriptions/types.ts:227-243`) — a windowless resume returning `status:"resumed", correlation_id:null, restored_task_count:0` needs **zero type changes**. The resume action (`src/app/(app)/subscriptions/[id]/edit/_actions.ts:163-168`) and ResumePanel render "Resumed / 0 tasks restored" with no UI change.

## §2 The synthetic-window design point (dispatch-flagged for the reviewer)

The triage memo's recorded fix shape was **Option A: route auto-pause through the bounded `pauseSubscription` with a synthetic open-ended window**. Body-reading the helpers shows Option A is worse than sketched — it has two correctness traps plus three coupled obligations:

- **Trap 1 — pause-time 365-stop throw:** for a finite-`end_date` sub, `countEligibleDeliveryDays` over `[today, far-future]` (`src/modules/subscription-exceptions/skip-algorithm.ts:540-561` — caps iterations at MAX_FORWARD_DAYS but does NOT clamp to the sub's end_date) yields a large `extensionDays`, and `computePauseExtensionDate` then rejects at the 365-day safety stop → `ConflictError` thrown at `service.ts:753-757`. The synthetic path would have to skip the extension entirely.
- **Trap 2 — resume-time end_date corruption:** early-manual resume computes `shrinkBy = originalExtension − effectiveExtension` over the window (`service.ts:1055-1085`); with a far-future window end, `shrinkBy` is huge and `walkBackwardEligibleDays` would slash the sub's real `end_date`. The resume path would have to detect the synthetic window (sentinel-date matching — fragile) and skip the shrink.
- Plus: a synthesized `idempotency_key` for the bounded path's replay check; system-actor bypasses for permission + cut-off; and a behavioral expansion (bounded pause cancels in-window tasks + fans out SF cancels — semantics the emergency halt never had, against a sub whose pushes are *already failing*).

**Option B (recommended): fix conformance at the resume side.** Replace the silent `pauseWindow === null → already_active` branch (`service.ts:1036-1042`) with a **windowless-recovery** branch, manual path only:

- In-tx: flip `status='active', paused_at=NULL` (the existing no-end_date-change UPDATE at `service.ts:1124-1132` is reused verbatim); no task restore (auto-pause canceled nothing); `end_date` untouched (no extension was ever granted).
- Post-commit: emit `subscription.resumed` with metadata `{subscription_id, actual_resume_date: today, new_end_date: null, restored_task_count: 0, is_auto_resume: false, idempotency_key, correlation_id: null, windowless_recovery: true, paused_at_was}` (`pausedAt` is already read by `readSubscriptionForLifecycle`, `service.ts:632`).
- Return `{status:"resumed", correlation_id:null, restored_task_count:0, reactivated_task_count:0, http_status:200}` — fits the existing type.
- **Auto path keeps the guard:** when `is_auto_resume === true`, windowless stays `already_active`. The cron can never select a windowless sub anyway (§1.3), but the explicit guard preserves the emergency-halt semantics — an auto-paused sub recovers only when a **human** clicks Resume, never silently by cron. This is the one place Option B must NOT be symmetric.
- `findActivePauseWindow`'s NOT EXISTS guard and the cron SQL both key on `(metadata->>'correlation_id')::uuid = exceptions.correlation_id`; a `correlation_id: null` emit matches no exception row, so neither query is perturbed.

Why B over A in one sentence each: B is ~15 lines in one function vs. a multi-surface refactor with two known correctness traps; B fixes ALL windowless-paused subs (including anomalies), not just future auto-pauses; B leaves the deliberately scope-limited `pauseSubscriptionRow` helper and the armed-but-unfired auto-pause exactly as the Day-16 Block 4-C record says they should be. Option A's one genuine advantage — auto-pause would cancel in-window tasks so SF stops attempting them — is moot while pushes are already failing (the very trigger condition) and is C-3-trigger-lane scope.

## §3 Scope

**IN:** the windowless-recovery branch in `resumeSubscription` (`src/modules/subscriptions/service.ts` only); one additive sentence on the `subscription.resumed` catalogue entry's `metadataNotes` (`src/modules/audit/event-types.ts:356-364`) documenting the `windowless_recovery` metadata key; tests (§5).

**OUT (explicit):** the C-3 trigger wiring (auto-pause still has no caller after this PR — separate item, separate dispatch); any change to `autoPauseSubscriptionForRepeatedFailure` or `pauseSubscriptionRow`;any task restore/re-push in the windowless branch (nothing was canceled); end_date math; UI changes; new audit event types (reuses `subscription.resumed`); new permissions; **no schema delta, no migrations** — if one appears necessary, STOP and park; no brief bump (none assigned).

## §4 Audit shape

Reuses `subscription.resumed` (catalogue `event-types.ts:356`) — a windowless recovery IS a resume; a dedicated event would split the "is this sub resumed?" query across two types and perturb the correlation-keyed NOT EXISTS guards for zero forensic gain. Discrimination lives in metadata: `windowless_recovery: true` + `correlation_id: null`. The `subscription.auto_paused → subscription.resumed` pair becomes a queryable lifecycle for the first time (the triage memo's "no possible subscription.resumed" blast-radius line is exactly what this closes).

## §5 Test plan (RED-first, watched failing before implementation)

**Unit — `src/modules/subscriptions/tests/service-lifecycle.spec.ts`** (existing mock harness, `mockExecute`/`mockEmit` pattern at lines 25-54):
1. Manual resume, paused + no active window → status flips (UPDATE issued), `subscription.resumed` emitted with `correlation_id: null` + `windowless_recovery: true`, result `status:"resumed"`, `restored_task_count: 0`. (Currently: returns `already_active`, no UPDATE, no emit — this is the RED assertion.)
2. Auto resume (`is_auto_resume: true`), paused + no window → `already_active`, NO UPDATE, NO emit (guard pinned).
3. Existing windowed-resume + already-active tests stay green (regression).

**Integration — `tests/integration/subscription-windowless-resume.spec.ts`** (new; real Postgres via the `resume-sf-reactivation.spec.ts` template — per-run random UUIDs, accepted-leak teardown):
1. Seed active sub → `autoPauseSubscriptionForRepeatedFailure` (system ctx) → assert `status='paused'`, `subscription.auto_paused` emitted, NO `pause_window` row.
2. Manual `resumeSubscription` → assert `status='active'`, `paused_at IS NULL`, `subscription.resumed` row exists with `metadata->>'windowless_recovery' = 'true'` and `metadata->>'correlation_id' IS NULL` (query by `occurred_at`, not `created_at`).
3. Second manual resume → `already_active`, exactly one `subscription.resumed` row (idempotency).
4. Cron-exclusion pin: the auto-resume selection SQL (run verbatim) returns no row for this sub while paused.
5. Bounded-pause regression: operator pause → resume still restores tasks + emits with the window's `correlation_id` (guards that the new branch didn't widen).

## §6 Schema delta

**None.** Two UPDATE statements already in the file, one metadata key, one catalogue sentence. (The triage memo's rejected alternative — a `pause_kind` column — stays rejected.)

## §7 Risks / interactions

- **Session A's R16 surface:** this PR touches `resumeSubscription` but only the currently-dead `pauseWindow === null` branch; R16's fan-out is in the windowed branch and is regression-pinned by `tests/integration/resume-sf-reactivation.spec.ts` (stays green). This dispatch explicitly assigns the resume path to Session C.
- **Materialization gap days:** while auto-paused, the materializer creates nothing (`status='active'` filter); after recovery, future dates materialize again. Days inside the halt are skipped, not back-filled — honest emergency-halt semantics; back-fill would be invented scope.
- **Stale comment:** the `findActivePauseWindow` null-branch comment ("defence-in-depth") is rewritten to name the windowless-recovery semantics so the next reader doesn't restore the silent no-op.

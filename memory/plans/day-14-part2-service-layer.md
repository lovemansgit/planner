# Day-14 part-2 — service-layer surface plan

**Status:** Drafting (T3 hard-stop #1 active at PR open).
**Tier:** T3 (hard-stop-twice — plan PR open + code PR open).
**Sequencing:** Drafted AFTER cron-decoupling code PR #153 merged (`7759580`); blocks Day-16 frontend feature work per brief §6 day-by-day plan.
**Owns:** Service-layer surface for the brief's exception model + lifecycle + CRM + merchant management + address services + the API route layer that exposes them.

**This plan does NOT include implementation.** It is the design. The implementation lands as a separate code PR drafted in a future session AFTER this plan merges (T3 hard-stop #2 fires at code-PR open).

---

## §0 Scope summary + sequencing rationale

### §0.1 What this plan is

Service-layer + API-route surface design for the brief's six business workflows from §2.2 (consignee onboarding wizard's atomic create-flow stays scope-shared with the existing `/api/consignees` POST; this plan covers the remaining five workflow surfaces plus the Transcorp-staff merchant management surface):

- **A.** Subscription exception services (5 type variants of `addSubscriptionException` + `appendWithoutSkip`)
- **B.** Subscription lifecycle services (`pauseSubscription` bounded + `resumeSubscription` manual + auto-resume scheduler)
- **C.** Consignee CRM services (`changeConsigneeCrmState`)
- **D.** Merchant management services (`createMerchant`, `activateMerchant`, `deactivateMerchant`)
- **E.** Address services (`changeAddressRotation`, `changeAddressOneOff`, `changeAddressForward`)
- **F.** API route layer exposing A–E

The schema underneath (migrations 0014–0019, applied to production Day 14 morning Track B) is the canonical foundation — this plan does NOT touch schema. The cron-decoupling code PR #153 (merged `7759580`) provides the materialization-side contract surface (§1.3 retirement table; `tasks.pushed_to_external_at` semantics; QStash queue infrastructure) that the exception services write into.

### §0.2 What this plan is NOT

- **NOT schema migrations.** All required tables + columns + CHECK constraints + RLS policies + UNIQUE indexes are in production from PR #139 + PR #144's auth landing + PR #153's migration 0020. If a service surfaces a schema gap during drafting, it goes in §10 open questions, NOT a silent migration addition.
- **NOT permission additions.** All 10 permissions per brief §3.1.3 are already registered in `src/modules/identity/permissions.ts` (verified pre-draft: lines 469–559 for the part-2 surface). This plan's §1 maps services → existing permissions, NOT adds new ones.
- **NOT audit event additions.** All 9 audit events per brief §3.1.2 (count corrected per `memory/project_brief_audit_event_count_correction.md`: 9, not 8) are already registered in `src/modules/audit/event-types.ts`. This plan's §2 maps service emit-points → existing events + correlation_id semantics.
- **NOT frontend.** UI for the workflows is Day-16+ scope per brief §6.
- **NOT label generation (L4).** Separate Day-16 plan PR per brief §3.5.
- **NOT implementation code.** Code lands in a separate code PR after this plan merges; T3 hard-stop #2 fires there.

### §0.3 Sequencing rationale (why now, why this scope, what this gates)

**Why drafted now (post-cron-decoupling merge):** per merged plan §8.1, three concrete reasons gated this part-2 plan on cron-decoupling landing first:

1. **Data-flow dependency.** `addSubscriptionException` writes the `subscription_exceptions` rows that Phase 1 reconciliation in the materialization handler consumes. Skip exceptions reduce future materialization (§2.4 row 1 of the cron-decoupling plan). Address overrides redirect address resolution (§2.4 rows 3–4). `append_without_skip` extends `subscription.end_date` for tail-end materialization (§2.4 row 5). The queue infrastructure must be stable first; otherwise a part-2 service write hits a half-built materialization path.
2. **Behavioral dependency.** `pauseSubscription` flips `subscriptions.status` to `'paused'`. The §3.2 amendment 4 paused filter behavior in the cron handler must be verified end-to-end before the service that triggers the transition exists; otherwise a regression in the filter wouldn't be caught until a real merchant pauses a subscription in production.
3. **Same-day T3 PR contention.** Two T3 plan PRs landing the same day would compete for review attention and risk schema-migration sequencing collisions.

All three pre-conditions cleared with PR #153's merge + Day-15 morning post-deploy verification (860 active subs / 860 materialization rows / Phase 1 reconciliation candidates = 0 / first 12:00 UTC tick under new architecture awaiting at ~16:00 Dubai today).

**Why this scope (and not more or less):**

- **Why bundled together:** A–F share a cross-cutting concern (RBAC + audit-correlation_id + idempotency-key UNIQUE + cut-off enforcement + tenant-isolation re-assertion) that is awkward to split. Splitting the exception services from the lifecycle services would force two passes through the same correlation-id design + the same idempotency key handling. One bundled plan, one bundled code PR.
- **Why merchant management is in the bundle:** Although Transcorp-staff scoped (cross-tenant) rather than merchant-operator scoped, `createMerchant` + `activate` + `deactivate` share the audit-event registration model and the systemOnly-permission posture established by the rest of the bundle. Splitting them out would create a third T3 plan PR for ~150 lines of service + 3 routes.
- **Why NO frontend:** UI surfaces (4-step onboarding wizard, consignee detail calendar, subscription detail, consolidated merchant calendar, Transcorp-staff admin) all consume these services. Drafting frontend in parallel with services creates a contract drift surface. Frontend Day-16+ per brief §6.

**What this gates:**

- **Day 16:** Skip workflow UI, subscription detail page, consolidated merchant calendar, L4 label generation plan PR — ALL consume services in this plan.
- **Day 17:** Per-task delivery status timeline, consignee timeline, CRM state UI, address change workflows — ALL consume services in this plan.
- **Day 18:** Brand pass + polish + demo data preparation — depends on Day 16-17 UI.
- **Day 19:** Pre-demo verification + dry-runs — depends on Day 18 demo data.

**Demo-dependency cascade per cron-decoupling plan §9 A5:** decoupling delays → part-2 plan delays → Day-16+ UI delays → demo at risk on May 12. Today is Day 15 (calendar 6 May 2026). 5 days remain to demo. Plan PR drafted today; code PR drafts tomorrow at earliest after this plan merges; merging code PR by Day 16 EOD is the tractable path that preserves the buffer.

### §0.4 Pre-flight verification (Love confirms before code-PR opens)

| # | Item | Verification |
|---|---|---|
| 1 | All 10 brief §3.1.3 permissions registered | `grep -oE "\"(subscription:skip\|subscription:override_skip_rules\|subscription:change_address_rotation\|subscription:change_address_one_off\|subscription:change_address_forward\|consignee:change_crm_state\|merchant:create\|merchant:read_all\|merchant:activate\|merchant:deactivate)\"" src/modules/identity/permissions.ts \| sort -u \| wc -l` returns **10** (counts UNIQUE matches per name; aggregate occurrence count would pass with the wrong 10 names — sort-u guards against duplicate-name false positives) |
| 2 | All 9 brief §3.1.2 audit events registered | `grep -oE "\"(subscription\.exception\.created\|subscription\.end_date\.extended\|subscription\.address_override\.applied\|subscription\.paused\|subscription\.resumed\|consignee\.crm_state\.changed\|merchant\.created\|merchant\.activated\|merchant\.deactivated)\"" src/modules/audit/event-types.ts \| sort -u \| wc -l` returns **9** (same unique-match guard as item 1) |
| 3 | Schema present on prod | `to_regclass('public.subscription_exceptions')`, `to_regclass('public.subscription_address_rotations')`, `to_regclass('public.consignee_crm_events')`, `to_regclass('public.consignee_timeline_events')` all return non-null (verified Day-14 morning Track B) |
| 4 | Migration 0020 + new cron handler live | `gh pr view 153` shows merged `7759580`; production deploy on `b6htar0mx` confirmed Day-15 evening (probe `/api/cron/generate-tasks` → 401 ✓) |
| 5 | Day-15 morning Posture B Stage 2 merged | `gh pr view 154` shows merged `7fd70f6`; `ALLOW_DEMO_AUTH` runtime gate retired |

If any pre-flight item fails: STOP, surface to Love, do not open code PR.

### §0.5 Table of contents

- [§0 Scope summary + sequencing rationale](#§0-scope-summary--sequencing-rationale)
- [§1 Permission mapping (no additions; all in code)](#§1-permission-mapping-no-additions-all-in-code)
- [§2 Audit event mapping + correlation_id semantics](#§2-audit-event-mapping--correlation_id-semantics)
- [§3 Service A — Subscription exception services](#§3-service-a--subscription-exception-services)
- [§4 Service B — Subscription lifecycle services + auto-resume scheduler](#§4-service-b--subscription-lifecycle-services--auto-resume-scheduler)
- [§5 Services C + D + E — Consignee CRM, Merchant management, Address services](#§5-services-c--d--e--consignee-crm-merchant-management-address-services)
- [§6 API route layer](#§6-api-route-layer)
- [§7 Idempotency + cut-off enforcement](#§7-idempotency--cut-off-enforcement)
- [§8 Webhook deduplication touch-points](#§8-webhook-deduplication-touch-points)
- [§9 Test plan](#§9-test-plan)
- [§10 Open questions for resolution at plan-PR amendment time](#§10-open-questions-for-resolution-at-plan-pr-amendment-time)
- [§11 Pre-merge gate checklist (code-PR open)](#§11-pre-merge-gate-checklist-code-pr-open)

---

## §1 Permission mapping (no additions; all in code)

Per §0.4 item 1, all 10 brief §3.1.3 permissions are registered. This section documents the service → permission mapping the code PR enforces in the service layer (re-asserted) and the API route middleware (first-line check). RBAC defense-in-depth per brief §3.4: middleware gate → service re-assertion → Postgres RLS as backstop. Service layer MUST re-assert (not trust the middleware).

| Service | Permission | systemOnly | Notes |
|---|---|---|---|
| `addSubscriptionException` (type='skip', no override) | `subscription:skip` | false | Default-rules skip; CS Agent has this. |
| `addSubscriptionException` (type='skip' with `target_date_override` OR `skip_without_append=true`) | `subscription:override_skip_rules` | false | Operations Manager / Tenant Admin only; CS Agent does NOT have this. |
| `addSubscriptionException` (type='address_override_one_off') | `subscription:change_address_one_off` | false | |
| `addSubscriptionException` (type='address_override_forward') | `subscription:change_address_forward` | false | |
| `appendWithoutSkip` | `subscription:override_skip_rules` | false | Operationally equivalent to skip-with-target-date-override extending end_date; same trust boundary, distinct UX path. CS Agent does NOT have this permission. Goodwill addition is operator-initiated tail-end extension; Phase-2 UI per brief §4 deferral table. Service ships in MVP. |
| `pauseSubscription` | `subscription:pause` | false | Pre-existing permission; reused. |
| `resumeSubscription` (manual) | `subscription:resume` | false | Pre-existing. |
| `resumeSubscription` (auto, scheduler-triggered) | system actor (no user permission check) | n/a | Auto-resume runs as `system: 'auto-resume-scheduler'` actor; permission check skipped per `assertSystemActor` pattern. |
| `changeConsigneeCrmState` | `consignee:change_crm_state` | false | |
| `changeAddressRotation` | `subscription:change_address_rotation` | false | |
| `changeAddressOneOff` | `subscription:change_address_one_off` | false | Same permission as one-off override exception (semantic alignment). |
| `changeAddressForward` | `subscription:change_address_forward` | false | Same permission as forward override exception. |
| `createMerchant` | `merchant:create` | true | Transcorp-staff scoped. |
| `listMerchants` (cross-tenant) | `merchant:read_all` | true | Powers `/admin/merchants` list view per brief §3.2.1. |
| `activateMerchant` | `merchant:activate` | true | `provisioning → active`. |
| `deactivateMerchant` | `merchant:deactivate` | true | `active → inactive`. |

**Skip-permission split rationale (load-bearing):** the brief §3.1.3 + the catalogue's `subscription:skip` description split default skip from override skip. The service's permission gate is **conditional on the input shape**:

```typescript
function requiredSkipPermission(input: AddSubscriptionExceptionInput): Permission {
  if (input.type !== 'skip') return /* type-specific (see table above) */;
  if (input.target_date_override !== undefined) return 'subscription:override_skip_rules';
  if (input.skip_without_append === true) return 'subscription:override_skip_rules';
  return 'subscription:skip';
}
```

CS Agent (per brief §3.1.3 role catalogue) has `subscription:skip` but NOT `subscription:override_skip_rules` — a CS Agent calling skip-with-override gets 403 from the service, not 200-then-silent-fallback to default. The split is enforced at the input-validation layer; the service's permission check uses the conditional resolver above.

**RBAC enforcement layers per brief §3.4:**

1. **Middleware** (API route entry): `requireAuth(ctx, requiredPermission)` returns 403 if the JWT-resolved actor lacks the permission. For dynamic permission (the skip split), middleware does the BASE check (`subscription:skip`) and the service does the FINER check (`subscription:override_skip_rules` if input demands).
2. **Service layer** (re-assertion): Every public service method's first line is `assertPermission(ctx, requiredPermission)`. The skip resolver above runs HERE (not in middleware) because middleware doesn't know the input shape.
3. **Postgres RLS** (backstop): Every tenant-scoped table (`subscription_exceptions`, `subscription_address_rotations`, `consignees`, `consignee_crm_events`) has the `app.current_tenant_id` policy. Cross-tenant writes via service are blocked at the database even if middleware + service are bypassed.

---

## §2 Audit event mapping + correlation_id semantics

Per §0.4 item 2, all 9 brief §3.1.2 audit events are registered. This section documents the service → audit-event mapping + the correlation_id semantics the code PR enforces.

### §2.1 Event registry (existing, per code at `src/modules/audit/event-types.ts:635–730`)

| Event | Registered at | Body fields |
|---|---|---|
| `subscription.exception.created` | line 635 | subscription_id, exception_id, type, target_date, compensating_date, correlation_id |
| `subscription.end_date.extended` | line 646 | subscription_id, previous_end_date, new_end_date, correlation_id, triggered_by ('skip' \| 'pause_resume' \| 'append_without_skip') |
| `subscription.address_override.applied` | line 657 | subscription_id, exception_id, target_date (one-off) OR effective_from (forward), address_id |
| `subscription.paused` | line 320 (pre-existing) | subscription_id, pause_start, pause_end |
| `subscription.resumed` | line 330 (pre-existing) | subscription_id, actual_resume_date, new_end_date, correlation_id, actor (user uuid for manual; system for auto) |
| `consignee.crm_state.changed` | line 677 | consignee_id, from_state, to_state, reason |
| `merchant.created` | line 702 | tenant_id, slug, name, pickup_address_line, pickup_district, pickup_emirate |
| `merchant.activated` | line 713 | tenant_id, previous_status='provisioning', new_status='active' |
| `merchant.deactivated` | line 724 | tenant_id, previous_status='active', new_status='inactive' |

### §2.2 correlation_id semantics — load-bearing

The brief §3.1.2 says: **"The skip flow emits `subscription.exception.created` + `subscription.end_date.extended` in same database transaction with shared `correlation_id`."** This generalizes to: **causally related events sharing a correlation_id must be emitted in the same transaction.**

| Service flow | Events emitted (same tx, shared correlation_id) | correlation_id source |
|---|---|---|
| **Default skip** (no override) | `subscription.exception.created` + `subscription.end_date.extended` | UUIDv7 generated at exception-creation; written to `subscription_exceptions.correlation_id` and propagated to both audit-event bodies. |
| **Skip with `target_date_override`** | `subscription.exception.created` + (conditional) `subscription.end_date.extended` with `triggered_by='skip'`. **Conditional contract:** if `new_end_date == previous_end_date` (target_date_override leaves end_date unchanged because the override is at-or-before current end_date), the `subscription.end_date.extended` event is NOT emitted — no extension actually occurred. Same-tx invariant holds because the second event is conditional on actual state change, not on flow type. | Same UUIDv7 anchor. |
| **Skip with `skip_without_append`** | `subscription.exception.created` ONLY | Same UUIDv7 anchor; no `subscription.end_date.extended` because no end_date change per brief §3.1.6. |
| **Address override (one-off OR forward)** | `subscription.exception.created` + `subscription.address_override.applied` | Same UUIDv7 anchor. |
| **`append_without_skip`** | `subscription.exception.created` (with type='append_without_skip') + `subscription.end_date.extended` (with `triggered_by='append_without_skip'`) | Same UUIDv7 anchor. |
| **Pause** | `subscription.paused` + `subscription.end_date.extended` (with `triggered_by='pause_resume'`) | Same UUIDv7 anchor; written to `subscription_exceptions.correlation_id` (the pause_window row) and propagated to both audit bodies. |
| **Resume (manual)** | `subscription.resumed` + (if pause shrunk) `subscription.end_date.extended` (with `triggered_by='pause_resume'`) | Same UUIDv7 anchor as the pause's correlation_id (carried forward via the pause_window row). |
| **Resume (auto-scheduler)** | `subscription.resumed` ONLY (no end_date change at auto-resume — extension was applied at pause-creation per §3.1.7) | Same UUIDv7 anchor as the pause; actor='system' rather than user uuid. |
| **CRM state change** | `consignee.crm_state.changed` ONLY | Single-event; no correlation needed. |
| **Merchant create / activate / deactivate** | one event each, no pairs | Single-event each. |

### §2.3 Idempotency vs. correlation_id

`subscription_exceptions.idempotency_key` (UNIQUE per `(subscription_id, idempotency_key)`) is the CLIENT-supplied dedupe key — operator's POST retry on network blip resolves to the same exception_id (returns 409). The `correlation_id` is the SERVER-generated event-causality anchor — operator can't see or set it.

**Idempotent retry path:** client-supplied idempotency_key already-seen → service returns existing `(exception_id, correlation_id, compensating_date?, new_end_date?)` with HTTP 409 — no audit events emitted on retry (one operator click → exactly one audit trail). This is the contract that prevents duplicate audit rows from breaking ops queries.

### §2.4 What the audit emit-pattern looks like in code

Each service that mutates state runs inside `withTenant(ctx.tenantId, async (tx) => { ... })` and emits via `auditEmit(tx, ctx, { event, body, correlation_id })` BEFORE the tx commits. Failure of audit emit rolls back the data write — same posture as the existing service modules per `feedback_audit_failed_attempts.md`.

```typescript
// Sketch — addSubscriptionException happy-path skip flow
return await withTenant(ctx.tenantId, async (tx) => {
  await assertPermission(ctx, resolvedPermission);
  await assertSubscriptionState(tx, subscriptionId, 'active');
  await assertCutoff(tx, subscriptionId, params.date);
  await assertIdempotency(tx, subscriptionId, params.idempotency_key);

  const correlationId = uuidv7();
  const compensatingDate = await computeCompensatingDate(tx, subscriptionId);
  const exceptionId = await insertSubscriptionException(tx, { /* ... */ correlationId });
  const newEndDate = await extendSubscriptionEndDate(tx, subscriptionId, compensatingDate);

  await auditEmit(tx, ctx, {
    event: 'subscription.exception.created',
    body: { subscription_id, exception_id: exceptionId, type: 'skip', target_date: params.date, compensating_date: compensatingDate, correlation_id: correlationId },
  });
  await auditEmit(tx, ctx, {
    event: 'subscription.end_date.extended',
    body: { subscription_id, previous_end_date, new_end_date: newEndDate, correlation_id: correlationId, triggered_by: 'skip' },
  });

  return { exception_id: exceptionId, correlation_id: correlationId, compensating_date: compensatingDate, new_end_date: newEndDate };
});
```

---

## §3 Service A — Subscription exception services

### §3.1 `addSubscriptionException` — full surface

**Module:** `src/modules/subscriptions/exceptions/service.ts` (NEW). Exports through `src/modules/subscriptions/index.ts`.

**Signature:**

```typescript
export interface AddSubscriptionExceptionInput {
  type: 'skip' | 'pause_window' | 'address_override_one_off' | 'address_override_forward' | 'append_without_skip';
  date: string;                     // ISO YYYY-MM-DD; for pause_window, pause_start
  end_date?: string;                // pause_window only; required when type='pause_window'
  reason?: string;                  // operator-supplied; optional
  idempotency_key: string;          // UUID; client-supplied; UNIQUE per subscription_id
  target_date_override?: string;    // skip override; ISO date
  skip_without_append?: boolean;    // skip override; default false
  address_override_id?: string;     // address_override_one_off / forward only; UUID FK to addresses
}

export interface AddSubscriptionExceptionResult {
  exception_id: string;
  correlation_id: string;
  compensating_date?: string;       // type='skip' only when skip_without_append=false AND target_date_override IS NULL
  new_end_date?: string;            // type='skip' (default + target_date_override path) AND type='append_without_skip'
  status: 'inserted' | 'idempotent_replay';
  http_status: 201 | 409;           // surface mapping
}

export async function addSubscriptionException(
  ctx: RequestContext,
  subscriptionId: Uuid,
  input: AddSubscriptionExceptionInput,
): Promise<AddSubscriptionExceptionResult>;
```

### §3.2 Behavior in single transaction (per brief §3.1.4)

Step ordering enforced verbatim in the implementation; departing requires a new `decision_*.md` (per `feedback_no_self_tier_escalation.md`):

1. Resolve required permission (per §1's skip-permission split).
2. `assertPermission(ctx, resolvedPermission)`.
3. Read subscription with FOR UPDATE; reject if not found OR `tenant_id !== ctx.tenantId` (RLS backstop) OR `status !== 'active'` for non-`pause_window` types (per brief §3.1.4 step 2). For `pause_window` itself, current status MUST be `'active'`.
4. Validate `params.date` is in the future relative to cut-off (§7 cut-off enforcement). Reject 400 if past or within cut-off window.
5. Validate `params.date` is eligible per `subscription.days_of_week` for `skip` and `address_override_one_off`. For `pause_window` the range need not align with eligible weekdays (operator pauses Mon-Sun; days_of_week filter applies at task-cancellation time, not validation time). For `address_override_forward` the start_date may fall on a non-eligible weekday (effective from there forward; first applicable date materializes per rotation).
6. Idempotency check: `SELECT id, correlation_id, compensating_date, ... FROM subscription_exceptions WHERE subscription_id = $1 AND idempotency_key = $2 LIMIT 1` — if hit, return existing fields with `status='idempotent_replay'`, `http_status=409`. **No audit events emitted on idempotent replay.**
7. For `type='skip'` with skip-without-override path: compute `compensating_date` via `computeCompensatingDate(tx, subscriptionId)` per brief §3.1.6 algorithm (§3.4 below).
8. For `type='skip'` with `target_date_override`: validate the target date is eligible per `days_of_week` AND not already a materialized task date AND not in a blackout/pause window. Reject 400 with explicit error if invalid. `compensating_date = target_date_override`; subscription end_date extends ONLY IF `target_date_override > current_end_date`.
9. For `type='skip'` with `skip_without_append=true`: `compensating_date = NULL`; subscription `end_date` unchanged.
10. Generate `correlation_id = uuidv7()`.
11. INSERT `subscription_exceptions` row with all derived fields.
12. For type='skip' without skip_without_append AND with valid compensating_date: UPDATE `subscriptions.end_date = compensating_date`.
13. For type='skip' (any variant): UPDATE the affected target task → `internal_status = 'SKIPPED'`. Reference the exception_id via the existing `tasks` foreign-key chain (no new column needed; `subscription_id + delivery_date` resolves the task; the SKIPPED state is the audit-trail anchor). **Sub-cases:**
    - **13a — Original date's task hasn't materialized yet** (skip recorded for a date still beyond the 14-day horizon): the UPDATE no-ops (zero rows match). The `subscription_exceptions` row is the durable record. Cron's materialization handler reads it via the §2.4 row 1 skip-the-date EXISTS guard when the horizon eventually reaches that date and skips materialization at that time. No service-side error.
    - **13b — `target_date_override` collides with an existing materialized task**: the service checks whether a task already exists on `target_date_override`. **If yes:** that existing task IS the compensating task — service does NOT INSERT a duplicate; only the ORIGINAL date's task is SKIPPED in this step. **If no:** only the original date's task is SKIPPED in this step; cron materializes the override date on the next tick (the override is reachable through the address-override / rotation / primary chain on cron's next pass).
    - **13c — `target_date_override` falls beyond the 14-day horizon**: same as 13a's logic for the override side — the new tail-end task materializes when cron reaches that date. The original date's task is still SKIPPED-or-no-op per 13a.
14. For type='address_override_one_off' / `_forward`: NO direct UPDATE to materialized tasks at exception-create time. The materialization handler (cron) re-resolves address per the COALESCE chain on next tick OR on already-materialized rows the brief §3.1.6 explicitly defers UPDATE-existing-rows behavior to Phase 2 (per Day-15 §7.1 row 6 plan-drift finding — folds into post-§7 plan-sync bundle).
15. Emit audit events per §2.2 mapping.
16. Return result; service exits transaction.

### §3.3 Edge cases (worked examples per brief §3.1.6 — implementation pins)

| # | Case | Behavior |
|---|---|---|
| A | Compensating date lands on blackout | computeCompensatingDate walks past blackout per algorithm; iteration cap at `start + 365 days` throws `NoCompensatingDateFound` (caught at service boundary, returned as 422). |
| B | Multiple skips in close succession (e.g., skip Tue + Thu of same week) | Second skip reads CURRENT `end_date` (already extended by first skip), extends from there. Stacking is transactional per FOR UPDATE on subscription row. |
| C | Operator double-tap / network retry | Idempotency key UNIQUE — second POST returns existing exception_id with 409. |
| D | Skip exhausts max_skips_per_subscription | Hard cap from merchant onboarding config. MVP: unlimited (per brief §4 deferrals — `max_skips_per_subscription` is Phase 2). Service does NOT check the cap; column exists in `subscriptions` but reads as NULL → unlimited. **Open question §10.1.** |
| E | Skip near original end_date | Always tail-end; documented in UI copy (Day 16+). Algorithm extends end_date by exactly one slot regardless. |
| F | Subscription currently paused | Reject 409 — status assertion in step 3 catches it. compensating_date undefined. |
| G | Skip on past date | Reject 400 — cut-off check in step 4 catches it. Historical-correction workflow is Phase 2 per `followup_historical_correction_workflow.md`. |
| H | Skip on very last delivery (i.e., the subscription's final task) | Algorithm extends end_date by exactly one slot; new task materializes on next cron tick within horizon. Test required (§9). |
| I | Skip on multi-task date | MVP not relevant (one subscription = one task per delivery_date by partial UNIQUE). |

### §3.4 `computeCompensatingDate` algorithm (per brief §3.1.6 pseudocode)

Lives at `src/modules/subscriptions/exceptions/compensating-date.ts`. Takes `(tx, subscriptionId)` and returns `Promise<string>` (ISO date) OR throws `NoCompensatingDateFound`.

```typescript
export async function computeCompensatingDate(
  tx: DbTx,
  subscriptionId: Uuid,
): Promise<string> {
  // Read subscription + days_of_week + current end_date + active blackouts + active pause_windows.
  // Iterate candidate = end_date + 1 day; while not eligible, candidate += 1 day; cap at +365 days.
  // Eligible iff:
  //   - ISODOW(candidate) ∈ subscription.days_of_week
  //   - candidate NOT IN blackout_dates (per-merchant + per-consignee blackouts; merchant-level only in MVP)
  //   - candidate NOT IN any active pause_window range
  //   - candidate < end_date + 365 days (safety stop; throws NoCompensatingDateFound otherwise)
}
```

**SQL pattern:** single query that walks +1..+365 generated dates and applies the 3 exclusion predicates; returns first match. Test fixtures pin the brief's worked examples (§9 row 1).

### §3.5 `appendWithoutSkip` — full surface

**Module:** same as §3.1 (`src/modules/subscriptions/exceptions/service.ts`).

**Signature:**

```typescript
export interface AppendWithoutSkipInput {
  reason: string;                   // required (goodwill addition is operator-recorded)
  idempotency_key: string;
  target_date_override?: string;    // optional; if absent, computed via computeCompensatingDate
}

export interface AppendWithoutSkipResult {
  exception_id: string;
  correlation_id: string;
  new_end_date: string;
  status: 'inserted' | 'idempotent_replay';
  http_status: 201 | 409;
}
```

**Behavior** per brief §3.1.4 + brief §3.1.6 override 3:

1. `assertPermission(ctx, 'subscription:override_skip_rules')`.
2. Verify subscription is `'active'`.
3. Idempotency check (same as §3.2 step 6).
4. Compute compensating date (or use target_date_override if validated).
5. Insert `subscription_exceptions` row with `type='append_without_skip'`, `start_date=compensating_date`, `compensating_date=NULL` (per CHECK constraint — compensating_date column reserved for type='skip' only).
6. UPDATE `subscriptions.end_date = compensating_date`.
7. Materialization handler (cron) generates the task on next tick (no direct INSERT here — keeps materialization-as-source-of-truth invariant).
8. Emit `subscription.exception.created` (type='append_without_skip') + `subscription.end_date.extended` (triggered_by='append_without_skip') with shared correlation_id.

### §3.6 Type vs. permission cross-check (defense-in-depth invariant)

The `subscription_exceptions.type` CHECK constraint admits 5 values. Each value MUST be reachable only via the corresponding service method + permission combination. The mapping:

| `type` | Service method | Permission(s) |
|---|---|---|
| `skip` (no override) | `addSubscriptionException` | `subscription:skip` |
| `skip` (with override) | `addSubscriptionException` | `subscription:override_skip_rules` |
| `pause_window` | `pauseSubscription` (NOT addSubscriptionException — different service surface; rejects in step 3 type-validation) | `subscription:pause` |
| `address_override_one_off` | `addSubscriptionException` (or `changeAddressOneOff` — alias for ergonomics; same write semantics) | `subscription:change_address_one_off` |
| `address_override_forward` | `addSubscriptionException` (or `changeAddressForward`) | `subscription:change_address_forward` |
| `append_without_skip` | `appendWithoutSkip` (NOT addSubscriptionException) | `subscription:override_skip_rules` |

**Open question §10.2:** should `addSubscriptionException` be the single entry point for ALL 5 types, with type-discriminated input shape — OR should we have separate service methods per type (`addSkipException`, `addPauseWindowException`, etc.)? Brief §3.1.4 lists `addSubscriptionException` singular; this plan defaults to singular but flags the alternative.

**Alias-method validation invariant (load-bearing):** `changeAddressOneOff` and `changeAddressForward` are NOT thunk-blind delegates to `addSubscriptionException`. Each alias performs its own input validation (Zod schema at the route layer + service-side type narrowing) BEFORE calling `addSubscriptionException`, which then re-validates the same input via its own canonical guard set (steps 4 + 5 + 8). This is defense-in-depth, not redundancy: the alias layer rejects shape errors specific to the address-override surface (e.g., `address_override_id` missing) early; the canonical service rejects the same error if the alias is bypassed (e.g., a direct `addSubscriptionException(type='address_override_one_off', address_override_id=undefined)` call from another service). Two layers, both load-bearing.

---

## §4 Service B — Subscription lifecycle services + auto-resume scheduler

### §4.1 `pauseSubscription` — full surface

**Module:** `src/modules/subscriptions/lifecycle/service.ts` (NEW; sibling to exceptions/).

**Signature:**

```typescript
export interface PauseSubscriptionInput {
  pause_start: string;              // ISO date; must be >= today + cut-off
  pause_end: string;                // ISO date; must be > pause_start
  reason?: string;
  idempotency_key: string;
}

export interface PauseSubscriptionResult {
  exception_id: string;             // the pause_window row in subscription_exceptions
  correlation_id: string;
  new_end_date: string;             // extended by eligible-delivery-day count of pause window
  canceled_task_count: number;      // tasks in window flipped to CANCELED
  status: 'inserted' | 'idempotent_replay';
  http_status: 201 | 409;
}
```

**Behavior** per brief §3.1.4 + §3.1.7:

1. `assertPermission(ctx, 'subscription:pause')`.
2. Read subscription FOR UPDATE; reject if not `'active'`.
3. Validate `pause_end > pause_start` (range check).
4. Validate `pause_start >= today + cut_off_offset` (cut-off enforcement; §7).
5. Idempotency check.
6. Insert `subscription_exceptions` row with `type='pause_window'`, `start_date=pause_start`, `end_date=pause_end`.
7. UPDATE all `tasks` where `subscription_id = $1 AND delivery_date BETWEEN pause_start AND pause_end AND internal_status NOT IN ('DELIVERED', 'FAILED')` → `internal_status='CANCELED'`. **Reason for chosen tasks NOT deleted:** audit trail preserved per brief §3.1.7. Operator-visible state change.
8. Compute extension days. **Locked arithmetic:** `extension_days = count of dates D in [pause_start, pause_end] (inclusive) where ISODOW(D) ∈ subscription.days_of_week`. Same eligibility test as the cron's materialization handler (§2.3 of cron-decoupling plan + §2 of this plan's §3.1.6 reference). Implementation pattern: `generate_series(pause_start, pause_end, INTERVAL '1 day')` filtered by `EXTRACT(ISODOW FROM d)::int = ANY(s.days_of_week)`, count rows. UPDATE `subscriptions.end_date = current_end_date + extension_days`.
9. UPDATE `subscriptions.status = 'paused'`, `subscriptions.paused_at = now()`.
10. Schedule auto-resume job (§4.3 below).
11. Emit `subscription.paused` + `subscription.end_date.extended` (triggered_by='pause_resume') with shared correlation_id.
12. Return result.

### §4.2 `resumeSubscription` — full surface

**Signature:**

```typescript
export interface ResumeSubscriptionInput {
  idempotency_key: string;
  is_auto_resume?: boolean;         // internal: only the scheduler sets this true; client requests must omit
}

export interface ResumeSubscriptionResult {
  correlation_id: string;
  actual_resume_date: string;       // today's date in tenant tz (manual) OR pause_end (auto)
  new_end_date: string;             // recomputed if manual resume shrinks the original pause window
  status: 'inserted' | 'idempotent_replay' | 'already_active';
  http_status: 200 | 409;
}
```

**Behavior** per brief §3.1.4 + §3.1.7:

1. If `is_auto_resume === true`: `assertSystemActor(ctx, 'auto-resume-scheduler')` (skip user permission check).
2. Else: `assertPermission(ctx, 'subscription:resume')`.
3. Read subscription FOR UPDATE; if `status='active'` already, return `status='already_active'` with 200 (idempotent — no-op).
4. Read the active `pause_window` exception row. **Locked SQL:** the row where `subscription_id = $1 AND type = 'pause_window' AND today BETWEEN start_date AND end_date AND NOT EXISTS (SELECT 1 FROM audit_events WHERE event_type = 'subscription.resumed' AND (metadata->>'correlation_id')::uuid = subscription_exceptions.correlation_id)`. ORDER BY start_date DESC LIMIT 1 (defensive even though the predicate above resolves to AT MOST one row in a paused subscription). Fail-loud if none — operationally impossible in a paused subscription; surfaces as 500.
5. Determine `actual_resume_date`:
   - If `is_auto_resume`: `pause_end` (the originally scheduled end).
   - If manual: `today` (in tenant tz).
6. Recompute extension: for manual resume BEFORE `pause_end`, the extension shrinks. Compute `eligible_days_remaining = count_eligible_days_in(actual_resume_date, original_pause_end)`. New end_date = `current_end_date - eligible_days_remaining`.
7. UPDATE `subscriptions.status='active'`, `subscriptions.paused_at=NULL`. UPDATE `subscriptions.end_date` per recompute.
8. Cron picks up newly-uncovered horizon dates on next tick (no direct task INSERT here).
9. Emit `subscription.resumed` (actor=user uuid OR system) + IF end_date changed → `subscription.end_date.extended` (triggered_by='pause_resume') with shared correlation_id (same as the pause's correlation_id).
10. Return result.

### §4.3 Auto-resume scheduler — DECISION REQUIRED at plan-PR amendment

Brief §8 lists this as open. Two viable patterns:

#### Option A — Cron-based polling

A new cron at `/api/cron/auto-resume` running every N minutes (suggest 15) walks `subscription_exceptions` for `type='pause_window' AND end_date <= today AND NOT EXISTS (resume audit event)` and calls `resumeSubscription` for each. Per-tenant timezone awareness via the same Dubai-date helper as the materialization cron.

**Pros:** Reuses existing cron-handler patterns (CRON_SECRET auth, withServiceRole, Sentry). Self-healing (missed tick recovers on next tick). No new infrastructure.

**Cons:** 15-minute resolution at best — resumed subscription's first task on resume_date might miss the materialization window if materialization cron runs at 12:00 UTC and auto-resume runs at 12:15 UTC (subscription resumes "after" today's materialization). Mitigation: materialization handles this naturally (next-tick will pick up the newly-uncovered date).

#### Option B — QStash delayed delivery

At pause-creation time (`pauseSubscription` step 10 in §4.1), schedule a QStash message with `delay = pause_end - now()` targeting a `/api/queue/auto-resume` endpoint with body `{ subscription_id, correlation_id }`. The endpoint receives the signed message on the scheduled day, calls `resumeSubscription({ is_auto_resume: true })`.

**Pros:** Exact-timing — the message fires at the scheduled instant, not the next 15-min cron tick. No polling overhead. QStash already provisioned (cron-decoupling Phase 5 uses it).

**Cons:** Delay reliability depends on QStash's delayed-delivery max (verify pre-decision: their docs cap delays at 7 days OR 30 days per public docs — Phase 2 pauses up to N months would not fit). Manual resume BEFORE the scheduled QStash fires must invalidate the message (or the auto-resume endpoint must check `subscription.status === 'paused'` first and skip if already resumed — Option B's de-facto idempotency layer). On crash mid-pause-creation between subscription_exceptions INSERT and QStash schedule: the pause is in DB but no auto-resume scheduled — the cron-based polling fallback per §4.4 handles this.

**LOCKED DECISION at plan-PR amendment time: Option A (cron-based polling, 15-min resolution).**

**Reasoning** (frozen — re-opening requires a `decision_*.md` filing per `feedback_no_self_tier_escalation.md`):
- Operational simplicity for MVP — reuses existing cron-handler patterns; no new operational surface.
- Demo posture — May 12 demo doesn't exercise multi-month pauses; auto-resume timing precision is not a demo-blocking factor.
- Materialization cron handles resume-day timing naturally — even with 15-min drift, the next 12:00 UTC tick after resume picks up newly-uncovered horizon dates.
- Self-healing on missed ticks — every 15 min the polling cron re-scans; a crashed tick recovers on the next.
- Avoids QStash-delay-cap pre-decision verification cost — Option B requires verifying QStash's delayed-delivery max (7 vs 30 days per public docs) before code PR can open; Option A has no such gate.
- Phase 2 may revisit if real merchants complain about 15-min resume drift; revisit gate is observability data, not architectural ambition.

§10.3 reflects this lock — not an open question.

### §4.4 Crash safety — pause-creation half-state

If `pauseSubscription` crashes between Steps 6 (insert pause_window row) and Step 10 (schedule auto-resume), the subscription is paused in DB but no auto-resume is scheduled. Under Option A (cron-based polling), the next 15-min tick scans for missing-resume rows and recovers. Under Option B (QStash delayed delivery), a fallback cron-based scan is required as belt-and-braces (§4.3 cons paragraph above).

**Recommendation:** even with Option B, ship the cron-based scan as the recovery layer. It's cheap (a `SELECT … WHERE end_date <= today AND status='paused'` per tenant per 15 min) and converts a rare half-state failure from "operator must intervene" to "self-heals on next tick."

### §4.5 Cross-method invariants

- **Pause + skip interaction:** `addSubscriptionException` (type='skip') step 3 rejects when subscription is `'paused'` (per brief §3.1.6 edge case F).
- **Pause + resume interaction:** `pauseSubscription` rejects when subscription is `'paused'` already (idempotent only via idempotency_key replay; otherwise 409).
- **Resume + skip interaction:** Operator can skip immediately after resume; no race because resume completes the tx before service returns.
- **Auto-resume + manual resume race:** Step 3's `if status='active' return already_active` makes this idempotent. The cron's auto-resume hits the row after a manual resume already flipped it; auto-resume short-circuits.

---

## §5 Services C + D + E — Consignee CRM, Merchant management, Address services

### §5.1 Service C — `changeConsigneeCrmState`

**Module:** `src/modules/consignees/crm/service.ts` (NEW).

**Signature:**

```typescript
export interface ChangeConsigneeCrmStateInput {
  to_state: 'ACTIVE' | 'ON_HOLD' | 'HIGH_RISK' | 'INACTIVE' | 'CHURNED' | 'SUBSCRIPTION_ENDED';
  reason: string;                   // required; written to consignee_crm_events.reason
}

export interface ChangeConsigneeCrmStateResult {
  consignee_id: string;
  from_state: string;
  to_state: string;
  event_id: string;                 // consignee_crm_events row id
  status: 'updated' | 'no_op';
  http_status: 200;
}
```

**Behavior:**

1. `assertPermission(ctx, 'consignee:change_crm_state')`.
2. Read consignee FOR UPDATE; reject 404 if not in tenant.
3. Validate state transition: certain transitions require additional gating (e.g., `CHURNED → ACTIVE` requires explicit reactivation per brief §3.1.4 — service rejects 422 with explicit error). Initial transition matrix lives in `src/modules/consignees/crm/transitions.ts` (NEW); §10.4 open question for the precise allowed/disallowed pairs.
4. If `from_state === to_state`: `status='no_op'`, no DB write, no audit. Returns 200 with empty change.
5. UPDATE `consignees.crm_state = to_state`.
6. INSERT `consignee_crm_events` row.
7. Emit `consignee.crm_state.changed` audit event.
8. Return result.

### §5.2 Service D — Merchant management

**Module:** `src/modules/merchants/service.ts` (NEW). All Transcorp-staff scoped (cross-tenant); `withServiceRole` for the tx (the actor is system-staff per `assertSystemActor`-equivalent for this surface).

#### §5.2.1 `createMerchant`

**Signature:**

```typescript
export interface CreateMerchantInput {
  name: string;
  slug: string;                     // UNIQUE in tenants table; lowercase-kebab convention
  pickup_address: {
    line: string;
    district: string;
    emirate: string;
  };
}

export interface CreateMerchantResult {
  tenant_id: string;
  status: 'provisioning';
  http_status: 201;
}
```

**Behavior:**

1. `assertPermission(ctx, 'merchant:create')` (systemOnly).
2. Validate `slug` matches `/^[a-z0-9-]+$/` and length 1–60. UNIQUE check at INSERT-time via constraint.
3. Validate pickup address fields non-empty trimmed.
4. INSERT `tenants` row: `status='provisioning'` (DB default per migration 0017), `pickup_address_line/district/emirate` populated.
5. Emit `merchant.created` audit event.
6. Return result.

#### §5.2.2 `activateMerchant`

```typescript
export async function activateMerchant(
  ctx: RequestContext,
  tenantId: Uuid,
): Promise<{ tenant_id: string; previous_status: 'provisioning'; new_status: 'active'; http_status: 200 }>;
```

1. `assertPermission(ctx, 'merchant:activate')`.
2. Read tenant FOR UPDATE; reject 404 if not found OR 409 if `status !== 'provisioning'`.
3. UPDATE `tenants.status = 'active'`.
4. Emit `merchant.activated` audit event.

#### §5.2.3 `deactivateMerchant`

```typescript
export async function deactivateMerchant(
  ctx: RequestContext,
  tenantId: Uuid,
): Promise<{ tenant_id: string; previous_status: 'active'; new_status: 'inactive'; http_status: 200 }>;
```

1. `assertPermission(ctx, 'merchant:deactivate')`.
2. Read tenant FOR UPDATE; reject 409 if `status !== 'active'`.
3. UPDATE `tenants.status = 'inactive'`.
4. Emit `merchant.deactivated` audit event.

**Side effects: NONE** in MVP per brief §5.4 Q3 ("Deactivation in MVP is reversible — sets tenant.status to INACTIVE, blocks new operator logins, preserves all data."). The block-new-logins part is enforced at `buildRequestContext` time via the existing `tenants.status` filter — **§10.5 verification gate is REQUIRED before code-PR opens**. If the filter is NOT present in `buildRequestContext`, the code PR adds it as part of THIS surface (one-line predicate in `resolveSession`'s public.users → tenants JOIN: `AND tenants.status = 'active'`) — NOT deferred. Without the filter, deactivation has no operator-visible effect, which contradicts brief §5.4 Q3 directly. The verification + (if-needed) one-liner is part of this code PR's scope.

#### §5.2.4 `listMerchants` (read-only, cross-tenant)

```typescript
export async function listMerchants(
  ctx: RequestContext,
  filters?: { status?: TenantStatus },
): Promise<readonly { tenant_id: string; slug: string; name: string; status: TenantStatus; pickup_address: {...}; created_at: string }[]>;
```

1. `assertPermission(ctx, 'merchant:read_all')`.
2. SELECT all tenants (or filtered by status).
3. Return ordered by created_at DESC.

### §5.3 Service E — Address services

**Module:** `src/modules/subscriptions/addresses/service.ts` (NEW; sibling to exceptions/lifecycle/).

#### §5.3.1 `changeAddressRotation`

```typescript
export interface ChangeAddressRotationInput {
  rotation: ReadonlyArray<{ weekday: 1|2|3|4|5|6|7; address_id: string | null }>;
  // null on a weekday means "remove rotation; fall through to primary"
}
```

**Behavior:**

1. `assertPermission(ctx, 'subscription:change_address_rotation')`.
2. Read subscription FOR UPDATE; reject if not `'active'`.
3. Read all addresses for the consignee; validate every `address_id` in input belongs to the consignee (RLS catches cross-consignee, but explicit check gives a 422 instead of an opaque 500).
4. UPSERT `subscription_address_rotations` per weekday provided. DELETE rows for weekdays explicitly set to `null`.
5. NO audit event registered for rotation changes per brief §3.1.2 (open question §10.6 — should we add `subscription.rotation.changed`?). Default: no audit emission for MVP.
6. Return updated rotation snapshot.

#### §5.3.2 `changeAddressOneOff` and §5.3.3 `changeAddressForward`

Both delegate to `addSubscriptionException` with the appropriate `type` — see §3.6. The aliases exist for ergonomic naming in the API route layer + frontend; the underlying service is the exception-creation pipeline. No separate implementation; the API route layer thunks to `addSubscriptionException` with a type-fixed input.

---

## §6 API route layer

All routes live under `src/app/api/`. Pattern mirrors existing routes (e.g., `src/app/api/consignees/route.ts`) for header-comment style, `buildRequestContext` resolution, Zod validation at the boundary, error mapping via `errorResponse`.

### §6.1 Route inventory

| Route | Method | Service called | Auth permission (middleware) | Body / params |
|---|---|---|---|---|
| `/api/subscriptions/[id]/skip` | POST | `addSubscriptionException` (type='skip') | `subscription:skip` | `{ date, reason?, idempotency_key, target_date_override?, skip_without_append? }` |
| `/api/subscriptions/[id]/pause` | POST | `pauseSubscription` | `subscription:pause` | `{ pause_start, pause_end, reason?, idempotency_key }` |
| `/api/subscriptions/[id]/resume` | POST | `resumeSubscription` | `subscription:resume` | `{ idempotency_key }` |
| `/api/subscriptions/[id]/append-without-skip` | POST | `appendWithoutSkip` | `subscription:override_skip_rules` | `{ reason, idempotency_key, target_date_override? }` |
| `/api/subscriptions/[id]/address-rotation` | PATCH | `changeAddressRotation` | `subscription:change_address_rotation` | `{ rotation: [...] }` |
| `/api/subscriptions/[id]/address-override` | POST | `addSubscriptionException` (type='address_override_one_off' or `_forward`) | conditional (see §6.2) | `{ scope: 'one_off'\|'forward', date, address_id, idempotency_key }` |
| `/api/consignees/[id]/crm-state` | POST | `changeConsigneeCrmState` | `consignee:change_crm_state` | `{ to_state, reason }` |
| `/api/admin/merchants` | POST | `createMerchant` | `merchant:create` | `{ name, slug, pickup_address }` |
| `/api/admin/merchants` | GET | `listMerchants` | `merchant:read_all` | query: `?status=` |
| `/api/admin/merchants/[id]/activate` | POST | `activateMerchant` | `merchant:activate` | (no body) |
| `/api/admin/merchants/[id]/deactivate` | POST | `deactivateMerchant` | `merchant:deactivate` | (no body) |

11 net-new route files. The conditional auth on `/address-override` per §6.2 is the only non-trivial middleware.

### §6.2 Conditional auth — the address-override + skip-override cases

Two routes have permission selection that depends on input shape:

**`/api/subscriptions/[id]/skip`** — middleware passes if actor has EITHER `subscription:skip` OR `subscription:override_skip_rules`. Service re-asserts the FINER permission per §1's resolver. Middleware is "any of"; service is "exactly the resolved one."

**`/api/subscriptions/[id]/address-override`** — middleware checks based on `scope` query param (or body field): `one_off` → `subscription:change_address_one_off`; `forward` → `subscription:change_address_forward`. Service re-asserts.

### §6.3 Validation + error mapping

Zod schema at the boundary catches shape errors (wrong type, missing required field) before the service layer. The service still validates business rules. Validation errors → 400. Service-thrown `AppError` subclasses map per `errorResponse`:

| Error | HTTP |
|---|---|
| `ValidationError` (input shape) | 400 |
| `UnauthorizedError` (no session) | 401 |
| `ForbiddenError` (lack permission) | 403 |
| `NotFoundError` (subscription/consignee/tenant id not in tenant) | 404 |
| `ConflictError` (idempotency-key replay; status mismatch) | 409 |
| `UnprocessableError` (cut-off violation; computeCompensatingDate exhausted) | 422 |
| (any other throw) | 500 |

### §6.4 Request-id propagation

`buildRequestContext` already populates `ctx.requestId`. Service emit-points carry it into audit-event metadata. Sentry-capture wraps it. No additional wiring needed.

### §6.5 Idempotency-key surface (per §7 detail)

All mutating routes that touch `subscription_exceptions` REQUIRE a client-supplied `idempotency_key` in the body. Missing key → 400 ("idempotency_key required"). Server does not generate a default. This is by design — operator must own retries explicitly; silent server-default would create a different exception_id per retry, breaking the 409-replay contract.

**Locked Zod contract (load-bearing):** the Zod schema for every mutating route MUST mark `idempotency_key` as required: `z.string().uuid()`. NO `.optional()`, NO `.default()`, NO server-side fallback. A future contributor adding a new mutating route MUST add `idempotency_key` to its schema with the same posture; reviewers reject any new mutating route that omits or weakens the contract.

**Regression signal:** §9 test plan adds a single integration test that POSTs to a representative mutating route (e.g., `/api/subscriptions/[id]/skip`) WITHOUT the `idempotency_key` field and expects HTTP 400. Pinning behavior at the route boundary; if a future contributor accidentally weakens the schema, the test fails loud.

Read-only routes (`GET /admin/merchants`) do not require idempotency_key.

---

## §7 Idempotency + cut-off enforcement

### §7.1 Idempotency-key UNIQUE — already in schema

Migration 0015 created `subscription_exceptions_idempotency_idx UNIQUE (subscription_id, idempotency_key)`. Service relies on the constraint for correctness:

- Step 6 of `addSubscriptionException` is a `SELECT … WHERE subscription_id = $1 AND idempotency_key = $2 LIMIT 1` — if row exists, return existing fields with 409.
- If the SELECT returns nothing, the subsequent INSERT runs. Concurrent retry race: both invocations SELECT zero rows; both attempt INSERT; one wins, the other hits SQLSTATE 23505 → catch block returns same 409 path with the existing fields (re-SELECT after the conflict).

The pattern is identical to the existing `task_generation_runs` ON CONFLICT pattern from migration 0012; no new infrastructure.

### §7.2 Cut-off enforcement (per brief §3.1.8)

Brief: "Skips before cut-off apply immediately. Skips after cut-off rejected with clear error."

**MVP cut-off:** hardcoded 18:00 local-tenant-time the day before delivery, per brief §3.1.8 + brief §4 deferral table (configurable per merchant is Phase 2).

**Implementation:**

```typescript
// Pseudo-code; actual impl uses the SAME TS-side Date.UTC + offset
// pattern as src/modules/task-materialization/dubai-date.ts from
// cron-decoupling. Adding a locale dependency (Intl.DateTimeFormat)
// or a third-party library (date-fns-tz) is a SEPARATE decision
// requiring its own decision_*.md filing — not part of this PR's scope.
function isWithinCutoff(deliveryDate: string): boolean {
  // Dubai is UTC+4 with no DST.
  const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
  const cutoffUtcMs =
    new Date(deliveryDate).getTime()
    - 24 * 60 * 60 * 1000   // -1 day
    + 18 * 60 * 60 * 1000   // 18:00 local
    - DUBAI_OFFSET_MS;       // local → UTC
  return Date.now() >= cutoffUtcMs;
}
```

Cut-off check fires in `addSubscriptionException` step 4, `pauseSubscription` step 4, and `appendWithoutSkip` (when target_date_override is supplied). Reject with `UnprocessableError` carrying message "delivery date is past the 18:00 cut-off the day before; skip cannot be applied."

**Phase 2 path:** per-merchant configurable cut-off lives in `tenants.cut_off_offset_minutes` (column-add migration). Service reads tenant config; falls back to 18:00 default if NULL. `followup_configurable_cutoff_time_per_merchant.md` already filed.

### §7.3 Pause-window cut-off semantics

Per `pauseSubscription` step 4: `pause_start >= today + cut_off_offset`. Operator cannot pause TODAY (the cut-off forbids same-day cancellation of materialized tasks). Pause `pause_start = tomorrow` + cut-off applies tomorrow's tasks.

Edge: if operator pauses at 17:30 with `pause_start = today + 1`, the cut-off check for tomorrow's task is at 18:00 today — not yet. The check passes. If operator pauses at 18:30 with same input, cut-off has elapsed, reject 422.

### §7.4 Idempotency on read-after-write race

A specific concurrency concern: client A sends POST, network slow; client A retries. Server processes both:

- Tx 1 reads idempotency-key → not found → INSERT → COMMIT.
- Tx 2 reads idempotency-key (started before Tx 1 commit) → not found → INSERT → 23505 → catch → re-SELECT → returns existing.

Postgres' default READ COMMITTED gets this right because the re-SELECT after the constraint violation runs in a fresh implicit snapshot (or after an explicit transaction restart in some drivers). The drizzle `tx.execute` pattern handles this naturally — the catch block re-runs the SELECT; no manual SAVEPOINT needed.

**Verification:** §9 row 12 integration test pins concurrent-retry behavior.

---

## §8 Webhook deduplication touch-points

### §8.1 Race surface

The webhook receiver (existing, per `src/app/api/webhooks/suitefleet/route.ts` at HEAD) processes SF status updates that may arrive concurrently with operator-driven service calls. Specific races:

| Service call | Concurrent webhook | Failure mode |
|---|---|---|
| `addSubscriptionException` (type='skip') marks task SKIPPED | SF webhook arrives marking same task DELIVERED | Operator skip happens AFTER delivery — edge case; service step 13 reads task FOR UPDATE; if internal_status is already DELIVERED, reject 422 ("cannot skip a delivered task"). |
| `pauseSubscription` cancels tasks in window | SF webhook updates status of one of those tasks mid-flight | Pause's bulk UPDATE is `WHERE internal_status NOT IN ('DELIVERED', 'FAILED')`; webhook concurrent UPDATE landing on the same row hits the same FOR-UPDATE lock; whichever wins owns the final state. SKIPPED → DELIVERED is allowed (delivery happened despite skip flag); CANCELED → DELIVERED is blocked by the existing webhook handler's status-transition guard (per existing webhook code). |
| `resumeSubscription` does NOT touch tasks directly | Webhook for tasks in resumed range continues normally | No race; clean. |
| `changeConsigneeCrmState` does NOT touch tasks | (any webhook) | No race; clean. |

### §8.2 Webhook receiver invariants the new services preserve

- **`webhook_events.dedup_key UNIQUE` (per migration 0019):** unaffected — services don't write webhook_events.
- **`tasks.internal_status` CHECK (admits 'SKIPPED'):** services rely on this admission per §3.2 step 13 (skip flow writes SKIPPED).

### §8.3 No new dedup infrastructure

No service in this plan introduces a new dedupe surface beyond the existing `subscription_exceptions_idempotency_idx`. The webhook receiver's existing dedupe + the service's idempotency-key UNIQUE jointly cover the race surface.

---

## §9 Test plan

Mirrors the `cron-decoupling` plan's §7 structure: unit + integration + happy-path E2E + edge-case rows. Estimated ~30 row tests across the plan.

### §9.1 Unit tests (mocked DB; per service)

Module-level tests at `src/modules/{subscriptions/exceptions,subscriptions/lifecycle,consignees/crm,merchants,subscriptions/addresses}/tests/service.spec.ts`. Each service gets:

- Permission denial test (caller lacks permission → 403)
- Input validation test (Zod boundary)
- Subscription-status-mismatch test (e.g., skip on paused subscription → 409)
- Idempotency-replay test (same key twice → 409 with existing fields)
- Audit-emit-fires test (mock auditEmit; verify called with right body)

### §9.2 Integration tests (real DB; per workflow)

`tests/integration/`:

- `subscription-exceptions-skip.spec.ts` — covers all 4 brief §3.1.6 worked examples + edge cases A through I from §3.3.
- `subscription-exceptions-address-override.spec.ts` — one_off + forward variants; verifies materialization handler picks up the override on next tick (uses real cron handler invocation, mocked QStash a la §7.4).
- `subscription-lifecycle-pause-resume.spec.ts` — pause + manual resume + auto-resume scheduler (mocked clock for the 15-min cron tick).
- `consignee-crm-state.spec.ts` — state transitions + invalid transitions per §10.4 matrix.
- `merchant-management.spec.ts` — create + activate + deactivate + listMerchants; cross-tenant `merchant:read_all` enforcement.
- `subscription-address-rotation.spec.ts` — UPSERT + DELETE per weekday; null-rotation falls through to primary.

### §9.3 Edge cases — explicit row tests

| # | Test | Pinned behavior |
|---|---|---|
| 1 | `computeCompensatingDate` returns first eligible day past current end_date | brief §3.1.6 worked example 1 (Mon-Fri ending Fri, skip Wed → next Mon) |
| 2 | computeCompensatingDate skips blackouts | edge case A |
| 3 | Stacked skips: Tue + Thu of same week → end_date extends by 2 eligible days | edge case B |
| 4 | Operator double-tap → 409 with same exception_id | edge case C |
| 5 | Skip on past date → 422 cut-off | edge case G |
| 6 | Skip on very last delivery → end_date extends by 1 eligible slot; new task materializes on next cron tick | edge case H |
| 7 | Pause: tasks in window flipped CANCELED, paused_at set, end_date extended by eligible-day count | brief §3.1.7 |
| 8 | Manual resume BEFORE pause_end → end_date shrinks by remaining eligible-day count | §4.2 step 6 |
| 9 | Auto-resume scheduler picks up `pause_end <= today` row → calls resume with system actor | §4.3 + §4.4 |
| 10 | Address rotation UPSERT: change Mon's address; assert next cron tick materializes Mon's task with new address | §5.3.1 + materialization §2.3 Layer 3 |
| 11 | Address override one-off: insert exception for Wed; cron next-tick materializes Wed task with override address (Layer 1 of §2.3) | §3.6 + cron §2.3 |
| 12 | Concurrent retry race: two POSTs with same idempotency_key → both return same exception_id with 409 | §7.4 |
| 13 | CRM transition CHURNED → ACTIVE rejected without explicit reactivation flag | §5.1 step 3 + §10.4 matrix |
| 14 | createMerchant: slug UNIQUE collision → 409 | §5.2.1 step 4 |
| 15 | activateMerchant: tenant in `provisioning` → moves to `active`; tenant in `active` already → 409 | §5.2.2 step 2 |
| 16 | deactivateMerchant blocks new login → buildRequestContext rejects on `status='inactive'` (verify; §10.5) | §5.2.3 |
| 17 | **Idempotency-key required regression pin** — POST to a representative mutating route (`/api/subscriptions/[id]/skip`) WITHOUT `idempotency_key` field → expect HTTP 400 with `idempotency_key required` error. Locks the §6.5 Zod contract; future contributor weakening any mutating route's schema fails this test loud. | §6.5 |

### §9.4 Happy-path E2E

`tests/integration/exception-model-happy-path.spec.ts` — single end-to-end exercising the full Day-15 stack. **Date arithmetic locked to brief §3.1.6 worked example 1 cadence** (Mon-Fri schedule, Fri end_date, skip Wed → appended Mon):

1. Pre-seed tenant + consignee + active subscription `days_of_week=[1,2,3,4,5]`, `end_date=2026-05-29` (**Friday** — the original final delivery).
2. POST /skip with `date=2026-05-13` (**Wednesday** — a Wed in the middle of the active window). Assert 201 + `new_end_date=2026-06-01` (**Monday** — first Mon-Fri eligible day after the prior end_date Fri 5/29; weekend skipped per `days_of_week`) + correlation_id present.
3. Assert `subscription_exceptions` row inserted, `subscriptions.end_date` updated to 2026-06-01, target task on 2026-05-13 has `internal_status='SKIPPED'`.
4. Assert `audit_events` has both `subscription.exception.created` + `subscription.end_date.extended` with shared correlation_id.
5. Trigger cron handler (mocked QStash); assert the new tail-end task materializes for 2026-06-01 with rotation/primary fallback (the day was previously beyond `materialized_through_date`; cron now picks it up).

**Why these specific dates:** mirrors brief §3.1.6 worked example 1 ("Mon-Fri ending Fri 15 May, skip Wed 6 May → appended Mon 18 May") with a 2-week shift to keep the demo data anchored in the May 2026 sprint window. Test asserts the EXACT new_end_date, not just "extension happened" — pins the algorithm's correctness as a regression-grade signal.

---

## §10 Open questions for resolution at plan-PR amendment time

1. **§10.1 — `max_skips_per_subscription` cap:** Brief §3.1.6 edge case D references it; brief §4 lists it as Phase 2. MVP service does NOT enforce the cap (column reads NULL → unlimited). **Confirm:** ship without enforcement; Phase 2 lands the column-not-null + service check together. Default: confirmed.
2. **§10.2 — `addSubscriptionException` single entry vs. per-type methods:** Brief §3.1.4 lists singular `addSubscriptionException`. This plan defaults to singular with type-discriminated input. Alternative: separate methods (`addSkipException`, `addPauseException`, etc.) for cleaner type-narrowing in TypeScript. Default: singular per brief.
3. **§10.3 — Auto-resume scheduler — DECISION LOCKED: Option A (cron-based polling, 15-min resolution).** Reasoning: operational simplicity, demo posture, materialization cron handles resume-day timing naturally, self-healing on missed ticks, avoids QStash-delay-cap pre-decision verification cost. Phase 2 may revisit if real merchants complain about 15-min drift; revisit gate is observability data, not architectural ambition. Re-opening requires `decision_*.md` filing per `feedback_no_self_tier_escalation.md`. **Not an open question; locked at plan-PR amendment time.**
4. **§10.4 — CRM state transition matrix:** Brief lists 6 states. Brief §3.1.4 (changeConsigneeCrmState bullet) explicitly says "can't go from `CHURNED` back to `ACTIVE` without explicit reactivation" — the only inter-state gating the brief calls out by name. Default matrix:
   - From any: → `INACTIVE`, `SUBSCRIPTION_ENDED` always allowed
   - From `ACTIVE`: → `ON_HOLD`, `HIGH_RISK`, `CHURNED` allowed
   - From `ON_HOLD`: → `ACTIVE`, `HIGH_RISK`, `CHURNED` allowed
   - From `HIGH_RISK`: → `ACTIVE`, `ON_HOLD`, `CHURNED` allowed
   - **From `INACTIVE`: → `ACTIVE` allowed** — routine reactivation (operator-clicked-by-accident recovery). Permission gate (`consignee:change_crm_state`) alone is sufficient; no keyword required. Distinct from CHURNED reactivation because INACTIVE is operational state (e.g., paused merchant relationship), not lifecycle-significant.
   - **From `CHURNED`: → `ACTIVE` ONLY** via explicit reactivation: the `reason` field MUST contain the keyword "reactivation" (case-insensitive). Service rejects 422 if absent. Intentionally clunky to surface the reactivation as a distinct operational decision; CHURNED is lifecycle-significant per brief framing.
   - From `SUBSCRIPTION_ENDED`: terminal — no transitions.
   **Verification at amendment time:** if brief §3.1.4 or any other brief section explicitly says INACTIVE → ACTIVE also requires gating, this plan amends to match the brief. Default: as written above; Love confirms.
5. **§10.5 — `tenants.status='inactive'` blocks new login:** Verify `buildRequestContext` filters tenants by status. If not, the deactivateMerchant service must also write to a separate "blocked-tenant" surface OR the auth path needs amendment. Default: verify in code at plan-PR review and amend if gap.
6. **§10.6 — Audit event for rotation changes:** Brief §3.1.2 lists 9 events; rotation change is NOT among them. Open: should we add `subscription.rotation.changed` as a 10th event? Default: NO — rotation changes are routine config, not audit-grade. Phase 2 brief amendment may revisit.
7. **§10.7 — Decoupling vs. bundling:** This plan bundles A–F. Reviewer may decide to split (e.g., merchant management as a separate plan PR). Default: keep bundled — sequencing rationale §0.3 holds.
8. **§10.8 — Plan-sync bundle drift items already on the docket:** From the cron-decoupling iteration:
   - §5.5 outcome enum 5 → 11 states
   - §7.2 rows 9+12 401 → 403
   - §7.1 row 6 forward-override supersession wording
   - Posture B runbook §1 P3+P4 `created_at` → `occurred_at`
   - `scripts/posture-b-preflight-probe.mjs` ephemeral → durable header rewrite
   This plan does NOT add new plan-drift items unless surfaced during reviewer counter-review.

---

## §11 Pre-merge gate checklist (code-PR open)

Mirrors `cron-decoupling` plan §11.2 structure. For T3 hard-stop #2 verification-only counter-review when the code PR opens.

| # | Gate | Status check |
|---|---|---|
| 1 | All 10 §1 permissions still registered + unchanged | grep test in CI; expected count = 10 (unchanged from PR #139) |
| 2 | All 9 §2 audit events still registered + unchanged | grep test in CI; expected count = 9 (unchanged from PR #139) |
| 3 | Schema unchanged in this PR | git diff shows no `supabase/migrations/*.sql` additions/edits |
| 4 | All services have permission re-assertion in line 1 of public method | grep `assertPermission(ctx,` count matches public method count |
| 5 | All services run inside `withTenant` or `withServiceRole` (the merchant-management trio) | grep test |
| 6 | All audit emits use shared correlation_id per §2.2 mapping | spec assertions cover each multi-event flow |
| 7 | Idempotency tests pass | §9.3 row 4 + row 12 |
| 8 | Cut-off enforcement tests pass | §9.3 row 5 + the pause cut-off edge in §7.3 |
| 9 | Crash-safety: pause without auto-resume scheduled recovers on next tick | §9.3 row 9 (auto-resume scheduler — Option A path) |
| 10 | API routes all return per §6.3 error map | spec assertions |
| 11 | Day-16 frontend dependency: this PR ships before any UI PR opens | At code-PR open, run `gh pr list --state=open --repo lovemansgit/planner` and verify NO Day-16+ UI PR is currently open (search PR titles/branches for `feat(ui)`, `consignees/[id]`, `/calendar`, `subscriptions/[id]/skip`, `(admin)/merchants`, `address-rotation`, `crm-state`, etc.). If any exists, sequencing rationale §0.3 is broken — pause this code PR until the UI PR closes/parks. Verifiable signal, not narrative. |
| 12 | §10 open-question defaults locked at plan-PR amendment | each §10 item has a "Default" line; reviewer marks accept/reject before code PR opens |

---

**End of plan.**

Cross-references:
- [PLANNER_PRODUCT_BRIEF.md](../PLANNER_PRODUCT_BRIEF.md) — v1.2 source of truth (§3.1.2 audit events, §3.1.3 permissions, §3.1.4 service surface, §3.1.6 skip-and-append, §3.1.7 pause semantics, §3.1.8 cut-off, §3.1.9 API routes)
- [memory/plans/day-14-cron-decoupling.md](day-14-cron-decoupling.md) — merged plan PR #145 (`27c5b8c`); §8.1 sequencing rationale (gates this plan)
- [memory/decision_brief_v1_2_amendments_d13_part1.md](../decision_brief_v1_2_amendments_d13_part1.md) — Day-13 part-1 schema landed via PR #139 (`875bfc4`)
- [memory/handoffs/day-13-eod.md](../handoffs/day-13-eod.md) — Day-13 EOD with PR #139 schema details
- [memory/project_brief_audit_event_count_correction.md](../project_brief_audit_event_count_correction.md) — locks audit-event count at 9 (not 8)
- [memory/feedback_t3_plan_prs_need_realtime_review.md](../feedback_t3_plan_prs_need_realtime_review.md) — gates real-time counter-review for T3 plan PRs
- [memory/feedback_no_self_tier_escalation.md](../feedback_no_self_tier_escalation.md) — tier discipline; this is T3 because Love's call, not self-escalation
- `src/modules/identity/permissions.ts` lines 469–559 — the 10 permissions registered for this surface
- `src/modules/audit/event-types.ts` lines 320, 330, 635, 646, 657, 677, 702, 713, 724 — the 9 audit events

# Day-53 Session C plan — R-C: webhook receipt-then-apply transaction split (T3)

**Filed:** Day-53 EVE (11 Jun 2026), Session C, per the "Triage builds pulled forward" dispatch (R-B then R-C; R-B's code parked at #438 before this plan opened, per the sequencing constraint).
**Lane authority:** Love's ruling pulls the two silent-failure races forward; the triage findings memo (`memory/triage_five_races_findings.md` §R-C, merged `6c193ca`, #428) is the contract and this plan follows its fix shape verbatim (no design deviation this time — the receipt-then-apply split IS the recorded shape).
**Hard fences (dispatch):** no `supabase/migrations/**`, no spend, no R-A/R-E work, no `src/modules/tasks/**`, no Session B R6 surfaces, no commits interleaved with R-B's branch (separate branch off main; disjoint module). **No brief bump assigned** — none is taken.

All citations re-verified by body-read against main `6c193ca`. `git diff c1b8cc7..6c193ca` over `src/modules/integration/**`, the webhook route, and `src/shared/db.ts` is empty — the triage evidence holds byte-for-byte on current main.

## §1 Grounded evidence (current main)

1. **One transaction couples receipt + apply.** Both apply paths INSERT the durable `webhook_events` receipt and apply the task UPDATE inside a single `withTenant` transaction: status events at `src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts:316-524`, edit events at `apply-webhook-edit-event.ts:153-280`. `withTenant` (`src/shared/db.ts:123-128`) opens one tx, no savepoints.
2. **Any post-INSERT throw erases the receipt.** The 23505 catch (`apply-webhook-status-event.ts:525-530`, `apply-webhook-edit-event.ts:282-284`) handles only the dedup-UNIQUE; every other throw — e.g. a cast failure in the task UPDATEs — rolls back the receipt with the apply. The two structured-return short-circuits (`task_not_found` at status:383-398; malformed-payload at edit:175-200, locked §5.3 Option A) COMMIT the receipt — those postures are correct today and must survive the split unchanged.
3. **The drop is silent.** The route (`src/app/api/webhooks/suitefleet/[tenantId]/route.ts:286-317`) wraps each event in try/catch: log + `captureException`, continue the batch — SF gets 200 regardless, so **SF never retries**; there is no inbound DLQ; the rollback erases the raw payload AND the dedup anchor; audit never emits (post-tx, gated on `applied`). The only trace is Sentry.
4. **Dedup key:** UNIQUE `(suitefleet_task_id, action, event_timestamp)` per `supabase/migrations/0018_webhook_events.sql:36-50` + brief §3.1.10. (Read-only fact; no migration in this lane.)
5. **A real induction vector exists for RED tests:** `deliveryDate` is validated only by regex `^\d{4}-\d{2}-\d{2}$` (status path zod at `apply-webhook-status-event.ts:134,138`; edit path zod at `apply-webhook-edit-event.ts:50,76`). A payload value like `2026-13-45` passes the regex, survives extraction/diff (string comparison against the row), and **throws at the Postgres date cast** in the task UPDATE — rolling back the receipt today. Both files share the vector.

## §2 Fix shape (the memo's, verbatim — receipt-then-apply split)

In BOTH apply functions, split the single `withTenant` into two sequential ones:

- **Tx-1 — receipt:** INSERT `webhook_events` RETURNING id, alone, then commit. The 23505 catch moves here and keeps its exact semantics (`duplicate` structured return). Nothing else can throw inside Tx-1, so dedup attribution actually gets CLEANER: today the catch wraps the whole body and would mislabel any other unique violation as `duplicate`.
- **Tx-2 — apply:** everything after the INSERT, verbatim (task SELECT, embedded diff, UPDATEs; the `webhookEventsId` from Tx-1 flows in as a plain variable). A Tx-2 throw propagates exactly as today (route catch → Sentry → batch continues → 200) — but now **the receipt survives as the forensic artifact**: raw payload preserved, dedup slot occupied, queryable.
- The structured-return short-circuits keep their current commit-the-receipt behavior by construction (they're in Tx-2 and don't throw; the receipt already committed in Tx-1).
- Audit emits stay where they are: post-Tx-2, gated on `applied`. No route changes. No new events, no schema, no UI.

**The documented trade-off (ruled forward with the fix shape):** after a Tx-2 failure, a re-delivery of the same event returns `duplicate` and is NOT re-applied — the occupied dedup slot is deliberate. Nothing real is lost: SF never retries after a 200 anyway (§1.3), so there is no retry-heal today either; what we gain is the payload, the timeline anchor, and a queryable orphan (receipt with no matching audit/task effect). Replay/reprocessing tooling is explicitly OUT (future ops scope).

**Crash-window note:** a crash between Tx-1 and Tx-2 leaves the same orphan-receipt shape as a Tx-2 failure — one posture, not a new state.

## §3 Scope

**IN:** the two-transaction split in `apply-webhook-status-event.ts` + `apply-webhook-edit-event.ts` (mechanical restructure; the Tx-2 body is the current body minus the INSERT); tests (§4).

**OUT (explicit):** any inbound DLQ or replay/reprocessing surface; route changes (200 posture, per-event isolation, Sentry stay as-is); savepoints; new audit events; retry semantics toward SF; **no schema delta, no migrations** — if one appears necessary, STOP and park; no brief bump (none assigned). R-D's `markErr` sibling gap stays in its own lane.

## §4 Test plan (RED-first, watched failing before implementation)

**Integration — `tests/integration/webhook-receipt-split.spec.ts`** (new; real Postgres; per-run random UUIDs, accepted-leak teardown; seeds tenant/consignee/address/task with an AWB in `external_tracking_number`):
1. **Induced Tx-2 failure, status path:** DELIVERED event whose top-level `deliveryDate` is `2026-13-45` → `applyWebhookStatusEvent` rejects → **assert the `webhook_events` row EXISTS** (RED today: it rolled back), task `internal_status` unchanged, zero `task.status_changed_via_webhook` audit rows.
2. **Orphan-slot semantics:** re-deliver the same event (same dedup triple) → `{applied:false, reason:"duplicate"}`, still exactly one `webhook_events` row — pins the §2 trade-off as designed behavior.
3. **Induced Tx-2 failure, edit path:** TASK_HAS_BEEN_UPDATED with the same bad-date vector → receipt survives, task unchanged.
4. **Happy-path regression, status path:** valid DELIVERED event → `applied:true`, receipt row, task updated, audit emitted (the split must not break the normal flow).
5. **Short-circuit regression:** `task_not_found` (unknown AWB) → receipt preserved, `applied:false` — pins that the pre-existing forensic posture survived the restructure.

**Existing regression net (verified):** no unit specs target the apply functions — `src/modules/integration/providers/suitefleet/tests/` covers clients/parser/mapper only. The behavioral pins live in the existing integration specs (`webhook-status-event-applied`, `webhook-edit-event-applied`, `webhook-status-embedded-delta-applied`, `webhook-pod-received`, `webhook-receiver`, `skip-sf-outbound-and-webhook-convergence`) — all must stay green untouched; they are the proof the split changed no observable behavior on the success, duplicate, task-not-found, and malformed-payload paths.

## §5 Schema delta

**None.** The UNIQUE, the table, and the route are untouched; this is a transaction-boundary restructure inside two functions.

## §6 Risks / interactions

- **Atomicity is intentionally weakened** — that IS the fix; §2 records why nothing real is lost and what is gained. The reviewer should treat the orphan-receipt trade-off as the contract, not a side effect.
- **Tenant scoping:** both txs are `withTenant(tenantId, …)` — RLS posture unchanged; no cross-tenant surface.
- **Throughput:** one extra tx per webhook event (a short INSERT-commit). Webhook volume is low (SF event-driven); no batching surface exists today to regress.
- **Do-not-touch:** the apply functions live in `src/modules/integration/**` — disjoint from R-B's `src/modules/subscriptions/**` branch, Session B's R6 surfaces, and `src/modules/tasks/**` (the task UPDATEs here are raw SQL inside integration's own module, as today — no new imports).

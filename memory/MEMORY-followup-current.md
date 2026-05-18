# Active-lane followups digest

> **Purpose.** Rolling digest of the active substantive lane's open
> followups, blockers, and success criteria. Read at session start
> alongside `MEMORY.md` (the historical per-day index) for the
> current state of in-flight architectural work. Rotated lane-by-lane
> as code-PRs land and new lanes open.
>
> **Last updated:** Day-30 EOD (18 May 2026 PM).
> **Active lane:** A1 — SF status-mapping defect on the inbound
> webhook ingest path (BRD §4.1). Plan-PR #306 v3 FULLY RULED, all 10
> OQs locked; code-PR Phase-0-evidence-gated.

---

## Active lane summary

Aqib UAT (Slides 7, 8-reflect, 10) confirmed: SF status webhook events (Picked Up, Cancelled, Delivered, In Transit, Failed, …) are captured by the inbound webhook receiver but ALL render as generic "Updated" in the consignee-detail Task Timeline drawer; DELIVERED does not surface POD.

Static-code investigation at SHA `b86466a` (D29 §D(2) Phase-1, the prior prod base) refuted the single-mapping-layer hypothesis:

- The mapping IS present in **THREE separate, independently-maintained action-code vocabularies** — NOT a single empty/unwired layer.
- **(A) Parser `KNOWN_ACTIONS`** — 15 entries (`src/modules/integration/providers/suitefleet/webhook-parser.ts`).
- **(B) Status-mapper `ACTION_TO_INTERNAL_STATUS`** — 14 entries with **silent null-drop for unknowns** (`status-mapper.ts:59-90`).
- **(C) Drawer `ACTION_LABELS`** — 16 entries (`TaskTimelineDrawer.tsx:39-56`).
- **Code-evidence-grounded vocabulary drift:** drawer expects `TASK_STATUS_UPDATED_TO_ASSIGNED`; parser+mapper expect `TASK_HAS_BEEN_ASSIGNED`. One side is wrong about SF wire reality; static code alone can't say which.

Strongest hypothesis (NOT static-provable, hence the Phase-0 gate): SF wire emits `TASK_HAS_BEEN_UPDATED` for most/all lifecycle changes in production. Receiver dispatches on literal raw-string → all land in `applyWebhookEditEvent` → `webhook_events.action = "TASK_HAS_BEEN_UPDATED"` → drawer renders "Updated". `tasks.internal_status` never advances. `tasks.pod_photos` never extracts. Status-specific codes either don't fire or use vocabulary the mapper doesn't know — silent drop via `apply-webhook-status-event.ts:81-83` early return BEFORE the `webhook_events` INSERT, so there's **no forensic trail**.

Day-29 cancel-twin precedent confirmed SF emits BOTH a status code AND a `TASK_HAS_BEEN_UPDATED` twin for the same operator action — but the question is whether the same holds for non-cancel lifecycle transitions on the production SF tenant config. That's the Phase-0 evidence question.

## Source documents

- **Plan-PR (in flight, v3 fully ruled, OPEN at SHA `72bbf8e`):**
  - PR #306 — [`memory/plans/day-30-a1-status-mapping-defect.md`](plans/day-30-a1-status-mapping-defect.md)
- **Diagnosis ground-truth followups (pre-existing surfaces touched by this lane):**
  - [`memory/followup_inbound_webhook_edit_apply_two_bugs.md`](followup_inbound_webhook_edit_apply_two_bugs.md) — Day-27/28 prior diagnosis on the same webhook receiver (first single-diagnostic-surprise live application; foundation for the 3-vocabulary refutation).
  - [`memory/followup_internal_task_status_lossiness.md`](followup_internal_task_status_lossiness.md) — pre-existing PROCESS_FOR_RETURN / RETURNED_TO_SHIPPER lossiness; explicitly OUT of A1 scope per plan §5.
- **Prior production code-PR providing the SHA baseline:**
  - PR #305 (D29 §D(2) Phase-1, merged `b86466a`).
- **Brief sections to read (v1.15 on main; A1 lane does NOT trigger a brief amendment per OQ-7):**
  - §3.6 four-layer identifier model (for vocabulary alignment context)
  - §3.1.10 webhook payload format
  - §3.3.6 consignee detail Task Timeline (the rendering surface)
  - §3.3.8 cache-from-webhook commitment (POD remains the canonical example)

## Current state (Day-30 EOD)

- **Main HEAD:** `8ff4462` (post-merge of EOD PR #311 — Session B fixes-lane handoff).
- **Production HEAD:** `18b5f7d` on `dpl_GNcgn1LAZWKvVZzvWqWwKFReKzXr` (Day-30 fixes-lane cumulative LIVE). Production is one commit BEHIND main because #311 is memory-only.
- **Rollback anchor:** `dpl_JDJs8LCyiD4nZ4vJzGKnR8emFC3j` (source `b86466a`, D29 §D(2) Phase-1).
- **Brief on main:** **v1.15**. v1.16 cutoff-drift append pending in B2 PR #312.
- **Schema:** UNCHANGED from D29; migration 0026 still latest applied.
- **A1 plan-PR status:** v3 OPEN at SHA `72bbf8e`, FULLY RULED, all 10 OQs locked. §3.6 hard-stop #1 CLEARED.
- **No code shipped yet** for the A1 lane. Awaiting Phase-0 SQL results.

## Blockers (status snapshot)

### Blocker 1 — Phase-0 evidence SQL (Love-run on production)

**Status:** OPEN (gating — code-PR cannot start until results land).
**Scope:** Three read-only SQL queries against the production DB project. Disambiguates the hypothesis space (parser/mapper vocab realignment vs routing rewire vs both).

What to run (verbatim per plan §2, code-PR build is downstream of this):

- **Q-A** — DISTINCT `action` values in `webhook_events` over the last 14 days, with counts. Disambiguates whether SF wire is dominated by `TASK_HAS_BEEN_UPDATED` (status-code twin theory) or includes status-specific codes that the mapper currently silent-drops.
- **Q-B** — JOIN sample (`webhook_events` × `tasks`) on the same action-value population to check whether `tasks.internal_status` advanced post-event (indicator that mapper IS firing for some codes vs none).
- **Q-C** — DELIVERED-action sample with `tasks.pod_photos` column read, to verify whether POD extraction is wired at all on the production data.

**Impact on code-PR:** code-PR fix shape depends on Q-A/Q-B/Q-C results:
- If Q-A shows `TASK_HAS_BEEN_UPDATED` dominant + status-specific codes absent → fix is routing rewire (give status-specific lifecycle events their own dispatch path; current single-dispatch on raw-string is wrong).
- If Q-A shows status-specific codes present but Q-B shows they silent-drop → fix is parser/mapper vocab realignment (close the drift between drawer expectations + parser+mapper expectations).
- If Q-C shows POD extraction wired but data populates nothing → fix is data-shape (extractPodPhotos reads the wrong wire key).
- Combined results most likely indicate **both** routing + vocab fixes (the plan's recommended same-lane combined posture).

### Blocker 2 — none

No vendor blocker on this lane (this is a planner-side observability + dispatch fix, no SF protocol change required). The Aqib API-key auth-header followup ([`memory/followup_aqib_api_key_auth_header_pending.md`](followup_aqib_api_key_auth_header_pending.md)) remains the institutional-level load-bearing pointer but does NOT block A1.

## Success criteria for the code-PR (T3 §3.6 hard-stop #2)

Per plan #306 §7 + §9:

- [ ] **Phase-0 SQL results landed.** Q-A/Q-B/Q-C run on production, results pasted into the code-PR body, fix-shape selection justified against the results.
- [ ] **Mapping contract realignment** (if Phase-0 shows vocab drift). 15-row table (per plan §3) wired through: parser KNOWN_ACTIONS / mapper ACTION_TO_INTERNAL_STATUS / drawer ACTION_LABELS all in lockstep with the SF wire vocabulary.
- [ ] **Routing rewire** (if Phase-0 shows routing-dispatch-on-raw-string is the bug). Each status-specific lifecycle event gets its own dispatch path; `apply-webhook-status-event.ts:81-83` silent-drop early return either deletes (forensic trail required) or stays-with-instrumentation (per Phase-0 ruling).
- [ ] **POD same-lane fix** (builder recommendation in plan §4). DELIVERED extracts `tasks.pod_photos`; same lane unless OQ-5 collision-guard interaction with #305's `outbound_sync_state` write path surfaces an issue.
- [ ] **Integration specs I1-I5 at PR open** (per plan §7).
- [ ] **CI green** per brief v1.13 §7.1.
- [ ] **Post-merge Aqib UAT loop closed** — Aqib re-walks Slides 7, 8-reflect, 10 on the patched receiver; sign-off captured.

## Out of scope for the A1 lane (do NOT collide)

- **B1** address-edit display lane (separate Session A lane, not yet opened).
- **B2** merchant-cancel display lane → handled by PR #312 (B2 /tasks-page cancel + edit, OPEN, §3.6 #2 NOT yet performed — see [`memory/handoffs/day-30-eod.md`](handoffs/day-30-eod.md) §B.3).
- [`memory/followup_internal_task_status_lossiness.md`](followup_internal_task_status_lossiness.md) (PROCESS_FOR_RETURN / RETURNED_TO_SHIPPER collapse) — pre-existing, post-demo follow-on.
- `webhook_events` UNIQUE-shape flag — Day-29 §D(2) Phase-1 forensic §2 surface; explicitly out of A1.
- Outbound SF push path — Session B's lane; A1 stays inbound-only.
- **OQ-7 ruled: NO brief v1.16** for the A1 status-mapping fix. (B2 #308's OQ-6 = v1.16 brief append is a scope-distinct ruling; both coexist.)

## T1 follow-ons (post-merge of A1 code-PR)

These DO NOT block the A1 code-PR but land in a small T1 doc + ops sequence afterward.

### T1-followon-1: apply-webhook-edit-event.ts inbound TZ symmetric bug

Confirmed real Day-30 during Session B's A3 diagnosis (outbound was `buildSuiteFleetTaskBody` missing Dubai-local→UTC; the inbound `apply-webhook-edit-event.ts` has the symmetric inverse — it doesn't convert SF's UTC back to Dubai-local when applying the edit). **Routed to A1 lane per Session B's hand-off.** Treat as a follow-on plan-PR off the A1 code-PR landing — same Phase-0-evidence-driven posture if the bug touches the routing/mapper paths the A1 fix also touches; otherwise a thin T2 fix-PR.

Trigger: A1 code-PR lands + Aqib UAT closes.

### T1-followon-2: Shared-canonical-vocabulary refactor (OQ-9)

Plan §7 OQ-9 ruled YES (recommend the refactor): collapse parser KNOWN_ACTIONS + mapper ACTION_TO_INTERNAL_STATUS + drawer ACTION_LABELS into a single canonical-vocabulary source-of-truth module so future SF wire additions can't drift again. **Not in the A1 code-PR scope** (scope-discipline — A1 fixes the observed defect; OQ-9 is a defence-in-depth follow-on).

Trigger: A1 code-PR lands. Expected scope: 1 new module + 3 imports + 1 reorganization commit.

### T1-followon-3: Cross-project Vercel boundary note for the `deploy-clean` project

Day-30 surfaced a false-alarm production scare on the `deploy-clean` separate Vercel project (bound to a different repo; no production deployment). Document the cross-project boundary in the operational runbook so the project isn't accidentally aliased onto a planner-shaped URL in the future.

Trigger: next operational-runbook touch.

## Followup memos in flight

These memos are referenced by the A1 lane and should be re-read by anyone working in this area:

- [`memory/followup_inbound_webhook_edit_apply_two_bugs.md`](followup_inbound_webhook_edit_apply_two_bugs.md) — **🔴 LOAD-BEARING for the A1 plan §2 hop chain** (Day-27/28 ground-truth on the receiver; A1's 3-vocabulary refutation builds on this).
- [`memory/followup_single_diagnostic_surprise_discipline.md`](followup_single_diagnostic_surprise_discipline.md) — **third live application** on A1 plan-PR's 3-vocabulary refutation (after Day-27 webhook + Day-28 appendWithoutSkip).
- [`memory/followup_ci_bypass_justification_requires_confirmed_diagnosis.md`](followup_ci_bypass_justification_requires_confirmed_diagnosis.md) — BINDING institutional discipline; A1 code-PR's CI gate inherits this for any `--admin` consideration.
- [`memory/decision_review_discipline_ci_gate.md`](decision_review_discipline_ci_gate.md) — §3.6 hard-stop with CI gate (brief §7.1 codification); A1 code-PR's CI must be green before §3.6 #2 clears.
- [`memory/followup_aqib_api_key_auth_header_pending.md`](followup_aqib_api_key_auth_header_pending.md) — institutional-level load-bearing pointer (production-region credential provisioning). Does NOT block A1; sandbox-region demo flow runs on OAuth.

## Decommissioned (Day-30 PM)

These items previously appeared in the prior digest (per-merchant SF credentials lane, Day-25 EOD baseline) but are now retired from the active-lane focus:

- ~~Per-merchant SF credentials lane (v1.14 + v1.15)~~ — code-PR shipped end-to-end Day-26 + production cutover Day-27. Lane CLOSED.
- ~~Aqib SF API Key + Secret Key auth-header reply (Blocker 1 of prior digest)~~ — NOT closed (Aqib has not replied), but no longer the active-lane blocker. Sandbox-region OAuth path is the demo flow; production-region (transcorp/transcorpuae/transcorpqatar) provisioning remains gated, but A1 lane is inbound-only and unaffected. The Aqib pointer demotes from active-lane blocker to institutional-level load-bearing followup (filed at [`memory/followup_aqib_api_key_auth_header_pending.md`](followup_aqib_api_key_auth_header_pending.md)).
- ~~Vault availability verification on production DB (Blocker 2 of prior digest)~~ — verified clean Day-27 (Vault v0.3.1 present per audit findings memo at PR #288).
- ~~Vercel env-var retirement (T1 follow-on of prior digest)~~ — separate small ops PR, deferred to housekeeping queue; not load-bearing for any active lane.
- ~~`migrateRegionAuthMethod` flow (T1 follow-on 3 of prior digest)~~ — still future; not load-bearing.

---

## Meta: file lifecycle

This file rotates whenever the active substantive lane transitions. Prior rotation: Day-25 EOD (per-merchant SF credentials lane, code-PR pre-build state). This rotation: Day-30 EOD, A1 status-mapping defect lane (plan-PR #306 v3 fully ruled, code-PR Phase-0-gated). The historical per-day record stays in [`MEMORY.md`](MEMORY.md); this file is the always-current "active followups" digest.

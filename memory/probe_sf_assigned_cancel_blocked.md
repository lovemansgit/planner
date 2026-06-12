# Probe memo — SF cancel-on-ASSIGNED: FIRED Day-54 assembly — **REJECTED (403)**, task NOT consumed

**Filed:** Day-54 (12 Jun 2026), Session C, per dispatch step 3 — originally BLOCKED (precondition unmanufacturable from builder seat; history below).
**FIRED:** Day-54 assembly dispatch (12 Jun 2026, Session A) — Love's named clearance rode the firing; Aqib staged the precondition (sandbox task `MPL-40595232` ASSIGNED to a driver).
**Verdict: SF REJECTS a customer-API cancel on an ASSIGNED task.** HTTP **403 FORBIDDEN**, response verbatim below. The rejection is clean: no vendor-side state change, no webhook, local mirror untouched — **the staged assignment was NOT consumed**.

## The probe run (verbatim records)

Target: `MPL-40595232` (local task `7b723792-6d7c-408b-8195-fbd759d0f63e`, external_id `61743`, delivery 2026-06-12). Script: `scripts/probe-sf-assigned-cancel.mjs` (#460, dry-run-verified) retargeted by AWB per the memo's own design.

- **Local before:** `internal_status=ASSIGNED outbound_sync_state=synced` (dry-run 08:38:44Z, re-confirmed live 08:39:22Z).
- **SF before** (task-activities, 200): `CREATE` (taskStatus `ORDERED`, by "Meal Plan Schedular" planner@transcorp-intl.com, 2026-06-11T03:49:08) → `ASSIGN` (taskStatus null, by fleet-side user "Love" love.dxb@transcorp-intl.com id 11, **2026-06-12T07:52:49** — the staged assignment).
- **THE PROBE** — `PATCH /api/tasks/awb/MPL-40595232` body `{"status":"CANCELED"}` (sanctioned Q2 route, merge-patch content type), 2026-06-12T08:39:23Z:

  ```
  http_status=403
  {"method":"PATCH","message":["User not allowed to do such action."],"url":"http://api.suitefleet.com/api/tasks/awb/MPL-40595232","status":"FORBIDDEN","timestamp":"2026-06-12T08:39:23.943+00:00"}
  ```

- **SF after** (200): activities **identical** to before — CREATE → ASSIGN, no new entry. The refused PATCH left no vendor-side trace.
- **Webhook reflection:** none in 60s poll (correct — nothing changed).
- **Local after:** `internal_status=ASSIGNED outbound_sync_state=synced` — unchanged.

## What this settles for R-E / UAT

1. **The refusal branch is REAL and is the EXPECTED branch for driver-assigned tasks.** SF refuses customer-API cancels once a driver holds the task. R-E's churn cascade attempting recall on an ASSIGNED task will get a synchronous 403 → the push pipeline's existing cancel-failed handling flips the push `failed` + DLQ row → the honesty rule's **"vendor refused recall — final delivery"** flag + accurate local state. **UAT should expect the refusal branch** whenever a churn recall touches an assigned/in-driver-hands delivery; the accept branch applies to pre-assignment (ORDERED/CREATED) tasks (Q2 probe precedent: cancel accepted there).
2. **Probe rejections are non-destructive.** A 403 leaves the task fully intact both sides — no second staging needed; `MPL-40595232` remains ASSIGNED and serves as the assignment-lock walk target and/or a live UAT row.
3. Consistent with the R16 finding that SF cancel state is vendor-governed (un-cancel → 403): SF enforces task-state transitions server-side on the customer API.

## History — why it was originally BLOCKED (Day-54 AM, Session C)

1. **No task was in ASSIGNED.** Local mirror survey: 485 CREATED, 17 SKIPPED, 8 CANCELED, 6 DELIVERED, 1 IN_TRANSIT — zero ASSIGNED; the customer API has no assignment surface (verified against `wire-types.ts`, `task-client.ts`, `memory/decision_phase_1_aqib_doc_verified.md`).
2. **The substitute (IN_TRANSIT `MPL-11182722`) was denied by the permission classifier, correctly** — the dispatch authorized an ASSIGNED target.
3. **Closed by:** Love's Option-A path — fleet-side staging (ASSIGN activity 2026-06-12T07:52:49) + the assembly dispatch's named clearance of #460 for execution.

## Cross-references

- PR #460 — the staged script (closed against this memo; the fired run's full log is on the PR thread).
- `memory/decision_phase_1_aqib_doc_verified.md` — sanctioned route provenance (Day-21 Q2 probe).
- `memory/decision_d53_five_race_triage.md` / R-E churn ruling — the honesty-rule branches this calibrates.
- `tests/integration/churn-cascade.spec.ts` — the cascade's refusal-branch handling (vendor-confirmed cancels only).

---
name: Layer 1.5 AWB-only extraction decision (Day-18 webhook handler 3-layer plan)
description: Locks the Layer 1.5 contract for the A2 webhook-handler plan-PR — webhook-parser extracts AWB only as the SF task identifier, not the numeric id. Drift between Day-7 inferred field names (taskId/externalTaskId/task_id) and Day-7 empirical capture (id + awb) caused every event to drop on missing_task_id; AWB matches tasks.external_id storage shape per PR #172 translation discipline.
type: project
---

# Layer 1.5 — AWB-only extraction (decision memo)

## §1 Background

Day-7 empirical webhook capture from SuiteFleet sandbox surfaced two identifier fields on every payload: `id` (numeric, SF-internal) and `awb` (string, e.g. `MPL-25193918` — SF-side airway-bill / external task identifier). The webhook-parser scaffold at `src/modules/integration/providers/suitefleet/webhook-parser.ts` was authored before that capture landed and inferred the field names from SF camelCase convention: `taskId`, `externalTaskId`, `task_id`. None of those keys appear in real SF webhook bodies.

Drift sat undetected from Day-7 through Day-17 because:

- The receiver verifies + parses but does NOT propagate events to side-effect code (D8-8 stub posture; see `src/app/api/webhooks/suitefleet/[tenantId]/route.ts:272-288`).
- Parser logs `missing_task_id` as a warn-only event-skip, not a fail.
- `webhook_events` table holds zero rows in production (no INSERT path wired), so the silent-drop signal had no surface.

Day-18 Vercel-log dive (Layer-1 forensics, see `memory/followup_webhook_handler_status_pod_date_sync_bug.md` §2) surfaced `missing_task_id` firing on every received event. That's the empirical anchor for this decision.

## §2 Decision

The webhook-parser extracts **AWB only** as the SF task identifier.

- Lookup keys swap from `["taskId", "externalTaskId", "task_id"]` to `["awb"]`.
- Numeric `id` is **not** extracted as a typed field. It remains in `raw_payload` for forensic recovery if ever needed.

**Rejected:** dual-extraction (both `awb` + `id`). Would force Layer 2 to handle two lookup shapes against `tasks.external_id` for no current benefit. The numeric `id` has no Planner-side consumer; preserving it as a typed field would be optionality without a use case.

## §3 Architectural rationale

`tasks.external_id` is `text` (`supabase/migrations/0006_task.sql:140`) and stores AWB-shaped strings — the Day-17 PR #172 Planner-UUID → SF-external-id translation discipline locks this. Label printing, status reconciliation, and any webhook-driven Layer-2 mutation key off `tasks.external_id`. AWB matches that storage shape; numeric `id` does not.

If Layer 2 keyed off numeric `id`, every lookup would either (a) require a separate column (`tasks.suitefleet_numeric_id`) added + backfilled, or (b) round-trip through SF API to translate `id → awb` at every webhook receipt. (a) is schema bloat for no consumer; (b) violates brief §3.3.8 cache-from-webhook-never-live-fetch.

AWB extraction is the single low-risk move that aligns parser output with the storage shape Layer 2 will look up against.

## §4 Scope

**In Layer 1.5:**

- `extractTaskId` lookup-key list change (3-line diff in `src/modules/integration/providers/suitefleet/webhook-parser.ts`, lines ~92-101).
- 2-3 unit test cases pinning real Day-7 captured payload shape against AWB extraction (drop-replace fixture-driven assertions; current spec asserts against synthetic shapes).

**Out of Layer 1.5 (Layer 2 / Layer 3 scope, separate sections of A2 plan-PR):**

- `webhook_events` table INSERT path (Layer 1.5 is parser-only; receiver-write is the next contract).
- `tasks.internal_status` UPDATE service fn (Layer 2).
- POD URL extraction + `tasks.pod_photos` migration (Layer 3, new column per A2 plan-PR §scope).
- `TASK_HAS_BEEN_UPDATED` edit-event mapping (Layer 3).

## §5 Effort estimate

30-45 min implementation:

- Field-key swap: ≤5 min.
- Unit test refactor against captured fixture: ~20 min.
- Re-verify no other site reads parser output today (receiver only logs idempotency keys; processWebhookAsync is a stub): ~10 min.

## §6 Filing context

This memo is filed retroactively. The Layer 1.5 verdict was captured by Reviewer A in claude.ai during a Day-18 deep-dive but never written to disk; the only on-disk reference was a one-line summary in `memory/handoffs/bootstrap-session-b.md:46` ("AWB-only fix; Layers 2-3 still to design"). Day-18 Phase-1 survey for the A2 plan-PR surfaced the gap; this memo closes it before plan-PR drafting begins.

## §7 Cross-references

- `memory/followup_webhook_handler_status_pod_date_sync_bug.md` — Layer-1 forensics; sibling Layer-2/3 scope (amended Day-18 PM to correct path + column-name errors).
- `memory/followup_webhook_auth_architecture.md` — Day-7 capture context.
- `memory/handoffs/bootstrap-session-b.md:46` — one-liner this memo supersedes.
- `src/modules/integration/providers/suitefleet/webhook-parser.ts:92-101` — `extractTaskId` lookup-key list (current state).
- `supabase/migrations/0006_task.sql:140` — `tasks.external_id text` storage shape.

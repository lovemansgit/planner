---
name: webhook_events.suitefleet_task_id column stores AWB, not numeric SF task id
description: Column-name vs content drift surfaced during Day-21 Q2 sandbox probe. Not adapter-blocking; schema rename or column-doc clarification deferred. Filed as ride-along to PR (Day-21 SF outbound adapter code-PR).
type: project
---

# webhook_events.suitefleet_task_id column-naming drift

**Filed:** Day 21 (10 May 2026), AM, during Session A LANE 1 Q2 sandbox probe (probe-sf-cancel-status-field.mjs).
**Surface:** code-PR §3.6 thread under cancelTask side-finding section.
**Severity:** low — not adapter-blocking; schema migration NOT in scope for the Day-21 SF outbound code-PR.

## Finding

The `webhook_events.suitefleet_task_id` column is named as if it stores the SuiteFleet **numeric task id** (e.g. `"59383"` for the probed task). Empirically, it stores the **AWB string** (e.g. `"MPL-72915243"` for the same task).

Confirmed by Day-21 probe:

- Probed task: SF `id=59383`, AWB `MPL-72915243`
- After PATCH-cancel, SF fired 2 webhook events; both rows in `webhook_events` carry `suitefleet_task_id = "MPL-72915243"` (AWB), NOT `"59383"` (numeric id)
- Type at the column level: `text NOT NULL` (per [supabase/migrations/0018_webhook_events.sql](../supabase/migrations/0018_webhook_events.sql)) — content is opaque to the schema; mismatch is name-only

## Why

The webhook receiver pulls `suitefleet_task_id` from the SF webhook payload's identifier field, which the parser maps from one of the SF payload fields. The parser's choice was AWB at implementation time — likely because lookup-by-AWB on `tasks.external_tracking_number` is the natural reconcile path (consistent with the createTask AWB-exists reconcile branch at [src/modules/integration/providers/suitefleet/task-client.ts:542-639](../src/modules/integration/providers/suitefleet/task-client.ts#L542-L639)).

The column should arguably be `suitefleet_awb` or the parser should populate `id` numeric instead. Either way the name and content disagree today.

## Adapter-design impact

**None.** The Day-21 SF outbound adapter does not query `webhook_events`. The probe script's poll loop hit the mismatch by happening to filter on numeric id; production code paths do not.

The existing inbound webhook receiver ([apply-webhook-status-event.ts](../src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts)) reconciles via AWB → `tasks.external_tracking_number` lookup (line 68 in plan §3.3 quoted there). That lookup uses the AWB regardless of the column name, so the receiver works correctly today.

## Closure paths (Phase 2, not Day-21)

Either path is fine; both equivalent for downstream queries:

1. **Rename the column** `suitefleet_task_id → suitefleet_awb` via a follow-on migration. Touches grep surface but cleaner long-term.
2. **Add a column-level comment** documenting "stores AWB despite the legacy name" via `COMMENT ON COLUMN webhook_events.suitefleet_task_id`. Cheaper, less invasive.

Phase 2 trigger: schema-cleanup pass post-pilot OR another contributor running into this mismatch on a fresh probe / debugging session.

## Day-21 SF outbound code-PR

Reference this memo from §3.6 thread under cancelTask side-finding section. Do NOT bundle a schema rename into the SF outbound code-PR — that PR's scope is adapter + client + QStash + DLQ migration; renaming a long-standing column is cross-cutting and belongs in its own PR with a coordinated grep.

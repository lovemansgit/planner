---
name: SuiteFleet webhook handler 3-layer compounding gap — events not landing + no UPDATE-tasks fn + no POD/edit-event handling. Day-18 morning first priority.
description: Day-17 EOD smoke surfaced webhook handler is not capturing status changes, POD photos, or edit events from SF. Investigation revealed 3 compounding layers — production webhook_events table is 0 rows (Layer 1 events not landing), no service fn applies webhook events to tasks (Layer 2), POD URL extraction + edit-event field mapping not implemented (Layer 3). Estimated ~8 hr if all three are genuine; 3 hr if Layer 1 resolves as config fix.
type: project
---

# Webhook handler 3-layer compounding gap

## §1 Surfaced

Day-17 EOD smoke. Love changed task date + status on SF side; Planner reflected neither. Investigation surfaced production `webhook_events` table at 0 rows — no events of any code received from SF for the sandbox-588 tenant. NOT a regression from any Day-17 PR; pre-existing latent gap from Day-7+ when the receiver was originally scaffolded but never end-to-end verified post-credentials-decision.

## §2 Layer 1 — events not landing

### §2.1 Diagnostic

Production query against `webhook_events`:

```sql
SELECT event_code, COUNT(*), MAX(received_at)
FROM webhook_events
GROUP BY event_code;
```

Returns zero rows. No SF-originated events of any code (`TASK_STATUS_UPDATED_TO_*`, `TASK_HAS_BEEN_UPDATED`, etc.) are landing in the table.

### §2.2 Three plausible root causes (rank by likelihood)

**(a) SF webhook URL not registered for sandbox-588** — config gap on SF side. SF admin panel may have the URL field empty OR pointing to a previous preview alias. Ask Aqib to confirm registration; register via SF admin if missing. ~30 min total (mostly Aqib-comm latency).

**(b) Per-tenant credential mismatch in receiver** — env var or HMAC signing key drift in `/api/webhooks/suitefleet/[tenantId]/route.ts`. Receiver may be 401-rejecting valid SF events because the per-tenant signing secret in env doesn't match what SF is signing with. ~15 min log read + env audit (check Vercel deployment logs for 401s on the webhook path; verify env var keys match SF admin secrets).

**(c) Genuine architectural gap** — Day-7 `memory/followup_webhook_auth_architecture.md` flagged credentials-vs-IP-allowlist auth model unresolved; possibly never finalized for production. If true, receiver lacks an end-to-end auth posture and is rejecting (or never-receiving) events. ~4 hr investigation + fix.

### §2.3 Day-18 morning first action

15-min scoping check to determine which root cause. Decision rule:

- If (a) or (b): Layer 2-3 fix runs ~3 hr. Day-18 budget comfortable.
- If (c): full ~8 hr stands. Day-18 PM brand pass slips to Day-19.

Diagnostic order:
1. Vercel logs for `/api/webhooks/suitefleet/*` path — any 4xx/5xx in last 24h? Indicates SF IS firing but receiver is rejecting (rules out (a); points to (b) or (c)).
2. If logs are silent: likely (a) — SF isn't firing. Aqib check + admin panel verify.
3. If logs show 401s: likely (b) — credential mismatch. Audit env vars.
4. If logs show 500s with auth-model errors: likely (c) — architectural.

## §3 Layer 2 — no UPDATE-tasks-SET service fn

### §3.1 Diagnostic

Receiver at `/api/webhooks/suitefleet/[tenantId]/route.ts` (verify path) parses payload + writes to `webhook_events` but does NOT write `tasks.internal_status` updates from `TASK_STATUS_UPDATED_TO_*` events. Even if Layer 1 resolves and events land, no service function consumes them to mutate task state.

Codebase audit: zero `UPDATE tasks SET internal_status` in `src/modules/`. No call site applies a webhook event to a task row.

### §3.2 New service fn needed

```typescript
applyWebhookStatusEvent(taskId, newStatus, eventTimestamp, payload)
  → updates tasks.internal_status
  → audit-emits webhook.event.applied event
```

~2 hr implementation + tests.

### §3.3 Status mapping table

15 SF event codes per brief §3.1.10 → 11 internal_status canon values per Day-15 cron-decoupling §5.5 plan-sync. Pre-existing partial mapping in `src/modules/integration/webhooks/suitefleet/event-mapping.ts`; verify completeness and extend any missing codes.

## §4 Layer 3 — POD + edit-event handling

### §4.1 POD URL extraction

`TASK_STATUS_UPDATED_TO_DELIVERED` payload contains POD photo URL (verify SF payload shape in `webhook_events.raw_payload` once Layer 1 unblocked). Write to `tasks.photos` jsonb column.

### §4.2 Edit-event handling

`TASK_HAS_BEEN_UPDATED` payload may contain `delivery_date`, `address`, `time_window` changes. Map to:
- `tasks.delivery_date`
- `tasks.address_id`
- `tasks.delivery_start_time`
- `tasks.delivery_end_time`

### §4.3 UI surface

POD link/photo in DayActionPopover detail (already scaffolded in PR #177; populate when `tasks.photos` non-empty). Tasks page POD column per sibling memo §4 also depends on this.

### §4.4 Effort

~3-4 hr Layer 3 total.

## §5 Demo workaround for tonight's batched promotion

Day-18 PM demo data prep manually seeds:
- `webhook_events` rows (synthetic, mimicking SF payload shape)
- `tasks.photos` jsonb (cached POD URL strings, e.g. via SF live-fetch one-time then write)
- `tasks.internal_status='DELIVERED'`

For ~5 cherry-picked Fatima Al Mansouri / Sarah Khouri demo tasks. Calendar surfaces realistic delivered states + POD photos for demo Section 4 / Section 5 even if live webhook flow remains broken. This matches existing brief §6 Day-18 demo data prep item.

## §6 Sequencing for Day-18

1. **15-min Layer 1 scoping check** (Vercel logs → Aqib comm if needed)
2. **If config fix:** register SF webhook URL OR fix credential mismatch; verify `webhook_events` landing within 5-10 min after SF event
3. **Layer 2 service fn + tests** (~2 hr)
4. **Layer 3 POD + edit handling** (~3-4 hr)
5. **Manual seeding for demo data prep** (Day-18 PM, brief §6) — independent of Layer 1-3 outcome; covers demo even if live flow remains broken

## §7 Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §3.1.10 (15 SF event codes)
- `memory/PLANNER_PRODUCT_BRIEF.md` §3.3.8 (cache from webhook never live-fetch)
- `memory/PLANNER_PRODUCT_BRIEF.md` §5.1 demo Section 4 (POD click-into-day)
- `memory/followup_webhook_auth_architecture.md` (Day-7 unresolved auth model)
- `memory/followup_day_18_smoke_surfaced_ui_gaps.md` (sibling memo, §4 POD column)
- `src/app/api/webhooks/suitefleet/[tenantId]/route.ts` (receiver entry point)
- `src/modules/integration/webhooks/suitefleet/event-mapping.ts` (15 event code mapping)
- `src/modules/integration/providers/suitefleet/*` (adapter; payload schemas)

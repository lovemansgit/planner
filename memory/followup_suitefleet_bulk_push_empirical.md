---
name: SuiteFleet bulk-push empirical capture (D8-4a first run)
description: Placeholder for the first cron-pass empirical capture after D8-4a ships. Documents the actual SF response shape for the AWB-exists 4xx, validates the createTask URL-with-customerId-query-param shape, and provides the timeline-response sample needed to commit D8-4b's getTaskByAwb parser. Populate at first cron run.
type: project
---

# SuiteFleet bulk-push empirical capture

**Captured:** placeholder (populate at first D8-4a cron pass)
**Why this exists:** D8-4a deliberately defers several empirical questions to first-run capture rather than guess at PR-write time. This memo is the canonical landing place for those captures so D8-4b can land confidently.

---

## Why this is a placeholder

D8-4a ships with three explicit empirical assumptions that the first cron pass will validate:

1. **`?customerId=<id>` query parameter on `POST /api/tasks`** — defensive add per SF API docs reading (suitefleet.readme.io, 4 May 2026). Empirical sandbox probes (29 April 2026 — `sandbox-smoke-task-create.mjs`, `sandbox-smoke-dedupe-probe.mjs`, `sandbox-smoke-idempotency-key-probe.mjs`) all succeeded WITHOUT the query param (POST `/api/tasks` only, customerId in body). Production may enforce more strictly. First-run capture confirms whether the change was operationally correct.

2. **AWB-exists error format `Awb with value <AWB> exists already`** — confirmed via Aqib Group-1 captured in `memory/followup_c3_deferred_day8.md`. The D8-4a AWB regex `/Awb with value ([\w-]+) exists already/` is built against this format. First duplicate POST will validate the message shape against live SF.

3. **`GET /api/tasks/awb/{awb}/task-activities` response shape** — endpoint URL confirmed via SF API docs reading (4 May 2026), but response body shape (timeline events, with the SF task `id` we need to extract for the reconcile) is unconfirmed without a real call. D8-4b is gated on either:
   - (a) The first 23505 capture from D8-4a producing a real AWB we can manually GET against, OR
   - (b) A one-off probe script run against sandbox after D8-4a merges.

---

## Capture template (populate after first cron run)

### A) `POST /api/tasks` — successful create with query-param `customerId`

URL captured:
```
<paste actual URL from cron logs>
```

Response status: `<200 / 201 / other>`
Response body (excerpt, PII-redacted):
```
<paste body>
```

Notes:
- Did the query-param shape work? (`OK` / `400` / `401` / `other`)
- Any new fields in the response not present in the smoke-probe captures?
- Does `customerId` in body still need to match the query-param value?

### B) `POST /api/tasks` — duplicate AWB 4xx response

URL captured:
```
<paste actual URL>
```

Response status: `<400 / 409 / other>`
Response body (verbatim):
```
<paste body>
```

Regex match check:
- AWB extracted by `/Awb with value ([\w-]+) exists already/`: `<AWB or "no match">`
- Format matches Aqib Group-1 confirmation: `<yes / no>`

### C) `GET /api/tasks/awb/{awb}/task-activities` — timeline response

Probe method: `<live cron 23505 / one-off probe script>`
URL captured:
```
<paste full URL with the actual AWB>
```

Response status: `<200 / 404 / other>`
Response body (verbatim, first 4KB):
```
<paste body>
```

Field mining for D8-4b:
- SF task `id` (numeric) field path: `<e.g. body.task.id / body[0].taskId / etc>`
- AWB echoed in response: `<yes / no, where>`
- Any pagination wrapper: `<yes / no>`

### D) Throttle behaviour at 5 req/sec

Pilot-scale capture — push N tasks at the 200ms interval:
- N = `<number of unpushed tasks in first run>`
- Wall-clock duration: `<seconds>`
- Did SF rate-limit at any point? `<yes / no>`
- Any 429s observed? `<yes / no>`

### E) Two fail-closed guards — observed?

Each row notes whether the guard fired during the first run AND whether it behaved as designed.

| Guard | Fired? | Tasks affected | Audit event | Notes |
|---|---|---|---|---|
| `unknown_district` (per-task) | `<y/n>` | `<count>` | `task.push_failed` × N | |
| `missing_customer_code` (per-tenant) | `<y/n>` | `<count>` | `tenant.push_skipped` × tenants | |

### F) DLQ rows landed

| Reason | Count | Notes |
|---|---|---|
| `awb_exists` (in failure_detail) | | |
| `network` | | |
| `server_5xx` | | |
| `client_4xx` (non-AWB) | | |
| `unknown` (incl. `unknown_district`) | | |

---

## What unblocks D8-4b after this is populated

1. **Section C populated** with at least one real timeline response → unblocks the `getTaskByAwb` adapter method's response parser. D8-4b extracts the SF `id` field per the path documented in C, returns a `TaskCreateResult` shape, and the cron-push service wires the catch-and-reconcile-on-AwbExists branch.

2. **Section A's query-param shape** confirmed → unblocks any defensive rollback if the query param caused production rejections.

3. **Section B's regex match** confirmed → validates the parse-only AWB extraction; if the format changed, the regex needs updating in D8-4b.

---

## Cross-references

- `memory/followup_c3_deferred_day8.md` — full D8-4 design + Aqib Group-1 confirmations
- `memory/followup_createbulk_vs_single_loop.md` — single-loop locked default
- `memory/followup_createtask_idempotency.md` — single-attempt policy
- `src/modules/integration/providers/suitefleet/task-client.ts` — AWB regex + AwbExistsError class
- `src/modules/task-push/service.ts` — cron-push orchestration
- `tests/unit/cron-push-rejects-unknown-district.spec.ts` + `tests/unit/cron-push-rejects-missing-customer-code.spec.ts` — guard regression markers

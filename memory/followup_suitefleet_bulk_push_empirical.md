---
name: SuiteFleet bulk-push empirical capture (D8-4a first run)
description: First-run empirical capture after D8-4a + α (sandbox tenant moved to position 1). Captures: the prerequisite chain that took 6+ rounds to clear (migration drift, customer_code backfill, deploy promotion, tenant iteration ordering, env var name mismatch), and partial SF wire-shape evidence pending the SUITEFLEET_SANDBOX_CUSTOMER_ID Vercel env fix.
type: project
---

# SuiteFleet bulk-push empirical capture

**Latest update:** 2 May 2026 — first two cron triggers attempted; both blocked before reaching SF.
**Why this exists:** D8-4a deliberately defers several empirical questions to first-run capture rather than guess at PR-write time. This memo is the canonical landing place for those captures so D8-4b can land confidently.

---

## First-run prerequisites — what we cleared to get here

The first-run capture surfaced **six prerequisites** that had to clear before any SF call could fire. Logging the chain so future trigger attempts have a checklist:

| # | Gate | What broke | Fix applied |
|---|---|---|---|
| 1 | Migrations 0012 + 0013 not applied to production | DB schema 5 days behind git | Applied via node bridge (Studio precedent suspended permanently per Love) |
| 2 | `tenants.suitefleet_customer_code` not backfilled for sandbox | Guard 2 fires fail-closed | `UPDATE tenants SET suitefleet_customer_code = 'MPL' WHERE id = '8bfc84b0...'` |
| 3 | Production deploy 5d stale (no D8-4a code) | Cron route returns 404 | `vercel promote` to production from latest Preview |
| 4 | CRON_SECRET unretrievable via `vercel env pull` | curl returns 401 | Switched to Path C — Vercel UI "Run Now" |
| 5 | Sandbox tenant at position 194 in `created_at ASC` enumeration | Cron times out before reaching it | α: `UPDATE tenants SET created_at = '2024-01-01' WHERE id = '8bfc84b0...'` (now position 1) |
| 6 | `SUITEFLEET_SANDBOX_CUSTOMER_ID` missing from Vercel Production env | Push throws at credential resolution | **Pending — this is where the second trigger blocked.** |

339 stale test tenants are the upstream cause for #5 — see `followup_audit_rule_cascade_conflict.md` for the cleanup-mechanism gap.

---

## Second cron trigger — 2 May 2026 15:49:05 UTC

`request_id: 978aaaef-e164-4146-8f83-9af3a88d8f21`
`target_date: 2026-05-03` (Saturday — matches `days_of_week: [6, 7]`)
`tenant_count: 340`

α-fix worked: sandbox tenant processed FIRST. New finding surfaced at the credential-resolver layer.

```json
{"timestamp":"2026-05-02T15:49:15.454Z","level":"warn","component":"suitefleet_credential_resolver","operation":"resolve","tenant_id":"8bfc84b0-c139-4f43-b966-5a12eaa7a302","error_code":"missing_env_vars","missing_count":1}
{"timestamp":"2026-05-02T15:49:15.454Z","level":"error","message":"task push threw for tenant","component":"cron_generate_tasks","tenant_id":"8bfc84b0-c139-4f43-b966-5a12eaa7a302","error":"SuiteFleet sandbox credentials missing from environment: SUITEFLEET_SANDBOX_CUSTOMER_ID"}
```

**Root cause:** Env-var-name mismatch.
- Resolver in `src/modules/credentials/suitefleet-resolver.ts` reads:
  - `SUITEFLEET_SANDBOX_USERNAME` ✓ (in Vercel)
  - `SUITEFLEET_SANDBOX_PASSWORD` ✓ (in Vercel)
  - `SUITEFLEET_SANDBOX_CLIENT_ID` ✓ (in Vercel)
  - **`SUITEFLEET_SANDBOX_CUSTOMER_ID` ✗ (NOT in Vercel)**
- Vercel has `SUITEFLEET_SANDBOX_ACCOUNT_ID` (different semantic — never wired up to the resolver).
- Local `.env.local` has the correct name `SUITEFLEET_SANDBOX_CUSTOMER_ID=588`, which is why the sandbox smoke probes (`scripts/sandbox-smoke-task-create.mjs` etc.) work locally but production doesn't.

**Next action:** add `SUITEFLEET_SANDBOX_CUSTOMER_ID=588` to Vercel Production + Preview scopes, then re-trigger.

What we DO know from this trigger (partial empirical wins):
- α-fix verified: sandbox at position 1 → processed first ✓
- Generation phase succeeded for sandbox (no error before the push attempt) ✓
- The push-phase try/catch wrapping correctly catches credential errors and emits a `task push threw for tenant` log line + Sentry capture (verifies the error-classification path) ✓

What we still DON'T know — pending the env-var fix + third trigger:
- `POST /api/tasks?customerId=588` query-param threading actually accepted by SF
- AWB regex match (only fires on duplicate-AWB 4xx)
- `customer.code: 'MPL'` body field accepted
- Timeline response shape from `GET /api/tasks/awb/{awb}/task-activities` (D8-4b's parser dependency)

---

## Third cron trigger — 2 May 2026 15:57:46 UTC ✅ SF PUSH SUCCEEDED

`request_id: 0223ca99-88e9-47ae-ae0d-4aa16faff9a5`
`target_date: 2026-05-03` (Saturday — matches seed `days_of_week: [6, 7]`)
`tenant_count: 340`
`Production deploy: planner-n04cdgsyr` (with `SUITEFLEET_SANDBOX_CUSTOMER_ID=588` baked in)

### Sandbox tenant push — happy-path success

Sequence of events for tenant `8bfc84b0-c139-4f43-b966-5a12eaa7a302`:

```
15:57:54.388  suitefleet_credential_resolver  resolve  source=env                    ✓ env var fix worked
15:57:54.985  suitefleet_auth_client          login    status=200                    ✓ SF auth via username/password
                                                       access_expires_at=2026-05-03T15:57:54.894Z (24h JWT)
                                                       refresh_expires_at=2026-10-29T15:57:54.894Z (~6 months)
15:57:54.985  suitefleet_token_cache          login_session  outcome=ok              ✓ token cached
15:57:56.054  suitefleet_credential_resolver  resolve  source=env                    (second resolve for createTask args)
15:57:56.465  suitefleet_task_client          create_task                            ✓ POST /api/tasks succeeded
                                              customer_order_number=SUB-42cbe3a73504-20260503
                                              external_id=59254
                                              tracking_number=MPL-08187661
15:57:57.526  task_push_service               task-push createTask ok                ✓ markTaskPushed UPDATE OK
                                              task_id=0b57b42c-723d-429d-8130-1b96f4e2805a
15:57:57.526  task_push_service               task-push tenant pass complete         ✓ outcome rolled up
                                              attempted=1 succeeded=1 failed_to_dlq=0
                                              skipped_district=0 awb_exists=0
```

### Empirical findings (validations + new data)

**Validated D8-4a code paths:**
| Path | Status | Evidence |
|---|---|---|
| α (sandbox at position 1 via `created_at` UPDATE) | ✓ Worked | First per-tenant log entry was for `8bfc84b0...` |
| Credential resolver reads `SUITEFLEET_SANDBOX_CUSTOMER_ID` from env | ✓ Worked post-fix | `source: "env"` log line; no `missing_env_vars` warn |
| SF auth flow (username/password → 24h JWT) | ✓ Worked | `status: 200`, valid `access_expires_at` |
| `POST /api/tasks?customerId=588` request | ✓ Accepted by SF | createTask returned a task with new SF id |
| `customer.code: 'MPL'` body field | ✓ Accepted | Tracking number prefix is `MPL-...` confirming MPL was the merchant scope on the SF side |
| `markTaskPushed` UPDATE on local task row | ✓ Worked | `task-push createTask ok` log fired post-success |
| Task-push counters (attempted/succeeded/awb_exists/etc.) | ✓ Worked | Final tenant-pass-complete log shows expected shape |

**SF response data captured (canonical wire-shape):**
- SF task `id` is **numeric** (e.g. `59254`), stringified by the parser before storing in `tasks.external_id`
- AWB format: **`MPL-08187661`** — confirms `{customer.code}-{numeric}` pattern from the webhook capture memo (Tabchilli equivalent was `TBC-55891430`)
- Local-side task UUID: `0b57b42c-723d-429d-8130-1b96f4e2805a`
- Customer order number generation: `SUB-{first-12-chars-of-subscriptionId}-{deliveryDate-YYYYMMDD}` (e.g. `SUB-42cbe3a73504-20260503`)

**SF auth token TTLs (matches ADR-007):**
- Access token: 24h
- Refresh token: ~6 months

### What we did NOT capture this run

| Gap | Reason | D8-4b posture |
|---|---|---|
| AWB regex match against live SF response | First push was clean (no 23505/duplicate-AWB hit) — there was nothing for SF to reject as duplicate | Parser writes against the regex from Aqib Group-1 (`/Awb with value ([\w-]+) exists already/`) with an inline comment marking the empirical gap + a unit test pinning the parser shape |
| Timeline response shape from `GET /api/tasks/awb/{awb}/task-activities` | D8-4b reconcile path not yet wired; first push didn't surface a 23505 anyway | Parser writes against the SF API docs reading (4 May 2026 — "task-activities" endpoint shape is documented) with explicit "this is unverified, validate on first 23505" comment |

The "either outcome unblocks D8-4b" criterion holds: clean success means D8-4b's reconcile-path parser ships against the docs with anchored unit-test fixtures, not blind code.

### Bonus finding — Webhook receiver creds also missing in Vercel

After the cron push at 15:57:57, two POSTs hit `/api/webhooks/suitefleet/8bfc84b0-c139-4f43-b966-5a12eaa7a302` at 15:57:56 / 15:57:57 — those are SF firing initial webhook events for the just-created task. Both failed:

```
{"component":"suitefleet_webhook_credential_resolver","operation":"resolve",
 "tenant_id":"8bfc84b0...","error_code":"missing_env_vars","missing_count":2}
{"component":"suitefleet_webhook_receiver","operation":"resolve_creds",
 "tenant_id":"8bfc84b0...","error_code":"webhook_creds_unavailable"}
```

**Missing:** `SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_ID` and `SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_SECRET` (count of 2 matches the 2 webhook env vars).

These were never set in Vercel (per the earlier `vercel env ls` audit). Pre-D8-8 (webhook hardening), the webhook path is observation-only anyway — the missing creds prevent the receiver from logging anything useful, but no in-flight state is corrupted. **Day 9 follow-up alongside D8-8.**

### Cron timeout — second-trigger details

The second trigger (`978aaaef-e164-4146-8f83-9af3a88d8f21`, 15:49:05 UTC) timed out at the Vercel default of 300 seconds:
```
Vercel Runtime Timeout Error: Task timed out after 300 seconds
```
That's empirical confirmation of the timeout horizon. Post-D8-4b, the β fix (filter `listAllTenantIds()` to `WHERE suitefleet_customer_code IS NOT NULL`) drops enumeration from 340 → 1 tenants and avoids this entirely.

### What this empirically unlocks for D8-4b

1. **AWB format pattern confirmed** — D8-4b's `getTaskByAwb` adapter method can build the URL `${baseUrl}/api/tasks/awb/${encodeURIComponent(awb)}/task-activities` against an AWB shape that matches the regex.
2. **Numeric SF task `id` confirmed** — D8-4b's response parser knows to extract `id` as a number and stringify before storing.
3. **Auth + customer_code + customerId query-param plumbing all work end-to-end** — D8-4b builds on a foundation that's now empirically validated, not assumed.
4. **Sentry/error-classification path empirically tested via the second trigger** — D8-4b's reconcile-failure error paths can mirror the same classification.

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

2. **Section A's query-param shape** confirmed → unblocks any defensive rollback if the query param caused production rejections (see rollback paths below).

3. **Section B's regex match** confirmed → validates the parse-only AWB extraction; if the format changed, the regex needs updating in D8-4b.

---

## Rollback paths (per reviewer's D8-4a accept-with-note)

### Rollback A — `customerId` query-param landed but SF rejected

If the first cron run shows production SF returning a 4xx that wasn't seen in sandbox (the smoke probes 29 April 2026 succeeded WITHOUT the query param), the defensive add needs to roll back. Rollback is **two changes, not one** — both must land together to avoid breaking CI:

1. **Code** — `src/modules/integration/providers/suitefleet/task-client.ts`, inside `createTask`:

   ```ts
   // Roll back to:
   const url = `${baseUrl}/api/tasks`;
   ```

2. **Test assertion** — `src/modules/integration/providers/suitefleet/tests/task-client.spec.ts`, the "POSTs to /api/tasks with Authorization, Clientid, Content-Type headers" test:

   ```ts
   // Roll back to:
   expect(url).toBe("https://api.suitefleet.com/api/tasks");
   ```

   The current assertion expects `…/api/tasks?customerId=588` and will fail if the URL reverts without updating it.

3. **Empirical capture (this memo)** — Section A's "Did the query-param shape work?" should record the rejection + reasoning, with a pointer to the rollback PR.

T2 commit per the protocol (touches source files; not schema, not auth). One PR, two file edits.

### Rollback B — AWB regex doesn't match production response shape

If Section B captures a duplicate-AWB response that doesn't match `/Awb with value ([\w-]+) exists already/`:

1. **Code** — `src/modules/integration/providers/suitefleet/task-client.ts`, the `AWB_EXISTS_ERROR_REGEX` constant. Update to match the observed format.

2. **Test** — task-client.spec.ts AWB-exists test fixture string update.

3. **D8-4a guard tests** — `tests/unit/cron-push-rejects-unknown-district.spec.ts` does NOT test the AWB regex (separate concern — that's the per-task pre-flight skip). No update needed there.

T2 commit. Surface at PR open with the original + new regex side-by-side.

### Rollback C — `tenant.push_skipped` event misshaped

Unlikely (the metadata shape is already locked via the watch-item memo), but if first-run shows the audit shape needs adjustment:

1. **Code** — `src/modules/audit/event-types.ts`, the `tenant.push_skipped` registration block.
2. **Code** — `src/modules/task-push/service.ts`, the `emit({ ... })` call inside the missing_customer_code guard.
3. **Test** — `tests/unit/cron-push-rejects-missing-customer-code.spec.ts`, the assertion on `emitArg.metadata`.

T2 commit if metadata shape only; T3 if the systemOnly flag changes (audit-policy boundary).

---

## Cross-references

- `memory/followup_c3_deferred_day8.md` — full D8-4 design + Aqib Group-1 confirmations
- `memory/followup_createbulk_vs_single_loop.md` — single-loop locked default
- `memory/followup_createtask_idempotency.md` — single-attempt policy
- `src/modules/integration/providers/suitefleet/task-client.ts` — AWB regex + AwbExistsError class
- `src/modules/task-push/service.ts` — cron-push orchestration
- `tests/unit/cron-push-rejects-unknown-district.spec.ts` + `tests/unit/cron-push-rejects-missing-customer-code.spec.ts` — guard regression markers

---
name: createTask retry-on-uncertainty creates duplicate SuiteFleet tasks (Day-14 blocker)
description: SuiteFleet sandbox does NOT dedupe by customerOrderNumber — empirical probe 2026-04-29. Retry policy in task-client.ts can produce duplicate physical deliveries when a request reaches SuiteFleet but the response is lost. Block pilot launch on hardening this surface.
type: project
---

**Status: Day-14 cutoff blocker.** Must be hardened before pilot launch.

## Gap

The S-8 task client (`src/modules/integration/providers/suitefleet/task-client.ts`) retries `POST /api/tasks` on 5xx and network errors with delays `[250, 500, 1000]ms` (4 attempts max). If a request reaches SuiteFleet successfully but the response is lost in transit (gateway timeout, NAT drop, our process crashes between send-receive), the retry creates a **duplicate task with a different `id` and a different `awb`** — which materialises as a duplicate physical delivery to the consignee.

## Empirical evidence (2026-04-29)

Ran `scripts/sandbox-smoke-dedupe-probe.mjs`: posted same `customerOrderNumber=DEDUPE-PROBE-1777447850779` twice with 1-second gap, identical bodies. Both responses HTTP 200:

- First:  `id=59019 awb=MPS-58040211`
- Second: `id=59020 awb=MPS-05267778`

**SuiteFleet sandbox does not dedupe by customerOrderNumber.** Probe script committed alongside the task client for future re-verification (SF behaviour may change post-vendor-update).

## Why this is a Day-14 blocker

The pilot scenario per `decision_daily_cutoff_and_throughput.md` pushes 7,000 tasks/day at 5 req/sec inside a 16:00–17:00 window. Each task is a physical delivery to a real consignee. A single network blip during the cutoff push could create 1+ duplicate tasks, which translates to:

- Duplicate driver dispatch
- Duplicate physical delivery attempts (consignee receives the same package twice, or two drivers race to the same address)
- Cost — Transcorp pays for both deliveries
- CX harm — consignee confusion, merchant complaint
- Reconciliation cost — operations has to detect, cancel one, refund

The probability of a single blip per cutoff is low but non-zero, and the consequence is operationally serious. Pre-pilot sign-off requires this gap closed.

## Hardening options (pick one or stack)

| Option | Pros | Cons |
|---|---|---|
| **Disable retry on POST `/api/tasks`** | Trivial code change. Eliminates duplicate risk. | Loses transient-failure resilience; one transient SF 503 = task push fails for the day, requiring manual replay. |
| **Idempotency-Key header probe** | If SF honours RFC-style `Idempotency-Key`, retry-with-same-key returns the existing task. Industry-standard. | Untested against SF — they may ignore the header silently (then we still duplicate). Empirical probe needed. |
| **Pre-flight `GET /api/tasks?customerOrderNumber=…` before retry** | Defensive — never POST a duplicate even if SF doesn't help. | Extra round-trip per retry; SF needs a search endpoint that we'd have to discover the shape of. |
| **Client-side ledger + before-send check** | We track every POST attempt in our DB; on retry, check our own ledger before re-POSTing. | Adds DB write to the hot path; consistency is on us; doesn't help if our ledger write also failed. |

## Plan for pre-pilot hardening

**Phase 1 — empirical probe of `Idempotency-Key`:**
1. Modify the dedupe probe to send `Idempotency-Key: <uuid>` on both POSTs with the same UUID. If SF dedupes (same id, same awb), this is the cheapest fix.
2. If SF ignores the header (still creates duplicates), proceed to Phase 2.

**Phase 2 — based on Phase 1 result:**
- **If `Idempotency-Key` works:** wire it into `task-client.ts` — generate a UUID per `createTask` call, attach to header, reuse on retries within the same call. ~10 lines of code, one new test.
- **If `Idempotency-Key` doesn't work:** disable retry on POST `/api/tasks` as the immediate fix. Surface 5xx / network errors directly to the caller; let the application layer (cron job) decide whether to re-attempt at the per-task level. Replace with pre-flight GET check or vendor escalation.

**Phase 3 — vendor confirmation regardless:**
Email SuiteFleet account manager pre-Day-14 (folded into the existing pre-Day-14 communication that already covers webhook retry policy + error-code catalogue + auth rate limits). Specifically request:

- Whether `Idempotency-Key` header is supported on `POST /api/tasks` (and the rest of the API surface)
- Whether `customerOrderNumber` should be a unique key on their side (and if not, whether vendor can add server-side uniqueness)
- Whether sandbox and production have the same dedupe behaviour
- Recommended client-side patterns for at-least-once-delivery resilience

## Inline TODO

`src/modules/integration/providers/suitefleet/task-client.ts` carries an inline `TODO(pre-pilot)` marker above the `callWithRetry` function. The marker references this memo. Resolution lands as a focused PR before Day 14.

**Surfaced:** Day 4 / S-8 PR review (29 April 2026), empirical evidence captured the same day.

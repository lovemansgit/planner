---
name: createTask single-attempt policy — SF doesn't dedupe and doesn't honour Idempotency-Key
description: Two empirical sandbox probes 2026-04-29 confirmed SF does not dedupe by customerOrderNumber AND ignores the Idempotency-Key header. Code mitigation in place — createTask is single-attempt. Vendor written confirmation still required pre-pilot.
type: project
---

**Status: code mitigation in place; vendor confirmation outstanding (Day-14 list).**

## Gap

The S-8 task client (`src/modules/integration/providers/suitefleet/task-client.ts`) calls `POST /api/tasks`. If a request reaches SuiteFleet successfully but the response is lost in transit (gateway timeout, NAT drop, our process crashes between send-receive), a naive retry creates a **duplicate task with a different `id` and a different `awb`** — which materialises as a duplicate physical delivery to the consignee.

## Empirical evidence (2026-04-29)

### Probe 1 — does SF dedupe by `customerOrderNumber`?

Ran `scripts/sandbox-smoke-dedupe-probe.mjs`: posted same `customerOrderNumber=DEDUPE-PROBE-1777447850779` twice with 1-second gap, identical bodies. Both responses HTTP 200:

- First:  `id=59019 awb=MPS-58040211`
- Second: `id=59020 awb=MPS-05267778`

**Result: SF does NOT dedupe by customerOrderNumber.**

### Probe 2 — does SF honour `Idempotency-Key` header?

Ran `scripts/sandbox-smoke-idempotency-key-probe.mjs`: posted same body + same `Idempotency-Key: e43ac9cc-1b38-4fce-a7de-8ae4dbe35be1` UUID twice with 1-second gap. Both responses HTTP 200:

- First:  `id=59022 awb=MPS-56635891`
- Second: `id=59023 awb=MPS-23006236`

**Result: SF IGNORES the Idempotency-Key header.**

Both probe scripts are committed at `scripts/` for future re-verification (SF behaviour may change post-vendor-update).

## Code mitigation in place

`task-client.ts` has been refactored: `createTask` is now **single-attempt**. On 5xx or network error, it throws immediately — no retry helper, no backoff. The auth client (S-2) retains its retry behaviour because auth flows are server-side idempotent.

The trade-off accepted:

| Outcome | Cost |
|---|---|
| Single-attempt + transient SF outage | One missed task per outage; cron worker re-attempts on next pass; no duplicate delivery |
| Retry-on-uncertainty + lost response | Duplicate physical delivery; consignee receives package twice; Transcorp pays for both; CX harm |

The cost of one duplicate physical delivery is operationally serious; the cost of one transient SF outage on a single task is low (cron re-attempts). Trade-off favours single-attempt.

## Vendor confirmation outstanding (Day-14 list)

**Required from SF account manager — written, not verbal:**

> "Request from SF account manager: written commitment to honour Idempotency-Key OR documented dedupe behaviour on customerOrderNumber."

This is folded into the existing pre-Day-14 SuiteFleet communication that already covers webhook retry policy + error-code catalogue + auth rate limits. If the vendor commits to one of:

- (a) **Honouring `Idempotency-Key` going forward** — we re-enable retry with a per-call UUID header, dropping single-attempt back to retry-with-idempotency.
- (b) **Documenting `customerOrderNumber` as a unique key on their side** — we re-enable retry knowing the second POST will return the existing task (or 409).

If the vendor refuses both, single-attempt stays as the policy through pilot and beyond.

## Inline pointers

- `src/modules/integration/providers/suitefleet/task-client.ts` file-header comment block carries the two empirical probe results verbatim.
- The createTask function body has a `SAFETY:` comment above the single fetch call documenting the design.
- No `TODO(pre-pilot)` marker remains — the gap is closed in code; only vendor follow-up is outstanding (which is tracked here).

**Surfaced and resolved in code:** Day 4 / S-8 PR review (29 April 2026), empirical evidence captured and code mitigation deployed the same day.

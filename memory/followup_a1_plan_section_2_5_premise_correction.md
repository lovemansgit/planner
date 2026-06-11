---
name: A1 plan §2.5 premise correction — guard kept (race-condition belt) not removed
description: A1 plan-PR §2.5 claimed task-push guard at service.ts:364-394 should be removed because "the resolver throws upstream." Empirical trace surfaced the resolver runs DOWNSTREAM of the guard (Step 4 vs Step 1 in pushSingleTask). Pattern B selected: keep guard, document race-condition-belt role between β cron enumeration and per-task push. Plan §2.5 premise inverted; this memo captures the correction.
type: project
---

# A1 plan §2.5 premise correction — guard kept as race-condition belt

**Filed:** Day 18, 8 May 2026 (post A1 plan-PR #187 merge, pre A1 code-PR open)

## §1 What the plan §2.5 said

Plan §2.5 ("Task-push guard removed"):

> With Option A locked, this guard can never reach its skip branch — the
> resolver throws upstream. Remove the guard entirely. Dead code is worse
> than no code; the resolver-throws contract is the single source of
> truth for "this tenant isn't push-ready."

Plus an explicit verification clause:

> Verify before removing: trace the call stack from cron entry to
> resolver, confirm the resolver IS called upstream of every site that
> uses customer_code. ... If the trace surfaces a path where customer_code
> is read WITHOUT going through the resolver, surface back to reviewer
> before removing — that's a planning gap.

## §2 What the trace surfaced (the planning gap)

`pushSingleTask` (`src/modules/task-push/service.ts:347-...`) call sequence:

| Step | Line | Action |
|---|---|---|
| 1 | 367-394 | `SELECT suitefleet_customer_code FROM tenants` (the guard) |
| 2 | 399-413 | load task |
| 3 | 418-442 | load consignee |
| 4 | 469 | `adapter.authenticate(tenantId)` ← triggers `resolveSuiteFleetCredentials` |
| 4 | 474 | `adapter.createTask` |

The guard runs at Step 1; the resolver fires at Step 4. The plan's "resolver upstream of guard" framing was empirically wrong — they are sequential within the same function, with the guard FIRST.

The actual upstream filter is `list-cron-eligible-tenants.ts:80-82` (β filter at cron enumeration), which only enumerates tenants where `suitefleet_customer_code IS NOT NULL AND <> ''`. The guard's role is the per-task race-condition belt: catch the window where `customer_code` was non-null at β enumeration time but cleared between enumeration and queue-worker pickup.

The existing code comment at `list-cron-eligible-tenants.ts:14-18` already documents this rationale:

> That guard stays — it's the per-tenant defence-in-depth (race-condition
> belt: if a tenant has a customer_code at enumeration time but the value
> gets cleared between enumeration and per-tenant-push, the guard catches it).

So the plan §2.5 premise contradicted an already-shipped runtime contract that had a written rationale.

## §3 Pattern B selected (Day-18 reviewer ruling)

Three patterns evaluated at Checkpoint 1 of A1 code-PR:

- **Pattern A** — Plan §2.5 verbatim: remove guard, wrap `adapter.authenticate` in try/catch around CredentialError, map to `failed_to_dlq`. Cascade: 8 files (union variant drop, queue switch case drop, UI handler drop, audit string-union update, 2 spec-file rewrites).
- **Pattern B** — Keep guard, reframe rationale in code comment, file this memo. Cascade: 1 comment block edit + 1 new memo.
- **Pattern C** — Hybrid: keep guard AND add CredentialError catch around `adapter.authenticate`. Cascade: medium.

**Pattern B selected.** Reasoning:

1. **Plan-PR is merged on disk; plan §2.5 cannot be amended in place** per merged-plan-immutability discipline (precedent: PR #190 fixup for `MEMORY.md` filename references — fixed only the live bootstrap doc, left plan-PRs frozen). A trailing memo capturing the correction is the discipline-compatible vehicle.
2. **Pattern A's cascade was 3-4× larger than plan §2.5 implied.** Reviewer counter-review at plan-PR open did not catch the cascade; plan was approved at smaller scope than Pattern A actually entails.
3. **β filter + guard + resolver throws is intentional defense-in-depth, not redundancy.** Each layer catches a different class of failure (enumeration-time, race-window, runtime-config-drift).
4. **MVP cycle constraints** — A1 already runs alongside Session B's parallel test-tenants cleanup; bundling Pattern A's cascade compounds review burden.

## §4 End-state — three layers of defense-in-depth

Post A1 code-PR merge:

1. **β cron filter** (`src/app/api/cron/generate-tasks/list-cron-eligible-tenants.ts:80-82`) — enumeration-time exclusion of tenants without `customer_code`. Catches: tenants in onboarding step (1) — row created, customer_code not yet backfilled.
2. **Per-task guard** (`src/modules/task-push/service.ts:364-394`) — race-condition belt at queue-worker pickup. Catches: race window where customer_code was non-null at β enumeration but got cleared before queue-worker dequeue.
3. **Resolver throw** (`src/modules/credentials/suitefleet-resolver.ts` post-A1) — fail-loud at adapter.authenticate. Catches: direct probe scripts, future non-cron callers, or any state where layers 1+2 failed.

## §5 Plan-PR gate adjustments (this code-PR)

A1 plan-PR §6 gates 7 + 8 reframed in the code-PR description:

- **Gate 7** — "Task-push guard removed; call-stack trace documented at removal site" → reframed to "Guard kept as race-condition belt per Pattern B; rationale comment added at the guard; trace documented in this memo."
- **Gate 8** — "Cron tenant-walk error handler catches resolver exceptions per-tenant, NOT per-task" → reframed to "Cron tenant-walk does not call resolver post-Day-14 cron-decoupling (push moved to QStash worker). Resolver throws are handled per-task by queue worker via existing `CredentialError` → DLQ via `failureCallback` path. Gate verified clean."

## §6 Cross-references

- `memory/plans/day-18-a1-customer-id-resolver-swap.md` §2.5 (premise was wrong; plan frozen post-merge per merged-plan-immutability)
- `memory/plans/day-18-a1-customer-id-resolver-swap.md` §6 (gates 7 + 8 reframed in code-PR description, not plan)
- `memory/followup_per_tenant_merchant_id_routing.md` (root-cause memo)
- `src/app/api/cron/generate-tasks/list-cron-eligible-tenants.ts:14-18` (race-condition belt rationale, written pre-A1)
- `src/modules/task-push/service.ts:364-394` (the guard kept; comment updated to reference this memo)
- `src/modules/credentials/suitefleet-resolver.ts` (the swap)
- PR #190 (`MEMORY.md` filename fixup precedent for merged-plan-immutability)

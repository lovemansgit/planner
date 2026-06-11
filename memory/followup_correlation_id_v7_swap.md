---
name: correlation_id v4 → v7 swap deferred (A1 ambiguity resolution)
description: Service A (Day-16 Block 4-B) uses crypto.randomUUID() (v4) for correlation_id minting because no uuidv7 helper exists in the codebase and adding the `uuid` npm dependency was deemed out of scope for a service-layer PR. Schema accepts any uuid (column type plain `uuid`, not v7-restricted). Sequence-ordering benefit of v7 is not load-bearing for the May 12 demo; the swap is a 5-line change post-demo when a uuidv7 generator lands.
type: project
---

# correlation_id v4 → v7 swap deferred

**Surfaced:** Day-16 Block 4-B Service A staging.

**Current state:** `src/modules/subscription-exceptions/service.ts` (Day-16 Block 4-B commit) mints `correlation_id` via `crypto.randomUUID()` (Node built-in, uuid v4).

**Schema posture:** Migration `0015_subscription_exceptions_and_materialization.sql:57-65` declares `correlation_id` as plain `uuid`, with the comment: "uuid v7 per service-layer convention; the column type here is plain uuid, not restricted to v7." The schema accepts either v4 or v7.

**Why deferred:**

- No `uuidv7` helper exists in `src/`. No `uuid` npm package is in `package.json` dependencies.
- Adding `uuid` mid-PR is scope creep for a service-layer PR.
- v7's monotonic-time-prefix sequence-ordering benefit is not load-bearing for the May 12 demo (correlation queries don't depend on ordering — they depend on equality match across two events in the same tx).
- Swap is a 5-line change once a `uuidv7` generator lands: replace `crypto.randomUUID()` call sites with the generator.

**Block 3 precedent:** Same pattern as the deferred-with-memo handling for ephemeral scripts — capture the deferral, cite the post-demo trigger, move on.

**Trigger for swap:**

- Post-demo (Day 19+).
- Either: add `uuid` npm dep + import `v7 as uuidv7`, OR write a 30-line custom generator using `crypto.randomBytes` + RFC 9562 v7 layout (preferable; no new dep).
- Replace `crypto.randomUUID()` call sites in service.ts (currently 1, will be ~3-5 by end of part-2 code PR including Service A + B + C + E).

**Cross-references:**

- `src/modules/subscription-exceptions/service.ts` (Day-16 Block 4-B commit) — current v4 call sites
- `supabase/migrations/0015_subscription_exceptions_and_materialization.sql:57-65` — schema posture (accepts either)
- Merged plan PR #155 §3.2 step 10 — "correlation_id = uuidv7()" plan-text (drift; will sync in next plan-sync bundle alongside other §3-§4 path drifts captured in followup_plan_path_drift_subscription_exceptions.md)

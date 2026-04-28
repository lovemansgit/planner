# Decision · Failed-payload DLQ — split MVP foundation from post-MVP UI

**Status:** Decided. Captured from `aqib.a` review of `subscription-planner-onboarding_v1.1` page 36.
**Decision date:** 28 April 2026 (Day 3 EOD review).
**Decided by:** Love (engineering-owner).

## Source comment

> "Option to edit and repush failed payloads"

## Decision — three-way split

| Component | When | Effort |
|-----------|------|--------|
| 1. Failed-payload storage (DLQ table or equivalent) | **MVP — Day 6 adapter work** | ~1 day |
| 2. Merchant-facing diagnostic UI | Post-MVP (v1.1) | ~1.5 days |
| 3. Edit-and-retry flow | Post-MVP (v1.1) | ~0.5 days |

The architectural foundation lands in MVP. The user-facing surface ships in
the post-pilot v1.1.

## Why split this way

**In favour of foundation-in-MVP:**
- The DLQ table is something the system needs anyway — sustained push
  failures (MP-14 in the doc) currently have no forensic record. Adding it
  later means double-touching the failure path.
- Once the table is logging from day-one of the pilot, the v1.1 UI ships
  with historical data already present — merchants get failure visibility
  on day-one of the v1.1 release, not day-one of using v1.1.
- During the pilot itself, Transcorp ops can manually edit-and-retry by
  querying the DLQ table directly. That's acceptable because (a) the pilot
  is three merchants, (b) failure rates should be low, (c) ops is in the
  loop anyway for sustained outages.

**Against folding the UI into MVP:**
- 3 days total work is 21% of the remaining 11-day budget at end of Day 3.
- We're already at Day 4 of 14, with 6 more days of adapter work and 4 days
  of UI ahead. Buffer is shrinking.
- The merchant-facing UI assumes a working failure-path, which assumes the
  table — so it has a dependency, not just a deferral.

## Engineering shape — Day 6 work

Day 6 (or whichever day finishes the SuiteFleet adapter retry surface):

- Add a `failed_pushes` table or equivalent (likely Postgres for
  queryability rather than an opaque DLQ; SQS DLQ is a different concern
  and operates at a lower layer).
- Schema (rough): `id`, `tenant_id`, `subscription_id`, `task_payload` (jsonb),
  `failure_reason`, `attempt_count`, `first_failed_at`, `last_attempted_at`,
  `resolved_at` (nullable), `resolved_by` (nullable, user uuid), `audit_trail`
  reference.
- RLS-enabled, same defensive form as every other multi-tenant table.
- Integration adapter writes a row when retries are exhausted.
- Index on `(tenant_id, resolved_at IS NULL, last_attempted_at DESC)` for
  the eventual UI query pattern.
- Audit emit on row creation: `task.push_failed` (denied/failed vocabulary
  tense per the open `followup_audit_failed_attempts.md`).

## Engineering shape — post-MVP UI (v1.1)

Two screens, shipped together post-pilot:

1. **Failed Tasks list** — table view, filterable by tenant, date,
   subscription, failure reason. Tenant Admin and Ops Manager only;
   CS Agents see a read-only version (consistent with permission catalogue).
2. **Edit-and-retry detail** — single failed row, payload fields editable
   inline, "retry push" button. Idempotency keys regenerate per retry so
   SuiteFleet doesn't reject as duplicate.

Both depend on the MVP table existing.

## Communication back to Aqib

When the v1.1 UI ships post-pilot, surface the design to Aqib's team. Core
message: "We agreed; we built the foundation in MVP so you have data
flowing from day one, and the UI shipped in v1.1 once we had pilot data
to design against."

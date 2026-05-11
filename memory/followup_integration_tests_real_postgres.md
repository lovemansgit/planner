---
name: Integration-tier test suite against ephemeral Postgres
description: Deferred — repository-tier integration tests using real Postgres to catch SQL-binding bugs invisible to mocked unit tests. Trigger: another repo-layer bug post-pilot OR Day-23+ buffer.
type: project
---

# Integration-tier test suite against ephemeral Postgres

**Filed:** 11 May 2026 (Day 22 PM) — bundled with PR #238 wizard 500 fix per bootstrap brief §4 FIX 3.
**Status:** Deferred. Trigger conditions below.

---

## §1 The class of bug we missed

Day-22 PM PR #238 surfaced a `42804 datatype_mismatch` in `insertSubscription` (subscriptions/repository.ts) — the `days_of_week` column expected `integer[]` but Drizzle's `sql` template was spreading the JS array as `($6, $7, $8, $9, $10)`, which Postgres parses as a record/tuple. The bug had been latent since Day 6 / S-3 — never triggered because:

- No production-app user flow exercised `insertSubscription` against real Postgres before Day 22's forms lane
- Seed scripts go through raw `psql`, bypassing the Drizzle layer
- All `subscriptions/tests/repository.spec.ts` tests mock `tx.execute` and never reach `pg`

**Class:** repository-tier bugs that mock-based unit tests cannot surface:

- Array vs single-param binding (e.g. `integer[]`, `text[]`, `jsonb[]`)
- jsonb shape mismatches the column constraint at parse time
- Type-cast drift (`::date`, `::integer`, `::timestamptz`)
- RLS `WITH CHECK` clauses that silently drop INSERTs the unit tier thinks succeeded
- `ON CONFLICT` resolution paths that the unit tier renders correctly but executes incorrectly

---

## §2 Why unit tests can't catch these

The unit tier (`tests/*/repository.spec.ts`) injects a stub `tx` with `execute = vi.fn(async () => fixtureRows)`. The Drizzle → postgres-js → Postgres chain is short-circuited at the FIRST link. The compiled SQL is captured for assertions on its **text** (e.g. `expect(sql).toMatch(/FOR UPDATE/)`) but never round-tripped through a real parse + bind + execute cycle.

The wizard 500 anchor test in `subscriptions/tests/repository.spec.ts` (added with this commit) now asserts the rendered SQL contains the `ARRAY[…]::integer[]` shape — but that's a defensive regex-on-string assertion, not proof the SQL executes correctly. A future binding bug with a different cause (e.g. a mismatched cast modifier) would slip past the regex if the regex doesn't anticipate it.

---

## §3 Proposed shape

**Tier:** `tests/integration/repo/` (new directory) — one spec per repository module covering the binding paths that are sensitive to SQL-text shape.

**Infra dependencies (already in repo):**
- `scripts/setup-test-db.sh` — provisioned ephemeral Postgres at Day-15 baseline
- `tests/integration/setup/auth-stub.sql` — RLS session-variable stub
- Vitest project config supports a `{ integration: ... }` project per existing `vitest.config.ts`

**New work needed:**
- Vitest project entry `integration-repo` with longer timeout + Postgres lifecycle hooks
- CI workflow conditional: only run on PRs touching `src/modules/**/repository.ts` OR `src/modules/**/repository.spec.ts` OR on nightly
- Anchor specs (~5–10 to start, expand as needed):
  - `subscriptions/repository.integration.spec.ts` — INSERT + UPDATE round-trips with array, jsonb, date, time, optional-null patches
  - `consignees/repository.integration.spec.ts` — INSERT + UPDATE with phone E.164 + jsonb internal_metadata
  - `tasks/repository.integration.spec.ts` — bulk INSERT round-trip + packages jsonb array
  - `addresses/repository.integration.spec.ts` — INSERT + label CHECK constraint
  - `audit/repository.integration.spec.ts` — INSERT with audit_payload jsonb + RULE-blocked DELETE behaviour

**Out of scope (already covered):**
- `tests/integration/rls-tenant-isolation.spec.ts` — cross-tenant defence
- `tests/integration/subscription-check-constraints.spec.ts` — CHECK constraint enforcement
- `tests/integration/merchant-slug-collision-conflict.spec.ts` — unique-constraint conflict

---

## §4 Trigger conditions to unblock

This is deferred, not silently dropped. Schedule the work when:

- **(a)** Another repository-tier binding bug surfaces post-pilot — proves the class is recurring, not a one-off
- **(b)** Day-23+ buffer permits proactive coverage — i.e. there's a quiet day with no Phase-2 feature on the critical path
- **(c)** Sarah Khouri demo-persona seed reveals further binding drift during pre-seed reconciliation

Without one of those, the existing regex-based SQL-shape assertions in unit tests + the Postgres CHECK constraint + RLS layer carry the load.

---

## §5 Scope estimate

- Infra wiring (Vitest project + CI conditional + ephemeral-Postgres lifecycle): ~3 hr
- Anchor specs (5–10 baseline, ~30 min each with shared fixtures): ~3–5 hr
- **Total:** ~6–8 hr. Single-PR scope.

---

## §6 Cross-references

- `memory/handoffs/bootstrap-session-a-day-22-pm.md` §4 FIX 3 — bundled deferral ruling
- `scripts/setup-test-db.sh` — existing ephemeral-Postgres setup script
- `tests/integration/setup/auth-stub.sql` — RLS session-variable stub
- `src/modules/subscriptions/repository.ts` — incident site (Day-22 PM regression)
- `src/modules/subscriptions/tests/repository.spec.ts` — regex-based anchor test added by the same commit

---

**End.**

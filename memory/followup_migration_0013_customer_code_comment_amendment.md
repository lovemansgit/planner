---
name: Migration 0013 — customer.code comment is misleading; amend to reflect actual cron-gate role
description: The 0013 migration header (lines 46-72) frames `tenants.suitefleet_customer_code` as a wire-body field SF requires on every createTask POST. Static-code analysis 3 May 2026 (Day 10) confirmed the actual production wire body never carries customer.code. The column is purely a CRON-GATE field — only push if non-NULL — but the value never reaches SF. Amendment surface: rewrite the comment to clarify the cron-gate role, drop the misleading "SF identifies via customer.code" framing. Bundle with Secrets Manager swap PR OR standalone docs touch.
type: project
---

# Migration 0013 — customer.code comment amendment

**Surfaced:** 3 May 2026 (Day 10, post-P2 cross-tenant probe + Path B static analysis)
**Tier:** T1 (docs-only) — schedule with the Secrets Manager swap PR or as a standalone docs touch, whichever lands first

---

## §1 The misleading comment

[supabase/migrations/0013_sf_integration_required_fields.sql](supabase/migrations/0013_sf_integration_required_fields.sql), Section 2 header (lines 46-72):

```
-- =============================================================================
-- Section 2: tenants.suitefleet_customer_code  — merchant scoping key
-- =============================================================================
-- Live webhook capture confirms SF identifies each pilot merchant via
-- a `customer.code` field (e.g. "TBC" for Tabchilli) on every task
-- create POST. Without it, SF can't scope the create to the right
-- merchant. The cron's payload-build (D8-4) reads this column per-
-- tenant and passes it as `customer.code` on every push.
```

The phrase **"passes it as `customer.code` on every push"** does not match production code. The cron's payload-build uses `suitefleet_customer_code` only as a guard (skip the tenant if NULL), never as a body field.

## §2 What production code actually does (3 May 2026)

Three-file static analysis:

| File | Behavior |
|---|---|
| [src/modules/integration/types.ts](src/modules/integration/types.ts) | `TaskCreateRequest` interface has no `customerCode` field |
| [src/modules/task-push/service.ts:274-310](src/modules/task-push/service.ts#L274-L310) | `buildTaskCreateRequest` reads `suitefleetCustomerCode` only at line 364 as a guard (`if (!customerCode) → tenant_skipped`); never propagates the value to the adapter request |
| [src/modules/integration/providers/suitefleet/task-client.ts:231-280](src/modules/integration/providers/suitefleet/task-client.ts#L231-L280) | `buildSuiteFleetTaskBody` constructs the wire body with `customerId` (numeric, from env) only — no `customer:` object, no `customer.code` field anywhere |

`grep -rn "customer.code|customerCode" src/modules/integration/providers/suitefleet/` returns zero non-test matches.

**Effective wire body to SF on every createTask POST:**

```
URL:    POST /api/tasks?customerId=588
Body:   { customerId: 588, customerOrderNumber: ..., consignee: {...}, ... }
        // NO customer.code, NO customer: { code: ... }
Auth:   Authorization: Bearer <jwt>, Clientid: <env-clientId>
```

## §3 Two possible explanations for the misleading framing

1. **Comment was aspirational at write-time (Day 8 / D8-2 era).** The author wrote the comment before the cron-push body builder was finalised in D8-4a. By the time D8-4a landed, the `customer.code` field was dropped (or never added) — possibly because empirical sandbox testing showed SF accepts the body without it, OR because the per-tenant routing happens via `customerId` alone, OR because the header was just not actually verified empirically before merge.

2. **SF accepts both with and without `customer.code`.** Sandbox SF has been receiving createTask POSTs without `customer.code` since D8-4a (3 May 2026 morning) and processing them successfully (sandbox-merchant-588's tasks all land — see audit-events row counts pre-Day-10 teardown). Whether production SF requires `customer.code` is empirically unknown.

## §4 Risk assessment

**Today (sandbox):** Zero — production code works against sandbox SF without sending customer.code.

**Day-15+ production cutover risk:** If production SF strictly enforces `customer.code` presence (in a way sandbox SF doesn't), tasks would fail during cutover. The Secrets Manager swap PR's empirical test ("trigger generation for two tenants with different SF accounts") would catch this — but only if the body shape stays unchanged. If a future engineer reads the misleading comment and "fixes" production by adding `customer.code` to the body, that's the moment the surprise lands.

**Misleading-comment shelf life:** Each future engineer who reads 0013 and looks at the production code path will hit the same confusion the Day-10 probe-prep did. Cost is minor each time but compounds across the team.

## §5 Amendment shape

Rewrite Section 2's header to:

```
-- =============================================================================
-- Section 2: tenants.suitefleet_customer_code  — cron-gate field (NOT wire body)
-- =============================================================================
-- This column gates whether the cron's bulk-push attempts the tenant
-- in a given pass: NULL → skip the tenant entirely with a
-- `tenant.push_skipped` audit event (reason='missing_customer_code').
-- Non-NULL → enumerate and push the tenant's pending tasks.
--
-- The COLUMN VALUE is NOT sent to SuiteFleet. The wire body for
-- createTask carries `customerId` (integer, from env-backed creds
-- today, AWS Secrets Manager post-Day-15+ swap) — see
-- src/modules/integration/providers/suitefleet/task-client.ts
-- buildSuiteFleetTaskBody. SF identifies the merchant via the JWT +
-- customerId combination; the body has no `customer.code` field.
--
-- This column was originally framed (3 May 2026 / D8-2) as the
-- field SF requires in body for merchant scoping. Static analysis
-- 3 May 2026 (Day 10) confirmed that's not how the production code
-- actually serializes — the column is purely a cron-gate. See
-- memory/followup_migration_0013_customer_code_comment_amendment.md
-- for the framing-amendment rationale.
--
-- Backfill convention (operator-driven, post-onboarding):
--   UPDATE tenants SET suitefleet_customer_code = '<code>' WHERE slug = '<merchant-slug>';
--
-- D8-4 cron-service guard: the per-tenant push code MUST fail-closed
-- if suitefleet_customer_code IS NULL — emit a `task.push_failed`
-- audit event with reason='missing_customer_code', skip the push,
-- leave the task for the next cron pass. Better than pushing without
-- a confirmed-active tenant identifier.
-- =============================================================================
```

## §6 Sequencing

Two scheduling options:

- **Option A — bundle with Secrets Manager swap PR** (Day-15+). The swap PR will already touch the credential stack; comment amendment fits the same change-set. Lower context-switch cost.
- **Option B — standalone docs PR** (T1, anytime). Pure-text amendment to a single migration file. Migration 0013 has already been applied to all DBs (sandbox + production); editing the comment is a forward-only operation per the project's no-edit-applied-migrations rule, but **comment-only edits are allowed because they don't change schema state** (the rule guards SQL-statement edits, not header text).

Lean **Option B**. The standalone PR is small, lands the framing-fix immediately so future readers don't repeat the Day-10 confusion, and the swap PR stays focused on its credential surface.

## §7 Cross-references

- [supabase/migrations/0013_sf_integration_required_fields.sql](supabase/migrations/0013_sf_integration_required_fields.sql) — the migration with the misleading comment
- [memory/followup_secrets_manager_swap_critical_path.md](followup_secrets_manager_swap_critical_path.md) — companion: Secrets Manager swap is the production-cutover gate
- [memory/decision_mvp_shared_suitefleet_credentials.md](decision_mvp_shared_suitefleet_credentials.md) — companion: Path B MVP posture, which the static-code finding unblocked
- [memory/followup_d8_2_migration_comment_framing.md](followup_d8_2_migration_comment_framing.md) — earlier Day-9 finding about a different misleading section of 0013 (D8-2 webhook-credentials framing); could bundle into the same amendment PR
- [src/modules/task-push/service.ts:274-310](src/modules/task-push/service.ts#L274-L310) + [src/modules/integration/providers/suitefleet/task-client.ts:231-280](src/modules/integration/providers/suitefleet/task-client.ts#L231-L280) — the actual production code paths confirming customer.code is not on the wire

---
name: Brief v1.7 amendment — SF identifier model (region client_id / merchant customerId / AWB-prefix customer.code)
description: Day-18 (8 May 2026) architectural correction. Day-10 memos framed shared-customer-588 as a "Path B sandbox-share" deferral and per-tenant credentials as the post-pilot hardening item. That framing was a misread of the SuiteFleet data model. Correct architecture (locked Day 18 by Love after SF onboarding context confirmation): region client_id is env-backed and shared across merchants in a region; per-merchant customerId is the routing identifier and lives in DB; customer.code is the alphanumeric AWB prefix with no routing role. Brief §3.6 rewritten v1.6 → v1.7. Bundled with A1 code-PR: resolver swap + migration 0013 comment fix + two Day-10 memo amendments + this decision file + MEMORY.md index update.
type: project
---

# Decision · Brief v1.7 amendment — SuiteFleet identifier model

**Status:** Locked Day 18 (8 May 2026) by Love (engineering-owner) after Day-18 morning architectural-context surface.
**Filed:** Day 18 (8 May 2026)
**Forms part of:** A1 code-PR (`day18/a1-customer-id-resolver-swap-code`) bundled scope
**Supersedes:** Day-10 framing in `decision_mvp_shared_suitefleet_credentials.md` and `followup_secrets_manager_swap_critical_path.md`
**Cross-references:**
- `memory/PLANNER_PRODUCT_BRIEF.md` §3.5 + §3.6 (rewritten this PR)
- `memory/followup_per_tenant_merchant_id_routing.md` (root-cause memo Day 17 EOD post-smoke)
- `memory/followup_a1_plan_section_2_5_premise_correction.md` (companion premise-correction memo)
- `memory/plans/day-18-a1-customer-id-resolver-swap.md` §5.4 (planned this decision file)

---

## §1 The three identifier layers (canonical)

The SuiteFleet data model has THREE distinct identifier layers, not two:

| Layer | Identifier | Storage | Example values | Scope | Role |
|---|---|---|---|---|---|
| Region | `client_id` | Environment variable (`SUITEFLEET_SANDBOX_CLIENT_ID`, future `_UAE_CLIENT_ID`, `_QATAR_CLIENT_ID`) | `transcorpsb` (sandbox), `transcorpuae` (UAE), `transcorpqatar` (Qatar) | Per region — shared across all merchants in that region | Authentication scope — every merchant in a region authenticates as that region's `client_id` |
| Merchant | `customerId` (numeric) | DB column `tenants.suitefleet_customer_code` (text type, content is integer) | 588 (MPL), 586 (DNR), 578 (FBU) | Per merchant within a region | Routing key — threaded into every createTask wire body for billing/dispatch scope to the correct merchant |
| AWB prefix | `customer.code` (alphanumeric) | NOT stored in Planner DB; assigned by SF and surfaces as a prefix on AWB strings | MPL, DNR, FBU | Per merchant within a region | Cosmetic — appears as the prefix on AWB labels (e.g. `MPL-72701927`); plays NO role in routing |

## §2 What was wrong with the Day-10 framing

Day-10 memos (`decision_mvp_shared_suitefleet_credentials.md`, `followup_secrets_manager_swap_critical_path.md`) framed:

- "Shared customer code 588" as the MVP deferral pattern
- "Per-tenant credentials" as the first post-pilot hardening item
- AWS Secrets Manager swap as the gate for production-cutover per-tenant isolation

That framing was based on the wrong architectural model:

- **Shared sandbox**: read as "every merchant in sandbox shares one merchant identity" (incorrect inference). Reality: every merchant in sandbox shares the region's authentication credential, but each merchant has its own `customerId` for routing. The "every merchant routes as 588" symptom was a real bug — the Day-4 resolver ignored `tenantId` and read a single env-backed `customerId` — not the architectural design.
- **Per-tenant credentials post-pilot**: framed as the hardening fix. Reality: per-tenant credentials at the auth layer are NOT the production architecture. Per-region credentials at the auth layer + per-merchant `customerId` at the wire-body layer IS the production architecture. The hardening item that was real was: regional credential expansion (adding UAE/Qatar) when those regions onboard.
- **Static-code finding (Day 10) "wire body has no customer.code"**: factually correct observation. Erroneously concluded that meant "merchant routing is invisible to SF." Reality: merchant routing happens via `customerId` (which IS in the wire body), not `customer.code`. The static-code observation was correct; the conclusion was wrong.

## §3 What the brief now reflects (post-A1)

Brief §3.6 (full text in v1.7) replaces the v1.6 framing entirely:

- Region creds env-backed, shared across merchants in region
- Per-merchant `customerId` DB-backed via `tenants.suitefleet_customer_code`, resolved per-tenant by `src/modules/credentials/suitefleet-resolver.ts`
- AWB prefix `customer.code` cosmetic only

Brief §3.5 (label generation) language reframed: removed the "Single shared `customer.code = 588` sandbox credential" line; replaced with the post-A1 region+customerId framing.

Brief §4 (Phase 2): dropped "Per-tenant SuiteFleet credential isolation"; replaced with "Regional credential expansion (UAE/Qatar onboarding)."

Brief §5.4 (Demo Q&A rehearsal): updated to surface multi-tenancy proof via SF console (three distinct merchants with respective task volumes) instead of the deferred-isolation framing.

## §4 What changes in the runtime (A1 code-PR scope)

`src/modules/credentials/suitefleet-resolver.ts` rewritten:

- `username` / `password` / `clientId` continue env-backed (region credentials)
- `customerId` now reads `tenants.suitefleet_customer_code` via `withServiceRole` + `sqlTag`
- Throws `CredentialError` on tenant-not-found / NULL/empty `customer_code` / non-positive-integer (Option A)
- Function signature simplified: `resolveSuiteFleetCredentials(tenantId)` — `EnvSource` injection seam dropped (mocked via `withServiceRole` in tests)

`tenants.suitefleet_customer_code` data values transition from alphanumeric placeholder values (e.g. `'MPL'`, `'DNR'`) to canonical numeric values (e.g. `'588'`, `'586'`, `'578'`). Operator-driven backfill via SQL editor; A1 plan-PR §6 Gate 14 verifies this for the three demo tenants.

## §5 Three layers of defense-in-depth (intentional, post-A1)

Per `memory/followup_a1_plan_section_2_5_premise_correction.md`:

1. **β cron filter** (`src/app/api/cron/generate-tasks/list-cron-eligible-tenants.ts:80`) — enumeration-time exclusion of tenants where `suitefleet_customer_code IS NULL OR ''`
2. **Per-task race-condition belt** (`src/modules/task-push/service.ts:364-394`) — re-checks at queue-worker pickup, catches the window where the value was cleared between β enumeration and per-task push
3. **Resolver throw** (`src/modules/credentials/suitefleet-resolver.ts`) — fail-loud at `adapter.authenticate` for direct probe scripts, future non-cron callers, or any state where layers 1+2 failed

## §6 Forward path

- **Sandbox** (today): three demo tenants (MPL/DNR/FBU) backfilled with 588/586/578 in `suitefleet_customer_code`. Each `createTask` POST routes to the correct SF merchant per the resolver's per-tenant return.
- **Demo May 18**: SF console screenshot shows three distinct merchants with their respective task volumes — direct evidence of multi-tenancy.
- **Production cutover** (post-pilot): regional expansion when UAE / Qatar onboard. Adds `transcorpuae` / `transcorpqatar` env-or-Secrets-Manager entries; per-merchant `customerId` continues from DB.
- **AWS Secrets Manager swap** (`memory/followup_secrets_manager_swap_critical_path.md`): scoped to regional credentials, not per-tenant isolation. Per-tenant `customerId` resolution is now durable (DB-backed); the swap moves region credentials from env to Secrets Manager.

## §7 Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §3.5 + §3.6 (this PR's edits) + §4 + §5.4 + §9 (v1.7 amendment row)
- `memory/decision_mvp_shared_suitefleet_credentials.md` (this PR adds prominent header noting framing was wrong; original text preserved as historical context)
- `memory/followup_secrets_manager_swap_critical_path.md` (this PR rewrites §1 + §5 to reframe scope as regional-credential-expansion not per-tenant-isolation)
- `memory/followup_per_tenant_merchant_id_routing.md` (root-cause memo Day 17 EOD)
- `memory/followup_a1_plan_section_2_5_premise_correction.md` (companion premise-correction memo Day 18)
- `memory/followup_migration_0013_customer_code_comment_amendment.md` (this PR rewrites the migration comment to reflect Option A)
- `src/modules/credentials/suitefleet-resolver.ts` (post-A1 implementation)
- `src/app/api/cron/generate-tasks/list-cron-eligible-tenants.ts:80` (β filter)
- `src/modules/task-push/service.ts:364-394` (per-task race-condition belt)
- `supabase/migrations/0013_sf_integration_required_fields.sql` Section 2 (this PR rewrites the comment)

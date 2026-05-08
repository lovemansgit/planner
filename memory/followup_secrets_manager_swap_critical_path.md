---
name: AWS Secrets Manager swap — REGIONAL credential expansion (UAE/Qatar onboarding); not per-tenant isolation [Day-18 amendment]
description: SuiteFleet credential resolution swap from environment variables to AWS Secrets Manager. Day-18 amendment reframed scope: this swap is for REGIONAL credentials (region `client_id` env vars — `transcorpsb` sandbox, future `transcorpuae` UAE, `transcorpqatar` Qatar), NOT per-tenant credential isolation. Per-merchant `customerId` is already DB-backed post-A1 (Day 18 / 8 May 2026); the swap remaining is moving the region credentials from env to Secrets Manager when regional expansion happens. Day-10 original framing of "per-tenant credential isolation" was a misread of the SF data model and is superseded.
type: project
---

# AWS Secrets Manager swap — regional credential expansion

**Captured:** 3 May 2026 (Day 10) — **scope reframed Day 18 (8 May 2026) post-A1 architectural correction**
**Status:** scope narrowed; **Phase 2 — triggers when UAE or Qatar regions onboard**
**Production-cutover impact for sandbox-only deployment:** **NOT blocking** — A1 (Day 18) made per-merchant `customerId` DB-backed, region credentials env-backed and shared across merchants in region is the canonical architecture (per `memory/decision_brief_v1_7_amendment_sf_identifier_model.md`)
**Phase 2 trigger:** UAE or Qatar regional onboarding — adds `SUITEFLEET_UAE_USERNAME` / `_PASSWORD` / `_CLIENT_ID` (or Secrets Manager entries) and per-region resolver dispatch

---

## §0 Day-18 scope-correction header (read first)

> The §1-§5 text below was filed Day 10 (3 May 2026) and framed this swap as "per-tenant credential isolation, the first post-pilot hardening item." **That framing was based on a misread of the SuiteFleet data model and is superseded by the Day-18 architectural correction.**
>
> **Three identifier layers (correct architecture, locked Day 18 by Love):**
>
> | Layer | Identifier | Storage | Scope |
> |---|---|---|---|
> | Region | `client_id` | env-backed (`SUITEFLEET_SANDBOX_CLIENT_ID` = `transcorpsb`; future `_UAE_CLIENT_ID`, `_QATAR_CLIENT_ID`) | Per region; shared across merchants in that region |
> | Merchant | `customerId` (numeric) | DB column `tenants.suitefleet_customer_code` | Per merchant within a region (588/586/578 in sandbox) |
> | AWB prefix | `customer.code` (alphanumeric) | Not stored in Planner DB | Per merchant; cosmetic — appears on AWB labels; no routing role |
>
> **What A1 (Day 18) shipped:** `src/modules/credentials/suitefleet-resolver.ts` now reads per-merchant `customerId` from DB via `withServiceRole` + `sqlTag`. Region creds (`username`, `password`, `clientId`) stay env-backed (region scope is correct env-shape).
>
> **What this swap is now actually for:** moving REGION credentials (`username` / `password` / `clientId`) from env to AWS Secrets Manager when regional expansion happens (UAE / Qatar onboarding). NOT per-tenant credential isolation — that was never the SF architecture.
>
> **Where to read the current architecture:** `memory/PLANNER_PRODUCT_BRIEF.md` §3.6 (v1.7), `memory/decision_brief_v1_7_amendment_sf_identifier_model.md`, `memory/followup_per_tenant_merchant_id_routing.md`, `memory/decision_mvp_shared_suitefleet_credentials.md` (§0 amendment header).

---

## §1 Current state (post-A1 — Day 18, 8 May 2026)

`src/modules/credentials/suitefleet-resolver.ts` (post-A1 rewrite):

- Region credentials (`username` / `password` / `clientId`) read from env vars (`SUITEFLEET_SANDBOX_USERNAME` / `_PASSWORD` / `_CLIENT_ID`). All merchants in the sandbox region share `transcorpsb`.
- Per-merchant `customerId` reads from `tenants.suitefleet_customer_code` via `withServiceRole` + `sqlTag`. Each tenant returns its own numeric customerId (588 MPL / 586 DNR / 578 FBU in sandbox).
- Throws `CredentialError` on tenant-not-found, NULL/empty `customer_code`, non-positive-integer values (Option A).

Token cache (`token-cache.ts`) is keyed by tenantId. Each Planner tenant gets a distinct session JWT, but JWTs are minted from the SHARED region credentials — every tenant in sandbox authenticates as `transcorpsb`. The per-merchant scope happens at the wire-body layer via the per-tenant `customerId` field, not at the auth layer.

**Effective behavior post-A1:** every Planner tenant's tasks land in their assigned SF merchant (588/586/578). Wire body carries the per-tenant `customerId`; auth uses region credentials. Per-tenant routing IS visible at the SF API call layer through the `customerId` field — Day-10's "per-tenant routing invisible to SF" framing was wrong (the field was always there, just env-backed at one fixed value because the resolver ignored `tenantId`).

## §2 Slip history (Day 5 trigger → still pending Day 10)

The Day-5 trigger has slipped through five day-rollovers, visible in handoff memos:

| Memo | Recorded slip |
|---|---|
| [memory/handoffs/day-6-eod.md:247](handoffs/day-6-eod.md#L247) | "Credential resolver type narrowing → Day-5 Secrets Manager touch" |
| [memory/handoffs/day-7-eod.md:386](handoffs/day-7-eod.md#L386) | same trigger; not touched on Day 7 |
| [memory/handoffs/day-8-eod.md:355](handoffs/day-8-eod.md#L355) | "Day-9 Secrets Manager touch (was Day-5 trigger; slipped)" |
| memory/handoffs/day-9-eod.md | did not surface — Day 9 was deep procedural-debt cleanup |
| Day 10 (this memo) | still pending; deferred to Day 15+ post-MVP per Path B decision |

Five-day slip with no scheduled landing date. The reason it kept slipping: each day's substantive scope (D8-* receiver hardening, D8-4 cron push, D8-5 DLQ retry, P4a webhook config UI, D8-8 Tier-2 verification, P2 auth wiring) consumed the day; the swap is foundational but not Day-X-blocking when the cron only walks `sandbox-merchant-588`.

Day 10's P3 onboarding (3 new tenants) extends the cron's walk from 1 tenant to 4. Under Path B (sandbox-share decision) this still works because all 4 share the same env creds; the swap only becomes hard-blocking at production cutover when the 4 tenants need to address distinct SF accounts.

## §3 Convention discrepancy to resolve

Two competing path conventions are documented:

| Source | Path |
|---|---|
| [src/modules/credentials/suitefleet-resolver.ts:5](src/modules/credentials/suitefleet-resolver.ts#L5) (resolver header) | `/transcorp/secrets/{tenantId}/suitefleet/credentials` |
| [src/modules/credentials/index.ts:9-10](src/modules/credentials/index.ts#L9-L10) (module header) | same pattern, plus `/transcorp/secrets/{tenantId}/suitefleet/webhook-credentials` for Tier-2 |
| [.env.example:161](.env.example#L161) (env doc) | `SECRETS_MANAGER_PATH_PREFIX=transcorp/planner/tenants` |

The resolver doc + module doc agree on `transcorp/secrets/{tenantId}/...`. The env doc disagrees. The swap PR locks one of these and updates the other; lean toward the resolver doc since it's been stable since Day 4 and the migration sequence (D8-2's Tier-2 webhook credentials, P4b's planned creds management) consistently references that shape.

## §4 Scope of the Day-15+ swap PR

**Implementation (T2 / T3 — auth surface, hard-stop-twice protocol):**

1. `src/modules/credentials/suitefleet-resolver.ts` — replace env reads with AWS Secrets Manager `GetSecretValue` against `/transcorp/secrets/{tenantId}/suitefleet/credentials`. Same return shape (`{ username, password, clientId, customerId }`). Cached per-tenant in-memory with TTL (~5 min) to avoid hot-pathing the AWS API on every cron pass.
2. `src/modules/credentials/suitefleet-webhook-resolver.ts` — same shape, different path: `/transcorp/secrets/{tenantId}/suitefleet/webhook-credentials`. (Currently used by D8-8 Tier-2 verification.)
3. IAM policy update — gain `secretsmanager:GetSecretValue` scoped to `arn:aws:secretsmanager:*:*:secret:transcorp/secrets/*/suitefleet/*`.
4. `.env.example` reconciliation — drop `SUITEFLEET_SANDBOX_USERNAME` / `_PASSWORD` / `_CLIENT_ID` / `_CUSTOMER_ID` (no longer the runtime path); update `SECRETS_MANAGER_PATH_PREFIX` to match locked convention.
5. Test plan — unit tests for resolver with mocked AWS SDK; integration test against a localstack-backed Secrets Manager OR a dedicated test secret in AWS.

**Provisioning workflow:**

1. `scripts/load-suitefleet-creds.mjs` — new operator script taking `--tenant-id`, `--username`, `--password`, `--client-id`, `--customer-id` (all required) and calling `aws secretsmanager create-secret` (or `put-secret-value` if updating). Mirror the shape of `onboard-merchant.mjs` for consistency.
2. `npm run load-suitefleet-creds -- --tenant-id=... --username=... ...` — invocation pattern. Operator runs once per tenant per environment.
3. Idempotent — `create-secret` falls back to `put-secret-value` on `ResourceExistsException`.

**Migration ordering:**

1. Land the resolver swap behind a fallback flag (`ALLOW_ENV_CREDS=true` keeps env reads alive during cutover, mirroring Posture A pattern from the auth wiring PR)
2. Provision creds for `sandbox-merchant-588` first; verify cron path works against new resolver via Preview
3. Provision creds for the 3 P3 merchants (or whatever production tenants exist by then)
4. Drop the `ALLOW_ENV_CREDS` fallback in a follow-up T1 once production has soaked

## §5 Phase 2 trigger — regional credential expansion

**Day-18 reframe:** the original "production-cutover gating" framing assumed per-tenant credentials were the post-pilot hardening item. That assumption was wrong (see §0 amendment header). Per-tenant `customerId` is already DB-backed post-A1; production-cutover for the sandbox region works as-is.

The actual Phase 2 trigger for this swap is **regional expansion** — specifically when UAE or Qatar regions onboard. At that point:

- ✅ Add `SUITEFLEET_UAE_USERNAME` / `_PASSWORD` / `_CLIENT_ID` env vars (or Secrets Manager entries) keyed to `transcorpuae`
- ✅ Add `SUITEFLEET_QATAR_USERNAME` / `_PASSWORD` / `_CLIENT_ID` analogously for `transcorpqatar`
- ✅ Resolver gains per-region dispatch: read tenant's region (likely a new `tenants.region` column or derived from `tenants.slug` prefix), select corresponding region env namespace
- ✅ For Secrets Manager (rather than continued env-backed): IAM policy grants `secretsmanager:GetSecretValue` scoped to `transcorp/secrets/regions/*/suitefleet/*`. Provisioning script `scripts/load-suitefleet-region-creds.mjs` (or similar) takes `--region` instead of `--tenant-id`
- ✅ Cron empirical test: seed a UAE tenant + a sandbox tenant; trigger generation for both; confirm UAE tenant's tasks land under `transcorpuae` merchant and sandbox tenant's tasks land under `transcorpsb` merchant

Until UAE / Qatar onboarding triggers regional expansion, **production for the sandbox region works correctly with env-backed region credentials + DB-backed per-merchant customerId.** The three demo tenants (MPL/DNR/FBU) all authenticate as `transcorpsb` AND each routes to its own SF merchant via `customerId` per A1.

## §6 Cross-references

- [memory/decision_mvp_shared_suitefleet_credentials.md](decision_mvp_shared_suitefleet_credentials.md) — companion: Path B sandbox-sharing for Day-14 MVP demo
- [memory/followup_migration_0013_customer_code_comment_amendment.md](followup_migration_0013_customer_code_comment_amendment.md) — companion: 0013 comment is misleading about customer.code on the wire
- [src/modules/credentials/suitefleet-resolver.ts](src/modules/credentials/suitefleet-resolver.ts) — primary swap surface
- [src/modules/credentials/suitefleet-webhook-resolver.ts](src/modules/credentials/suitefleet-webhook-resolver.ts) — secondary swap surface (Tier-2)
- [memory/followup_credential_resolver_type_narrowing.md](followup_credential_resolver_type_narrowing.md) — prior follow-up tied to the same Day-5 trigger
- [memory/followup_suitefleet_auth_rate_limits.md](followup_suitefleet_auth_rate_limits.md) — vendor-confirmation gap on lockout policy; touched by the swap
- [.env.example](.env.example) — env-doc that needs reconciliation

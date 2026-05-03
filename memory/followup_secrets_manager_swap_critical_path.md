---
name: AWS Secrets Manager swap — production-cutover blocker, Day-15+ scope
description: SuiteFleet API credential resolution today reads from environment variables and ignores tenantId. The Day-5 swap to AWS Secrets Manager has slipped through Days 5/6/7/8/9/10 (visible in handoff memos days 6/7/8). Acceptable for Day-14 MVP demo (3 test merchants intentionally share sandbox SF account per decision_mvp_shared_suitefleet_credentials.md) but BLOCKS production cutover. This memo documents current state, slip history, scope of the swap PR, and target schedule (Day 15+).
type: project
---

# AWS Secrets Manager swap — production-cutover blocker

**Captured:** 3 May 2026 (Day 10 P3 onboarding prep, Path B accepted)
**Status:** outstanding; deferred from Day-5 trigger; **Day-15+ scope (post-MVP-demo)**
**Production cutover impact:** **BLOCKING** — current env-backed resolver cannot serve distinct merchants with distinct SuiteFleet accounts
**MVP-demo impact:** **NOT blocking** — see [decision_mvp_shared_suitefleet_credentials.md](decision_mvp_shared_suitefleet_credentials.md)

---

## §1 Current state (3 May 2026)

[src/modules/credentials/suitefleet-resolver.ts:39-40](src/modules/credentials/suitefleet-resolver.ts#L39-L40) accepts `tenantId` but ignores it — every tenant resolves the same env-backed credentials:

```ts
// suitefleet-resolver.ts line 8-9 (file header)
// `tenantId` is accepted on the Day-4 implementation but ignored: the
// same sandbox secret serves every tenant during pilot dev.

// line 39-40
// tenantId is intentionally unused in the Day-4 path — see file-header docblock.
// TODO(Day-5): replace env reads with AWS Secrets Manager lookup at /transcorp/secrets/{tenantId}/suitefleet/credentials.
```

Four env vars consulted by every tenant's resolution:

- `SUITEFLEET_SANDBOX_USERNAME`
- `SUITEFLEET_SANDBOX_PASSWORD`
- `SUITEFLEET_SANDBOX_CLIENT_ID`
- `SUITEFLEET_SANDBOX_CUSTOMER_ID` (the integer SF merchant ID — 588 for the canonical sandbox)

Token cache (`token-cache.ts`) is keyed by tenantId, so each Planner tenant gets a distinct session JWT, but those JWTs are all minted from the same shared username/password — they all authenticate as SF merchant 588.

**Effective behavior:** every Planner tenant's tasks land in SF merchant 588 in sandbox SF. The wire body NEVER carries customer.code (verified Day 10 — see [followup_migration_0013_customer_code_comment_amendment.md](followup_migration_0013_customer_code_comment_amendment.md)); only `customerId=588` reaches SF, in URL query and body. Per-tenant routing is invisible at the SF API call layer.

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

## §5 Production-cutover gating

Before any pilot merchant goes live in production:

- ✅ All required tenants must have entries in AWS Secrets Manager
- ✅ The resolver swap must be merged + soaked in Preview against multi-tenant cred resolution
- ✅ IAM policy must grant `secretsmanager:GetSecretValue` scoped to `transcorp/secrets/*/suitefleet/*`
- ✅ Old env vars (`SUITEFLEET_SANDBOX_*`) removed from Production scope (Preview retains for fallback during cutover)
- ✅ Cron empirical test: trigger generation for two tenants with different SF accounts and confirm tasks land in the right SF merchants

Until those gates land, **production has effectively one merchant** (whoever the env creds authenticate as).

## §6 Cross-references

- [memory/decision_mvp_shared_suitefleet_credentials.md](decision_mvp_shared_suitefleet_credentials.md) — companion: Path B sandbox-sharing for Day-14 MVP demo
- [memory/followup_migration_0013_customer_code_comment_amendment.md](followup_migration_0013_customer_code_comment_amendment.md) — companion: 0013 comment is misleading about customer.code on the wire
- [src/modules/credentials/suitefleet-resolver.ts](src/modules/credentials/suitefleet-resolver.ts) — primary swap surface
- [src/modules/credentials/suitefleet-webhook-resolver.ts](src/modules/credentials/suitefleet-webhook-resolver.ts) — secondary swap surface (Tier-2)
- [memory/followup_credential_resolver_type_narrowing.md](followup_credential_resolver_type_narrowing.md) — prior follow-up tied to the same Day-5 trigger
- [memory/followup_suitefleet_auth_rate_limits.md](followup_suitefleet_auth_rate_limits.md) — vendor-confirmation gap on lockout policy; touched by the swap
- [.env.example](.env.example) — env-doc that needs reconciliation

---
name: Day-14 MVP demo — 3 P3 test merchants intentionally share sandbox SF account [SUPERSEDED Day 18 — see §0 amendment header]
description: Path B accepted Day 10 (3 May 2026). The 3 P3 test merchants (MPL, DNR, FBU — meal-plan-scheduler, dr-nutrition, fresh-butchers) are seeded in Planner with distinct slugs/UUIDs/admin logins and distinct suitefleet_customer_code values, but all push tasks to SF merchant 588 in sandbox SF via the existing env-backed credential resolver. Planner-side per-tenant isolation is validated end-to-end (RLS, cron tenant filter, dashboard scoping, operator UI scoping); SF-side per-tenant isolation is NOT validated and gates on the Day-15+ Secrets Manager swap. SUPERSEDED Day 18 — Day-10 architectural framing was incorrect. Original text preserved below as historical context. See §0 amendment header.
type: project
---

# Decision · Day-14 MVP demo — 3 P3 test merchants share sandbox SF merchant 588

## §0 Amendment — Day 18 (8 May 2026): Day-10 framing was wrong

> **HISTORICAL CONTEXT NOTICE.** The decision text below (§1 onwards) was filed Day 10 (3 May 2026) and reflects the architectural model understood at that time. **The Day-10 framing was based on a misread of the SuiteFleet data model and is superseded by the Day-18 architectural correction.** Read this header first; the §1-§8 text below remains for historical/forensic context but should NOT be cited as current architecture.
>
> **What was wrong:**
>
> - Day-10 framed "shared customer 588" as a Path-B sandbox-share deferral, with "per-tenant credentials" as the first post-pilot hardening item. That framing was the misread.
> - Reality (locked Day 18 by Love after SF onboarding context confirmation): SuiteFleet has three identifier layers, not two. Region `client_id` (env-backed; `transcorpsb` for sandbox) is shared across merchants in a region — that's the auth credential. Per-merchant `customerId` (numeric, 588/586/578 in sandbox) is the routing identifier — DB-backed via `tenants.suitefleet_customer_code` post-A1. AWB prefix `customer.code` (alphanumeric, MPL/DNR/FBU) is cosmetic with NO routing role.
> - The "every merchant routes as 588" symptom from Day 10 was a real bug — the Day-4 resolver ignored `tenantId` and read a single env-backed `customerId` — not the architectural design.
> - "Per-tenant credentials post-pilot" was the wrong framing of the real hardening item, which is regional credential expansion (UAE / Qatar onboarding when those regions deploy).
>
> **What changed Day 18:**
>
> - A1 code-PR (`day18/a1-customer-id-resolver-swap-code`) rewrote `src/modules/credentials/suitefleet-resolver.ts` to read per-merchant `customerId` from `tenants.suitefleet_customer_code` via `withServiceRole` + `sqlTag`. Region creds (`username`, `password`, `clientId`) stay env-backed.
> - `tenants.suitefleet_customer_code` data values transitioned from alphanumeric placeholders (`'MPL'`, `'DNR'`) to canonical numeric values (`'588'`, `'586'`, `'578'`).
> - Three demo tenants (MPL/DNR/FBU) now route to distinct SF merchants 588/586/578. SF console will show three distinct merchants with their respective task volumes — direct demo evidence of multi-tenancy.
>
> **Where to read the current architecture:**
>
> - `memory/PLANNER_PRODUCT_BRIEF.md` §3.6 (v1.7) — current decision
> - `memory/decision_brief_v1_7_amendment_sf_identifier_model.md` — companion decision file
> - `memory/followup_per_tenant_merchant_id_routing.md` — root-cause memo (Day 17 EOD post-smoke surface)
> - `memory/followup_secrets_manager_swap_critical_path.md` — companion memo (also amended Day 18 to reframe swap as regional-credential-expansion not per-tenant-isolation)
> - `memory/followup_a1_plan_section_2_5_premise_correction.md` — A1 code-PR Pattern B rationale
> - `supabase/migrations/0013_sf_integration_required_fields.sql` Section 2 — header comment rewritten Day 18 to reflect per-merchant `customerId` role
>
> **What stays valid from §1-§8 below:** the Planner-side per-tenant isolation observations (RLS, cron tenant filter, dashboard scoping, operator UI scoping per §2 ✓). What's superseded: the §3 wire-body framing, §4 AWB-prefix narrative ("AWB prefix shows MPL during sandbox" was correct symptom but wrong cause), and §6 production-posture framing.

---

# (Original Day-10 decision text — preserved as historical context)


**Status:** Decided. Path B accepted by Love after Path A (delete sandbox-merchant-588) rejected and after the static-code probe confirmed wire-body has no `customer.code` mismatch surface.
**Decision date:** 3 May 2026 (Day 10, post-P2 cross-tenant probe completion)
**Decided by:** Love (engineering-owner)
**Forms part of:** Day-14 MVP definition (3 merchants × 1000 tasks × 1 operator each)

---

## §1 Decision

The 3 P3 test merchants — Meal Plan Scheduler (MPL), Dr. Nutrition (DNR), Fresh Butchers (FBU) — are seeded in Planner with:

- distinct `tenants.slug` (`meal-plan-scheduler`, `dr-nutrition`, `fresh-butchers`)
- distinct `tenants.id` (UUIDs from onboard-merchant)
- distinct `tenants.suitefleet_customer_code` (`MPL`, `DNR`, `FBU`)
- distinct admin Supabase Auth users + email domain (`*-admin@planner.test`)
- distinct Tenant Admin role assignments scoped per tenant

**But all 3 push tasks to the same SuiteFleet merchant — sandbox SF merchant 588 — via the existing env-backed credential resolver.**

This is intentional for the Day-14 MVP demo. SF-side per-tenant isolation is NOT validated; that gate moves to the Day-15+ Secrets Manager swap PR per [followup_secrets_manager_swap_critical_path.md](followup_secrets_manager_swap_critical_path.md).

## §2 Why this is acceptable for Day-14 MVP demo

The MVP definition is *"3 merchants × 1000 tasks × 1 operator each testing all use cases by Day 14."* The pilot scope is **Planner-side end-to-end validation**:

- Operator-A logs into Planner, sees only Meal Plan Scheduler's data
- Operator-B logs into Planner, sees only Dr. Nutrition's data
- Operator-C logs into Planner, sees only Fresh Butchers' data
- Each operator manages ~1000 subscriptions in their tenant; cron generates ~1000 tasks per merchant per day
- Operators run all use-cases: skip / append / pause / resume / end / DLQ retry / asset-tracking lookup

**What this DOES validate (Planner-side, all tested by Day 14):**
- RLS enforces per-tenant data isolation at the database layer (validated empirically by Day-10 P2 cross-tenant probe)
- Cron's per-tenant filter (`WHERE suitefleet_customer_code IS NOT NULL`) walks each merchant's subscriptions independently
- Per-tenant dashboards scope correctly via `withTenant`
- Operator UI shows the right tenant's data via session-bound tenantId
- Auth surface (login / logout / cookie handling) works for distinct merchant operators
- Subscription / task / consignee / failed-pushes flows all exercise per-tenant correctly

**What this does NOT validate:**
- SF receiving distinct merchant tasks under distinct SF accounts (all tasks land in SF merchant 588)
- Per-tenant SF cred rotation
- Per-tenant SF rate limits
- Per-tenant SF webhook routing (sandbox SF webhooks all carry merchant 588's identity)

These are the production-cutover gates, not Day-14-demo gates.

## §3 Static-code finding that unblocked Path B (3 May 2026)

Originally feared: SF would 4xx on URL-`customerId=588` mismatched against body-`customer.code='DNR'`. Static-code probe surfaced the actual production wire shape:

- `TaskCreateRequest` interface has no customerCode field
- `buildTaskCreateRequest` doesn't propagate `suitefleet_customer_code` to the adapter request
- `buildSuiteFleetTaskBody` builds wire body with `customerId` only — no customer.code

**The mismatch can't occur** because the wire body never carries customer.code in the first place. Every Planner tenant's wire body is identical from SF's perspective: `customerId=588` in URL + body, JWT for SF user 588, no customer.code field.

Sandbox-merchant-588 has been pushing tasks via this exact envelope since D8-4a (3 May 2026 morning). The 3 P3 merchants will share that proven path.

The 0013 migration's comment claiming SF requires customer.code is misleading and tracked separately in [followup_migration_0013_customer_code_comment_amendment.md](followup_migration_0013_customer_code_comment_amendment.md).

## §4 What the operators actually see

When Operator-B (DNR's admin) logs in and views their dashboard, the data is correctly scoped to DNR's tenant — they see DNR's subscriptions, DNR's tasks, DNR's failed pushes, DNR's consignees. Each task in DNR's view has an external SF id (assigned by sandbox SF on push), an AWB (e.g. `MPL-08187661`), and a status synced from SF webhooks.

The AWB prefix is `MPL-` (sandbox SF's pre-existing prefix for merchant 588) regardless of which Planner tenant pushed the task. This is the most-visible signal that all 3 Planner tenants share the underlying SF merchant. Operators can be told: "AWB prefix shows MPL during sandbox; production deploy will issue per-merchant AWBs after the Secrets Manager swap."

## §5 Per-merchant identifiers in the Planner DB (kept distinct for forensics)

Even though SF receives identical envelopes, the Planner DB preserves distinct per-tenant data:

| Field | MPL tenant | DNR tenant | FBU tenant |
|---|---|---|---|
| `tenants.id` | (post-onboard UUID) | (post-onboard UUID) | (post-onboard UUID) |
| `tenants.slug` | `meal-plan-scheduler` | `dr-nutrition` | `fresh-butchers` |
| `tenants.name` | `Meal Plan Scheduler` | `Dr. Nutrition` | `Fresh Butchers` |
| `tenants.suitefleet_customer_code` | `MPL` | `DNR` | `FBU` |
| Admin email | `mpl-admin@planner.test` | `dnr-admin@planner.test` | `fbu-admin@planner.test` |
| Operator | Operator-A | Operator-B | Operator-C |

Forensic queries can answer "which Planner tenant pushed this task" by joining tasks → subscriptions → tenants on tenant_id. The fact that multiple tenants share `customerId=588` in SF is invisible to the Planner-side query path.

## §6 Production posture (for clarity)

Production cutover is BLOCKED on the Day-15+ Secrets Manager swap. Until that PR lands:

- Each merchant must have entries in AWS Secrets Manager at `/transcorp/secrets/{tenantId}/suitefleet/credentials`
- Each tenant's resolver call returns that merchant's distinct creds
- SF receives distinct JWT + customerId per tenant
- Tasks land in the right SF merchant
- AWB prefix differs per merchant

Until then, **production with multiple merchants would behave the same as sandbox today** (everyone routed to whichever SF merchant the env creds authenticate as). That's why Path B is acceptable for sandbox demo only, and the swap is a hard production-cutover gate.

## §7 Operational acknowledgment requirement

When the 3 P3 operators run their first end-to-end flow, they should be told the AWB-prefix observation explicitly:

> "During sandbox testing your tasks will show an AWB prefix beginning with `MPL-` regardless of which merchant you are. This is because all three test merchants share a single sandbox SuiteFleet account in this pilot phase. In production, each merchant will receive their own AWB prefix tied to their own SuiteFleet merchant account; the swap is scheduled post-Day-14."

This avoids surprise during operator-A's first task creation in DNR's tenant when they see an `MPL-` AWB.

## §8 Cross-references

- [memory/decision_planner_auth_independent.md](decision_planner_auth_independent.md) — Day-3 decision: Planner login is independent of SF auth (related; this decision is about API creds)
- [memory/followup_secrets_manager_swap_critical_path.md](followup_secrets_manager_swap_critical_path.md) — companion: production-cutover gate for SF cred isolation
- [memory/followup_migration_0013_customer_code_comment_amendment.md](followup_migration_0013_customer_code_comment_amendment.md) — companion: 0013 wire-body comment is misleading
- [src/modules/credentials/suitefleet-resolver.ts](src/modules/credentials/suitefleet-resolver.ts) — env-backed resolver
- [src/modules/integration/providers/suitefleet/task-client.ts:231-280](src/modules/integration/providers/suitefleet/task-client.ts#L231) — wire-body builder confirming no customer.code field
- [memory/followup_probe_complete_day10.md](followup_probe_complete_day10.md) — Day-10 P2 cross-tenant probe forensic record (Planner-side isolation validation)
- [.env.example](.env.example) — `SUITEFLEET_SANDBOX_CUSTOMER_ID=588` env var, the source of merchant 588's identifier

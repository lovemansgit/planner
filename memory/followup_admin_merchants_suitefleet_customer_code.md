---
name: Admin merchants form — SuiteFleet customer code closure
description: Day-22 §5.3 Gate 2 demo storyline gap closure — /admin/merchants/new now captures suitefleet_customer_code at create time so new merchants route SF tasks correctly out of the box; within v1.11 scope (no version bump).
type: project
---

# Admin merchants form — SuiteFleet customer code closure

**Filed:** 11 May 2026 (Day 22, post-Love-walkthrough) per PR #238 §5.3 Gate 2 closure.
**Status:** Closed by PR #238 commit `feat(d22-forms-crud): add SuiteFleet customer code to merchant onboarding form (PR #238 §5.3 Gate 2 closure)`.

---

## §1 What was broken

Brief §5.3 Gate 2 demo storyline requires Transcorp staff to onboard a new merchant via `/admin/merchants/new` and for that merchant's tasks to push outbound to SuiteFleet. The column `tenants.suitefleet_customer_code` (consumed by `src/modules/credentials/suitefleet-resolver.ts:91`) gates SF outbound — when null/empty, the cron push fail-closes per-tenant (audit event `task_push.tenant_skipped_missing_customer_code` per Day-8 D8-4).

The form at `/admin/merchants/new` (shipped Day 18) **did not capture this field**. New merchants landed with `null` → SF outbound fail-closed → Gate 2 demo would break for the freshly-onboarded merchant.

## §2 Closure scope

Wired the field end-to-end:

1. **Form** (`src/app/(admin)/admin/merchants/new/_components/CreateMerchantForm.tsx`) — new `<Field>` "SuiteFleet customer code" in its own `<fieldset>` after the pickup-address fieldset, before the Create button. Required attribute; help-text "Numeric ID provided by Transcorp's SF vendor contact (e.g. 588). Positive integer, no leading zeros."

2. **Form parser** (`_helpers.ts` `parseCreateMerchantForm`) — captures `suitefleet_customer_code`, validates via `CLIENT_SUITEFLEET_CUSTOMER_CODE_RE = /^[1-9]\d*$/` (positive integer, no leading zeros, rejects bare zero / empty / non-numeric).

3. **Server action** (`_actions.ts` `createMerchantAction`) — passes `suitefleetCustomerCode` through to `createMerchant`.

4. **API route** (`src/app/api/admin/merchants/route.ts` `CreateMerchantBodySchema`) — Zod schema extended with `suitefleet_customer_code: z.string().regex(/^[1-9]\d*$/)`. Mirrors the client-side check at the JSON-API boundary.

5. **Service** (`src/modules/merchants/service.ts` `createMerchant`) — added `requireSuitefleetCustomerCode` validator (same regex; matches the SF resolver canon at `credentials/suitefleet-resolver.ts:108-131`). Audit metadata extended with `suitefleet_customer_code` so forensic queries can correlate SF-routing issues to onboarding values.

6. **Repository** (`src/modules/merchants/repository.ts` `insertMerchant`) — SQL INSERT now writes the `suitefleet_customer_code` column.

7. **Types** (`src/modules/merchants/types.ts` `CreateMerchantInput`) — added `readonly suitefleetCustomerCode: string` field.

## §3 Test coverage added

- `src/app/(admin)/admin/merchants/tests/helpers.spec.ts` — 6 new tests:
  - rejects missing field
  - rejects empty / whitespace
  - rejects non-numeric ("abc")
  - rejects leading zero ("0588")
  - rejects bare zero ("0")
  - accepts valid positive integer ("588")

- Existing happy-path tests updated to include the field; existing audit-shape test in `service.spec.ts` extended to expect `suitefleet_customer_code` in metadata; API route `validBody()` fixtures updated.

- Integration test `tests/integration/merchant-slug-collision-conflict.spec.ts` updated to include the field in its fixture.

## §4 Brief impact

**No brief version bump.** This is closing a gap between brief §5.3 Gate 2 demo storyline and shipped reality — within v1.11 scope (the v1.11 amendment focused on the consignee-onboarding wizard; the merchant-onboarding form Gate 2 gap is in adjacent scope but doesn't warrant its own version bump).

Brief §5.3 Gate 2 narrative unchanged.

## §5 Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §5.3 Gate 2 (demo storyline)
- `src/modules/credentials/suitefleet-resolver.ts:108-131` (SF resolver consumer)
- `src/modules/audit/event-types.ts:120` (Day-8 D8-4 fail-closed cron event triggered by missing code)
- PR #238 commit `feat(d22-forms-crud): add SuiteFleet customer code to merchant onboarding form (PR #238 §5.3 Gate 2 closure)`

---

**End.**

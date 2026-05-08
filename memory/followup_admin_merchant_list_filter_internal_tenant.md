---
name: /admin/merchants list filter for internal Transcorp tenant — Phase 2 cleanup
description: Day-18 transcorp-sysadmin onboarding (PR #194 plan / code-PR sibling) provisions a dedicated 'transcorp' tenant row to host the sysadmin user's home-tenant binding. With no `tenants.is_internal` column today, that row appears in the `/admin/merchants` list rendered by PR #186's listMerchants flow. Cosmetic only. Phase 2 cleanup: add `tenants.is_internal boolean NOT NULL DEFAULT false` schema migration, backfill `WHERE slug = 'transcorp'`, extend listMerchants with `excludeInternal?: boolean` (defaults true), `/admin/merchants` page passes `excludeInternal: true`. Bundle with the discrete `transcorp-staff` role slug work per existing `memory/followup_admin_middleware_phase2.md`.
type: project
---

# `/admin/merchants` list filter for internal Transcorp tenant — Phase 2 cleanup

**Filed:** Day 18, 8 May 2026 (alongside transcorp-sysadmin onboarding code-PR)
**Trigger date:** pre-Day-28 (external demo to first prospect customer)
**Tier when triggered:** T2 (small schema migration + service-layer filter + page-level pass-through)
**Cross-references:**
- `memory/plans/day-18-transcorp-sysadmin-onboarding.md` §3 (this memo's source)
- `memory/followup_admin_middleware_phase2.md` (existing memo on transcorp-staff role deferral; bundle with this work)
- `src/app/(admin)/admin/merchants/page.tsx` (the page that needs the `excludeInternal: true` pass-through)
- `src/modules/merchants/service.ts` `listMerchants` (the service fn that gets the new param)
- `src/modules/merchants/repository.ts` (the SQL the new param threads into)
- PR #186 (Day-18 Session B — the merchant admin frontend that surfaces this list)

---

## §1 What surfaced

Day-18 transcorp-sysadmin onboarding (`scripts/onboard-transcorp-sysadmin.mjs`) provisions a dedicated `'transcorp'` tenant row as the home tenant for the sysadmin user. The schema requires every user to have a non-NULL `tenant_id` and every role assignment to have a matching `tenant_id` (per `0001_identity.sql:103-199` + `request-context.ts:135` JOIN). There is no tenant-NULL role assignment shape in the codebase, so the sysadmin needs SOME tenant binding — the dedicated `'transcorp'` tenant is the cleanest option (per the plan's decision §2).

`listMerchants` today filters by `excludeArchived` only (default true). The `'transcorp'` tenant has `status='active'`, so it appears in the `/admin/merchants` list — visible alongside the three demo merchants (MPL/DNR/FBU).

A transcorp-sysadmin viewing the list sees four tenants instead of three.

## §2 Why this is acceptable for Day-18 demo

**Cosmetic only; no functional issue.**

- No SF-side impact: `'transcorp'` has `suitefleet_customer_code = NULL` so the cron β filter (`list-cron-eligible-tenants.ts:80`) excludes it from task-push enumeration.
- No RLS leak: tenant isolation works correctly; transcorp-sysadmin's `withServiceRole` cross-tenant access is intentional, not a bypass.
- No audit-trail confusion: `actor.tenantSlug = 'transcorp'` for the sysadmin actor — that's the desired honest-naming behavior.

**Demo Q&A risk:** minor. CAIO panel asking "what's that fourth tenant?" is recoverable. Mitigation: train Love on demo-day phrasing ("that's our system tenant — we'll filter it out before external demo").

## §3 Phase 2 cleanup scope

When the discrete `transcorp-staff` role slug lands as Phase 2 work (per existing `memory/followup_admin_middleware_phase2.md`), bundle the following into the same PR:

### §3.1 Schema migration

Add `tenants.is_internal` column:

```sql
ALTER TABLE tenants
  ADD COLUMN is_internal boolean NOT NULL DEFAULT false;

-- Backfill the dedicated transcorp tenant.
UPDATE tenants SET is_internal = true WHERE slug = 'transcorp';
```

The DEFAULT false ensures all existing demo tenants + new merchants stay non-internal. The backfill flips only the `'transcorp'` row.

### §3.2 Service-layer filter

Extend `listMerchants` (`src/modules/merchants/service.ts`) with an `excludeInternal?: boolean` parameter, defaulting to `true`:

```ts
export interface ListMerchantsFilters {
  readonly excludeArchived?: boolean;  // existing
  readonly excludeInternal?: boolean;  // NEW — defaults true
}
```

The repository SQL gains a corresponding `AND is_internal = false` predicate when the filter is true. Mirror the existing `excludeArchived` plumbing pattern.

### §3.3 Admin page pass-through

`src/app/(admin)/admin/merchants/page.tsx` calls `listMerchants` — pass `excludeInternal: true` explicitly. Don't rely on the default; explicit is more discoverable.

For the rare case where a transcorp staff member wants to see their own tenant row (e.g., admin self-service to update transcorp-internal display name), surface a UI toggle that flips the filter to `excludeInternal: false`. **Lowest priority** — out of scope unless a real need surfaces.

### §3.4 Tests

- Unit test: `listMerchants` excludes `is_internal=true` rows when `excludeInternal: true` (default).
- Unit test: `listMerchants` includes `is_internal=true` rows when `excludeInternal: false`.
- Integration test: page-level — admin merchants page renders only non-internal tenants by default.

## §4 Why not now

Day-18 is the demo-prep day. Adding a schema migration + service-layer filter + page-level pass-through + tests for a cosmetic concern is not justified against the demo-deadline budget. The CAIO demo is internal (Transcorp leadership); they're aware of the implementation choices. External demo (post-Day-28) is when the cosmetic surface starts mattering.

## §5 Cross-references

- `memory/plans/day-18-transcorp-sysadmin-onboarding.md` §3 (this memo's source; concrete cleanup body)
- `memory/followup_admin_middleware_phase2.md` (existing memo on transcorp-staff role deferral; this work bundles together)
- `scripts/onboard-transcorp-sysadmin.mjs` (the script that provisions the `'transcorp'` tenant — this memo addresses the cosmetic side-effect of that provisioning)
- `src/modules/merchants/service.ts` (`listMerchants` signature)
- `src/modules/merchants/repository.ts` (SQL filter)
- `src/app/(admin)/admin/merchants/page.tsx` (page-level pass-through)
- `supabase/migrations/0001_identity.sql:50-90` (tenants table — where `is_internal` column is added)

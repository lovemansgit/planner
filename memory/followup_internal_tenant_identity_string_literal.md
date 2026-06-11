# Followup — internal-tenant identity rides on the "transcorp" string literal

**Filed:** Day-26 (14 May 2026)
**Trigger:** Edit Merchant footgun-closure PR — removing the UI slug-edit
capability narrowed the dangerous path but exposed the underlying coupling.
**Risk status:** NOT a live hazard after the footgun-closure PR lands. The
only remaining way to rename the `transcorp` slug is a deliberate direct-DB
UPDATE by Transcorp staff. This memo tracks correctness debt, not an open
footgun — no urgency-by-risk.

## Finding

Internal-vs-merchant tenant classification in the auth and user-creation
layers is keyed off the hard-coded string literal `"transcorp"` compared
against `tenants.slug`. Two known sites:

1. **`src/modules/identity/service.ts:428`** —
   `runCreateRoleAssignment` selects the parent tenant's slug and routes
   role-assignment eligibility through a literal compare:

   ```typescript
   const allowedRoles =
     tenantSlug === "transcorp" ? TRANSCORP_TENANT_ROLES : MERCHANT_TENANT_ROLES;
   ```

   If the `transcorp` slug is ever renamed, this branch silently falls
   through to `MERCHANT_TENANT_ROLES` — sysadmin role assignment breaks
   for the (former) internal tenant.

2. **`src/app/(admin)/admin/users/new/page.tsx:40,71`** — the
   user-creation surface classifies tenants for the role dropdown via the
   same literal:

   ```typescript
   const TRANSCORP_TENANT_SLUG = "transcorp";
   // ...
   kind: t.slug === TRANSCORP_TENANT_SLUG ? "transcorp" : "merchant",
   ```

   A rename leaves the internal tenant classified as `merchant`, hiding
   transcorp-side roles in the dropdown and offering merchant-side roles
   that the underlying service would reject downstream.

These two sites are the trip-wires; the wider auth tree may have more —
re-grep for the literal at lane open.

## Correct end state

Move internal-tenant identity off the string literal and onto an explicit
schema flag:

- New column `tenants.is_internal_tenant boolean NOT NULL DEFAULT false`
  (or a `tenants.tenant_type` enum if a third class is anticipated; today
  the binary flag is enough).
- Backfill: `UPDATE tenants SET is_internal_tenant = true WHERE slug =
  'transcorp';` — runs once during migration. Verify post-backfill that
  exactly one row carries the flag.
- Rewire both call sites (and any others surfaced at lane open) to read
  `tenant.is_internal_tenant` instead of comparing slug to a literal.
- Slug becomes a display/url identifier only — no auth semantics.

After the rewire, slug remains creation-only at the UI layer (the
footgun-closure PR keeps that posture) but the catastrophic-rename
scenario is structurally impossible: even if a slug were renamed via
direct-DB UPDATE, the flag-driven branch keeps classifying correctly.

## Tier estimate

**T3.** Schema migration + backfill + two known code sites rewired +
role-assignment-gating-adjacent. Smaller than per-merchant SF credentials
but more than a typical T2 because the auth tree touches it; integration
test coverage needs to assert both `is_internal_tenant=true` and `false`
branches behave correctly.

## Trigger

Pick up when:

- A schema-touching merchant-admin lane is next open (cheap to bundle
  the column-add + backfill onto an existing migration).
- Or sooner, if the string-literal coupling blocks other work — e.g.,
  multi-internal-tenant support, or a refactor of role-assignment
  eligibility that wants a typed classifier instead of a string compare.

No urgency-by-risk; the footgun-closure PR closed the dangerous UI path.

## Related

- Edit Merchant footgun-closure PR (this filing's parent) — removed
  the slug-edit input + `UpdateMerchantInput.slug` field + the slug-change
  confirmation modal. See
  `src/modules/merchants/types.ts:UpdateMerchantInput` JSDoc for the
  inline reasoning trail.
- `memory/followup_team_management_ui.md` — Phase 1.5 team-management
  expansion may touch the same role-assignment paths; if that lane opens
  first, bundle the is_internal_tenant rewire.

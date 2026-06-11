# Day-25 plan — Edit Merchant surface (T3)

Filed: 2026-05-13 (Session B). Plan-PR per §3.6 hard-stop discipline.
Code-PR opens only after reviewer (Love) approves this plan.

Production HEAD at filing: `3255621` on `dpl_2M7HDHrt9zAAFajiFVP7CXkY2uVn`.
Local main HEAD: `ead0482` (one Day-24 docs commit ahead of production).

## §0. Preamble

A new operator surface for editing existing merchant tenants. Today
the `/admin/merchants/new` create flow is the only path to populate
merchant fields; correcting a typo in pickup address, fixing a
mis-keyed `suitefleet_customer_code`, or rebranding `name`/`slug`
requires SQL editor work — fine for the 3-merchant demo seed, not fine
once we're past the pilot.

Demo distance at filing: T-2 (May 15 internal CAIO) / T-5 (May 18
external prospect). **This PR is not on the demo critical path.** It
exists because Session A's parallel v1.12 brief amendment surfaces
"Edit Merchant" as a needed Transcorp-staff surface; building it
alongside the demo prep keeps Sessions A + B busy without overlapping
on demo-blocker territory.

### §0.1 Brief alignment

References `memory/decision_brief_v1_12_amendment_decouple_and_edit_merchant.md`
(filed in parallel by Session A — not yet on main at this plan-PR's
filing). The v1.12 amendment is expected to extend brief §2.3
Transcorp-staff workflows from two entries (Onboard/activate/deactivate
+ Cross-tenant operational read) to three:

> 3. **Edit a merchant** (Day-25, Phase 1.5) — sysadmin-scoped update
> of merchant identity (name, slug) + pickup address + SF routing
> (`suitefleet_customer_code`). Read at branch HEAD once Session A's
> memo lands on main; this plan-PR sits behind that brief amendment
> sequentially.

**Sequencing rule:** this plan-PR cannot merge until Session A's
brief v1.12 amendment is on main. If review surfaces conflict between
this plan and the brief amendment, the brief wins; this plan amends.

### §0.2 Tier discipline

T3 by §3.6 because the PR introduces:
- A new permission (`merchant:update`) — perms catalogue is a
  systemOnly contract surface.
- A new audit event (`merchant.updated`) — audit catalogue is a
  registered-metadata contract surface (§A discipline rule from PR
  #161 / Block 4-D).
- A service-layer write path against the `tenants` table —
  cross-tenant scope, RLS bypass via `withServiceRole`.

Hard-stop discipline:
- **Hard stop 1 (this PR)** — plan opens, reviewer counter-reviews
  scope + decisions, plan merges only after explicit approval.
- **Hard stop 2 (code PR)** — code-PR opens, reviewer counter-reviews
  implementation against this plan, code merges only after explicit
  approval. Both stops are Love-only; per
  `memory/feedback_t3_plan_prs_need_realtime_review.md`, T3 plans
  require real-time counter-review — no autonomous drafting between
  plan-merge and code-PR-open.

## §1. Scope boundaries

### §1.1 In scope

| Field | Editable | Notes |
|---|---|---|
| `name` | yes | display string; no format constraint beyond non-empty trim |
| `slug` | yes | UNIQUE; lowercase-kebab `^[a-z0-9-]+$`, 1-60 chars; client-side confirm-modal for change (see §G.4) |
| `pickup_address_line` | yes | non-empty trim if any pickup field provided |
| `pickup_address_district` | yes | non-empty trim if any pickup field provided |
| `pickup_address_emirate` | yes | non-empty trim if any pickup field provided |
| `suitefleet_customer_code` | yes | positive integer string, no leading zeros |

All-three-or-none for `pickup_address_*` per §3.1. Reuses the existing
`SLUG_RE` + `SUITEFLEET_CUSTOMER_CODE_RE` regexes from
`src/modules/merchants/service.ts:104,125` (no new canon).

### §1.2 Out of scope

- **`status`** — not editable here. Status flips go through the existing
  `/admin/merchants/[id]/activate` + `/deactivate` routes + the
  `MerchantStatusModal` on the list page. Activation/deactivation is a
  state-machine transition with its own audit events
  (`merchant.activated` / `merchant.deactivated`); collapsing it into
  the edit form would muddy that contract.
- **Tenant-admin-facing edit** — Tenant Admins do NOT get an
  edit-self-merchant surface in this PR. The merchant identity record
  is a sysadmin-managed entity for the MVP; tenant operators manage
  consignees + subscriptions + tasks (their own data), not the tenant
  row that scopes them. A tenant-admin "settings" surface for
  merchant-side rebranding is Phase 2.
- **Archive / un-archive** — `'archived'` is set ONLY by the Day-18
  fixture-cleanup migration per `src/modules/merchants/types.ts:38-44`.
  No operator-driven archive flow lands here.
- **Slug history / redirect** — when slug changes break bookmarks per
  §G.4, we surface a confirm-modal and proceed. We do NOT keep a slug
  redirect table or 301-from-old-slug. Phase 2 if pain manifests.
- **Diff preview before submit** — operator sees their edits inline
  in the form (no separate "Review changes" step). The confirm-modal
  for slug-change is the only review surface.

### §1.3 Schema impact

**No migration.** All editable columns already exist on `tenants` and
are nullable/non-CHECK-constrained against the values this PR can set.
The repository UPDATE statement (see §E) targets existing columns.

The Day-23 §F "every new SQL path needs an integration spec at
PR-open" rule applies because we're adding a new UPDATE statement with
new column-shape coupling. Integration spec scoped at §6.

## §2. Permission model

### §2.1 New permission

`merchant:update` — registered at `src/modules/identity/permissions.ts`
between `merchant:deactivate` (line 651) and `task:read_all` (line 660).

```typescript
"merchant:update": {
  id: "merchant:update",
  resource: "merchant",
  action: "update",
  description:
    "Day 25 / T3. Update an existing merchant tenant's identity (name, slug), pickup address (line/district/emirate), and SF routing (suitefleet_customer_code) via the Transcorp-staff updateMerchant flow. Status changes are NOT in scope — those go through merchant:activate / merchant:deactivate. systemOnly per brief §2.3 (v1.12); granted only to transcorp-sysadmin.",
  systemOnly: true,
},
```

### §2.2 Role grant

`transcorp-sysadmin` already auto-picks up every permission via
`new Set<PermissionId>(ALL)` at `src/modules/identity/roles.ts:219`.
Adding `merchant:update` to the catalogue is sufficient — no
explicit-grant line needed.

`transcorp-systems` (the narrow migration-cut-over role at
`roles.ts:188`) does NOT get `merchant:update`. Verified by the
existing `systemOnlyPermissionsAreNotInTenantRoles` invariant +
explicit permission-set listing in the systems role.

Tenant-facing roles (`tenant-admin`, `ops-manager`, `cs-agent`) MUST
NOT carry `merchant:update`; the `systemOnly: true` flag + the
existing invariant test enforce this statically.

### §2.3 API_KEY_FORBIDDEN expansion

Add `"merchant:update"` to `API_KEY_FORBIDDEN_PERMISSIONS` at
`permissions.ts:732-749`. Reason: same as the existing
`merchant:create` + `merchant:activate` + `merchant:deactivate`
entries — an exfiltrated API key minting another API key with merchant
mutation capability is a clean privilege-escalation path.

### §2.4 Defense in depth

Three layers per brief §3.4:

1. **Server-component page guard** — `/admin/merchants/[id]/edit/page.tsx`
   calls `requirePermission(ctx, "merchant:update")` before rendering
   the form. ForbiddenError → redirect to `/`. UnauthorizedError →
   redirect to `/login?next=…`. Mirrors `merchants/new/page.tsx:42`.
2. **Server-action / API-route guard** — `updateMerchantAction` (the
   Server Action) calls `updateMerchant(ctx, …)`; the service fn
   itself calls `requirePermission(ctx, "merchant:update")` as line 1.
   Mirrors `service.ts:164` for `createMerchant`.
3. **No RLS layer needed** — `tenants` table RLS scopes by
   `id = app.current_tenant_id`. Cross-tenant operations run inside
   `withServiceRole("transcorp_staff:update_merchant", …)` which
   bypasses RLS by switching to the elevated role. No new RLS policy
   required.

### §2.5 Audit event

`merchant.updated` — registered at
`src/modules/audit/event-types.ts` after `merchant.deactivated`
(line 826), inside the same "Merchant lifecycle events" group.

```typescript
"merchant.updated": {
  id: "merchant.updated",
  resource: "merchant",
  action: "updated",
  description:
    "Day 25 / T3. A merchant tenant was updated via the Transcorp-staff updateMerchant service. Captures field-level diffs (before / after) for each changed column. Does NOT capture status changes — those land in merchant.activated / merchant.deactivated. systemOnly per brief §2.3 (v1.12).",
  metadataNotes:
    "tenant_id (uuid), changes (object: { <field>: { before, after } } for each changed field; fields are: name, slug, pickup_address.line, pickup_address.district, pickup_address.emirate, suitefleet_customer_code). Only changed fields appear in the changes object; an update that mutates zero fields throws ValidationError and never reaches emit.",
  systemOnly: true,
},
```

#### §2.5.1 Diff payload shape

`changes: { [field]: { before, after } }` — flat keys, nested old/new.
Example for a 2-field update:

```json
{
  "tenant_id": "550e8400-e29b-41d4-a716-446655440000",
  "changes": {
    "name": { "before": "Demo Bistro", "after": "Demo Bistro UAE" },
    "suitefleet_customer_code": { "before": "591", "after": "612" }
  }
}
```

For pickup-address sub-fields, dot-notation keys keep each sub-field
diff atomic in the audit row (operator can see "only district changed"
without parsing a nested object):

```json
{
  "changes": {
    "pickup_address.district": { "before": "Al Quoz", "after": "Business Bay" }
  }
}
```

**Empty-diff rule:** if the operator submits the form with every
field unchanged (or only whitespace-trim differences that resolve
identical), the service throws `ValidationError("no changes")` before
reaching emit. This keeps the audit log free of zero-information
"update" rows. Surfaced in UI as an inline alert ("No changes to
save").

#### §2.5.2 Reading prior contract

The metadataNotes wording follows the §A discipline rule (registered
metadata wins). Block 4-D Gate 4 Option C for `merchant.created`
chose NESTED `pickup_address: { line, district, emirate }`; here we
deliberately use FLAT dot-notation in the diff because:

- `merchant.created` is a snapshot of the initial state — nested
  pickup_address mirrors the wire shape sent by the operator.
- `merchant.updated` is a delta — flat dot-notation makes single-field
  changes visible without nested-object parsing, which is what an
  audit-trail reader cares about.

This is a documented divergence, not drift. The metadataNotes string
calls it out (see §2.5).

## §3. Service layer

### §3.1 New method signature

```typescript
// src/modules/merchants/service.ts (new export, after deactivateMerchant)

export interface UpdateMerchantInput {
  readonly name?: string;
  readonly slug?: string;
  readonly pickupAddress?: PickupAddress;
  readonly suitefleetCustomerCode?: string;
}

export interface UpdateMerchantResult {
  readonly status: "updated";
  readonly tenantId: Uuid;
  readonly changedFields: readonly string[];
}

export async function updateMerchant(
  ctx: RequestContext,
  tenantId: Uuid,
  input: UpdateMerchantInput,
): Promise<UpdateMerchantResult>;
```

All input fields optional; at least one must be provided AND result in
a real diff. `pickupAddress` is all-or-none: if `input.pickupAddress`
is supplied, all three sub-fields (`line`, `district`, `emirate`) must
be present and non-empty after trim. Partial pickup updates (e.g., "I
just want to fix the district") still require operator to re-supply
line + emirate as the unchanged values — the form pre-fills, so this
is a UI no-op; the service contract stays simple (no merge-with-current
logic).

### §3.2 Validation

Reuses existing helpers from `service.ts`:
- `requireNonEmpty(value, field)` for trim + required check
- `requireValidSlug(value)` for slug regex + length cap (lines 106-114)
- `requireSuitefleetCustomerCode(value)` for positive-integer regex
  (lines 127-135)

New validation:
- **At least one field provided.** If `name` + `slug` +
  `pickupAddress` + `suitefleetCustomerCode` are all `undefined`,
  throw `ValidationError("no fields to update")`.
- **Pickup all-or-none.** If `pickupAddress` is supplied, validate all
  three sub-fields via `requireNonEmpty`. If only some sub-fields are
  present in the object, that's a programming error (the UI layer
  shouldn't produce it); the validation still rejects it.
- **No-op diff.** After loading current row + computing what would
  change, if no field's normalized value differs from current, throw
  `ValidationError("no changes")` before UPDATE.

### §3.3 Behavior

```
1. requirePermission(ctx, "merchant:update")
2. Normalize input — trim strings, run shape validators (§3.2).
3. withServiceRole("transcorp_staff:update_merchant <tenantId>", tx => {
     a. findMerchantForStatusUpdate(tx, tenantId)
        — reuses the existing FOR UPDATE row-lock query from
          repository.ts:186 (locks across the validate → diff → UPDATE
          → emit sequence the same way activate/deactivate do).
        — returns null → throw NotFoundError("merchant not found: …")
     b. Compute diff: for each provided field, compare normalized
        new value vs current row value. Build `changedFields` array
        + `changes` audit-payload object (per §2.5.1 shape).
     c. If changedFields.length === 0 → throw ValidationError("no changes").
     d. updateMerchantFields(tx, tenantId, normalizedInput)
        — new repo fn; see §E.
        — catches isUniqueViolation(err) → throw ConflictError(
          "merchant slug already exists: <slug>")
   })
4. Post-commit emit: merchant.updated with metadata { tenant_id, changes }.
5. Return { status: "updated", tenantId, changedFields }.
```

#### §3.3.1 Transaction boundary

Steps 3a-3d are inside a single `withServiceRole` transaction. The
audit emit (step 4) is post-commit per the existing
`createMerchant` / `activateMerchant` / `deactivateMerchant` convention
(`service.ts:198,278,357`) — `emit` runs in its own
`withServiceRole("audit:emit:…")` block. This matches the existing
"audit emit outside the mutating tx" pattern.

#### §3.3.2 Slug uniqueness

`tenants.slug` carries a UNIQUE constraint per migration 0001 (the
existing convention `createMerchant` relies on at
`service.ts:191-196`). The repository UPDATE will raise SQLSTATE 23505
on a slug collision (excluding self, because UPDATE-to-same-value is a
no-op at the constraint level). The service catches via
`isUniqueViolation(err)` and maps to `ConflictError`, mirroring
`createMerchant:191-196`.

**No pre-flight slug check.** Optimistic posture: trust the UNIQUE
constraint to enforce; map the error after. Matches `createMerchant`'s
posture (line 191 — no `findMerchantBySlug` call before INSERT).

#### §3.3.3 SF customer code validation

The `customer_code` value is operator-supplied via the form and lands
on `tenants.suitefleet_customer_code` (the column the SF outbound
resolver reads per `src/modules/credentials/suitefleet-resolver.ts:91`).
The service does NOT phone-home to SF to verify the code is real —
that's a Phase 2 hardening (live SF lookup adds a network dependency
to the edit flow). The positive-integer regex is the only validation;
if the operator enters a wrong-but-valid integer, the cron's
per-tenant push fail-closes audibly via the existing
`followup_secrets_manager_swap_critical_path.md` pathway.

### §3.4 Throws

- `ForbiddenError` — actor lacks `merchant:update`.
- `ValidationError` — missing/empty fields when supplied; no fields
  to update; no changes diff; malformed slug; malformed customer code;
  empty pickup-address sub-field.
- `NotFoundError` — tenant id not found.
- `ConflictError` — slug already exists (SQLSTATE 23505 on the UPDATE).

## §4. Repository

### §4.1 New repository fn

```typescript
// src/modules/merchants/repository.ts (new export, after updateMerchantStatus)

export interface UpdateMerchantFieldsPatch {
  readonly name?: string;
  readonly slug?: string;
  readonly pickupAddress?: PickupAddress;
  readonly suitefleetCustomerCode?: string;
}

export async function updateMerchantFields(
  tx: DbTx,
  id: Uuid,
  patch: UpdateMerchantFieldsPatch,
): Promise<Merchant | null>;
```

Returns the updated row (mapped via `mapRow`) on success; `null` if no
row matched (vanished mid-tx — the caller's FOR UPDATE lock prevents
this in practice).

### §4.2 SQL shape

Single UPDATE statement with conditional SET clauses driven by the
patch object. Two viable patterns; the plan picks Pattern A.

**Pattern A (chosen): COALESCE-style with parameter sentinel.**

```sql
UPDATE tenants
SET
  name = COALESCE(${patch.name ?? null}, name),
  slug = COALESCE(${patch.slug ?? null}, slug),
  pickup_address_line = COALESCE(${patch.pickupAddress?.line ?? null}, pickup_address_line),
  pickup_address_district = COALESCE(${patch.pickupAddress?.district ?? null}, pickup_address_district),
  pickup_address_emirate = COALESCE(${patch.pickupAddress?.emirate ?? null}, pickup_address_emirate),
  suitefleet_customer_code = COALESCE(${patch.suitefleetCustomerCode ?? null}, suitefleet_customer_code),
  updated_at = now()
WHERE id = ${id}
RETURNING *
```

**Pattern B (rejected): dynamic SQL fragment composition** via
`sqlTag` chain conditionally appending `name = ${…}, ` per provided
field. More flexible but introduces SQL composition complexity for
zero gain — the COALESCE pattern handles "this field stays as-is" in
one statement, the input shape's optional fields map cleanly to `null`
sentinels.

**Pattern A risk:** none of the editable fields are nullable at write
time AND none of them legitimately accept NULL as a value (UI guards,
service validates non-empty). So COALESCE-with-null-sentinel is safe.
If a future field added here legitimately accepts NULL ("clear this
field"), Pattern A breaks and we'd need to revisit; for the v1 scope
this is fine.

### §4.3 Updated_at

The `updated_at` column has a BEFORE-UPDATE trigger per migration 0001
that auto-sets it. Explicit `updated_at = now()` in the UPDATE
statement is defensive — matches `updateMerchantStatus:215`. Pin
ensures the timestamp value is set even if the trigger were dropped
or modified.

## §5. API surface

### §5.1 Server Action vs API route

The existing `/admin/merchants` surface uses **Server Actions** for
mutations (`activateMerchantAction`, `deactivateMerchantAction`,
`createMerchantAction` at `_actions.ts:56,72,120`) and NO `/api/admin/merchants/[id]/*`
route for mutating ops (only the activate/deactivate routes at
`/api/admin/merchants/[id]/activate/route.ts` + `/deactivate/route.ts`).

**This PR follows the same convention: Server Action only.** New file:

```
src/app/(admin)/admin/merchants/_actions.ts (extend with updateMerchantAction)
```

No new `/api/admin/merchants/[id]/route.ts` route is needed. The form
posts to the Server Action via React's `useActionState` per the
existing `CreateMerchantForm` pattern.

#### §5.1.1 Rationale

Three reasons the Server Action surface is sufficient:

- **Existing precedent** — `createMerchant` is Server-Action-only (the
  POST `/api/admin/merchants` route exists but for programmatic use
  outside the UI; we have no current external consumer). The Edit
  surface has no programmatic consumer either.
- **CSRF defense baked in** — Next.js Server Actions ship with
  built-in CSRF defense; rolling a parallel `/api` route would
  re-introduce CSRF surface for no UI benefit.
- **Cost of a separate API route** — would need to (a) add the
  middleware permission gate, (b) write a Zod schema for the body, (c)
  duplicate error mapping (ValidationError → 422 / Conflict → 409 /
  etc.), (d) pin a separate route-spec. Server-action-only path skips
  all four.

If a programmatic consumer arises (e.g., terraform-style provisioning
through CI/CD), a `/api/admin/merchants/[id]` PATCH route is a clean
Phase 2 add bound by the existing service contract.

### §5.2 Server Action signature

```typescript
// src/app/(admin)/admin/merchants/_actions.ts (new export)

export type UpdateActionResult =
  | { readonly kind: "updated"; readonly tenantId: string; readonly changedFields: readonly string[] }
  | { readonly kind: "validation"; readonly fieldErrors: Readonly<Record<string, string>> }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

export async function updateMerchantAction(
  tenantId: string,
  _prevState: UpdateActionResult | { kind: "idle" },
  formData: FormData,
): Promise<UpdateActionResult>;
```

Mirrors the `createMerchantAction` discriminated-union shape. The
extra `not_found` variant matches `activateMerchantAction`'s
`mapStatusError` family (tenant could be deleted/archived between page
load and submit).

### §5.3 revalidatePath

On success: `revalidatePath("/admin/merchants", "page")` flushes the
list page so any edited name/slug/status surfaces immediately. Mirrors
the existing pattern at `_actions.ts:65`.

## §6. UI

### §6.1 Route

`/admin/merchants/[id]/edit` under the `(admin)/` route group. New
files:

```
src/app/(admin)/admin/merchants/[id]/edit/page.tsx
src/app/(admin)/admin/merchants/[id]/edit/_components/EditMerchantForm.tsx
```

Server component preflight pattern mirrors `merchants/new/page.tsx`:

1. `buildRequestContext` for permission + actor binding.
2. `requirePermission(ctx, "merchant:update")` — ForbiddenError → `/`.
3. Load the merchant row server-side via a new `getMerchantById(ctx, id)`
   service fn (thin wrapper over the existing `findMerchantById` repo
   call with `requirePermission(ctx, "merchant:update")` — same permission
   gates read-for-edit, since seeing the current values is necessary
   for editing them).
4. NotFoundError → 404 page (Next.js's default not-found handling, or
   a small "Merchant not found" inline render — mirror what other
   admin pages do for missing-row state).
5. Render `<EditMerchantForm initial={merchant} />` — server passes
   the pre-fill values to the client component.

#### §6.1.1 Shell verification (Day-24 §E #2)

Route lives under `(admin)/`, so the `AdminTopNav` + admin shell
chrome wraps automatically. **Verification step at code-PR time:**
spot-check the rendered page under Preview deployment to confirm the
admin shell wraps; navigation from `/admin/merchants` → "Edit" → back
keeps the operator in the admin shell throughout. The Day-24 PR #257
lesson applies if any cross-route-group sneak emerges.

### §6.2 Form component

Reuses the `Field` component shape from `CreateMerchantForm.tsx` —
identical label/placeholder/hint/error pattern. Pre-fills every input
from the `initial: Merchant` prop. Layout matches the create form
(same fieldsets: Identity (name + slug), Pickup address, SuiteFleet
routing).

Sketch:

```tsx
<form action={boundUpdateAction} className="space-y-8">
  <Field label="Merchant name" name="name" defaultValue={initial.name} ... />
  <Field label="Slug" name="slug" defaultValue={initial.slug} ... />

  <fieldset><legend>Pickup address</legend>
    <Field label="Address line" name="pickup_line"
           defaultValue={initial.pickupAddress?.line ?? ""} ... />
    <Field label="District" name="pickup_district"
           defaultValue={initial.pickupAddress?.district ?? ""} ... />
    <Field label="Emirate" name="pickup_emirate"
           defaultValue={initial.pickupAddress?.emirate ?? ""} ... />
  </fieldset>

  <fieldset><legend>SuiteFleet routing</legend>
    <Field label="SuiteFleet customer code" name="suitefleet_customer_code"
           defaultValue={initial.suitefleetCustomerCode ?? ""} ... />
  </fieldset>

  <div className="flex items-center justify-end gap-3 ...">
    <Link href="/admin/merchants">Cancel</Link>
    <button type="submit" disabled={isPending}>
      {isPending ? "Updating…" : "Update merchant"}
    </button>
  </div>
</form>
```

Submit button labeled **"Update merchant"** (matches the per-section
casing convention in `CreateMerchantForm` — sentence-case button text,
not all-caps). The original brief said "UPDATE MERCHANT" all-caps;
this is a minor housekeeping adjustment to brand discipline — Mulish
sentence-case for buttons per `feedback_vercel_env_scope_convention.md`-style
visual canon (PR #224 login-page polish + PR #225 brand pass).

> **Open question for reviewer:** the user-provided spec literal said
> "UPDATE MERCHANT" all-caps. Existing `CreateMerchantForm` uses
> sentence-case ("Create merchant"). Plan defaults to sentence-case for
> brand consistency unless reviewer overrides. See §J.1.

### §6.3 Pickup-address loading

`initial.pickupAddress` is `PickupAddress | null` (legacy tenants
pre-dating migration 0017 can have NULL pickup-address columns). For
the edit form, `null` is rendered as empty `defaultValue=""` strings
across the three sub-fields. Operator filling them in for the first
time is a valid update path (turns null → populated).

The form's parser (re-uses `parseCreateMerchantForm` rename → `parseEditMerchantForm`)
treats empty all-three as "no pickup update intended"; partial
non-empty (e.g., 2 of 3) as a validation error per the all-or-none
rule (§3.2). The discrimination matches the service's input
contract.

### §6.4 Slug-change confirm modal

When the operator changes the slug from its initial value AND submits,
the form opens a confirm modal:

> **Confirm slug change**
> Changing the slug will break any existing bookmarks or saved URLs
> that use the current slug. Continue?
>
> [Cancel] [Continue]

Cancel returns to the form (form state preserved; nothing submitted).
Continue proceeds with the submit. Implementation pattern: client-side
check on form submit; if `formData.get("slug") !== initial.slug`,
preventDefault, open modal; on Continue, re-submit form.

The modal uses the same dialog primitive as `MerchantStatusModal.tsx`
(in `_components/`) — radix `<Dialog>` per the existing convention.

#### §6.4.1 Why not server-side warn-only

The slug-change is a real breaking-change for any external bookmark.
We could (a) silently change with audit-trail only, (b) hard-block
with confirm modal (chosen), (c) require a separate "I understand"
checkbox. Option (b) matches the operator-respect posture: explicit
acknowledgement of break-glass for slug change, low friction (one
click), high signal in the audit trail (the operator confirmed they
knew the impact).

### §6.5 Success path

`useEffect` watches `actionResult.kind === "updated"`:
1. Toast: "Merchant updated."
2. `router.push("/admin/merchants")` (operator lands on refreshed list).

Toast primitive: reuses `<Toast>` from
`src/components/Toast.tsx` (the Day-23 PR #248 wizard-success toast
that's now a shared primitive). Auto-dismiss after 4s; manual dismiss
button.

### §6.6 Error states

| Error class | Surface |
|---|---|
| `validation` (field-level) | inline below each field via `Field` component's `error` prop |
| `validation` (form-level, `_form` key) | top-of-form alert banner |
| `conflict` (slug duplicate) | top-of-form alert banner with the specific slug in the message |
| `forbidden` | top-of-form alert + nudge "You don't have permission to edit merchants." (defense-in-depth; the page-level preflight should catch this first) |
| `not_found` | top-of-form alert + nudge "Merchant not found. The merchant may have been deleted." + auto-redirect to list after 3s |

Inline alert styling: matches existing `CreateMerchantForm:60-63`
(navy text on amber 100 tint; 0.5px hairline border).

### §6.7 List action

`/admin/merchants` table at `page.tsx:158-167` currently renders one
button per row (the `MerchantStatusModal` — Activate / Deactivate
depending on status, or "—" for terminal states). The Edit button is
added alongside.

#### §6.7.1 Layout

Replace the single `<MerchantStatusModal>` cell with a flex row:

```tsx
<Td>
  <div className="flex items-center gap-3">
    <Link
      href={`/admin/merchants/${merchant.tenantId}/edit`}
      className="..."  // same as MerchantStatusModal button styling
    >
      Edit
    </Link>
    {action === null ? null : (
      <MerchantStatusModal tenantId={merchant.tenantId} ... />
    )}
  </div>
</Td>
```

Edit link visible for ALL statuses (provisioning / active / suspended /
inactive / archived) — sysadmin can edit any tenant row. Status flip
button shows for `provisioning` / `active` per existing
`statusAction(merchant.status)` logic.

#### §6.7.2 Permission gating

The Edit link's permission gating happens at the **page level**
(server-component preflight on `/admin/merchants/[id]/edit/page.tsx`
per §6.1.2). On the list page, since the entire list page already
gates on `merchant:read_all` (`listMerchants` requires it), and
`merchant:read_all` is held by `transcorp-sysadmin` (which is the only
role with `merchant:update`), the list page renders the Edit link
unconditionally for visitors who reach the page.

**Conditional render check:** at code-PR time, verify that
`merchant:read_all` and `merchant:update` are both system-only and
both held by exactly `transcorp-sysadmin`. If a future role mix
introduces "can read merchants but not edit", we need to wrap the Edit
link in a `hasPermission(ctx, "merchant:update")` check. For this
PR's catalogue state, the unconditional render is correct.

#### §6.7.3 Visual styling

The "Edit" link uses the same button-link styling as the
Activate/Deactivate button surface (small uppercase tracking, hairline
border, sentence-case label). Order: Edit first (read-most-frequent
action), status flip second (state-machine-rare action).

### §6.8 Empty / mid-null pickup-address row state

If a tenant in the list has `pickupAddress === null` (legacy
pre-0017), the Edit button still renders. The edit form renders three
empty pickup fields; operator fills them in. On submit, the
service-layer validation passes (all-or-none, all three supplied), the
repo UPDATE writes the values, and `merchant.updated` audit emits with
`before: null, after: "<value>"` for each of the three sub-fields.

Mid-null state (some columns NULL, some populated — per
`repository.ts:65-89` shouldn't exist for any merchant created via
`createMerchant`, but defensible against manual SQL fixups) renders as
`pickupAddress === null` per the existing mapper rule. The Edit
form's pre-fill shows empty for all three; the operator's submit
overwrites the mid-null state with the new values. Audit captures the
diff cleanly because the service reads the current row pre-write
(§3.3 step 3a).

## §7. Tests

### §7.1 Unit tests (service layer)

`src/modules/merchants/tests/service.spec.ts` (extend):

1. **Happy path — single-field update.** Mock `findMerchantForStatusUpdate`
   to return a merchant; mock `updateMerchantFields` to return updated
   row; assert audit emit called with correct `changes` payload.
2. **Happy path — multi-field update.** Same as above with 3 fields
   changed; assert `changedFields.length === 3` + audit payload contains
   all three diffs.
3. **Validation — no fields provided.** Empty input throws
   `ValidationError("no fields to update")`.
4. **Validation — no diff.** Input matches current row exactly; throws
   `ValidationError("no changes")`.
5. **Validation — empty name after trim.** Throws ValidationError.
6. **Validation — invalid slug pattern.** Throws ValidationError.
7. **Validation — slug over 60 chars.** Throws ValidationError.
8. **Validation — pickup partial (line only).** Throws ValidationError.
9. **Validation — pickup full but empty district.** Throws ValidationError.
10. **Validation — customer code leading zero.** Throws ValidationError.
11. **Permission — actor without `merchant:update`.** Throws
    ForbiddenError; no DB call.
12. **NotFound — tenant id doesn't exist.** Throws NotFoundError.
13. **Conflict — slug collision (SQLSTATE 23505 from repo).** Throws
    ConflictError with the duplicate slug in the message.
14. **Pickup-address diff captures sub-field changes.** Operator
    submits new pickup line + same district + same emirate; audit
    payload only carries `pickup_address.line` diff.
15. **Pre-existing null pickup → populated.** Diff captures
    `pickup_address.line / district / emirate` all with
    `before: null, after: "<value>"`.

### §7.2 Repository unit tests

`src/modules/merchants/tests/repository.spec.ts` (extend):

16. **`updateMerchantFields` happy path** (mocked `tx.execute`).
17. **`updateMerchantFields` no-row-matched** (RETURNING zero rows) →
    returns null.

### §7.3 Helper unit tests

`src/app/(admin)/admin/merchants/tests/helpers.spec.ts` (extend
with the rename of `parseCreateMerchantForm` → shared parser or extend
to `parseEditMerchantForm`):

18. Edit form parser — at-least-one-field-required check.
19. Edit form parser — pickup-address all-or-none check (UI-side
    enforcement before service round-trip).
20. Edit form parser — every validation branch from §7.1 §3-10.

### §7.4 Integration spec at PR open (Day-23 §F discipline)

`tests/integration/admin-merchants-update.spec.ts` — new file.

Real Postgres test database (`tests/integration/_helpers` setup
pattern from `admin-users-list.spec.ts` per the Day-24 §E lesson).
Pins the column-name shape that mocked specs can't catch.

Coverage:

1. **Happy path single-field** — update name; assert DB row changed;
   assert `merchant.updated` row in `audit_events` with correct
   metadata shape.
2. **Happy path full pickup update** — change all 3 pickup
   sub-fields; assert all 3 columns updated; assert audit metadata
   contains all 3 dot-notation diff keys.
3. **Happy path customer code update** — change
   `suitefleet_customer_code`; assert column updated; assert audit.
4. **Slug uniqueness rejection** — seed two tenants; attempt to update
   tenant A's slug to tenant B's slug; assert ConflictError thrown;
   assert tenant A's row unchanged; assert NO audit event emitted.
5. **Slug self-update allowed** — update tenant A's slug to its own
   current value: throws `ValidationError("no changes")` (no-diff
   rule); assert no DB change; no audit event.
6. **Customer code positive-integer validation** — submit `"0588"`
   (leading zero); ValidationError; no DB change.
7. **Pickup all-or-none validation** — submit `pickupAddress` with
   only `line` populated; ValidationError; no DB change.
8. **Audit event diff payload** — update name + slug; query
   `audit_events.metadata`; assert exactly 2 keys in `changes`; assert
   each carries `{before, after}`.
9. **Permission rejection** — non-sysadmin actor; ForbiddenError;
   no DB change; no audit event.
10. **NotFound on non-existent tenant id** — random UUID; NotFoundError.

The spec follows `tests/integration/calendar-day-view.spec.ts` /
`admin-users-list.spec.ts` / `admin-merchants-update.spec.ts` (new)
seed-then-call-then-assert pattern. RLS bypass via `withServiceRole`
in setup is acceptable per existing integration-spec convention.

### §7.5 Test baseline impact

Expected delta: +18 unit tests (1-15 service, 16-17 repo, 18-20
helper splits across 3 spec files but 18-20 might fold into existing
parser test or replace some create-tests if helper is renamed) + +10
integration tests = ~+28 net. Unit baseline goes 1229+ → ~1247+;
integration baseline gains 1 new file with 10 spec cases.

## §8. Sequencing + check-in cadence

Plan-PR review-and-merge → code-PR opens. Code-PR commit cadence:

1. **C-1 (T1 catalogue)** — add `merchant:update` to permissions.ts,
   add to API_KEY_FORBIDDEN_PERMISSIONS, add `merchant.updated` to
   audit event-types.ts.
2. **C-2 (repository)** — add `updateMerchantFields` to
   `merchants/repository.ts` + repo unit tests.
3. **C-3 (service)** — add `updateMerchant` + `getMerchantById` (the
   thin read-for-edit wrapper) to `merchants/service.ts` + service
   unit tests.
4. **C-4 (UI page + form)** — `/admin/merchants/[id]/edit/page.tsx` +
   `_components/EditMerchantForm.tsx` + `_actions.ts`
   `updateMerchantAction` + helper tests.
5. **C-5 (list-page Edit button)** — extend `/admin/merchants/page.tsx`
   `Row` action cell.
6. **C-6 (integration spec)** — `tests/integration/admin-merchants-update.spec.ts`.

§3.6 hard-stop at code-PR open after C-6 + green CI. Mid-PR amendments
follow the §3.6 hold convention (PR #258 Day-24 precedent).

## §9. Open questions for reviewer

### §9.1 Button label casing

User-provided spec said "UPDATE MERCHANT" all-caps. Plan defaults to
sentence-case "Update merchant" for brand-canon parity with
`CreateMerchantForm`'s "Create merchant" button. Reviewer may
override.

### §9.2 Confirm modal — slug change scope

User spec says the confirm modal fires when slug differs from initial
slug at submit time. Plan implements exactly that. Edge case: what if
the operator changes the slug, opens the confirm modal, hits Continue,
the submit fails (e.g., ConflictError), the operator returns to the
form with the changed-slug state in the form, edits the slug AGAIN
(to a third value, or back to the original), and submits — does the
modal re-fire? Plan says: yes, fires every time submit-with-different-slug
happens, including after a failed submit. Single rule: `formData.get("slug") !== initial.slug` triggers the modal.

### §9.3 `getMerchantById` permission gate

The page-level read needs to fetch the current merchant row for
pre-fill. Option (a) gates on `merchant:update` (chosen — what you can
edit, you can see). Option (b) gates on `merchant:read_all` (sysadmin
already has it; semantically "I'm reading the row" matches). Option (a)
keeps the surface tight; option (b) reuses the existing read perm.
Plan picks (a); reviewer override is a one-line change.

### §9.4 Sequencing against v1.12 brief amendment

This plan-PR's merge order: must land AFTER Session A's
`decision_brief_v1_12_amendment_decouple_and_edit_merchant.md` is on
main (which the brief amendment is documented as expected to add a
third entry to §2.3 Transcorp-staff workflows). If Session A's memo
lands first, plan-PR is unblocked. If this plan opens first, plan-PR
holds at §3.6 until the brief amendment merges; then this plan's §0.1
"Brief alignment" prose is final-form.

### §9.5 Demo distance check

Demo is T-2 / T-5 at filing. This PR is NOT on the demo critical
path. Code-PR may or may not land before demo morning depending on
whether defect-patching from Love's dry-run takes priority. If demo
morning approaches with code unlanded, plan-PR stays open + code-PR
stays in draft; nothing breaks.

## §10. Out-of-scope (forward-link)

- **Phase 1.6 cross-tenant action capability** — broader merchant-data
  edit (the data the merchant operator owns: consignees, subscriptions)
  from the admin shell. Not this PR.
- **Slug history table** — for old-slug redirect support after slug
  change. Phase 2.
- **External API route** — `/api/admin/merchants/[id]` PATCH per §5.1.1
  if a programmatic consumer emerges. Phase 2.
- **Bulk edit** — multi-select merchants → edit shared field. Phase 2.
- **Audit-trail viewer for `merchant.updated`** — the audit row is
  emitted today; viewer UI is on the existing
  `followup_audit_log_viewer_ui.md` Phase 2 deferral.
- **Phone-home SF customer code verification** — Phase 2 hardening per
  §3.3.3.

---

End of plan. T3 hard-stop at plan open per §3.6.

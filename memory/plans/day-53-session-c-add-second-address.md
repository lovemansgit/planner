# Day-53 Session C plan — operator adds a second address from the consignee detail page (T3)

**Filed:** Day-53 (11 Jun 2026), Session C, plan-PR (everything in this lane parks).
**Lane authority:** Love's Day-53 EVE ruling §D.1 (`memory/decision_d53_eve_final_clears.md`): "the Phase-2 add-address UI builds **before production merchants onboard, not before UAT**." This plan is that build. UAT itself runs on pre-seeded multi-address consignees and does not wait on this.
**Driving finding:** `memory/followup_no_ui_second_consignee_address.md` — R4/R5 address overrides are merged, promoted, and proven on real SF wire, but unreachable for any consignee onboarded through the production UI, because v1 has no way to give a consignee a second address.

All citations verified against this worktree's HEAD = main `2ce7ace`.

---

## §1 Grounded evidence — the known state

1. **The new-consignee form creates exactly one primary address.** `createConsignee` (`src/modules/consignees/service.ts:200-208`) makes a single `insertAddress(tx, tenantId, consignee.id, { …, isPrimary: true })` call inside one `withTenant` transaction; no second call exists. (The v1.11 `createConsigneeWithSubscription` orchestration was superseded by v1.12 — service header at `src/modules/consignees/service.ts:138`.)
2. **The form copy promises the capability this plan builds.** `src/app/(app)/consignees/new/_components/CreateConsigneeForm.tsx:118-119`, verbatim: *"Single primary address for v1. Add more from the consignee detail page after onboarding."*
3. **That detail-page capability does not exist.** The detail page renders Overview / Subscription / Calendar / History tabs (`src/app/(app)/consignees/[id]/page.tsx:462-467`) with no address add/edit surface. `EditConsigneeForm.tsx` is scoped to six non-address scalars (name/phone/email/deliveryNotes/externalRef/notesInternal, lines 24-31, 68-131); its header comment (lines 3-4) defers address editing to Phase 2.
4. **The addresses module is read-only in v1.** `src/modules/addresses/service.ts:8-14` defers `createAddress` / `updateAddress` / `setPrimaryAddress` / `deleteAddress` explicitly ("Standalone create surface lands when multi-address rotation UI ships in Phase 2"); only `listAddresses` exists (lines 62-70). The repository has `insertAddress` (`src/modules/addresses/repository.ts:81`) with exactly one production caller — the onboarding orchestration above.
5. **`src/modules/subscription-addresses` exposes list + rotation, no operator add path.** Public surface (`index.ts:14-30`): `changeAddressRotation`, `listConsigneeAddresses`, `buildConsigneeSnapshotForAddress`, `findAddressForConsignee`. Nothing creates addresses.
6. **R4/R5 override pickers consume `listConsigneeAddresses` and starve on single-address consignees.** The detail page fetches it at `page.tsx:227` (overview) and `:290` (calendar, when the operator holds `subscription:change_address_one_off` or `_forward`) and passes it to `DayActionPopover` as `availableAddresses`. `ChangeAddressPanel` (`DayActionPopover.tsx:428-541`) renders one radio per row; its zero-address empty state (lines 475-480) instructs verbatim: *"No alternative addresses on file. Add a second address from the consignee form first."* — pointing at a capability that isn't built. With exactly one address the only selectable option is the primary the task already has, so the override is inert.
7. **No cache sits between an INSERT and the consumers.** `listConsigneeAddresses` is a plain SELECT (`subscription-addresses/repository.ts:195-209`); the detail page declares `revalidate = 0` (`page.tsx:88`); the materializer's 4-layer COALESCE (`src/modules/task-materialization/cte-builder.ts:157-191`) reads `addresses` / rotations / exceptions live. A committed row is immediately visible to the pickers, `changeAddressRotation`, and the materializer's override layers.

## §2 Scope — IN

- **`createAddress(ctx, consigneeId, input)`** in `src/modules/addresses/service.ts` — the exact function the Phase-2 note names. Input: `{ label, line, district, emirate }` (the same fields the onboarding address block captures; lat/lng stays Phase 2, matching onboarding at `CreateConsigneeForm.tsx`). Behavior: `requirePermission(ctx, "consignee:update")` + `assertTenantScoped`, validate label ∈ home/office/other and required text fields, verify the consignee exists in-tenant, then one `withTenant` transaction: `insertAddress(…, isPrimary: false)` + audit emit. Returns `{ address_id }`.
- **"Add address" dialog on the consignee detail Overview tab** — mirrors the `AdHocTaskDialog` pattern (`useActionState` + server action in `_actions.ts`, the MerchantStatusModal interaction model). Fields identical to the onboarding address block. Render-gated on `consignee:update` exactly like the existing Edit affordance (`page.tsx:198` `canEditConsignee = perms.has("consignee:update")` — §3.3.10 rule 1, hide what the user cannot access). On success: `revalidatePath` so the new address appears in the Overview list and the R4/R5 pickers immediately.
- **Overview address display** — the Overview tab already receives `addresses` (`page.tsx:407`); the block lists all addresses with the primary badged first. The `page.tsx:226` fetch condition widens so `overviewAddresses` also loads when the operator can edit (today it loads only when `canAddAdHocTask`).
- **One new typed audit event** — §5 below.

## §3 Scope — explicitly OUT (stays Phase-2-deferred unless the reviewer rules any trivially-same-surface)

- **Edit an existing address** (`updateAddress`) — out; the v1 deferral at `addresses/service.ts:8-14` stands for mutation of existing rows.
- **Delete an address** (`deleteAddress`) — out; delete needs referential thinking (tasks/exceptions/rotations referencing the row) that add does not.
- **Default-address changes** (`setPrimaryAddress`) — out; the partial UNIQUE (`addresses_one_primary_per_consignee_idx`, migration 0014:145-147) makes primary-flips a two-row dance with its own failure modes.
- **Rotation-pattern changes** — out; `changeAddressRotation` already exists and is untouched.

This is the no-gold-plating line: the override pickers and rotation service need a *second row to exist*; everything else is management UX that no proven flow currently starves on.

## §4 Design decisions (trade-offs, three sentences each)

**Separate dialog vs. extending `EditConsigneeForm`.** The edit form was deliberately ruled to exclude ALL address fields (brief §9 v1.11: editing the legacy inline scalars would silently desync display from routing), so reopening it for addresses contradicts a recorded ruling. A standalone add-only dialog on the Overview tab adds a row without touching any existing-address mutation path. It also lands on the exact surface the onboarding copy promises ("the consignee detail page").

**Piggyback `consignee:update` vs. a new `address:create` permission.** The catalogue has no address permissions by design — `addresses/service.ts:58-60`: "address ops piggyback on consignee ops in v1; multi-address Phase 2 may split if granular control is needed." Adding an address is editing the consignee's deliverable surface, the same operator intent as `consignee:update`, and the dialog gates identically to the Edit affordance so the UI and service layers agree. A new permission would need catalogue + role-grant + UI-gating churn with no role that would hold one and not the other.

**Server action vs. API route.** Every existing detail-page mutation (ad-hoc task, calendar actions, consignee edit) is a server action with the service as the permission gate; the API-route pattern (`crm-state/route.ts:17-19`) exists but is not this page's idiom. A server action in `_actions.ts` calling `createAddress` keeps one wiring pattern per surface and gets `revalidatePath` for free. The service re-asserts the permission either way (three-layer RBAC, brief §3.4).

**`is_primary: false` always, from this surface.** The partial UNIQUE only constrains `is_primary = true` rows, so a non-primary INSERT can never collide with the existing primary (migration 0014:145-147) and never changes routing defaults out from under existing tasks. The new address becomes *available* to pickers and rotation immediately but *active* only when an operator explicitly selects it — exactly the R4/R5 consumption model. Making the new address primary is the OUT-scoped `setPrimaryAddress`.

## §5 Audit event shape (typed, per the OQ-8 discipline)

New registration in `src/modules/audit/event-types.ts`, modeled on `consignee.crm_state.changed` (`event-types.ts:866-875`):

```
"consignee.address.added": {
  id: "consignee.address.added",
  resource: "consignee",
  action: "address.added",
  description: "Day-53 / T3. Operator added a non-primary address from the
    consignee detail page (Phase-2 add-address surface, Love's Day-53 EVE
    ruling). Emitted in the same transaction as the INSERT.",
  metadataNotes: "consignee_id (uuid), address_id (uuid), label
    ('home'|'office'|'other'), is_primary (always false from this surface).",
  systemOnly: false,
}
```

Standard create-event body (no flat-diff — nothing pre-exists to diff; this matches the `consignee.created` convention, not an OQ-8 shape divergence, and contains no sensitive payload). No `correlation_id`: the unit of work is a single insert with no causally paired event (contrast skip → end-date-extended, brief §3.1.2). The existing `subscription.address_override.applied` / `*_pushed` events are untouched — they fire when the address is *used*, this fires when it is *created*.

## §6 Schema delta — NONE (expectation confirmed)

Plain INSERT into the existing `addresses` table (migration `0014_addresses_and_subscription_address_rotations.sql:121-137`): all captured fields are existing NOT NULL columns, `is_primary` defaults false, the partial UNIQUE is untouched by non-primary rows, and the existing `addresses_tenant_isolation` RLS policy (0014:151-154, FOR ALL with WITH CHECK) covers the write. **No migration, no SQL-TO-APPLY flag.** `insertAddress` already writes `tenant_id` explicitly (defence-in-depth alongside RLS, `repository.ts:100`) inside the `withTenant` transaction-scoped `set_config` (`src/shared/db.ts:123-128`).

## §7 Tests (RED-first, written before implementation)

**Unit (`src/modules/addresses/tests/service.spec.ts` — new; module currently has no specs):**
- `createAddress` happy path: repository called with `isPrimary: false`, audit emitted with the §5 metadata, `{ address_id }` returned.
- Permission denial (no `consignee:update` → forbidden), tenant-scope assertion, label/field validation rejects, unknown consignee rejects.

**Component (`__tests__/AddAddressDialog.spec.tsx`):** JSX-shape coverage per the `ForwardOverrideConfirmDialog.spec.tsx` precedent — fields present, error/pending states.

**Integration, real Postgres (`tests/integration/addresses-create.spec.ts` — new, per the `consignees-create.spec.ts` pattern):**
- New address visible to `listConsigneeAddresses` immediately post-commit (row count 1 → 2, primary unchanged) — this IS the override-picker path, since `ChangeAddressPanel` renders exactly what that function returns (`page.tsx:290` → `availableAddresses`).
- Tenant isolation negative case: address inserted under tenant A is invisible to `listConsigneeAddresses` under tenant B (RLS).
- Partial-UNIQUE invariant: inserting a second non-primary address does not violate `addresses_one_primary_per_consignee_idx`; the consignee still has exactly one `is_primary = true` row.
- Audit row present for `consignee.address.added` with the typed metadata.

**Gates:** full unit suite + `tsc` + `eslint` + integration green; CI status reported at PR open per §7.1 discipline.

## §8 Lane compliance (do-not-touch)

Touched: `src/modules/addresses/**` (service + tests), `src/modules/audit/event-types.ts` (one additive entry), `src/app/(app)/consignees/[id]/` (`page.tsx` fetch-condition + dialog mount, `_actions.ts` one action, one new `_components/AddAddressDialog.tsx` + spec), `tests/integration/addresses-create.spec.ts`. NOT touched: `/tasks` surfaces + nav-config (Session B), `src/modules/credentials/**` + merchant admin pages (Session A), `supabase/migrations/**` (no schema delta), mpl UAT demo data, `DayActionPopover` itself (its copy "Add a second address from the consignee form first" only renders at zero addresses, which cannot occur for onboarded consignees — primary always exists; rewording it is cosmetic and stays out to keep the diff minimal).

## §9 Open questions for the reviewer

1. **Trivially-same-surface ruling (per dispatch):** edit / delete / set-primary / rotation changes are OUT above. If the reviewer judges any of them trivially-same-surface, say so in the verdict; otherwise the §3 line stands and they remain Phase-2-deferred.
2. **Brief bump:** this build retires part of the v1.11 "multi-address UI deferred to Phase 2" deferral (brief §3.3.1 / §9 v1.11). My dispatch assigned no brief version bump, and bumps are dispatch-assigned, never self-assigned (`memory/decision_d53_three_pair_scaling.md` rule 3) — so this plan files NO brief amendment and flags the question to the reviewer surface/Love instead.
3. **Onboarding-copy drift:** `CreateConsigneeForm.tsx:118-119` ("Add more from the consignee detail page after onboarding") becomes TRUE with this build — no copy change needed there. The `DayActionPopover` zero-state copy points at "the consignee form"; left as-is per §8 unless the reviewer rules the one-line reword in-scope.

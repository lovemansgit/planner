---
name: Phase-2 — multi-address + per-weekday rotation UI
description: Surface area deferred from Day-22 Phase 1 forms lane per brief v1.11 amendment; trigger conditions for Phase 2 unblock and what the implementation needs to ship
type: project
---

# Phase-2 followup — multi-address + per-weekday rotation UI

**Filed:** 11 May 2026 (Day 22, AM) per brief v1.11 amendment.
**Trigger:** Day-22 forms lane discovery — `createAddress` service fn doesn't exist; brief §3.3.1 multi-address Step-2 wizard semantics required either ~3.5 hr scope expansion (path A1+B1) or single-address narrowing (path A2+B1, which won the ruling). v1 ships single-address MVP; this memo captures the deferred multi-address surface area for Phase 2 unblock.

---

## §1 Deferred surface area

### §1.1 Service layer (`src/modules/addresses/`)

- `createAddress(ctx, consigneeId, input): Promise<Address>` — currently absent; v1 has `insertAddress` as repository-level export (consumed inside the orchestration tx only). Phase 2 adds the standalone create surface.
- `updateAddress(ctx, addressId, patch): Promise<Address>` — net-new.
- `setPrimaryAddress(ctx, addressId): Promise<Address>` — flips `is_primary` atomically; the partial UNIQUE on `(consignee_id) WHERE is_primary=true` (migration 0014) guarantees at-most-one. Implementation must clear the previous primary in the same tx.
- `deleteAddress(ctx, addressId): Promise<void>` — must enumerate `subscription_address_rotations` references first (FK is `ON DELETE RESTRICT` per migration 0014); error surface should list active references for operator triage.

### §1.2 UI routes

- `/consignees/[id]/addresses` — list view (primary + alternatives).
- `/consignees/[id]/addresses/new` — add address form.
- `/consignees/[id]/addresses/[addressId]/edit` — edit single address.
- `/consignees/[id]/addresses/[addressId]/delete` — delete with reference enumeration.
- `setPrimaryAddress` action affordance from the list row.

### §1.3 Subscription rotation editor

Per brief §3.3.5 ("Address rotation editor (change which address goes which weekday)") — defer to Phase 2:

- Rotation tile UI on `/subscriptions/[id]/edit` (currently absent in Day-22 LANE 3.3 ship).
- `changeAddressRotation` (already shipped, `subscription-addresses/service.ts:175`) is the action target — it accepts a full-replace array of `{ weekday, addressId }`. UI builds and submits this shape.

### §1.4 AddressPicker `allowOverride` slot widening

The forms-primitives library's `AddressPicker` (`src/components/forms/AddressPicker.tsx`, shipped PR #233) already supports `options: ReadonlyArray<AddressOption>` with `kind: "primary"|"alternative"`. v1 only ever passes 0 or 1 options (the primary). Phase-2 unblock requires no API change — just feeding the picker with the multi-address listing from `listAddresses`.

The `allowOverride` flag is gated on the `subscription:change_address_one_off` permission per brief §3.3.3 line 504. v1 does not surface override on the task-edit modal (Sub-PR #2 LANE 4 — see OQ-4 ruling); Phase 2 surfaces it once multi-address is real.

### §1.5 Edit-consignee form address fields

`/consignees/[id]/edit` (Day-22 LANE 2.2) intentionally excludes address fields per the v1.11 amendment to avoid the divergence footgun (consignees inline address columns vs `addresses` primary row). Phase 2 unblock includes:

- Either: extend the edit form with an `updateConsigneeWithPrimaryAddress` orchestration that updates BOTH the consignee inline columns AND the `addresses` row in one tx.
- Or: drop the inline address columns from `consignees` (migration 0014 header documents this as a Phase-2 deprecation step) and migrate the calendar `AddressIndicator` to read from the `addresses` table directly.

The second option is cleaner architecturally; the first is faster to ship.

## §2 Trigger conditions for Phase-2 unblock

Hold this surface back until at least one of:

1. **Operator pilot feedback** explicitly asks for "consignee with two addresses" (e.g. corporate breakfast → home dinner). Anecdotal "users might want it" is not enough — wait for a real ask.
2. **Pilot data** shows `subscription_address_rotations` row count > 0 in production. Currently zero; if it climbs, multi-address routing is genuinely in use.
3. **Brief amendment** to a Phase-2 BRD section that schedules this work into a milestone.

## §3 Implementation effort estimate

- §1.1 service-layer fns + tests: ~2 hr
- §1.2 UI routes (list + new + edit + delete): ~3 hr
- §1.3 subscription rotation editor: ~2 hr
- §1.4 AddressPicker integration on task-edit modal: ~30 min (no API change)
- §1.5 edit-consignee address fields (option 1, orchestration-extension path): ~1.5 hr
- Brief amendment + tests: ~1 hr
- **Total:** ~10 hr aggregate, single Phase-2 PR.

## §4 Schema impact

None expected. The schema (migration 0014) was designed for multi-address from day one — the deferral is purely a UI / service-layer surface decision. The v1 single-address ship doesn't touch the schema; Phase-2 unblock doesn't touch the schema either.

## §5 Cross-references

- `memory/decision_brief_v1_11_amendment_single_address_mvp.md` — the v1.11 amendment that filed this followup.
- `memory/PLANNER_PRODUCT_BRIEF.md` §3.3.1 (post-v1.11) — the wizard scope this defers from.
- `memory/PLANNER_PRODUCT_BRIEF.md` §3.3.5 — the rotation-editor surface this defers to.
- `supabase/migrations/0014_addresses_and_subscription_address_rotations.sql` — schema this would consume unchanged.
- `src/modules/subscription-addresses/service.ts` — `changeAddressRotation` already shipped; Phase-2 UI consumes it.
- `src/components/forms/AddressPicker.tsx` (PR #233) — multi-address-ready primitive.

---

**End followup.**

---
name: merchant.created audit body — 3-way nested-vs-flat drift between plan PR #155 §2.1 + reviewer Gate 4 vs registered metadataNotes vs migration 0017 schema columns
description: Day-16 Block 4-D pre-flight verification surfaced a 3-way drift on the merchant.created audit body shape. Plan PR #155 §2.1 line 148 + reviewer Block 4-D Gate 4 specify a flat-mixed shape (pickup_address_line + pickup_district + pickup_emirate); src/modules/audit/event-types.ts:707-708 metadataNotes registered the nested shape (pickup_address: { line, district, emirate }) at Day-13 PR #139; migration 0017 schema columns are flat all-long (pickup_address_line + pickup_address_district + pickup_address_emirate). Resolution: nested form wins per "registered-metadata-wins" precedent (sibling to "already-shipped wins" from v1.2 §0.3 Option A). Reviewer Gate 4 formally waived to Option C nested at Block 4-D ruling. Plan-text amendment scoped for next plan-sync bundle.
type: project
---

# merchant.created audit body — plan-vs-registration-vs-schema drift

**Surfaced:** Day-16 Block 4-D pre-flight verification.

## §1 The 3-way drift

Three sources prescribe the `merchant.created` audit body shape; all three disagree.

| Source | Body shape |
|---|---|
| **Plan PR #155 §2.1 line 148** | `tenant_id, slug, name, pickup_address_line, pickup_district, pickup_emirate` — flat, mixed (long for `_line`, short for `district`/`emirate`) |
| **Block 4-D reviewer Gate 4** (initial lock) | Same as plan §2.1 — flat mixed |
| **`src/modules/audit/event-types.ts:707-708` `metadataNotes`** (registered Day 13 PR #139) | `tenant_id (uuid), slug (string), name (string), pickup_address (object: { line, district, emirate })` — **nested object**, short inner keys |
| **`supabase/migrations/0017_tenants_pickup_address.sql:59-61` schema columns** | `pickup_address_line, pickup_address_district, pickup_address_emirate` — flat, all long-form |
| **Brief v1.3 §3.1.1** | Service-layer DTO `pickup_address: { line, district, emirate }` (nested); persistence layer maps to schema column names |

The reviewer Gate-4 text-rule was *"USE EXACT COLUMN NAMES"* — applied verbatim to the actual schema columns it would yield all-long-form flat (`pickup_address_line, pickup_address_district, pickup_address_emirate`), but the field names listed in Gate 4 itself used the mixed form (short for district/emirate), inheriting the plan-text drift.

## §2 Resolution — Option C nested wins

**Block 4-D reviewer ruling (this turn):** Gate 4 formally waived. `merchant.created` audit body uses the nested form per Option C, matching the registered `metadataNotes`:

```json
{
  "tenant_id": "<uuid>",
  "slug": "<string>",
  "name": "<string>",
  "pickup_address": {
    "line": "<string>",
    "district": "<string>",
    "emirate": "<string>"
  }
}
```

**Reasoning the reviewer cited:**

- Brief v1.3 §3.1.1 establishes the service DTO as nested `{ pickup_address: { line, district, emirate } }`.
- `audit/event-types.ts` `metadataNotes` registered the nested form at Day-13 PR #139, before the plan was drafted.
- Plan PR #155 §2.1 + Block 4-D Gate 4 both inherited the same plan-text drift.
- Hierarchy: brief > registered contract > plan text > gate ruling. Plan text and gate are the drift; brief + registered metadata agree.

**Persistence-layer is independent:**

The `tenants` table INSERT in Service D's repository writes to columns `pickup_address_line`, `pickup_address_district`, `pickup_address_emirate` verbatim — schema-fixed, non-negotiable. The audit body shape (nested) is independent of column names (flat). The drift only affects what gets written to the `audit_events.metadata` JSONB, not what gets written to the `tenants` row.

## §3 Plan-text amendment for next plan-sync bundle

- §2.1 line 148 (`merchant.created` row in the event-registry table): `tenant_id, slug, name, pickup_address_line, pickup_district, pickup_emirate` → `tenant_id, slug, name, pickup_address: { line, district, emirate }` — matches the registered `metadataNotes` and the brief v1.3 service-DTO shape.
- Block 4-D Gate 4 in any future Block-4-D-adjacent reviewer note: the gate is waived; nested form is canonical.

## §4 Reviewer-discipline note (new convention added at Block 4-D)

**For audit body shape decisions in any future block:** builder probes registered `metadataNotes` at `src/modules/audit/event-types.ts` FIRST, before plan-text or reviewer ruling carries.

The probe is one grep: `grep -n "<event_type_id>" src/modules/audit/event-types.ts` followed by reading the `metadataNotes` field of the registration. If `metadataNotes` documents a body shape, that shape is the registered contract; subsequent plan-text or reviewer rulings that conflict are drift candidates and must be surfaced explicitly with all three sources cited.

This is a subset of the broader "already-shipped wins" precedent from v1.2 §0.3 Option A — registered audit-event metadata is shipped contract.

## §5 Cross-references

- **Plan PR #155** (`0d1ce21`) §2.1 line 148 — the originating plan-text drift
- **Block 4-D pre-flight verification** (Day-16, this turn) — discovery surface
- **`src/modules/audit/event-types.ts:707-708`** — registered `merchant.created` `metadataNotes` (nested form, Day-13 origin via PR #139)
- **`supabase/migrations/0017_tenants_pickup_address.sql:59-61`** — schema columns (flat all-long-form)
- **`memory/PLANNER_PRODUCT_BRIEF.md`** v1.3 §3.1.1 — service-DTO shape (nested, endorses Option C)
- **`memory/decision_brief_v1_2_amendments_d13_part1.md`** — v1.2 amendment §0.3 Option A precedent for "already-shipped names win"
- **`memory/followup_plan_path_drift_subscription_exceptions.md`** — sibling Day-16 plan-vs-code drift memo, same plan-PR amendment vehicle

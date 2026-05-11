---
name: Brief v1.11 amendment — single-address MVP for /consignees/new
description: Day-22 forms lane scope ruling — wizard collapses 4 steps → 3, single primary address per consignee for v1; multi-address + per-weekday rotation deferred to Phase 2
type: project
---

# Brief v1.11 amendment — single-address MVP

**Date:** 11 May 2026 (Day 22, AM)
**Filed by:** Session A, post-discovery scope ruling
**Triggered by:** Day-22 Phase 1 forms lane (Sub-PR #1 — `/consignees/new` wizard) discovery surfaced two service-layer gaps requiring a brief amendment before implementation could proceed.

---

## §1 Discovery — what surfaced

Pre-implementation discovery for `/consignees/new` 4-step wizard found:

1. **No `createAddress` service fn exists in `src/`** — the `addresses` table (migration 0014) has insert sites only in `scripts/seed-demo-personas.mjs`. Production-app code only reads addresses via `subscription-addresses/repository.ts` (rotation lookups), `task-materialization/cte-builder.ts` (CTE address resolution), and `tasks/service.ts` (FK consistency checks).
2. **No `createConsigneeWithSubscription` orchestration** — existing `createConsignee` and `createSubscription` each open their own `withTenant` tx; brief §3.3.1 step 4 says "single transaction" for the wizard's final submit, which the existing API surface cannot satisfy.

Both gaps surfaced as STOP-and-surface architectural questions to reviewer per Day-22 Block-2 §3.6 hard-stop discipline.

## §2 Ruling — bundle A2 + B1 (single-address MVP + atomic orchestration)

Reviewer ruled (Day-22 AM, Block 2):

- **Gap A — A2:** single-address MVP. Defer multi-address + per-weekday rotation to Phase 2.
  - Wizard collapses 4 steps → 3:
    - **Step 1** — consignee details (name, phone, email, notes)
    - **Step 2** — single primary address (label + line + district + emirate)
    - **Step 3** — subscription (cadence, dates, single-task toggle per §J-4)
  - Final submit creates: `consignees` row + ONE `addresses` row (`is_primary=true`) + ONE `subscriptions` row + ZERO `subscription_address_rotations` rows. The rotations CTE (cte-builder.ts:182-187) falls through to the consignee's primary address when no per-weekday rotation row matches — well-formed delivery routing without rotation rows.
  - AddressIndicator chip (PR-A2 calendar surface) keeps rendering correctly — single address is the primary, displayed consistently.
  - Sub-PR #2 (LANE 4 task-edit modal AddressPicker per OQ-4 ruling) shows the single primary address consistently — operator mental model preserved.

- **Gap B — B1:** single-transaction orchestration.
  - New service-layer fn: `createConsigneeWithSubscription(ctx, wizardInput)` at `src/modules/consignees/onboarding.ts`.
  - Opens ONE `withTenant` tx, inlines all 3 writes (consignee + addresses + subscription) atomically.
  - Rollback-on-error semantics — no orphan consignee state possible.
  - Audit emits per existing patterns: `consignee.created` + `subscription.created` post-commit.
  - Both `consignee:create` AND `subscription:create` permissions required; either denial blocks entry pre-tx.

## §3 Brief edits per amendment

- **§3.3.1** wizard rewritten: 4 steps → 3 steps. Step-2 multi-address spec → single primary. "Address rotation" tile in Step 3 dropped (deferred). Brief language updated to make the single-address MVP explicit.
- **§1** (Onboard a consignee, line 62) language tightened: "primary + alternative addresses, per-weekday address rotation" → "primary delivery address" with Phase-2 cross-reference.
- **§9** version log: v1.11 entry added.

## §4 Phase-2 followup filing

`memory/followup_multi_address_rotation_phase_2.md` files the deferred surface area + trigger conditions for unblocking:
- `createAddress(ctx, consigneeId, input)` service fn
- `updateAddress` / `setPrimaryAddress` / `deleteAddress` service surface
- `/consignees/[id]/addresses/...` UI route family for managing the address book
- `subscription_address_rotations` editor on `/subscriptions/[id]/edit` (per brief §3.3.5)
- `AddressPicker` `allowOverride` slot widened to support multi-address rotation choice on task-edit modal (Sub-PR #2 surface; v1 picker only ever shows single primary)

Trigger conditions for Phase 2 unblock: (a) operators ask for multi-address per-consignee in pilot feedback, (b) pilot consignees genuinely need per-weekday rotation (not anecdotal — verifiable via `subscription_address_rotations` row count climbing post-MVP).

## §5 Implementation impact

Sub-PR #1 ships:
- `src/modules/addresses/` — net-new module (types + repository + service + index). `listAddresses(ctx, consigneeId)` is the only public service fn in v1; `insertAddress` exported as orchestration-only repository surface.
- `src/modules/consignees/onboarding.ts` — `createConsigneeWithSubscription` orchestration.
- `src/modules/subscriptions/index.ts` — `insertSubscription` exported as orchestration-only surface (documented inline).
- `/consignees/new` 3-step wizard — full surface per §3.3.1 (post-amendment).
- `/consignees/[id]/edit` — non-address scalar editor only (address editing deferred to Phase 2 alongside rotation UI).
- `/subscriptions/new` — full surface incl. cadence preset chips per OQ-2 + single-task toggle per §J-4.
- `/subscriptions/[id]/edit` — full edit surface incl. pause/resume CTAs per §D.

This brief amendment is filed as a ride-along T1 commit in Sub-PR #1 to keep the amendment atomic with the implementation that depends on it.

---

**End v1.11 amendment.**

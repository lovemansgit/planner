---
name: No UI path to add a second consignee address — R4/R5 unreachable for UI-onboarded consignees
description: v1 creates exactly one primary address per consignee (new-consignee orchestration) and has no surface to add/edit a second address (Phase-2 deferral). R4/R5 address overrides require ≥2 addresses, so they are unreachable for any consignee onboarded through the UI. Surfaced Day-53 PM during the R4/R5 proving pass.
type: followup
---

# The finding

Day-53 PM (2026-06-11), during the R4/R5 address-override proving pass: R4
(one-off) and R5 (forward) are merged, promoted, and **proven on real SF wire**
— but a real operator **cannot reach them for a consignee onboarded through the
production UI**, because v1 provides no way to give a consignee a *second*
address. The override needs ≥2 addresses to be meaningful (you switch from
address A to address B); a one-address consignee's panel lists only the primary.

# Why it's structural (not a data gap)

- **New-consignee form** (`createConsigneeWithSubscription`,
  `src/modules/consignees/service.ts:200` → single `insertAddress`) captures
  exactly one primary address. The form copy says verbatim: *"Single primary
  address for v1. Add more from the consignee detail page after onboarding."*
- **Consignee edit form** (`EditConsigneeForm.tsx`) has **no** address fields —
  only name/phone/email/notes. The promised "add more from the consignee detail
  page" capability does not exist.
- `src/modules/addresses/service.ts` documents the deferral explicitly:
  `createAddress` / `updateAddress` / `setPrimaryAddress` / `deleteAddress` are
  **"NOT in v1 (deferred per brief v1.11 amendment) … lands when multi-address
  rotation UI ships in Phase 2."**
- The subscription page renders *"Single-address MVP. Multi-address rotation per
  weekday ships in Phase 2."*
- The override panel itself instructs *"Add a second address from the consignee
  form first"* — pointing at a form capability that isn't built.

`insertAddress` has exactly one caller (the new-consignee orchestration). No
webhook/inbound-sync path creates consignee addresses either. So the **only**
multi-address consignees are direct-seeded demo personas (e.g. Fatima Al
Mansouri, seeded home+office), and those ship with **no materialised tasks** —
so even they can't exercise the override until a subscription is created to
materialise+push tasks.

# Impact

- **UAT / demo:** R4/R5 cannot be demonstrated against a freshly UI-onboarded
  merchant. A demo needs a **pre-seeded 2-address consignee WITH a
  materialised+pushed subscription**. The Day-53 proving pass bootstrapped this
  by creating a probe subscription for Fatima (who already had 2 seeded
  addresses) through the UI.
- **Production operators:** until Phase 2, the address-override actions are
  effectively inert for any consignee they themselves onboard — the panel will
  always show one address and offer no way to add another.

# Fix shape (Phase 2, not a blocker now)

Ship the deferred address-management surface: an "Add address" action on the
consignee detail page wiring `createAddress` (+ set-primary / edit / delete per
the service-layer TODO), so operators can give a consignee the second address
the override feature already consumes. Until then, R4/R5 demos must use
pre-seeded multi-address consignees.

Optionally, consider whether SF inbound consignee sync should populate the
address book (a second real-world source of multiple addresses).

# Cross-references

- `memory/handoffs/day-53-pm-proving-pass.md` — the proving pass that surfaced this.
- `memory/uat_mvp_scope_definition.md` §5 / §7 — UAT scope; R4/R5 listed as
  "Closed by R4/R5 work" for the move-to-date placeholder, but reachability is
  gated on this.
- `src/modules/addresses/service.ts` — the Phase-2 deferral note (source of truth).

---
name: Consignee notes + loyalty tier + merchant-internal-ID — Phase 2
description: MVP consignee schema does not include free-form notes, loyalty tier, or merchant-internal-ID fields. BRD §6.1.1 calls for these; deferred per Day-12 scope decision.
type: project
---

# Consignee notes + loyalty tier + merchant-internal-ID

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4 + §3.3.1 (Steps 1 + 3 explicitly call out Phase 2); BRD §6.1.1
**Phase 2 trigger:** Post-pilot

## What

Consignee schema in MVP captures: name, primary phone, alternative phone, email, addresses, CRM state. NOT captured:
- Free-form internal notes (operator-only)
- Loyalty tier (Bronze/Silver/Gold-style classification)
- Merchant-internal consignee ID (the merchant's own customer reference)

Onboarding wizard Step 1 + Step 3 explicitly mark these as Phase 2 in the brief.

## Why deferred

Adds schema columns + UI surface area without operational value for the Day-14 demo. Merchants haven't asked for these at this stage.

## When unlocked

Post-pilot, when the first merchant requests "I need to attach our internal CRM ID to your consignees" — likely an early Phase 2 ask.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4 + §3.3.1 Step 1 + Step 3
- BRD §6.1.1

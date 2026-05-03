# Question · Consignee-only bulk import (vs. consignee+subscription bundle)

**Status:** Phase-2 question for product. Captured from `aqib.a` review of `subscription-planner-onboarding_v1.1` page 13.
**Decision:** Defer; not MVP scope.
**Decided by:** Love (engineering-owner).

## Source comment

> "What about creating bulk upload for adding consignee as well?"

## Gap identified

The MVP CSV template (one row = one consignee + one subscription) does not
support a consignee-only upload. A merchant who wants to bulk-add consignees
without immediately attaching subscriptions has no path.

## Why deferred

For meal-plan merchants — the pilot's audience — the consignee IS the
subscription. Customers don't exist in the merchant's world without a
recurring delivery rule attached. The consignee-only use case is more
relevant for non-meal-plan SuiteFleet customers (general e-commerce, ad-hoc
deliveries) and is not the pilot's target.

## Phase-2 question for product

Before building this, validate whether real meal-plan merchants want it.
Possible non-meal-plan use cases that would surface it:

- Onboarding a customer record before their first subscription is finalised
  (e.g., signed up but plan not chosen yet)
- Migrating from a system where customers and orders are separate concerns
- B2B contexts where a single consignee receives many one-off deliveries
  rather than a recurring schedule

If the post-pilot merchant cohort includes any of these, the feature earns
its keep. If they're all meal-plan, skip it.

## Engineering shape if it lands

Trivial — it's the existing bulk-import pipeline minus the subscription
fields. Same validation engine, narrower template, same all-or-nothing
transactional commit. ~1 day of work given the existing bulk-import surface.

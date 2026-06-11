---
name: Skip notifications via SMS to consignee — Phase 2
description: MVP does not notify the consignee when their delivery is skipped. BRD §14 Q5 calls for SMS notifications; deferred to Phase 2.
type: project
---

# Skip notifications via SMS to consignee

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4; BRD §14 Q5
**Phase 2 trigger:** Post-pilot

## What

When an operator skips a delivery on behalf of a consignee, MVP records the skip + reschedule via tail-end reinsertion but does NOT send any SMS / email notification to the consignee. The consignee learns about the skip via their merchant's CS team (the merchant called them, or the consignee called the merchant).

## Why deferred

Notification service is a separate post-pilot module per plan §10.3 — Resend integration scoped but not built; SMS provider not selected. Pilot merchants handle communication out-of-band.

## When unlocked

Post-pilot, alongside the notification service module. SMS provider selection (likely Twilio or AWS SNS) is a separate pre-implementation decision.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4
- BRD §14 Q5
- `docs/plan.docx` §10.3 (notification service deferred)

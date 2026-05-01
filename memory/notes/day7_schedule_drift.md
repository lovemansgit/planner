---
name: Day 7 schedule drift — calendar vs plan-content mismatch
description: Reference note for future-Claude reviewing the canonical 14-day plan. Day 7 calendar (2 May 2026) does not match Day 7 plan content; calendar Day 7 maps to plan Day 9. Captures the mapping at the moment Day 7 work begins, so plan documents remain interpretable as historical artefacts.
type: project
---

# Day 7 schedule drift

**Captured:** 2 May 2026 (Day 7 calendar morning, pre-work)
**Source documents:** `docs/plan.docx` (canonical 14-day plan), `docs/plan-resolutions.docx` (resolutions addendum)
**Why this exists:** Future-Claude reading the plan documents will see "Day 7 = subscriptions module + 30-day preview + MP-01 through MP-12" and will be wrong about what the calendar Day 7 commit history shipped. This note pins the mapping.

---

## The mismatch

| Calendar | Plan content slated | Plan content actually executed |
|---|---|---|
| Day 7 (2 May 2026) | Subscriptions module + 30-day preview + MP-01 through MP-12 | Nightly cron batch + DLQ retry + Sentry init + MP-13/14 + sweeper service (= **Day 9 plan content**) |

Calendar Day 7 ≈ Plan Day 9.

## What already shipped ahead of plan calendar

| Plan day | Plan content | Calendar day actually shipped |
|---|---|---|
| Day 5 | Task module (T-series) | Day 5 (1 May 2026 was Day 6; T-series landed Day 5 = 30 April 2026) |
| Day 6 | Subscriptions S-1 through S-3 | Days 5–6 (S-1 through S-5 across 30 April + 1 May 2026, migrations 0009/0010) |
| Day 7 | Subscriptions S-4/S-5 + 30-day preview + MP-01..12 | Mostly already done by Day 6 EOD |

The accumulated lead carries the project ~2 plan-days ahead of plan calendar at Day 7 calendar start.

## Why the drift accumulated

Three drivers, in order of contribution:

1. **Empirical SF probing collapsed multiple plan-day's-worth of unknowns into single commits.** Day 4 / Day 6 SF probing (`createTask` shape, webhook taxonomy, asset-tracking endpoint) resolved questions the plan had budgeted across 2–3 days each.
2. **Subscription module sub-commits parallelised better than the plan modelled.** S-1 through S-5 were planned linearly across Days 6–7; landed across Days 5–6 because schema (S-1) and service-layer (S-2) had no real coupling once schema froze.
3. **No re-baseline of plan calendar after Day 4.** Lead accumulated silently; first surfaced at Day 7 calendar planning.

## Day 7 row carry-forwards (from `plan-resolutions.docx §3 Day 7`)

Also folded into Calendar Day 7 work:

- MP-13 (consignee deactivation cancels pushed tasks) named test
- MP-14 (push-failure auto-pause at N=3) named test + new `subscription.auto_paused` audit event
- ACTIVE → ENDED transition test pin + `sweepEndedSubscriptions` service-layer logic (cron infra for the sweeper itself slips to Day 12)

## Implications for future-Claude

- **Don't trust plan calendar dates as ground truth for what shipped when.** Trust git log + EOD handoff documents.
- **Plan content remains the canonical scope spec.** What the plan says should ship is still what should ship; only the calendar mapping is loose.
- **Closing-commit discipline applies per calendar day, not per plan day.** Day 7 calendar's closing commit must be reviewed for known semantic gaps the same as any other day.

## What is NOT in scope today (despite plan-Day-9 framing)

- Label generation (MVP-required but slipped to Day 8 or Day 9 per Day 7 brief §4)
- Sweeper cron infrastructure (Day 12 per plan; today is service-layer only)
- Sentry custom dashboards / measurements (Day 11 per plan)

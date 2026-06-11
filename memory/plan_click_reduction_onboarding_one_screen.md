---
name: Click-reduction plan — one-screen subscriber onboarding
description: PLAN (parked for Love's directional ruling). Onboarding a new subscriber today is two separate routes (create consignee, then create subscription); this proposes a single combined onboarding screen. Shared lane (consignees/new + subscriptions/new) — coordinate at build time; would add a new UAT step.
type: reference
---

# Click-reduction plan (c) — one-screen subscriber onboarding

**Status:** PLAN ONLY. Parked `needs-directional-ruling` for Love's one-liner.
No code in this PR. Build (when ruled) touches `src/app/(app)/consignees/new/**`
+ `src/app/(app)/subscriptions/new/**` — a **shared/ambiguous lane**; needs a
session-assignment + a do-not-touch note at build time.

## The problem in plain English

To put a brand-new subscriber into the system, an operator does **two separate
flows on two routes**:

1. **Create the consignee** (`/consignees/new`) — name, phone, email, address.
2. **Then create their subscription** (`/subscriptions/new`) — pick the
   just-created consignee, set the plan / schedule.

That's two screens, two saves, and a navigation in between — and the operator
has to remember to do step 2 after step 1. For the common "new customer signing
up" case, it's one logical task split across two pages.

## Proposed change

A **single onboarding screen** that captures the consignee details **and** their
first subscription on one form, with one save:

- **Consignee block** (name / phone / email / first address)
- **First subscription block** (plan / schedule / first delivery)

Submitting creates the consignee and their first subscription together. Keep the
standalone `/subscriptions/new` for the *other* case — adding a subscription to a
consignee who already exists. So: one-screen for **new subscriber**, the existing
route for **new subscription on an existing subscriber**.

## Run-sheet steps it touches + re-script note

**None of the current run-sheet steps** — the sheet uses **pre-seeded** people
(Fatima, Sarah) and has **no create-a-subscriber flow**. So this change is
additive to the UAT surface: it would **add a new step** (e.g. "**K. Onboard a
new subscriber on one screen**") to the run sheet rather than re-scripting an
existing one. Flagging that the run sheet currently doesn't exercise onboarding
at all — this would be the first such step.

## Recommendation

**One combined consignee + first-subscription form** for the new-subscriber
case; **keep** `/subscriptions/new` standalone for adding subscriptions to
existing consignees. This collapses the common signup from two screens to one
without removing the path the run sheet and existing flows rely on.

## Directional question for Love

1. Approve a **one-screen** consignee + first-subscription onboarding form for
   the new-subscriber case?
2. Keep the standalone `/subscriptions/new` for existing-consignee
   subscriptions (recommended), or fully merge the two?
3. Should a new run-sheet step (K) be added to UAT this, or is it post-UAT?

## Cross-references
- `src/app/(app)/consignees/new/**` + `src/app/(app)/subscriptions/new/**` —
  the two current routes.
- `memory/uat_run_sheet_v1.md` — no current step exercises onboarding (flow A is
  read-only viewing of a pre-seeded subscriber).

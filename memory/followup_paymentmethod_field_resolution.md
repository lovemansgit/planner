---
name: SuiteFleet paymentMethod (sent on create) vs codPaymentMethod (SF-side COD field) — distinct fields, both pilot non-blocking
description: B-1's first memo conflated two independent observations into one "silent drop" finding. Reviewer pointed out that paymentMethod (what we send on create) and codPaymentMethod (returned on GET, SF-side Cash-On-Delivery field) are NOT the same field. paymentMethod is accepted-but-ignored on POST. codPaymentMethod is null on prepaid tasks because there is no COD to record. Both observations stand empirically; the conflation was the bug. Pilot non-blocking (all meal-plan deliveries prepaid). Day-14 vendor escalation downgraded to "scope clarified, non-issue for pilot."
type: project
---

## Finding

S-8 sandbox full-response capture (2026-04-29) revealed that the `deliveryInformation.paymentMethod` field we send on `POST /api/tasks` is not echoed back in the response. The response's `deliveryInformation` block contains 24 fields (including `codPaymentMethod: null`, `taskCompletionReason`, `taskFailureReason`, etc.) but no field named `paymentMethod`.

Specifically:
- We sent `deliveryInformation: { paymentMethod: "PrePaid" }`
- Response top-level has `deliveryDate: "2026-04-30"`, `deliveryStartTime: "09:00:00"`, `deliveryEndTime: "12:00:00"` (these we sent at top level too)
- Response `deliveryInformation` block: every field is `null` except `id: 59027`

## Three possibilities

(a) **We're sending it in the wrong shape.** SuiteFleet may expect `paymentMethod` at the top level, or under a different key like `paymentTerms` or `paymentInformation`.

(b) **SuiteFleet stores it under a different field.** Maybe it's mapped to `codPaymentMethod` (which appears in the response, value `null`). Or stored on a separate paymentInformation/billingInformation record we don't see.

(c) **SuiteFleet silently ignores it.** The field is unrecognised and discarded; payment method effectively isn't tracked on the task. This would be a real product gap — drivers can't know whether the delivery is COD or pre-paid.

## Why it matters

For meal-plan merchants in the pilot, all subscriptions are pre-paid by definition (subscription billing, not per-delivery). The `paymentMethod=PrePaid` is correct but verifying SuiteFleet records it correctly matters for:

- Driver workflows: COD vs PrePaid changes whether the driver collects money
- Reporting: per-merchant revenue reconciliation needs SF-side payment data to match our DB
- Audit: future B2B customers using ad-hoc COD deliveries need this field to actually work

## Verification path (S-9)

After creating a task in S-9 integration tests:

1. **GET `/api/tasks/:id`** — fetch the task by external ID. Check whether any field carries the value `"PrePaid"` (top-level, nested, or in any sub-resource).
2. **Try sending `paymentMethod` at the top level** instead of nested under `deliveryInformation`. Compare responses.
3. **Try sending `codPaymentMethod` directly** (the field SF returns) and observe.
4. **Inspect SuiteFleet's portal** for the created task — does the merchant-facing UI show the payment method?

If GET `/api/tasks/:id` doesn't surface payment method anywhere, escalate to vendor: ask the SuiteFleet account manager what field name they expect and whether their Java client lib has an example.

## Action for S-9

Add a sub-test to the create-task round-trip integration suite that follows the create with a GET, asserts the payment method is recoverable. If the assertion fails, mark the test as `it.todo` and capture the response for the gap analysis.

## Resolution — empirical + reviewer correction (Day 6 / B-2, 1 May 2026, revised)

### Reviewer correction to the original framing

The first version of this section conflated two independent observations into a single "silent drop" finding. Reviewer pointed out:

- **`paymentMethod`** is what we send on create, nested under `deliveryInformation`. A free-text-ish metadata field where we put values like `"PrePaid"` or `"CashOnDelivery"`.
- **`codPaymentMethod`** is what SF returns on GET, also nested under `deliveryInformation`. The SF-side **Cash-On-Delivery** payment method — the mechanism the consignee uses to pay the courier at the door (cash, card, etc.) when the task is configured as COD on the SF side. For non-COD (prepaid) tasks, `codPaymentMethod` is expected to be `null` because there is no money to collect.

These are **NOT the same field**. The original memo treated `codPaymentMethod = null` as evidence that `paymentMethod` was being silently dropped. That conflated two distinct observations of distinct fields.

### Empirical probe (re-interpreted)

Probe executed against sandbox task 59113 (created via S-9 round-trip with `paymentMethod: "PrePaid"`):

```
GET /api/tasks/59113
status: 200
```

A recursive search across every nested field returns exactly one payment-related reference:

```
deliveryInformation.codPaymentMethod = null
```

The value we sent (`"PrePaid"`) appears nowhere in the GET response.

### Two independent observations, read independently

1. **`paymentMethod` is accepted-but-ignored on POST.** SF accepts `deliveryInformation.paymentMethod` without rejection on create, returns no error, and the value never resurfaces — not on GET, not in webhook events, not under any other field name we have probed. This is the original Day-4 finding from S-8 capture, re-confirmed.
2. **`codPaymentMethod = null` is the correct value for a non-COD task.** The probe task was not configured as COD on the SF side, so SF returns null for the COD-payment-method field. This is *not* evidence about `paymentMethod`; it is SF's normal handling of its own COD-related field on a non-COD task.

Both observations are empirically true; conflating them was the bug.

### Pilot-time impact

**Non-blocking for Transcorp's pilot.** All meal-plan deliveries are PrePaid by subscription billing → no COD → `codPaymentMethod = null` is the expected operational state. The driver UI does not surface payment-method information because there is no money to collect on delivery. Both `paymentMethod` and `codPaymentMethod` are operationally irrelevant for pilot scope.

### What `paymentMethod` actually is (best inference)

The `paymentMethod` field SF accepts on create is most likely a free-text metadata field for a vendor's own bookkeeping — accepted on POST so client integrations don't error, but not the operational signal SF uses for COD vs prepaid routing. The actual COD signal lives in a separate task-creation mechanism we haven't fully mapped (probably a customer-level configuration or a different field on the create body); when set, it would populate `codPaymentMethod` on the GET response.

For pilot, this is moot — we don't have COD merchants and the prepaid case is the empty-COD-field case which we already observe.

### Day-14 vendor escalation — DOWNGRADED

The original "where does paymentMethod surface?" question is **downgraded to: scope clarified, non-issue for pilot.** Pulled from the Day-14 vendor-email queue.

A lower-priority residual question, useful pre-future-COD-merchant onboarding (NOT pilot-blocking):

> "When a task should be COD (consignee pays courier at door), what is the correct create-time signal to SuiteFleet, and does that signal populate `codPaymentMethod` on the GET response? Our `deliveryInformation.paymentMethod` send appears to be a metadata-only field that doesn't drive COD routing."

This can land on the Day-14 list if a future COD merchant is in the pipeline; otherwise it's reference material for whenever non-PrePaid scope opens.

## Status

**Resolved as scope clarification** for pilot scope. Documented; non-blocking; vendor-escalation downgraded.

**Surfaced:** Day 4 / S-8 sandbox capture review (29 April 2026).
**Empirical probe:** Day 6 / B-2 closing commit (1 May 2026, initial framing).
**Reviewer correction (paymentMethod ≠ codPaymentMethod):** Day 6 / B-2 closing-commit reviewer round (1 May 2026).

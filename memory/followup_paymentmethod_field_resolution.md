---
name: SuiteFleet drops deliveryInformation.paymentMethod from createTask response
description: We send deliveryInformation.paymentMethod="PrePaid" on createTask, but the response's deliveryInformation block has 24 fields and none named paymentMethod. S-9 must verify whether the field is dropped, renamed, or stored elsewhere.
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

**Surfaced:** Day 4 / S-8 sandbox capture review (29 April 2026).

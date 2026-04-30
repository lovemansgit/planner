---
name: SuiteFleet drops deliveryInformation.paymentMethod end-to-end
description: We send deliveryInformation.paymentMethod="PrePaid" on createTask. Empirical probes (S-8 create response + B-2 GET probe + Day-6 webhook payload) confirm the value is silently ignored — never echoed in any response, never appears in webhook events, no field on GET surfaces "PrePaid" or "Cash" anywhere. codPaymentMethod returns null. Effective product gap for non-PrePaid use cases; non-blocking for pilot (all deliveries PrePaid by subscription definition); needs vendor escalation pre-pilot for any future COD merchant.
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

## Resolution — empirical (Day 6 / B-2, 1 May 2026)

Probe executed against sandbox task 59113 (created via S-9 round-trip with `paymentMethod: "PrePaid"`):

```
GET /api/tasks/59113
status: 200
```

**Result: the value `"PrePaid"` does NOT appear anywhere in the GET response.** A recursive search across every nested field returns exactly one payment-related reference:

```
deliveryInformation.codPaymentMethod = null
```

`codPaymentMethod` was never sent by us; it is a SF-side field that surfaces on the response with a null value. There is no `paymentMethod` (singular) field on the GET response. There is no field anywhere with the value `"PrePaid"`, `"Cash"`, or `"CashOnDelivery"`.

The full `deliveryInformation` block on GET (25 fields) confirms: `id`, `deliveryDate`, `deliveryStartTime`, `deliveryEndTime`, plus 21 nullable operational fields (collectedAmount, completionLatitude, recipientName, signature, taskAssetsReturned, codPaymentMethod, etc.). None carries our payment-method value.

This is consistent with the parallel finding in [followup_suitefleet_webhook_policy.md](followup_suitefleet_webhook_policy.md) ("codPaymentMethod surface confirms Day-4 finding"): on a fully delivered task with otherwise populated `deliveryInformation`, `codPaymentMethod` was also `null`.

### Three-possibilities answer

- **(a) Wrong shape sent.** Unlikely — we sent the doc-shaped `deliveryInformation.paymentMethod` and got no rejection on create; SF's response simply omits it. Possibility (a) cannot be fully ruled out without docs that we don't have, but the silent-drop pattern is more consistent with (c).
- **(b) Stored under a different field.** Empirically false on the surfaces we can probe. The full GET response and the inbound webhook payload do not expose the value under any name.
- **(c) Silently ignored.** ✅ Best-supported by the evidence. SF accepts the field on create, returns no error, and the value never resurfaces. It is effectively dropped.

### Pilot-time impact

**Non-blocking for Transcorp's pilot.** All meal-plan deliveries are PrePaid by subscription billing — there is no per-task payment collection. Drivers do not need to know payment status because they never collect money on delivery. The dropped field has no observable effect on pilot operations.

### Future-pilot impact (when escalation matters)

For any future merchant using **CashOnDelivery** or **partial payments**, SF's silent drop becomes a real product gap:

- Drivers cannot tell from the SF UI whether to collect money at the door
- The `collectedAmount` field returns post-delivery — too late for the driver to know what to ask for
- Reporting cannot reconcile per-task revenue against payment method

This blocks any non-pre-paid B2B use case until SF either (i) acknowledges the field and stores it, or (ii) documents the correct field name / shape. Pre-pilot escalation to the SF account manager is required for any non-PrePaid merchant onboarding.

### Day-14 vendor escalation message

Combine with the other open SF questions (asset-tracking enum exhaustiveness, pagination behaviour, rate limits, etc.) into a single consolidated email. Specific paymentMethod ask:

> "POST /api/tasks accepts `deliveryInformation.paymentMethod` without rejection but the value never surfaces on GET /api/tasks/:id, on webhook events, or under any other field name we can see. `codPaymentMethod` returns null on every response we have inspected. (a) Is `deliveryInformation.paymentMethod` the correct shape? (b) If yes, where is the value persisted and how do drivers see it in the SF mobile/web UI? (c) What is the canonical field name for distinguishing PrePaid / CashOnDelivery / partial-payment tasks at create time? (d) Does the SF mobile UI surface payment method at all, and from which field?"

## Status

**Resolved as known gap** for pilot scope. Documented; non-blocking; vendor-escalation queued for Day-14 message.

**Surfaced:** Day 4 / S-8 sandbox capture review (29 April 2026).
**Resolved (empirically) and documented:** Day 6 / B-2 closing commit (1 May 2026).

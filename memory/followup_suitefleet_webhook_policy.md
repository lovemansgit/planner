---
name: SuiteFleet webhook policy — architectural blocker + carried-forward §14 vendor questions
description: Single home for SuiteFleet webhook semantics. Headline architectural question — does SF support multiple endpoints per merchant per status — gates the additive-vs-relayer decision and W-1's per-tenant URL design. Plus three carried-forward §14 vendor questions (retry policy, error catalogue, programmatic portal API) that previously had no dedicated home.
type: project
---

This file is the consolidated home for every open SuiteFleet webhook-semantics question. The headline — additive vs relayer receiver topology — is an architectural blocker for W-1's per-tenant-URL design and for the Day-8+ multi-merchant rollout. The remaining three are pre-Day-14 vendor questions previously scattered or homeless across the followup tree; they land here so webhook-policy concerns live in one place when the Day-14 vendor email is drafted.

## Architectural blocker — additive vs relayer

### Question

Does SuiteFleet support configuring **multiple webhook endpoints per merchant per status**, so the same event can be delivered to both the Planner URL and the merchant's existing endpoint?

### Why it matters

The answer determines the Planner's position in the merchant's integration topology, and it gates W-1's per-tenant-URL design plus everything downstream.

**If YES → additive receiver.** SF fans each event out to N URLs configured per merchant. The Planner subscribes alongside the merchant's existing webhook receiver; both receive the event independently; neither knows about the other. The Planner is purely a receiver — no outbound webhook obligations, no critical-path liability for merchant flows. Merchant integrations stay untouched. Failure mode is contained: a Planner outage does not block the merchant's existing flows.

**If NO → relayer.** Each merchant has a single webhook URL slot on SF. The Planner takes that slot; the merchant's existing receiver moves behind the Planner. The Planner becomes critical path: it must accept the SF webhook, transform / enrich / persist, then emit a re-broadcast webhook to the merchant's URL with retry-and-DLQ semantics. New surface area lands at once: outbound webhook client, signing, retry policy, dead-letter queue, fan-out reliability. Merchant integration gains entirely new failure modes (Planner outage = merchant blackout for any flow that depends on those events).

The W-1 commit currently in flight assumes the additive model — per-tenant URL on SF, no relay. If the answer is YES, the per-tenant-URL pattern is exactly right and no further architecture is required. If the answer is NO, the per-tenant-URL pattern still works at the SF-side configuration layer but the Planner gains a critical-path obligation; an outbound-emission commit has to gate the W-1 portal config before any pilot merchant goes live.

### Status — empirical probe planned (not vendor email)

This question is verifiable directly via the SF sandbox without waiting on an account-manager response. Rough probe shape (instructions to be confirmed by Love before running):

1. Log into the SF sandbox portal for merchant 588.
2. Configure two webhook endpoints for the same status (e.g. `TASK_HAS_BEEN_ASSIGNED`):
   - Endpoint A: a free `webhook.site` URL (or any disposable receiver), standing in for "the merchant's existing endpoint."
   - Endpoint B: the Planner sandbox URL (post-W-1 dynamic form).
3. Trigger a `TASK_HAS_BEEN_ASSIGNED` event by creating + assigning a sandbox task (`scripts/sandbox-smoke-task-create.mjs` flow + manual portal assign).
4. Observe whether both endpoints receive the event, only one does, or the second-endpoint config silently overwrote the first.

Short-circuit: if the SF portal UI rejects the second-endpoint config outright (greys out the field, surfaces a "one URL per status" notice), the answer is NO without needing to fire an event.

### Probe findings

**Date:** 1 May 2026.

**Method:** Configured two System Webhook entries in the SF sandbox portal — Probe A and Probe B — both Active, both using the same Client ID (`transcorpsb`), each pointed at a separate `webhook.site` capture URL. Triggered the `TASK_STATUS_UPDATED_TO_DELIVERED` status event on task id `59113` (AWB `MPS-98410409`, customer "588 MEAL PLAN SCHEDULAR").

**Result:** Both endpoints received the event. Payloads were byte-identical. Timestamps were identical at `1777533200494`. **SF fans out the same status event to multiple active webhook endpoints in parallel.**

**Per-status configuration:** _Open — Love is still investigating whether SF supports status-level routing (configuring different endpoints for different status events). For now the finding is "all Active System Webhooks fired on this status event"; whether a System Webhook entry can be scoped per-status is not yet confirmed._

**Client Secret field:** _Open — whether the Client Secret field on the System Webhook entry is required or optional has not been confirmed during the probe. Carry as a small operational question for the SF portal config step in W-1._

### Architectural decision

**Decision:** The Planner is an **additive receiver**. SF fans events out to both the Planner per-tenant URL and the merchant's existing webhook URL. Merchant integrations remain untouched. The Planner does NOT relay.

**Architectural implication:** No outbound webhook delivery from the Planner to merchants. No retry/DLQ surface for forwarding. The Planner is not on the critical path for merchant order management — a Planner outage does not block the merchant's existing flows.

**Operational implication:** When onboarding a merchant onto the Planner, the merchant's existing SF webhook configuration stays exactly as-is, and a second System Webhook entry is added in the SF portal pointing at the Planner per-tenant URL (`/api/webhooks/suitefleet/[tenantId]`). Both fire in parallel for every event.

**W-1 status:** The per-tenant URL design (`/api/webhooks/suitefleet/[tenantId]`) is validated. W-1 (PR #46) resumes — the seed-migration + sentinel-UUID fix is the next blocker, separate from the architectural question.

## Bonus findings from probe payload

Two findings unrelated to the additive-vs-relayer question but worth carrying forward, surfaced from inspecting the actual webhook payload received during the probe:

### Bag tracking signal lives on the payload

The webhook payload exposes bag tracking configuration directly under `customer`:

- `customer.taskAssetTrackingEnabled` — boolean, indicating whether bag tracking is enabled for this merchant
- `customer.defaultTaskAssetType` — string, e.g. `"BAGS"`, identifying the default asset type

**Implication for B-1 (bag tracking schema + adapter method):** the bag-tracking-enabled flag is available on every webhook event without a separate API call. The B-1 design can read this directly from the inbound webhook rather than provisioning a separate "is bag tracking enabled?" lookup. Cache the value on the bag-tracking row and refresh on subsequent events.

### codPaymentMethod surface confirms Day-4 finding

On a fully delivered task with otherwise populated `deliveryInformation`, `codPaymentMethod` was `null`. This is consistent with the Day-4 / S-9 empirical finding that `paymentMethod` is dropped from `createTask` responses (per [followup_paymentmethod_field_resolution.md](followup_paymentmethod_field_resolution.md)).

**Implication for B-2 (paymentMethod probe):** the field is missing on the receive side too, not just the create-response side. Day-4's three-outcome hypothesis (surfaces in webhook / absent everywhere / surfaces only via GET) tilts toward "absent everywhere" — but B-2's explicit GET-path probe should still run to confirm.

## Carried-forward vendor questions (brief §14, no prior home)

These are pre-Day-14 questions carried forward from the brief's §14 list. Each was previously homeless or referenced only in passing across other followup files; consolidating here so a single email to the SF account manager can cover all webhook-policy concerns.

### 1. Webhook retry policy

What retry policy does SF apply when a webhook delivery returns 5xx or times out? Specifically:

- Retry count (how many attempts before give-up?)
- Retry interval (constant, exponential, jittered? what spread?)
- Eventual-drop behaviour — does SF surface dropped events anywhere (UI, API, log), or are they silent?

**Why we care:** the Day-7+ cron's failure-recovery design and the Day-5 `failed_pushes` DLQ (T-7) both implicitly assume some retry policy on the SF side. If SF drops on the first failure, our receiver-outage tolerance shrinks dramatically and the receiver SLA story has to lead with availability. If SF retries with generous spacing, brief outages are absorbed silently and the architecture is more forgiving.

### 2. Error code catalogue

The full list of error codes SF emits — both inside webhook payloads and as HTTP 4xx/5xx responses on the REST surface. Today we have ad-hoc knowledge of a handful (auth failures, validation failures, the 23505-ish equivalent on createTask). A catalogue gives us:

- Switch exhaustiveness on the receiver side (which codes need lifecycle handling vs. log-and-drop vs. surface-to-operator)
- Audit-event vocabulary completeness (so failed-attempt logging captures the right reason taxonomy from `followup_audit_failed_attempts.md`)
- Confidence that future SF additions don't silently slip into our default-drop branch

Mentioned in passing in `decision_daily_cutoff_and_throughput.md`'s "Open follow-up — SuiteFleet rate-limit confirmation" section but never given a dedicated home until now.

### 3. SF portal API for programmatic webhook config

Does SF expose a programmatic API for configuring webhook URLs (the same setting humans configure in the SF portal Webhooks page)? If yes:

- W-1's manual-portal operational step becomes a `scripts/configure-webhook.mjs` invocation — no human-in-the-loop browser work.
- Day-8+ multi-merchant rollout (per-tenant URLs across N merchants) becomes scriptable rather than per-merchant manual.
- Removes a non-trivial, error-prone manual step from the Day-14 demo prep.

The Claude SF MCP toolset surveyed during W-1 confirms no webhook-config tool is exposed via MCP. Whether the underlying SF REST API has the capability is the open question — the MCP surface may simply be a curated subset.

## Out of scope for this file (cross-references)

These vendor questions are also pre-Day-14 but live elsewhere by domain and stay there:

- **`Idempotency-Key` honouring** → [followup_createtask_idempotency.md](followup_createtask_idempotency.md), § "Vendor confirmation outstanding (Day-14 list)"
- **`customerOrderNumber` dedupe behaviour** → [followup_createtask_idempotency.md](followup_createtask_idempotency.md), same section
- **Auth endpoint rate limits + account-lockout policy** → [followup_suitefleet_auth_rate_limits.md](followup_suitefleet_auth_rate_limits.md), § "How to apply"
- **`createTask` 5 req/sec — guidance or hard limit** → [decision_daily_cutoff_and_throughput.md](decision_daily_cutoff_and_throughput.md), § "Open follow-up — SuiteFleet rate-limit confirmation"
- **`task-asset-tracking` rate limit** → deferred to B-1 (bag tracking schema + adapter method); will live alongside the bag-tracking decision/followup once B-1 lands

When the Day-14 vendor email is drafted, the three questions above (plus the probed-or-vendor-fallback architectural answer) and the cross-referenced questions should fold into a single consolidated message to the SF account manager.

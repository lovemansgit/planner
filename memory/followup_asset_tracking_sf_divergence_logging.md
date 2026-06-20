---
name: followup_asset_tracking_sf_divergence_logging
description: PARKED build — webhook logs divergence between SF's customer.taskAssetTrackingEnabled and the Planner asset-tracking gate (visibility only; never flips the gate). Not built; awaits scheduling.
metadata:
  type: project
---

# PARKED followup — SF asset-tracking divergence logging (option b, build leg)

**Source:** [[decision_f4_asset_tracking_sf_sync_ruling]] (Love's Day-55 firing,
option b). **Do NOT build now** — Love: "the mirror logging is a separate
parked item." The manual toggle (F4 / PR #524) ships; this is the follow-on.

## What to build (when scheduled)

In the SuiteFleet webhook applier (Builder-1's lane,
`src/modules/integration/**`), when a payload carries
`customer.taskAssetTrackingEnabled`, **compare** it to the tenant's current
`tenants.task_asset_tracking_enabled`:

- If they **disagree**, record the divergence for operator visibility (log
  line + a low-noise signal — Sentry breadcrumb or an `asset_tracking.*`
  audit/observability event; pick per the existing webhook-observability
  pattern). Include `tenant_id`, SF's value, Planner's value, timestamp.
- **NEVER flip the gate** based on the SF field — the admin toggle stays sole
  authority (the staged posture invariant from migration 0034).
- The existing webhook write of `default_task_asset_type` (display-only
  mirror) is unaffected — only the gate is protected.

## Fences / notes

- Lives in the webhook applier — coordinate with Builder-1 (integration lane).
- No gate mutation, no migration anticipated (logging/observability only).
- Re-read [[decision_f4_asset_tracking_sf_sync_ruling]] before building;
  option (c) (SF-authoritative) is explicitly excluded without a new ruling.

---
name: decision_f4_asset_tracking_sf_sync_ruling
description: Love's ruling on how SF's customer.taskAssetTrackingEnabled relates to the manual per-merchant asset-tracking gate (F4) — option (b), SF read-only mirror, admin toggle stays sole authority
metadata:
  type: decision
---

# F4 SF-sync ruling — option (b), SF read-only mirror

**Filed:** 19 Jun 2026 (Day 55), Love's firing clearance on the overnight
Builder-2 wave, verbatim:

> "#524 cleared — F4 SF-sync ruling: option (b), SF read-only mirror. The
> webhook LOGS divergence between SF's customer.taskAssetTrackingEnabled and
> the Planner gate for visibility, but NEVER flips the gate; the admin toggle
> stays sole authority. File this as a §10 ruling + a followup for the
> divergence-logging build (don't build the logging now — the manual toggle
> ships, the mirror logging is a separate parked item)."

## The ruling

The per-tenant asset-tracking gate (`tenants.task_asset_tracking_enabled`,
migration 0034 — THE DARK SWITCH) has **exactly one writer: the manual admin
toggle** (F4 `setMerchantAssetTracking`, gate `merchant:update`, shipped in
PR #524). The SuiteFleet webhook payload field
`customer.taskAssetTrackingEnabled` is **read-only mirror only**:

- The webhook path **MUST NEVER flip the gate** (ON or OFF). This preserves
  migration 0034's staged posture — activation control stays with Planner
  admins, not SF's data.
- The webhook MAY (future, parked — see
  [[followup_asset_tracking_sf_divergence_logging]]) **log divergence** when
  SF's flag disagrees with the Planner gate, purely for operator visibility.
- The admin toggle remains the **sole authority** over the gate value.

Option (c) — SF-authoritative (webhook flips the gate to match SF) — is
**explicitly NOT adopted** and is not to be built without a fresh, explicit
Love ruling.

## Status

- The manual toggle (F4) **ships now** via PR #524.
- The divergence-logging build is a **separate parked item**, NOT built now
  — see [[followup_asset_tracking_sf_divergence_logging]].
- Builder-1 owns the webhook applier path; the divergence-logging build,
  when authorized, lands in that lane.

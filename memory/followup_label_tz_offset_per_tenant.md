---
name: D8-6 LABEL_TZ_OFFSET=4 hardcode — must become tenant-derived before multi-GCC rollout
description: D8-6's label-client.ts hardcodes `tz_offset=4` (Asia/Dubai UTC+4). Works for UAE + Oman (both UTC+4 year-round). KSA is UTC+3. Other GCC markets likely +3. The constant becomes incorrect on the first non-UAE tenant onboard. Must convert to a tenant-derived value before multi-GCC production rollout.
type: project
---

# D8-6 LABEL_TZ_OFFSET hardcode — multi-GCC rollout blocker

**Captured:** 2 May 2026 (Day 8 closing-commit self-review, post-D8-6 merge)
**Trigger to revisit:** **first non-UAE/non-Oman tenant onboard.** Until then, the hardcode is operationally correct.

---

## The gap

`src/modules/integration/providers/suitefleet/label-client.ts` carries:

```ts
/** Asia/Dubai UTC+4 year-round; SF endpoint requires explicit tz_offset. */
const LABEL_TZ_OFFSET = 4;
```

The SF generate-label endpoint uses this value to render delivery timestamps on the label PDF in the operator's local timezone. The constant is correct for UAE (and Oman, which is also UTC+4 year-round, no DST). It is **incorrect** for:

- **KSA (Saudi Arabia)** — UTC+3 year-round, no DST. Renders timestamps 1h off.
- **Bahrain, Qatar, Kuwait** — UTC+3 year-round, no DST. Same.
- **Egypt** — UTC+2 standard, +3 with DST in summer (DST returned in 2023). Variable.
- **Anywhere else GCC tenants might expand to** — unknown.

A wrongly-rendered timestamp on a delivery label causes operational confusion (driver shows up at "10:00" thinking that's local but the label says 10:00 GST, etc.). Not a data-integrity issue per se; SF stores the underlying timestamp correctly. But operationally meaningful.

---

## Why this gap exists

Pilot scope is UAE-only meal-plan deliveries (per `memory/followup_c3_deferred_day8.md` — `countryCode='AE'` is the locked default). Hardcoding `tz_offset=4` was the right call for D8-6:

- One value covers every pilot tenant.
- Adding tenant-derivation infrastructure for a value that doesn't yet vary would have been speculative scope (CLAUDE.md rule).
- The hardcode is documented in the file header with the year-round-no-DST justification.

The trigger to revisit is concrete: first non-UAE tenant onboard.

---

## Resolution path (Day 9+, gated on multi-GCC rollout)

### Step 1: derive timezone per tenant

Two viable storage shapes:
1. **`tenants.timezone_offset_minutes`** integer column (e.g., `240` for UTC+4, `180` for UTC+3). Easy to compute against; numeric arithmetic for any future calendar logic.
2. **`tenants.timezone` IANA string column** (e.g., `'Asia/Dubai'`, `'Asia/Riyadh'`). More expressive; future-proof against DST regions like Egypt; requires a runtime lookup (Intl API or a constant table) to convert to the SF-required hour offset.

Lean: **(2) IANA string** — pilot scope is no-DST, but if a DST region ever onboards the IANA string is the right shape. The label-client converts to hour offset at request time. Cost is one Intl/Date computation per label call, negligible.

### Step 2: thread it through

- `LastMileAdapter.printLabels(session, taskIds)` signature stays unchanged — the timezone resolves in the SF adapter layer via the existing per-tenant credentials path.
- `last-mile-adapter-factory.ts`'s `printLabels` wiring: after `resolveCredentials(session.tenantId)`, also resolve the tenant's timezone (new helper or extend the credentials object).
- `label-client.ts`'s `buildSuiteFleetLabelUrl` accepts a `tzOffset` parameter (no longer reads the hardcoded constant). The constant stays in the file as the default for tests / single-tenant fallback only.

### Step 3: tests

- Update `label-client.spec.ts`'s URL-shape tests to pass the tz_offset as input rather than expecting `4` literally.
- Add a test pinning the per-tenant resolution (mock the credentials resolver returning two tenants with different offsets, assert the URL changes).

---

## Cross-references

- `src/modules/integration/providers/suitefleet/label-client.ts` — the file with the hardcode
- `memory/followup_suitefleet_label_endpoint.md` — the original endpoint shape capture (locked tz_offset=4 there too)
- `memory/followup_c3_deferred_day8.md` — pilot's UAE-only `countryCode='AE'` lock; same trigger surfaces tz_offset
- D8-6 PR #84 — the commit that surfaced this gap during closing-commit self-review

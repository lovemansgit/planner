---
name: P3 subscription seeding plan — Day 11/12 (T2)
description: Plan-only memo for the 3-P3-merchant subscription seeding work that follows P3 onboarding (Day 10) and P4 operator nav (Day 11). MVP demands 1000 tasks per merchant by Day 14; once subscriptions land, the daily cron at 12:00 UTC (16:00 Asia/Dubai) starts generating tasks. Lean scripted (extend the onboard-merchant.mjs pattern with a new seed-subscriptions.mjs CLI) over CSV import (no operator-facing CSV surface exists yet, and the per-merchant variation is easier to express programmatically). Per-merchant variation in cadence + plan archetype + delivery zones surfaces the UI's per-tenant differentiation during demo. Implementation runs Day 12; this memo locks the surface for review.
type: project
---

# P3 subscription seeding plan

**Tier:** T2 (data seeding, no schema/security surface — uses the existing `createSubscription` service path)
**Driver:** MVP definition — *1000 tasks per merchant by Day 14.* Once subscriptions land in MPL/DNR/FBU, the daily cron (`0 12 * * *` UTC, [vercel.json:3-7](../vercel.json#L3-L7)) starts generating tasks. Day 14 is 3 calendar days away as of memo authorship (4 May 2026).
**Status:** plan-only — no code today. Implementation lives Day 12 in a follow-up PR after this plan reviews.
**Hard-stop:** plan-memo only; do NOT open a P3-impl PR today.

---

## §0 What's in place

After Day-10 P3 onboarding (PR #104) + Day-11 P4 (PR #117):

- 3 tenants seeded on shared DB:
  - MPL (Meal Plan Scheduler) — `tenants.id` 4d53221c-7681-406b-8e46-224cd75a5c5b, slug `meal-plan-scheduler`, customer_code `MPL`
  - DNR (Dr. Nutrition) — `tenants.id` 0dabde8a-8fb5-4a67-9235-173759855e51, slug `dr-nutrition`, customer_code `DNR`
  - FBU (Fresh Butchers) — `tenants.id` 84013d14-00d2-4cdf-9c86-248295a2b790, slug `fresh-butchers`, customer_code `FBU`
- 3 admin users with Tenant Admin role assignments per tenant
- 0 consignees, 0 subscriptions, 0 tasks per tenant
- `createConsignee` and `createSubscription` service paths live at [src/modules/consignees/service.ts:106](../src/modules/consignees/service.ts#L106) and [src/modules/subscriptions/service.ts:183](../src/modules/subscriptions/service.ts#L183) — both single-row, no `bulkCreate*` exports today
- Cron `/api/cron/generate-tasks` runs daily at 12:00 UTC (16:00 Asia/Dubai); walks tenants whose `suitefleet_customer_code IS NOT NULL` and generates tasks for upcoming scheduled dates
- Path B SF-credentials posture per [decision_mvp_shared_suitefleet_credentials.md](../decision_mvp_shared_suitefleet_credentials.md) — all 3 tenants push to SF merchant 588 in sandbox SF

---

## §1 Approach — scripted seeding, NOT CSV import

### Decision: scripted

Two approaches considered:

- **A) Bulk CSV import.** Requires a tenant-facing CSV upload endpoint (gated on `subscription:bulk_create` / `consignee:bulk_create`). Permission exists in the catalogue but no implementation does. Building this is post-MVP scope per the plan-of-record.
- **B) Scripted seeder.** New CLI at `scripts/seed-subscriptions.mjs` mirroring the `onboard-merchant.mjs` shape: dotenv-loads, takes a `--tenant-slug` arg, walks the per-merchant config (defined in-script), writes consignees + subscriptions via the service-role client.

**Recommend B.** The scripted approach matches the existing operator-script pattern (onboard-merchant, teardown-merchant), supports per-merchant variation declaratively, and doesn't gate on a missing operator-facing CSV import surface. Its expected lifecycle is short — pilot seeding only; the post-MVP CSV import is a separate workstream.

### What the script does

```
npm run seed-subscriptions -- --tenant-slug=meal-plan-scheduler [--reset]
```

Per invocation:

1. Resolve tenant by slug → tenant_id (fail loud if not onboarded)
2. (`--reset`) Optional: delete existing consignees + subscriptions for this tenant via service-role + RULE-disable per the audit_rule_cascade_conflict pattern
3. Read the merchant's config from in-script `MERCHANT_PROFILES` (see §3)
4. Seed N consignees (deterministic UUIDs from a per-merchant seed for re-run idempotence) via `createConsignee`
5. Seed M subscriptions linking to those consignees via `createSubscription`, varying cadence + delivery window per profile
6. Print a summary: `seeded N consignees, M subscriptions for tenant <slug>`

Idempotent on re-run if `--reset` is passed; without `--reset` it inserts new rows (CSVish "append" semantics) — intentional escape hatch for incremental seeding.

---

## §2 Subscription shape — what gets seeded

The `createSubscription` service takes `CreateSubscriptionInput`:

| Field | Notes |
|---|---|
| `consigneeId` | FK to a seeded consignee |
| `startDate` | "today" (`new Date().toISOString().slice(0,10)`); see §5 for backfill posture |
| `endDate` | null (open-ended) for the pilot — operators exercise the End flow during testing |
| `daysOfWeek` | ISO 1-7 array per merchant cadence (§3) |
| `deliveryWindowStart` / `End` | HH:MM:SS strings, varied by merchant |
| `addressOverride` | null (use consignee's default address) |
| `mealPlanName` | merchant-flavor-specific text (§3) |
| `externalRef` | null in pilot (no upstream ID to track) |

`status` defaults to `active` via the `0009_subscription.sql` DEFAULT; the script doesn't pass it. Operators exercise pause/resume/end during pilot — those flows already ship with API endpoints and tests.

---

## §3 Per-merchant variation (locked at memo authorship)

Variation surfaces the UI's per-tenant differentiation during demo. Each merchant gets a distinct *flavor* — different cadences, plan archetypes, delivery zones — so the operator running each tenant sees obviously-different content during their session.

### MPL — Meal Plan Scheduler

| Field | Value |
|---|---|
| Plan archetype | Vegetarian / vegan meal plans |
| `mealPlanName` examples | `"5-day veggie box"`, `"weekday plant plan"`, `"green starter"`, `"vegan reset"` |
| Cadence | 5-day weekday (`daysOfWeek = [1,2,3,4,5]`) |
| Delivery window | Lunch (`12:00:00 – 14:00:00`) |
| Delivery zones | Dubai only (consignees with `emirateOrRegion = "Dubai"`) |
| Volume target | 200 consignees × 1 subscription each = 200 subs × 5 days/wk = ~1000 tasks/wk |

### DNR — Dr. Nutrition

| Field | Value |
|---|---|
| Plan archetype | Medical / diet-controlled plans |
| `mealPlanName` examples | `"diabetic-friendly daily"`, `"low-sodium plan"`, `"weight-management protocol"`, `"post-op recovery box"` |
| Cadence | 7-day daily (`daysOfWeek = [1,2,3,4,5,6,7]`) — consistency matters for medical regimens |
| Delivery window | Morning (`07:00:00 – 09:00:00`) |
| Delivery zones | Dubai + Sharjah (mix in consignee seeding) |
| Volume target | 145 consignees × 1 sub each = 145 subs × 7 days/wk = ~1015 tasks/wk |

### FBU — Fresh Butchers

| Field | Value |
|---|---|
| Plan archetype | Meat boxes / butcher subscriptions |
| `mealPlanName` examples | `"weekly grass-fed box"`, `"family BBQ plan"`, `"twice-weekly meat assortment"`, `"premium cuts"` |
| Cadence | 2-day weekly (`daysOfWeek = [2,5]` Tue/Fri) |
| Delivery window | Evening (`17:00:00 – 19:00:00`) |
| Delivery zones | Dubai + Abu Dhabi (mix in consignee seeding) |
| Volume target | 500 consignees × 1 sub each = 500 subs × 2 days/wk = ~1000 tasks/wk |

### Why these numbers

The MVP definition is "1000 tasks per merchant by Day 14." Each merchant's volume target lands at ~1000 tasks/wk under their specified cadence — within a margin that absorbs day-of-week alignment.

If the demo measures "1000 cumulative tasks since seeding" rather than "1000 tasks generated daily," even the lower-cadence FBU tenant clears 1000 within ~1 week of seeding. If the demo measures "1000 tasks visible right now," the math holds for active subscriptions × pending+upcoming task generation.

The numbers also reflect realistic merchant shapes: a medical-plan operator (DNR) carries fewer customers but each one daily, a butcher (FBU) carries more customers each on a lower cadence, a meal plan scheduler (MPL) sits between.

---

## §4 Consignee distribution — what gets seeded with the subscriptions

Each merchant needs consignees as foreign-key targets. The plan seeds them in the same script (a sub-step before subscription seeding) so the `--reset` flow is atomic.

| Merchant | Consignee count | Distribution |
|---|---|---|
| MPL | 200 | All Dubai, varied addresses across Dubai sub-regions |
| DNR | 145 | 100 Dubai + 45 Sharjah |
| FBU | 500 | 350 Dubai + 150 Abu Dhabi |

Consignee fields populated:
- `name` — synthetic (e.g., `"MPL Customer 001"` through `"MPL Customer 200"`); operators see this as the "consignee" column in the subscriptions list. Synthetic-but-numbered keeps demo legibility high without needing real PII.
- `phone` — E.164 format with valid UAE prefix (`+9715xxxxxxxx` random digits, deterministic per consignee index per merchant)
- `emirateOrRegion` — per the distribution above
- `addressLine` — synthetic but plausible (e.g., `"Building 12, Street 3, Al Barsha, Dubai"`)
- `district` — required by SF for createTask wire body (per [followup_c3_deferred_day8.md](../followup_c3_deferred_day8.md)); seeded with the operator's emirate-relevant district

Phone numbers are deterministic from the consignee index so re-runs produce identical fixtures (idempotency with `--reset`).

---

## §5 Backfill question — start fresh from today

### Decision: subscriptions seeded with `startDate = today`; no historical task backfill

Two options considered:

- **A) Backfill historical tasks.** Seed subscriptions with `startDate` 7 or 14 days in the past + walk the date range emitting tasks for past dates. Gives "1000 tasks visible right now" instantly. Forces one-shot historical task generation outside the cron path; either by extending the cron's lookback or by writing a separate `scripts/backfill-tasks.mjs`.
- **B) Start fresh from today.** Seed subscriptions with `startDate = today`, let the cron generate tasks daily from that point forward. Demo scales over the 3 days between Day 11 and Day 14.

**Recommend B (start fresh).** The cron's task-generation path is the production code path; backfill is a one-shot bypass that introduces a separate untested code path days before the demo. Operators testing MPL on Day 12 see Day-12 tasks; Day-13 they see Day-12+13; Day-14 they see Day-12+13+14 cumulative — that's the realistic operator-pilot experience and matches what production-with-real-merchants will look like.

The MPL tenant ships ~200 tasks/day (Mon-Fri) → by Day 14 the cumulative total is ~600-800 tasks (depending on weekday alignment). Below the "1000" target. If 1000 is a hard floor, options:
- Run the seed script earlier (e.g., end of Day 11 / start of Day 12) so Day 12 + 13 + 14 = 3 daily-generation cycles, totaling ~600 tasks for MPL.
- Bump the per-merchant subscription count proportionally (if MPL needs 1000 tasks Mon-Fri, run 200 → 250 subs to hit 1000+ in 4-5 days).
- Or revise the MVP's "1000 tasks" definition to "1000 cumulative tasks across the pilot window (Day 12 → Day 14 + a buffer day)."

DECISION NEEDED: do we treat 1000 as cumulative-by-Day-14 or as visible-on-Day-14? Different volume calculations apply.

---

## §6 Cron interaction

The cron at `/api/cron/generate-tasks` runs at `0 12 * * *` UTC (16:00 Asia/Dubai). After seeding, the cron's behavior:

- Walks `tenants WHERE suitefleet_customer_code IS NOT NULL` (all 3 P3 merchants qualify)
- For each tenant, walks active subscriptions whose `daysOfWeek` includes the next-day's day-of-week (or whatever the lookahead window is — verified at impl time)
- Emits tasks for those subscriptions; pushes to SF merchant 588 (Path B) per existing creds resolution
- Emits `task.created` audit events; failed pushes land in `failed_pushes` DLQ

What seeding doesn't change:
- The cron path itself
- The push-to-SF behavior (everyone routes to merchant 588)
- The DLQ retry surface (`/admin/failed-pushes`)
- The webhook receiver (`/api/webhooks/suitefleet/[tenantId]`)

What seeding does change:
- Empty cron passes start producing real work
- Operators see real subscriptions in `/subscriptions` lists
- Day-14 demo has actual data to demonstrate against

### One pre-impl verification

The plan assumes the cron generates tasks for "tomorrow" (or some lookahead). Day 12 implementation verifies this by reading the cron's actual scheduling logic and confirming the seeded `startDate = today` subscriptions trigger tasks at the next 12:00 UTC tick (or at the manual trigger if used during impl). If lookahead is "next 7 days," even better — cumulative builds faster.

---

## §7 File-level scope (Day 12)

| File | Change | Rationale |
|---|---|---|
| `scripts/seed-subscriptions.mjs` | NEW | The CLI; mirrors `onboard-merchant.mjs` shape (dotenv, service-role client, idempotent w/ `--reset`) |
| `package.json` | npm script entry | `"seed-subscriptions": "node scripts/seed-subscriptions.mjs"` |
| `scripts/teardown-merchant.mjs` | OPTIONAL update | If teardown should also clear seeded fixtures, extend its scope; otherwise keep them separate |
| `tests/unit/seed-subscriptions-config.spec.ts` | NEW (light) | Pure unit test of the in-script `MERCHANT_PROFILES` config — verifies cadence math, volume targets, zone distribution. Doesn't exercise the DB; the script itself is operator-run, not auto-tested |

Estimated diff: ~250-350 lines (one new script + one config-validation test + the npm script entry).

No service-layer changes. No schema changes. No new permissions. Purely a script-layer addition.

---

## §8 Test posture (Day 12)

The scripted seeder is operator-run, not CI-run. Test coverage strategy:

- **Pure config validation (~3-5 unit tests).** Verify `MERCHANT_PROFILES` has the expected shape, the cadence math lines up with the volume targets, no overlap in synthetic phone numbers between merchants. Keeps the static config drift-free.
- **No DB integration test.** The script runs against a real DB once; CI doesn't need to re-run it. Manual verification on Preview after first run is sufficient.
- **Manual smoke after impl.** Operator (Love) runs the script for one merchant on Preview, verifies the subscriptions list page shows the seeded data, then triggers the cron manually (`curl -H 'Authorization: Bearer $CRON_SECRET' /api/cron/generate-tasks`) to confirm tasks generate.

---

## §9 Watch-list for reviewer (Day 12 PR)

1. **Service-role client for bulk inserts.** The script uses `withServiceRole` to bypass RLS for the seeding bulk path. This matches `onboard-merchant.mjs` precedent.
2. **Idempotency with `--reset`.** The reset path needs to handle the `audit_events_no_delete` RULE per [followup_audit_rule_cascade_conflict.md](../followup_audit_rule_cascade_conflict.md) — disable the rule, delete consignees + subscriptions cascading via FK, re-enable. Same pattern as `teardown-merchant.mjs`.
3. **Audit emit volume.** 200 consignees + 200 subscriptions = 400 audit events for MPL alone, in a tight loop. The `audit_events` table absorbs that fine, but the script should flush/wait between batches to avoid pegging the connection pool. Probably a 50-row batch with `await Promise.all(...)` per batch is the right shape.
4. **Synthetic phone numbers.** The phone format is real UAE-prefix + random-but-deterministic digits. Confirm no collision with real seed data (the existing CI residue's 339 stale tenants might have phone collisions if it had any; verify post-impl).
5. **`mealPlanName` text.** The pilot's first plan-name strings are operator-visible — get them right (no obviously-fake "tabchilli"-style placeholders per the [example-data hygiene memo](../followup_example_data_in_user_facing_help.md)). Use believable names per §3.
6. **Cron's lookahead is unverified.** The plan assumes "next-day generation"; impl should verify and document.
7. **Volume target may need adjustment.** Per §5 DECISION NEEDED, if the MVP's "1000 tasks" is "visible-on-Day-14," seeded counts might need to scale up to 250+ per merchant.

---

## §10 Out of scope (post-MVP)

- Operator-facing CSV import endpoint (deferred — `subscription:bulk_create` permission exists but no implementation)
- Real customer-data import (post-MVP per the migration-import path with its own gate-set)
- Per-tenant import history UI (operators currently see seeded data via `/subscriptions`; no import-log page)
- Address-override examples in the seed (`addressOverride = null` everywhere; pilot tests address-override via manual operator edits)
- Pause / Resume / End starting states (everyone seeds `active`; operators exercise transitions during pilot)
- Externally-referenced subscriptions (`externalRef = null`)

---

## §11 Sequencing

```
P3 onboarding (Day 10)
  └─ P4 nav (Day 11 — PR #117 merged)
        └─ Double-resolve fix (T2 follow-up — PR before P5)
              └─ P3 subscription seeding (this plan — Day 12 implementation)
                    └─ Day-12+13+14: cron generates tasks daily; operator validation runs
                          └─ Day-14: MVP demo
```

Implementation lands Day 12 morning. Cron's first post-seed run hits Day 12 at 16:00 Dubai → tasks visible Day 13 morning. Demo is Day 14.

---

## §12 Cross-references

- [memory/decision_mvp_shared_suitefleet_credentials.md](../decision_mvp_shared_suitefleet_credentials.md) — Path B; all 3 merchants share SF merchant 588
- [memory/handoffs/day-10-eod.md](../handoffs/day-10-eod.md) §6 — Day-11 carry-forward calling for this plan
- [memory/plans/p4_operator_nav_plan.md](p4_operator_nav_plan.md) — companion plan (Day-11 work)
- [memory/followup_double_session_resolve_per_request.md](../followup_double_session_resolve_per_request.md) — T2 follow-up that lands before P5; ordering note
- [memory/followup_audit_rule_cascade_conflict.md](../followup_audit_rule_cascade_conflict.md) — RULE-disable pattern needed for `--reset`
- [memory/followup_example_data_in_user_facing_help.md](../followup_example_data_in_user_facing_help.md) — example-data hygiene; affects mealPlanName + consignee.name choices
- [src/modules/subscriptions/service.ts:183](../src/modules/subscriptions/service.ts#L183) — `createSubscription` entry point
- [src/modules/consignees/service.ts:106](../src/modules/consignees/service.ts#L106) — `createConsignee` entry point
- [scripts/onboard-merchant.mjs](../../scripts/onboard-merchant.mjs) — script pattern to mirror
- [scripts/teardown-merchant.mjs](../../scripts/teardown-merchant.mjs) — `--reset` pattern reference
- [vercel.json](../../vercel.json) — cron schedule (`0 12 * * *` UTC)

# Transcorp Subscription Planner — Product Brief

**Status:** Active. This document is the source of truth for Planner product scope, architecture, and demo posture. Supersedes `docs/plan.docx` §10 Day 11–13 scope where in conflict.

**Version:** v1.1
**Filed:** Day 12 (5 May 2026), evening
**Path:** Path 2-A (full operator-experience layer, demo May 12)

**Provenance:** This brief is consolidated from:
- Day-1 BRD (`docs/Subscription_Planner_BRD_v1.docx`)
- Day-1 Enterprise Build Plan v1.0 + v1.1 delta (`docs/Enterprise_Build_Plan_v1.docx`, `docs/Enterprise_Build_Plan_v1_1_delta.docx`)
- Day-1 Claude Code prototype brief (`docs/Claude_Code_Brief_Subscription_Planner.docx`)
- Day-1 reviewer's refinement note (filed Day 12 evening, 15 amendments)
- Day-12 frontend scope audit + capability probe
- Love's Day-12 product vision dump (meal-plan CRM positioning)
- Day-12 reviewer triage + scope decisions

**Amendment protocol:**
- This document is not a handoff brief. It is permanent product memory.
- Every Day-N EOD doc references this brief by section, does not duplicate.
- Every substantive PR description references this brief for scope.
- Amendments require an explicit `decision_*.md` filing with reasoning + a versioned update here. Silent inline edits are prohibited.
- Deferring a scope item requires both: (a) marking the item as deferred in this brief with reason and target phase, (b) filing a `followup_*.md` if applicable.
- New scope additions follow the same protocol: explicit decision + brief amendment + version bump.

**Reading discipline for reviewers (any session, any day):**
1. Read this brief in full before approving any substantive PR.
2. If a PR's scope is not represented in this brief, the PR is rejected pending brief amendment.
3. If this brief conflicts with an EOD doc or memo, this brief wins; the conflicting document is amended.

---

## 1. Project framing

The Transcorp Subscription Planner is a **Transcorp-owned microservice** that integrates SuiteFleet as a backend last-mile execution layer.

**IP ownership:** Transcorp owns the Planner product, the operator UX, the merchant-CRM functionality, and the data model. SuiteFleet is a vendor consumed for last-mile delivery execution (task push, label generation, webhook telemetry, asset tracking).

**Product positioning:** The Planner is offered to meal-plan merchants as a value-add service. Transcorp's tool helps merchants run their subscription business; Transcorp's logistics arm executes deliveries via SuiteFleet.

**Demo audience reframe:** Transcorp leadership / CAIO pitch panel. Pitch story is "I built Transcorp's owned subscription delivery product in 14 days using AI" — emphasis on ownership and architectural rigor, not on integration plumbing.

**Reference prototype:** `subplanner.vercel.app/consignee/c_001` — Love's pre-sprint conceptual prototype (calendar-driven, consignee-centric). Used as visual + interaction reference. Adapted to Transcorp brand tokens per `memory/decision_brand_guidelines_v2.md` and `transcorp-lofi-v2.vercel.app` design language.

**Framing supersedes:** Earlier sprint days framed the Planner as "frontend for SuiteFleet." That framing is retired. The Planner is a standalone product with its own UX, owned by Transcorp, that calls SuiteFleet APIs.

---

## 2. Product vision

The Planner is a **meal-plan CRM for merchants**. Merchants use it to manage their subscriber base end-to-end. Transcorp staff use a separate admin surface to onboard merchants onto the platform.

### 2.1 Three operator role contexts

| Role context | Who | Surface | Data scope |
|---|---|---|---|
| `transcorp_staff` | Transcorp internal team | `/admin/merchants/*` | Cross-tenant (all merchants) |
| Merchant operator | Merchant team (Tenant Admin / Operations Manager / Customer Service Agent — see §3.4) | `/`, `/consignees/*`, `/subscriptions/*`, `/tasks`, `/calendar` | Single-tenant (own merchant) |

### 2.2 Six core merchant-operator workflows

1. **Onboard a consignee** — capture subscriber details, primary + alternative addresses, per-weekday address rotation, set delivery rules. System materializes tasks from rules going forward (rolling 14-day horizon, see §3.1.5).
2. **View subscriber base** — list all consignees with CRM state badges; drill into individual consignee detail showing their subscription as a calendar (week/month/year toggle).
3. **View today's operations** — consolidated merchant calendar showing all consignees' deliveries for the day/week, filterable by status/area/time window.
4. **Handle exceptions** — skip a delivery (with automatic tail-end reinsertion per §3.1.6), pause/resume a subscription with bounded duration, change address one-off or forward-going.
5. **Apply skip overrides** — move skipped delivery to specific date instead of tail-end; skip without appending (cancel without compensation).
6. **Maintain consignee CRM state** — transition consignees between states (Active, On Hold, High Risk, Inactive, Churned, Subscription Ended).

### 2.3 One Transcorp-staff workflow

1. **Onboard, activate, deactivate a merchant** — create the merchant tenant (name, slug, pickup address as ship-from), activate, deactivate.

---

## 3. MVP scope (ships by demo May 12, 2026)

### 3.1 Backend additions

#### 3.1.1 Schema migrations

**`subscription_exceptions` table:**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `subscription_id` | uuid FK | references `subscriptions(id)` |
| `tenant_id` | uuid FK | denormalized for RLS |
| `type` | text CHECK | `'skip'`, `'pause_window'`, `'address_override_one_off'`, `'address_override_forward'`, `'append_without_skip'` |
| `start_date` | date | for single-day exception, equals end_date |
| `end_date` | date | for pause_window, the resume date; for address_override_forward, NULL or far-future |
| `target_date_override` | date | for skip overrides where operator picks a specific date instead of tail-end |
| `skip_without_append` | boolean | for `type='skip'` — when true, no compensating insert; subscription end_date unchanged |
| `reason` | text | optional operator-supplied reason |
| `address_override_id` | uuid FK | references `addresses(id)` for address override exceptions |
| `compensating_date` | date | tail-end-reinsertion target (populated for `type='skip'` when `skip_without_append=false` and `target_date_override IS NULL`) |
| `correlation_id` | uuid | links related audit events; matches `subscription.exception.created` and `subscription.end_date.extended` UoW |
| `idempotency_key` | uuid | client-supplied; UNIQUE per subscription |
| `created_by` | uuid | actor performing the exception |
| `created_at` | timestamptz | |

- RLS policy mirrors `subscriptions` tenant_isolation
- Indexes: `(subscription_id, start_date)`, `(tenant_id)`, UNIQUE on `(subscription_id, idempotency_key)`

**`tasks_internal_status_check` extension:**

Add `'SKIPPED'` to CHECK constraint. SKIPPED is semantically distinct from CANCELED:
- `SKIPPED` = human-driven exception with compensating-date semantics
- `CANCELED` = terminal stop (subscription ended, paused, or task cancelled outright)

**`tasks.suitefleet_push_acknowledged_at` column:** `timestamptz NULL`. Populated when SuiteFleet POST returns 2xx. Surfaced on UI as integration-honesty indicator (§3.3.6).

**`webhook_events.raw_payload` column:** `jsonb NOT NULL`. Stores full SuiteFleet webhook payload at receipt time. Verify column exists; add migration if absent.

**`tenants.status` column:** `text` with values `'ACTIVE'` / `'INACTIVE'`. Default `'ACTIVE'` on new tenant insert. Verify; add migration if absent.

**`tenants.pickup_address` columns:** Add `pickup_address_line text`, `pickup_district text`, `pickup_emirate text`. Captured at merchant creation by Transcorp staff; surfaces as ship-from on every task.

**`subscription_materialization` table:**

| Column | Type | Notes |
|---|---|---|
| `subscription_id` | uuid PK FK | one row per subscription |
| `tenant_id` | uuid FK | denormalized for RLS |
| `materialized_through_date` | date | tasks generated through this date inclusive |
| `last_materialized_at` | timestamptz | |

Used by nightly horizon-advance cron (§3.1.5).

**`addresses` table extension (or new addresses table if not present):**

Each consignee can have multiple addresses. Schema captures:
- `id` uuid PK
- `consignee_id` uuid FK
- `tenant_id` uuid FK (RLS)
- `label` text (`'home'`, `'office'`, `'other'`)
- `is_primary` boolean (exactly one per consignee)
- `line` text, `district` text, `emirate` text (or city/country for non-UAE Phase 2)
- `lat` numeric, `lng` numeric
- `created_at`, `updated_at`

**`subscription_address_rotations` table:**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `subscription_id` | uuid FK | |
| `tenant_id` | uuid FK | RLS |
| `weekday` | int CHECK 1-7 | ISO weekday |
| `address_id` | uuid FK | references `addresses` |

UNIQUE on `(subscription_id, weekday)`. If a subscription has no rotation rows for a weekday, the consignee's primary address is used by default.

**`consignees.crm_state` column:** `text CHECK` with values: `'ACTIVE'`, `'ON_HOLD'`, `'HIGH_RISK'`, `'INACTIVE'`, `'CHURNED'`, `'SUBSCRIPTION_ENDED'`. Default `'ACTIVE'` on insert.

**`consignee_crm_events` table:** Audit trail of state transitions.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `consignee_id` | uuid FK | |
| `tenant_id` | uuid FK | RLS |
| `from_state` | text | nullable on initial create |
| `to_state` | text | |
| `reason` | text | |
| `actor` | uuid | |
| `occurred_at` | timestamptz | |

**`consignee_timeline_events` view or table:**

Aggregated chronological view per consignee combining:
- `consignee_crm_events`
- `subscription_events` (creation, pause, resume, end)
- `subscription_exceptions` (skips, address overrides)
- `tasks` state changes (delivered, failed)
- `audit_log` entries scoped to this consignee

For MVP, a database view computing this on read is acceptable. If performance requires, denormalize to a table in Phase 2.

#### 3.1.2 Audit event registrations

Add to `src/modules/audit/event-types.ts`:

- `subscription.exception.created` — body includes `subscription_id`, `exception_id`, `type`, `target_date`, `compensating_date`, `correlation_id`
- `subscription.end_date.extended` — body includes `subscription_id`, `previous_end_date`, `new_end_date`, `correlation_id`, `triggered_by` (`'skip'` | `'pause_resume'` | `'append_without_skip'`)
- `subscription.address_override.applied` — body includes `subscription_id`, `exception_id`, `target_date` (for one-off) or `effective_from` (for forward), `address_id`
- `subscription.paused` — body includes `subscription_id`, `pause_start`, `pause_end`
- `subscription.resumed` — body includes `subscription_id`, `actual_resume_date`, `new_end_date`, `correlation_id`
- `consignee.crm_state.changed` — body includes `consignee_id`, `from_state`, `to_state`, `reason`
- `merchant.created`
- `merchant.activated`
- `merchant.deactivated`

The skip flow emits `subscription.exception.created` + `subscription.end_date.extended` in same database transaction with shared `correlation_id`.

#### 3.1.3 Permissions catalogue additions

Per the BRD/v1.1 delta permission catalogue. Add to `src/modules/identity/permissions.ts`:

**Subscription:**
- `subscription:skip` — apply default skip with tail-end append
- `subscription:override_skip_rules` — apply skip overrides (move-to-date, skip-without-append, append-without-skip)
- `subscription:pause`, `subscription:resume` (existing)
- `subscription:change_address_rotation`
- `subscription:change_address_one_off`
- `subscription:change_address_forward`

**Consignee:**
- `consignee:change_crm_state`

**Merchant management (Transcorp-staff only):**
- `merchant:create`, `merchant:read_all`, `merchant:activate`, `merchant:deactivate`

**Roles in MVP** (catalogue-level; UI only needs Tenant Admin for demo, but permission distinctions exist):

- `transcorp_staff` — `merchant:*`, `tenant:impersonate` (Phase 2)
- `tenant_admin` — full merchant-side permissions including `subscription:override_skip_rules`
- `operations_manager` — same as tenant_admin minus user/role management (Phase 2 differentiation)
- `customer_service_agent` — `subscription:skip` (default rules only) but NOT `subscription:override_skip_rules`; pause/resume; address changes; no schedule rule changes; no integration access

**Demo posture:** Demo accounts log in as `tenant_admin` for simplicity. Other roles exist in catalogue and are testable but not exercised in demo. Q&A answer: "The role catalogue distinguishes Tenant Admin, Operations Manager, and Customer Service Agent per the BRD; the demo uses Tenant Admin for narrative simplicity. Production rollout differentiates."

#### 3.1.4 Service layer additions

**`addSubscriptionException(ctx, subscriptionId, params)`:**

Params: `{ type, date, reason?, idempotency_key, target_date_override?, skip_without_append?, address_override_id? }`

Behavior in single transaction:
1. Verify permission per type:
   - Default skip → `subscription:skip`
   - Skip with override (target_date or skip_without_append) → `subscription:override_skip_rules`
   - Address override → `subscription:change_address_one_off` or `_forward`
2. Verify subscription is `'ACTIVE'` (reject if PAUSED or ENDED — except `pause_window` itself)
3. Verify `date` is in future relative to cut-off (§3.1.8)
4. Verify `date` is eligible per `subscription.days_of_week` (or address override doesn't require this)
5. Idempotency check: existing `(subscription_id, idempotency_key)` → return existing exception_id, 409
6. Compute `compensating_date` (only for type='skip' without override) per algorithm §3.1.6
7. Insert `subscription_exceptions` row with `correlation_id` (UUID v7)
8. For type='skip' without skip_without_append: update `subscriptions.end_date` to `compensating_date`
9. Update target task: `internal_status = 'SKIPPED'`, link to `exception_id`
10. For address overrides: update affected tasks' `address_id` per scope
11. Emit appropriate audit events with correlation_id
12. Return `{ exception_id, compensating_date?, new_end_date? }`

**`pauseSubscription(ctx, subscriptionId, { pause_start, pause_end, reason? })`:**

Bounded pause per BRD glossary:
1. Verify permission (`subscription:pause`)
2. Insert `subscription_exceptions` row with `type='pause_window'`, `start_date=pause_start`, `end_date=pause_end`
3. Mark all tasks in window `internal_status='CANCELED'` with reason `'subscription_paused'`
4. Extend `subscriptions.end_date` by `(pause_end - pause_start)` days, accounting for non-eligible days (only count days that would have been eligible deliveries)
5. Set `subscriptions.status='PAUSED'`
6. Schedule auto-resume job for `pause_end`
7. Emit `subscription.paused` + `subscription.end_date.extended` with shared correlation_id

**`resumeSubscription(ctx, subscriptionId, params)`:**

- Manual resume (operator-triggered) OR auto-resume (scheduler-triggered at `pause_end`)
- Set `subscriptions.status='ACTIVE'`
- Trigger nightly cron to materialize newly-uncovered horizon dates
- Emit `subscription.resumed` with `actor` (user uuid for manual, system for auto)

**`changeConsigneeCrmState(ctx, consigneeId, { to_state, reason })`:**

- Verify permission (`consignee:change_crm_state`)
- Verify state transition is valid (e.g., can't go from `CHURNED` back to `ACTIVE` without explicit reactivation)
- Update `consignees.crm_state`
- Insert `consignee_crm_events` row
- Emit `consignee.crm_state.changed`

**`createMerchant(ctx, { name, slug, pickup_address })`** / **`activateMerchant`** / **`deactivateMerchant`:**

Transcorp-staff scoped. Audit-emits.

**`appendWithoutSkip(ctx, subscriptionId, { target_date?, reason })`:**

- Verify permission (`subscription:override_skip_rules`)
- Compute compensating date (or use target_date_override)
- Extend `end_date`, materialize new task on next horizon advance
- Insert `subscription_exceptions` row with `type='append_without_skip'`
- Emit `subscription.end_date.extended` with `triggered_by='append_without_skip'`

#### 3.1.5 Rolling 14-day horizon

**Decision:** Tasks materialize on a 14-day rolling horizon, advanced nightly.

**Rationale:** SuiteFleet dispatch dashboards should not contain tasks weeks in the future. 14 days is enough operational visibility without cluttering SF.

**Cron schedule:** Nightly at 22:00 local time per tenant. Cron walks all `'ACTIVE'` subscriptions; computes `target_horizon_date = today + 14 days`; if `subscription_materialization.materialized_through_date < target_horizon_date`, generates tasks for the gap (respecting `subscription_address_rotations` for per-weekday address selection) and advances `materialized_through_date`.

**Per-tenant timezone:** Cron walks tenants, computes per-tenant local time, advances horizon if past 22:00.

**Skip past horizon:** When skip extends `end_date` past `materialized_through_date`, the appended task is recorded in Planner DB at compensating date but pushed to SuiteFleet only on next nightly cron tick covering that date. Merchant calendar shows appended task immediately (sourced from Planner DB); SF dispatch dashboard sees it when relevant.

**Pause-resume horizon:** Auto-resume scheduler triggers `resumeSubscription`; horizon cron picks up next tick and materializes newly-uncovered dates.

#### 3.1.6 Skip-and-append algorithm

**Pseudocode (canonical):**

```
function computeCompensatingDate(subscription, blackoutDates, pauseWindows):
  candidate = subscription.end_date + 1 day
  while true:
    weekday = candidate.weekday()  // 1=Mon ... 7=Sun (ISO)
    if weekday in subscription.days_of_week
       and candidate not in blackoutDates
       and candidate not in pauseWindows:
      return candidate
    candidate = candidate + 1 day
    if candidate > subscription.end_date + 365 days:
      throw NoCompensatingDateFound  // safety stop
```

**Edge cases (handled in implementation, with tests):**

| Edge case | Behavior |
|---|---|
| A. Compensating date lands on blackout | Roll forward to next eligible non-blackout day |
| B. Multiple skips in close succession | Stack: each transactional read of current end_date, extends from there |
| C. Operator double-tap / retry | Idempotency key UNIQUE constraint; duplicate POSTs return 409 |
| D. Skip exhausts max_skips_per_subscription | Hard cap from merchant onboarding config; reject with clear error if exceeded. (No max_consecutive_skips — dropped per Day-12 decision.) |
| E. Skip near original end_date | Always tail-end; documented in UI copy |
| F. Subscription currently paused | Reject; compensating date undefined |
| G. Skip on past date | Reject; historical correction is Phase 2 |
| H. Skip on very last delivery | Algorithm extends end_date by exactly one slot; test required |
| I. Skip on multi-task date | MVP not relevant (1 sub = 1 task/date); algorithm operates per-task |

**Worked examples (tests):**
- Mon-Fri ending Fri 15 May, skip Wed 6 May → appended Mon 18 May
- Mon/Wed/Fri ending Fri 15 May, skip Wed 6 May → appended Mon 18 May
- Tue/Fri ending Fri 15 May, skip Tue 6 May → appended Tue 19 May
- Mon-Fri ending Fri 15 May, skip Tue 5 May AND Thu 7 May → appended Mon 18 May AND Tue 19 May, end_date 19 May

**Skip overrides (per BRD §6.3.3):**
- `target_date_override`: operator picks specific date instead of tail-end. Algorithm validates date is eligible per `days_of_week` and not in blackout/pause; otherwise reject.
- `skip_without_append`: cancel-only, no compensating insert, no end_date change.
- `append_without_skip`: operator-initiated tail-end addition without a skipped delivery (goodwill / complaint resolution).

#### 3.1.7 Pause semantics (BRD-aligned)

**Bounded pause window with auto-resume:**

- Pause has explicit `pause_start` and `pause_end` dates
- All tasks in window marked `internal_status='CANCELED'` with reason `'subscription_paused'`
- Tasks NOT deleted — audit trail preserved
- `subscriptions.status` flips to `'PAUSED'` for duration
- `end_date` extends by pause duration (counted in eligible-delivery-days, not calendar days)
- Auto-resume scheduler triggers at `pause_end`
- Manual resume (operator-triggered before `pause_end`) recalculates extension based on actual resume date

**No artificial split between subscription-level pause and `pause_window` exception** — they are the same thing in the BRD. The `subscription_exceptions.type='pause_window'` row IS the pause record.

#### 3.1.8 Cut-off enforcement

Per BRD §6.3.4. Skips before cut-off apply immediately. Skips after cut-off rejected with clear error in MVP.

Configurable cut-off time per merchant is **Phase 2** (rule enforced in MVP at hardcoded 18:00 local time the day before delivery; merchant-config UI deferred).

#### 3.1.9 API routes

| Route | Method | Permission |
|---|---|---|
| `/api/admin/merchants` | POST | `merchant:create` |
| `/api/admin/merchants` | GET | `merchant:read_all` |
| `/api/admin/merchants/[id]/activate` | POST | `merchant:activate` |
| `/api/admin/merchants/[id]/deactivate` | POST | `merchant:deactivate` |
| `/api/consignees` | POST | (existing) — extends to handle initial subscription + addresses + rotation in single request |
| `/api/consignees/[id]/crm-state` | POST | `consignee:change_crm_state` |
| `/api/consignees/[id]/timeline` | GET | `consignee:read` |
| `/api/subscriptions/[id]/skip` | POST | `subscription:skip` (or `:override_skip_rules` with override params) |
| `/api/subscriptions/[id]/pause` | POST | `subscription:pause` — body `{ pause_start, pause_end, reason? }` |
| `/api/subscriptions/[id]/resume` | POST | `subscription:resume` |
| `/api/subscriptions/[id]/append-without-skip` | POST | `subscription:override_skip_rules` |
| `/api/subscriptions/[id]/address-rotation` | PATCH | `subscription:change_address_rotation` |
| `/api/subscriptions/[id]/address-override` | POST | `subscription:change_address_one_off` or `_forward` |

#### 3.1.10 SuiteFleet integration

**Webhook deduplication:** `(suitefleet_task_id, action, timestamp)` UNIQUE on `webhook_events`.

**Webhook auth:** Verify `X-Client-Id` and `X-Client-Secret` headers match values registered for tenant (per-tenant webhook credentials already exist per memory).

**Webhook payload format:** `?sf-format=object` (single-event JSON, simpler handler logic).

**Webhook events parsed (canonical SF codes):**

`TASK_HAS_BEEN_ORDERED`, `TASK_HAS_BEEN_ASSIGNED`, `TASK_HAS_BEEN_UPDATED`, `TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC`, `TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY`, `TASK_STATUS_UPDATED_TO_PICKED_UP`, `TASK_STATUS_UPDATED_TO_IN_TRANSIT`, `TASK_STATUS_UPDATED_TO_DELIVERED`, `TASK_STATUS_UPDATED_TO_FAILED`, `TASK_STATUS_UPDATED_TO_CANCELED`, `TASK_STATUS_UPDATED_TO_RESCHEDULED`, `TASK_STATUS_UPDATED_TO_REATTEMPT`, `TASK_STATUS_UPDATED_TO_PROCESS_FOR_RETURN`, `TASK_STATUS_UPDATED_TO_RETURNED_TO_SHIPPER`, `TASK_STATUS_UPDATED_TO_HUB_TRANSFER`.

#### 3.1.11 SuiteFleet API endpoint mapping

Per Day-1 reviewer note + BRD §15.2:

| Planner operation | SF resource:operation | HTTP |
|---|---|---|
| Create consignee | `consignee-resource:create` | POST |
| Update consignee | `consignee-resource:update` | PATCH |
| Create single task | `task-resource:create` | POST |
| Bulk create tasks (nightly horizon) | `task-resource:createBulk` | POST |
| Update task (status, address) | `task-resource:update` | PATCH |
| Cancel task (skip path) | `task-resource:update` with cancel | PATCH |
| Reschedule task | `task-resource:reschedule` | POST |
| Get task timeline (popover) | `task-resource:getTimeline` | GET |
| Webhook registration per tenant | `customer-hook-resource:create` | POST |

Engineers reference SF v2.0 docs at `suitefleet.readme.io` for exact paths/payloads.

### 3.2 Frontend additions — Transcorp-staff admin

#### 3.2.1 Routes

- `/admin/merchants` — list view, all merchants, status column, row-level activate/deactivate
- `/admin/merchants/new` — create form: name, slug, pickup address (street, district, emirate)

#### 3.2.2 Auth posture

- Middleware gates `(admin)/` route group on `transcorp_staff` role
- Merchant operators get 403
- `(admin)/` route group parallel to `(app)/`
- UI permission rendering rules per §3.3.10

### 3.3 Frontend additions — Merchant operator

#### 3.3.1 Consignee onboarding wizard (`/consignees/new`)

**Four-step wizard** (per BRD §8.1 + Claude Code Brief §4.6):

**Step 1 — Identity:**
- Full name (required)
- Primary phone (required, validated format per country)
- Alternative phone (optional)
- Email (optional, recommended for notifications)
- Merchant internal consignee ID — **Phase 2** (deferred per Day-12 decision)

**Step 2 — Addresses:**
- Primary address: line, building/villa, district, emirate, lat/lng (smart geotag)
- Address label (Home / Office / Other)
- Alternative address (optional, same structure)
- District default: most-recently-used district for operator session (empty on first onboarding)

**Step 3 — Subscription:**
- Plan name (free text for MVP; configurable selectable list Phase 2)
- Start date (default today)
- End date OR duration (8 weeks computes end_date)
- Days of week (clickable Mon–Sun pills)
- Default delivery time window (start time, end time)
- **Address rotation** (per-weekday address mapping shown as tiles): Mon→[Home/Office], Tue→[...], etc. Defaults all to Primary; operator overrides per weekday for rotation.
- Consignee CRM state (default `ACTIVE`; operator can set initial state if onboarding a known high-risk subscriber)

**Step 4 — Schedule rules:**
- Cut-off time (read-only display of merchant default; configurable Phase 2)
- Maximum skips per subscription (default unlimited; configurable Phase 2)
- Blackout dates (read-only merchant default; per-consignee custom Phase 2)
- Notes / loyalty tier — **Phase 2** (deferred per Day-12 decision)

**On final submit:** creates consignee + addresses + subscription + address rotations in single transaction. Redirect to `/consignees/[id]` calendar view.

#### 3.3.2 Consignee list view (`/consignees`)

Evolved from current read-only list. New affordances:
- CRM state badge column (color-coded per state)
- Search by name / phone / email
- Filter: CRM state, district, today's delivery state
- Click row → `/consignees/[id]` calendar view
- "Onboard new consignee" CTA

**Visual treatment per BRD §8.5:**
- High Risk consignees: row tinted red
- On Hold consignees: row greyed out
- Active: default styling

#### 3.3.3 Consignee detail page with calendar (`/consignees/[id]`)

Headline UI surface. Reference: `subplanner.vercel.app/consignee/c_001`.

**Header card:**
- Consignee avatar (initials), name, status badge (CRM state), plan tier badge
- Phone, email, address district
- Plan name, subscription window (start–end), days remaining
- Summary stat row: Delivered, Scheduled, Skipped, Appended, Failed (compact)

**Calendar:**
- Week / Month / Year toggle (pill buttons, top-right)
- Status legend (Delivered / Out for delivery / Scheduled / Skipped / Appended / Failed)
- Default view: Week (per BRD §6.2.1 — week is daily-ops default)
- Each day cell shows delivery card with status color, time, **address indicator** (Home/Office per rotation)
- Days without deliveries (per `days_of_week`): muted grey background
- Year view: heat-map density per BRD §6.2.1

**Click-into-day popover:**
- Date, status badge, consignee name
- Delivery time window
- Address (primary or alternative or one-off override) with label
- Driver name (cached from webhook)
- Status detail (Delivered at 07:00 / Failed reason / Skipped reason)
- POD photo (when status=Delivered, cached from webhook)
- Consignee rating (when available)
- **SuiteFleet-acknowledged indicator** — "Pushed to SuiteFleet at HH:MM ✓"
- Action buttons (contextual, permission-gated):
  - Skip this delivery (default rules) — for `subscription:skip`
  - Skip with override (move to date / skip without append) — for `subscription:override_skip_rules`
  - Pause from this date — for `subscription:pause` (opens pause-window picker)
  - Change address for this delivery only — for `subscription:change_address_one_off`
  - Change address from this delivery onwards — for `subscription:change_address_forward`
  - Cancel delivery (no append, reduces subscription count) — for `subscription:override_skip_rules`
  - Add note to driver — for relevant permission
  - View full task detail (opens timeline drawer) — for `task:view_timeline`

**Year view performance:** ~365 cells × 1 task/day. Lazy-load by month or aggregate-only summary in year view with month drill-down. Decided in Day-14 design spec.

#### 3.3.4 Consolidated merchant calendar (`/calendar`)

Per BRD §6.4. Cross-consignee aggregate view for Operations Manager workflow.

**Header:**
- Merchant name + today's date
- Five metric cards: Active consignees, Today's deliveries, Delivered (today), Out for delivery, Failed/at-risk
- Filter bar: search by consignee name/phone, CRM state dropdown, area/district dropdown, time window dropdown, task status dropdown

**Calendar grid:**
- Week view default; Month and Day views available
- Each day cell shows aggregate counts (e.g., "127 deliveries scheduled")
- Click day → list of all tasks that day, grouped or filterable
- Drill-down from any task → consignee detail calendar
- High-risk deliveries highlighted (failed attempts, high-risk consignees, missing addresses per BRD §6.4)

**Export to CSV** — Phase 2.

#### 3.3.5 Subscription detail page (`/subscriptions/[id]`)

- Header: consignee name (link), plan name, subscription window, status, days remaining
- Subscription rule summary: days of week (visual grid), delivery window, primary+alternative addresses, address rotation per weekday (visual)
- Pause / Resume CTA (opens bounded-pause picker for pause; resume immediate)
- Skip workflow (date picker + preview + confirm)
- Skip override workflow (move to date / skip without append) — permission-gated
- Address rotation editor (change which address goes which weekday)
- Recent exceptions list (read-only, last 10)

#### 3.3.6 Per-task delivery status timeline

On click of any task: drawer or detail page shows full state-transition history.

- Created → Assigned → In transit → Delivered/Failed/Skipped
- Each transition with timestamp, actor (system/driver/operator), source (cron/SF webhook/manual)
- Sourced from local DB cached webhook events

#### 3.3.7 Consignee timeline view

Per BRD §6.5.2. Separate surface from per-task timeline — full subscription lifecycle for a consignee.

**Surface:** Tab on consignee detail page OR `/consignees/[id]/timeline` route.

**Content (chronological, newest first):**
- Onboarding event (consignee created, subscription started)
- All delivery events (Created → ... → Delivered/Failed) with task references
- All exceptions (skips, pauses, address overrides) with operator + reason
- CRM state transitions
- Subscription resumed / extended events
- Each entry: timestamp, event type icon, summary text, actor, click-through to relevant detail

For MVP: read from `consignee_timeline_events` view (database view computing on read). Phase 2 if performance demands denormalization.

#### 3.3.8 Cache from webhook, never live-fetch

Architectural commitment. All popover and timeline data (driver, POD, rating, status detail) cached from SF webhooks at receipt time, read from local DB.

**Reasoning:** SF API latency unpredictable; auth refresh hiccups; rate limits; live-fetch creates SF dependency on every popover render.

**Exception:** Phase 2 "Refresh" button for IN_TRANSIT tasks.

**Schema implication:** Webhook handler stores typed extracted fields AND full raw payload in `webhook_events.raw_payload`. Prevents future backfill.

#### 3.3.9 Merchant operator landing page (`/`)

Existing workflow shortcut cards. Add:
- "Today's deliveries" → `/calendar` (current day, default view)
- "Onboard new consignee" → `/consignees/new`
- "Subscriber base" → `/consignees`
- Existing: "Tasks" (`/tasks`), "Failed pushes" (`/admin/failed-pushes`)

Reorder for primary workflows first.

#### 3.3.10 UI permission rendering rules

Three rules per Day-1 reviewer + BRD §12.2.10:

1. **Hide what user cannot access.** Routes/nav items the user lacks permission for are not rendered. Customer Service Agents never see admin routes.
2. **Disable what user can see but not act on.** Skip override button visible-but-disabled with tooltip ("Requires Operations Manager role") for users without the permission.
3. **Never silently fail.** 403 from service surfaces as clear error message, never silent no-op.

#### 3.3.11 Brand pass

Apply Transcorp design tokens across all new UI:
- Deep ink navy primary (#0B1B2B), warm off-white background (#F5F4F0), pure white surface raised
- Hairline borders 0.5px (#D4D1C8), no shadows
- Sentence case, generous whitespace, 24px gutter, content max-width 1200px
- Mulish + Sanchez typography (Mulish for body/UI, Sanchez or Inter for hero numerals)
- Status colors restrained: Delivered #3F6B3F, In transit #3A5F8F, Failed #A14040, Scheduled #8B8780, Skipped #5F6A7A
- Reference: `transcorp-lofi-v2.vercel.app`

### 3.4 RBAC enforcement — three layers

Per Day-1 v1.1 delta §12.2.4-5. Defense in depth:

1. **Middleware at API route entry.** Every API route declares required permission. Middleware checks JWT claim, returns 403 before reaching handler.
2. **Service layer reassertion.** Each service method re-checks permission. Prevents privilege escalation from misconfigured route or bypass.
3. **Postgres RLS as backstop.** Tenant isolation enforced at database via RLS on every tenant-scoped table.

**RLS verification required on every new tenant-scoped table:**
- `subscription_exceptions`
- `subscription_materialization`
- `subscription_address_rotations`
- `consignee_crm_events`
- `addresses` (if newly added)
- `consignee_timeline_events` (view inherits RLS from underlying tables)

### 3.5 L4 — Label generation

Proxy SF's existing label endpoint with Transcorp logo swap.

- Surface: `/tasks` page multi-select Print Labels button (PR #122)
- Phase 1: single-task and multi-select label download as PDF
- Implementation: Day 16 L4 plan PR

### 3.6 SuiteFleet credential decision

**MVP:** Single shared SF sandbox credential across all tenants. Hardcoded customer.code = 588.

**Reasoning:** Per-tenant credential isolation requires AWS Secrets Manager swap (post-MVP per `memory/followup_secrets_manager_swap_critical_path.md`).

**Phase 2:** Per-tenant SF credential isolation per v1.1 delta §6.2.1. First post-pilot hardening item.

**Demo Q&A rehearsal:**

> "Yes, the architecture is designed for per-tenant credentials per v1.1 delta §6.2.1; we shipped the demo with a shared dev credential to isolate the demo from the architecture work. Per-tenant credential isolation is the first item on the post-pilot hardening list."

---

## 4. Phase 2 scope (deferred, documented, not lost)

Each item filed as deferral memo in `memory/` during Day-13 setup.

| Item | Source | Phase 2 trigger |
|---|---|---|
| Configurable cutoff time per merchant | BRD §6.3.4 | Post-pilot |
| Configurable max_skips_per_subscription per merchant | BRD §6.3.4 | Post-pilot |
| Per-merchant blackout date editor | BRD §6.3.4 | Post-pilot |
| Notes + loyalty tier + merchant-internal-ID on consignee | BRD §6.1.1 | Post-pilot (Day-12 deferral) |
| Skip notifications via SMS to consignee | BRD §14 Q5 | Post-pilot |
| Reconciliation job between Planner and SF | BRD §10.2 | Post-pilot |
| Failed-attempt manual retry workflow (delivery-level, not webhook-DLQ) | BRD §6.2.3 | Post-pilot |
| Per-tenant SuiteFleet credential isolation | v1.1 delta §6.2.1 | First post-pilot item |
| AWS Secrets Manager swap | `followup_secrets_manager_swap_critical_path.md` | Post-pilot |
| Webhook events admin UI | plan.docx §10 Day 12 | Post-pilot |
| Credential rotation UX | plan.docx §10 Day 12 | Post-pilot |
| Integrations page (SF credential entry/test in merchant portal) | plan.docx §10 Day 5 + v1.1 delta §6.2.1.9 | Post-pilot |
| Audit log viewer UI | plan.docx §10.3 | Post-pilot |
| Reporting / BI dashboards | plan.docx §10.3 | Post-pilot |
| CSV export from consolidated calendar | BRD §6.4 | Post-pilot |
| Arabic / i18n UI toggle | plan.docx §10.3 | Post-pilot |
| Custom roles / impersonation / SSO | plan.docx §7.9 + v1.1 delta §12.2.7-9 | Post-pilot |
| Failed-payload edit-and-retry UI | `decision_failed_payload_dlq_split.md` | v1.1 |
| Operator-facing CSV import | replaced by `seed-subscriptions.mjs` | Post-pilot |
| `/profile` page | `p4_operator_nav_plan.md` | Post-pilot |
| Sidebar nav / metrics dashboard / search bar / breadcrumbs / dark mode | `p4_operator_nav_plan.md` | Post-pilot |
| Notifications / alerts surface | `p4_operator_nav_plan.md` | Post-pilot |
| Tenant switcher | `p4_operator_nav_plan.md` | Post-pilot |
| Transcorp-staff: deactivate cleanup, brand assignment, cross-merchant metrics | This brief §2.3 | Post-pilot |
| Plan tier as configurable selectable list per merchant | BRD §6.1 | Post-pilot |
| "Refresh" button on popover for live SF fetch on IN_TRANSIT | This brief §3.3.8 | Post-pilot |
| Mobile responsive operator UI | This brief §8 | Post-pilot |
| Operations Manager / Customer Service Agent role differentiation in UI | Day-1 BRD §5.1 | Post-pilot (catalogue exists) |
| Append-without-skip override (operator-initiated goodwill) | BRD §6.3.3 | Post-pilot |
| Historical-correction workflow (skip on past date with Ops Manager approval) | This brief §3.1.6 Edge case G | Post-pilot |
| Consignee timeline performance optimization (denormalize from view to table) | This brief §3.3.7 | Post-pilot if needed |

---

## 5. Demo posture

**Audience:** Transcorp leadership / CAIO pitch panel
**Date:** May 12, 2026 (Day 19)
**Duration target:** 15–20 minutes live walkthrough + Q&A

### 5.1 Demo narrative arc

1. **Setup (2 min):** "Transcorp's logistics arm runs cold-chain delivery for meal-plan merchants. We built Transcorp's owned operator product in 14 days, using AI throughout. The product is a meal-plan CRM that consumes SuiteFleet as a backend execution layer. Here's what we built."

2. **Transcorp-staff onboarding (3 min):** Log in as Transcorp staff → `/admin/merchants` → create new merchant "Demo Bistro" with pickup address → list updates → activate.

3. **Merchant operator first-touch (3 min):** Log in as Demo Bistro operator → land on operator home → onboard first consignee Fatima Al Mansouri (4-step wizard: identity → addresses with Home + Office → subscription Mon-Fri lunch with Home/Office rotation Mon-Wed-Fri Home, Tue-Thu Office → schedule rules) → `/consignees/[id]` calendar materializes immediately. Visible "Pushed to SuiteFleet ✓" indicators.

4. **Calendar workflow (5 min):**
   - Switch to month view → see address rotation visualized (different address indicators per day)
   - Click delivered Wednesday → popover shows POD photo / driver / 5-star rating
   - Click future Wednesday → click Skip → preview shows tail-end reinsertion → confirm → calendar updates with skip + appended delivery
   - Click another future delivery → click Skip with override → "Move to specific date" → pick alternative valid day → preview → confirm

5. **Consolidated view (3 min):** Click `/calendar` → shows all consignees' deliveries today across Demo Bistro → metric cards (Active / Today's deliveries / Delivered / Failed) → filter to High Risk consignees → Sarah Khouri appears (red row) → drill into Sarah → consignee timeline shows pattern of failed deliveries → click Change CRM state → mark High Risk.

6. **Subscription management (2 min):** From Fatima's consignee detail click into subscription → bounded pause for 1 week (holiday) → end_date extends → calendar shows pause window + new end date.

7. **Architecture + AI velocity story (2 min):** Single slide three numbers:
   - 14 days, sprint start to demo
   - X tests passing (current at demo time)
   - Zero production incidents during pilot setup

   30-second narration: "We didn't just build the product. We built it with the test discipline, the audit pipeline, and the architectural rigour you'd expect from a team of seven engineers over six months. The architecture is in the codebase; the discipline is in the memory directory; both inspectable post-demo."

8. **Q&A (5 min):** Roadmap (Phase 2 list as scope discipline evidence), tech choices, scaling, security posture.

### 5.2 Demo data state

- 3 pre-seeded merchants (MPL, DNR, FBU) plus Demo Bistro created live
- 845 consignees + subscriptions seeded
- Live cron-generated tasks for current week
- At least one mid-subscription skip with tail-end appended (visual variation)
- At least one delivered task with **POD photo via real SF webhook flow** (architectural honesty — not direct DB insert)
- Fatima Al Mansouri pre-configured with Home/Office address rotation as the demo persona
- Sarah Khouri pre-configured with High Risk CRM state and history of failed deliveries

### 5.3 Pre-demo verification (`demo-preflight.sh`)

Runs twice on Day 19 (start of dry-run, 30 min before live demo):

1. Demo Bistro merchant exists, status=ACTIVE, pickup address set
2. ≥3 other seeded merchants (MPL, DNR, FBU)
3. Total consignees ≥ 845
4. Cron has run within last 24 hours
5. ≥1 task with status=DELIVERED and non-null POD photo URL (sourced via real webhook)
6. ≥1 subscription with applied skip + populated compensating_date
7. Fatima Al Mansouri has address rotation configured
8. Sarah Khouri has CRM state=HIGH_RISK with ≥2 failed deliveries in history
9. SF integration responsive (ping known-safe endpoint)
10. Auth flows work for `transcorp_staff` test account and `tenant_admin` test account

If any check fails: stop, fix, or fall back to recorded screen capture.

### 5.4 Q&A rehearsal — anticipated questions

**"How does Transcorp prevent merchant A's tasks appearing in merchant B's SuiteFleet account?"**

> "The architecture is designed for per-tenant credentials per Build Plan v1.1 §6.2.1; we shipped the demo with a shared dev credential to isolate the demo from the architecture work. Per-tenant credential isolation is the first item on the post-pilot hardening list."

**"How does the Operations Manager see what's happening across all 845 consignees?"**

> "MVP gives operators two complementary views. The consolidated merchant calendar — what we just demoed — is the Operations Manager's daily-ops surface: filter by status, area, time window, see aggregate counts, drill into any task. The per-consignee calendar is the Customer Service Agent's surface: 'Fatima called, she wants to skip Wednesday.' Both are in MVP."

**"What happens when a merchant deactivates? Their consignee data?"**

> "Deactivation in MVP is reversible — sets tenant.status to INACTIVE, blocks new operator logins, preserves all data. Hard data archival follows post-pilot data lifecycle policy."

**"How does the system handle webhook delivery failures from SuiteFleet?"**

> "Three layers of resilience. SuiteFleet retries on non-2xx. Our webhook receiver dedupes via task_id + action + timestamp UNIQUE constraint. The dead-letter queue surfaces unrecoverable events to operators via /admin/failed-pushes. Reconciliation between Planner and SF state is a Phase 2 hardening item — for MVP, the webhook + DLQ patterns hold."

**"What if a consignee wants to skip 30 deliveries in a row?"**

> "MVP supports this — each skip independently tail-end-extends the subscription, stacking transactionally. Merchants can configure max_skips_per_subscription as a hard cap (Phase 2 — currently unlimited). The bounded-pause workflow is the better fit for long absences: pause start + end dates, automatic resume, end_date extends by pause duration."

---

## 6. Day-by-day plan (Day 13–19)

### Day 13 (Tuesday May 5, 2026)

- Fresh Claude Code session opens with bootstrap pointer to this brief
- Commit `memory/PLANNER_PRODUCT_BRIEF.md v1.1` (T1 PR)
- File Phase 2 deferral memos for §4 items not already tracked
- Amend Day-12 EOD doc to reference brief as source of truth
- Merge #134; Day 12 closes
- Posture B retirement (T1, runs whenever soak window opens)
- Cron diary check at 16:30 Dubai
- **Substantive: backend exception model PR part 1 (T3)** — schema migrations (subscription_exceptions, subscription_materialization, addresses, subscription_address_rotations, consignees.crm_state, consignee_crm_events, tenants.status + pickup_address, tasks.suitefleet_push_acknowledged_at, webhook_events.raw_payload, tasks_internal_status_check extension), generator updates with address rotation + exception application, audit event registrations, permissions catalogue additions, tests
- Day-13 EOD batched promotion + EOD doc

### Day 14 (Wednesday May 6, 2026)

- **Substantive: backend exception model PR part 2 (T3)** — service layer (addSubscriptionException with all override variants, pauseSubscription bounded, resumeSubscription with auto-resume scheduler, changeConsigneeCrmState, createMerchant + activate/deactivate, appendWithoutSkip, address rotation + override services), API routes, idempotency enforcement, cut-off enforcement, webhook deduplication, integration tests
- Verify end-to-end with test skip + test bounded-pause + test address override on real seeded subscription
- **Begin frontend design spec PR (T2)** — wireframes for: Transcorp-staff admin, 4-step onboarding wizard with address rotation, consignee detail with calendar (week/month/year), consolidated merchant calendar, subscription detail with all override workflows, consignee timeline view. References subplanner prototype + Transcorp brand tokens.
- Reviewer counter-review on design spec heavy
- **Begin Transcorp-staff admin implementation** (smaller surface, faster ship)
- Day-14 EOD batched promotion + EOD doc

### Day 15 (Thursday May 7, 2026)

- **Consignee onboarding 4-step wizard implementation PR**
- **Consignee detail page + calendar view (week/month/year) implementation PR** — headline UI surface
- **Address rotation visualization on calendar + popover** — within above PR or split
- Day-15 EOD batched promotion + EOD doc

### Day 16 (Friday May 8, 2026)

- **Skip workflow UI implementation PR** (default + override variants: skip-to-date, skip-without-append)
- **Subscription detail page implementation PR** (pause/resume bounded with date pickers, skip override, address rotation editor, exception history)
- **Consolidated merchant calendar implementation PR** (`/calendar` route with metric cards, filters, drill-down)
- **L4 label generation plan PR + implementation PR**
- Day-16 EOD batched promotion + EOD doc

### Day 17 (Saturday May 9, 2026)

- **Per-task delivery status timeline implementation PR**
- **Consignee timeline view implementation PR**
- **CRM state change UI** (badge + transition workflow + history)
- **Address change workflows** (one-off and forward-going from popover)
- Day-17 EOD batched promotion + EOD doc

### Day 18 (Sunday May 10, 2026)

- **Brand pass** — full sweep all new UI against Transcorp design tokens
- **Polish** — error states, loading states, empty states, responsive layouts (desktop-first)
- **Demo data preparation** — seed Demo Bistro, configure Fatima with address rotation, Sarah with HIGH_RISK + failed history, apply demo skip via real API, trigger real SF webhook for POD photo
- **Build `demo-preflight.sh` verification script**
- Day-18 EOD batched promotion + EOD doc

### Day 19 (Monday May 11, 2026 → Demo May 12)

- Day 19 is preparation day, demo Day 20 morning
- Run `demo-preflight.sh` (start of day)
- Live demo dry-run × 2 end-to-end
- Slide deck for CAIO pitch (three-numbers slide for §5.1 step 7)
- Backup screen capture
- Final fixes from dry-runs
- Run `demo-preflight.sh` (30 min before demo)
- **Demo May 12 — go time**

---

## 7. Quality gates (non-negotiable)

- **Design spec before implementation.** No implementation PR opens without approved design spec PR. Reviewer counter-review on spec is heavy; on implementation is verification-only.
- **Frontend-design skill activation.** Every UI implementation PR explicitly invokes `frontend-design` skill at session start.
- **Demo-state seeding scripted, not manual.** Demo Bistro + Fatima rotation + Sarah HIGH_RISK + applied skip + delivered POD photo reproducible via `demo-preflight.sh` or seed scripts.
- **Test discipline.** Each backend addition has unit + integration coverage. Each UI addition has at minimum smoke tests for happy path. Skip-and-append algorithm has worked-example tests for all canonical cases including override variants.
- **Brand discipline.** No new UI ships without Transcorp design tokens. Day 18 brand pass is sweep, not fix-up.
- **Tier discipline.** T2 hard-stop at PR open for code; T3 hard-stop twice (plan + PR) for schema/auth/RLS/audit changes.
- **RLS verification.** Every new tenant-scoped table has RLS verified in PR review.
- **Audit correlation_id.** Causally related events (skip → end_date_extended; pause → end_date_extended) share correlation_id in same transaction.
- **Idempotency on mutating operations.** Skip API requires idempotency_key. Server stores, rejects duplicates with 409.
- **Webhook deduplication.** Every webhook event deduplicated via UNIQUE.
- **Pre-demo verification automated.** `demo-preflight.sh` is the gate before live demo.

---

## 8. Open questions for resolution during Day 13–14

| Question | Resolution location |
|---|---|
| `tenants.status` and `pickup_address` columns present in current schema? | Day-13 backend PR part 1 first commit |
| `webhook_events.raw_payload` column present? | Day-13 backend PR part 1 first commit |
| `addresses` table present and shape? | Day-13 backend PR part 1 first commit |
| `/api/consignees` POST atomicity (consignee + addresses + subscription + rotation in one tx)? | Day-14 design spec PR |
| Year-view calendar performance (~365 cells × address indicators) | Day-14 design spec PR |
| Auto-resume scheduler implementation (cron-based or event-based)? | Day-13 backend PR part 2 |
| Consignee timeline view: read-time DB view or denormalized table? | Day-14 design spec PR (default to view; denormalize Phase 2) |
| Mobile responsiveness | Phase 2 unless time permits Day 18 polish |

---

## 9. Brief amendment log

| Version | Date | Changes |
|---|---|---|
| v1.0 | 5 May 2026 (mid-day) | Initial filing. Path 2-A locked. Demo May 11. Incorporates Day-1 BRD partial + Day-1 reviewer note + Day-12 audit + Day-12 product vision dump. |
| v1.1 | 5 May 2026 (evening) | Demo slipped to May 12. Comprehensive amendments per full Day-1 source review (BRD + Build Plan v1.0 + v1.1 delta + Claude Code prototype brief). Added: address rotation (per-weekday primary/alternative), four-step onboarding wizard, consolidated merchant calendar (`/calendar`), three-role permission catalogue, skip overrides (move-to-date, skip-without-append, append-without-skip via Phase 2), address change workflows (one-off + forward), consignee CRM states with transitions and timeline view, BRD-aligned bounded pause (replaces artificial split). Dropped: max_consecutive_skips. Phase 2: notes/loyalty/merchant-internal-ID. |

---

## 10. Acknowledge protocol for fresh sessions

When a new Claude Code session opens (Day 13, 14, 15, etc.):

1. Read this brief in full before any action.
2. Acknowledge briefly: confirm absorption of (a) Path 2-A scope, (b) Transcorp-microservice framing, (c) three-role permission catalogue, (d) backend exception model + 14-day horizon + bounded pause + address rotation, (e) frontend surfaces (Transcorp-staff admin + merchant operator + consolidated calendar + consignee detail with calendar + onboarding wizard + timeline), (f) Day-by-day plan and current day's slot, (g) demo posture and Q&A rehearsal.
3. First action of each session: verify brief is current (check version + last amendment); if newer version exists in main, sync.
4. Substantive PRs reference brief sections in PR description (e.g., "Implements PLANNER_PRODUCT_BRIEF.md §3.1.6").
5. Scope changes require: explicit `decision_*.md` filing + brief amendment + version bump in §9.

---

**End of v1.1.**

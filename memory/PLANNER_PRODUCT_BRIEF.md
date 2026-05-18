# Transcorp Subscription Planner — Product Brief

**Status:** Active. This document is the source of truth for Planner product scope, architecture, and demo posture. Supersedes `docs/plan.docx` §10 Day 11–13 scope where in conflict.

**Version:** v1.15
**Filed:** Day 12 (5 May 2026), evening; v1.2 amendments filed Day 13 (5 May 2026), post-PR-#139 merge; v1.4 amendment filed Day 17 (7 May 2026) morning; v1.5 amendment filed Day 17 (7 May 2026) post-PR-#168 visual refinement; v1.6 amendment filed Day 17 (7 May 2026) ~1:30 PM Dubai; v1.7 amendment filed Day 18 (8 May 2026) post-A1-resolver-swap; v1.8 amendment filed Day 18 (8 May 2026) post-A2-plan-PR — webhook handler 3-layer plan + §3.1.10 array-shape + §5.3 Gate-5 path corrections; v1.9 amendment filed Day 19 (9 May 2026) post-A2-smoke-PASS — §2.3 expansion to two Transcorp-staff workflows (Phase 1.5 admin cross-tenant operational read); v1.10 amendment filed Day 21 (10 May 2026) evening — Sarah Khouri demo-persona pre-seed reconciliation (§5.1 live-flip wins; §5.2 + §5.3 Gate 8 amended to match); v1.11 amendment filed Day 22 (11 May 2026) AM — single-address MVP for the `/consignees/new` 3-step wizard (multi-address + per-weekday rotation deferred to Phase 2 per `memory/followup_multi_address_rotation_phase_2.md`); v1.12 amendment filed Day 25 (13 May 2026) AM — decoupled consignee creation from subscription creation (wizard removed; flat form lands operator on Overview with Create-subscription + Add-ad-hoc-task CTAs); edit-merchant surface added (`/admin/merchants/[id]/edit`, `updateMerchant` service, `merchant:update` permission); v1.13 amendment filed Day 25 (13 May 2026) evening — §7.1 review-discipline checklist codified (§3.6 hard-stop nomenclature + CI status verification gate; per `memory/decision_review_discipline_ci_gate.md`); v1.14 amendment filed Day 25 (13 May 2026) PM — per-merchant SF credentials + multi-region `client_id` resolver. §3.6 identifier model deepened from three layers to four (region + merchant + api_key + secret_key); new `suitefleet_regions` table; per-tenant Vault-backed credential storage; new §3.7 security posture; new admin routes for region management and per-merchant credentials; new `region:manage` permission; four new audit events. OAuth username/password resolution retires; auth migrates to API Key + Secret Key per SF OpsPortal. Filed at `memory/decision_brief_v1_14_amendment_per_merchant_sf_credentials.md`; v1.15 amendment filed Day 25 (13 May 2026) PM (post v1.14 merge) — dual-path SF auth at region level. `suitefleet_regions` gains a NOT NULL `auth_method` enum (`'oauth'` \| `'api_key'`, IMMUTABLE post-create); sandbox keeps OAuth, production regions use API Key per SF OpsPortal. Tenant Vault columns renamed to `suitefleet_credential_1_vault_id` / `_2_vault_id` (semantics interpreted by `region.auth_method`). Resolver returns a discriminated union; auth-client `login()` branches on the discriminator. Overrides v1.14 OQ-10 "clean OAuth cutover" with dual-path support. OAuth path ships independently; API Key code path remains blocked on Aqib's auth-header reply. Filed at `memory/decision_brief_v1_15_amendment_dual_path_sf_auth.md`.
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

1. **Onboard a consignee** — capture subscriber details, single primary delivery address, set delivery rules. System materializes tasks from rules going forward (rolling 14-day horizon, see §3.1.5). v1.11 amendment: multi-address (alternative addresses + per-weekday rotation) deferred to Phase 2 per `memory/followup_multi_address_rotation_phase_2.md`; the schema (migration 0014) is multi-address-ready but the v1 UI ships single-address only.
2. **View subscriber base** — list all consignees with CRM state badges; drill into individual consignee detail showing their subscription as a calendar (week/month/year toggle).
3. **View today's operations** — consolidated merchant calendar showing all consignees' deliveries for the day/week, filterable by status/area/time window.
4. **Handle exceptions** — skip a delivery (with automatic tail-end reinsertion per §3.1.6), pause/resume a subscription with bounded duration, change address one-off or forward-going.
5. **Apply skip overrides** — move skipped delivery to specific date instead of tail-end; skip without appending (cancel without compensation).
6. **Maintain consignee CRM state** — transition consignees between states (Active, On Hold, High Risk, Inactive, Churned, Subscription Ended).

### 2.3 Two Transcorp-staff workflows

1. **Onboard, activate, deactivate a merchant** — create the merchant tenant (name, slug, pickup address as ship-from), activate, deactivate.
2. **Cross-tenant operational read** (Phase 1.5, Day-19) — read-only visibility into all tasks, consignees, and subscriptions across all merchants on the platform. Powers the `/admin/tasks`, `/admin/consignees`, `/admin/subscriptions` admin surfaces with merchant-filter dropdown. Backed by 3 systemOnly read_all permissions (`task:read_all` / `consignee:read_all` / `subscription:read_all`) granted only to the `transcorp-sysadmin` role. No action capability — modifications go through the merchant operator's tenant-scoped surface (Phase 1.6 if cross-tenant action capability is needed).

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

**`tasks.pushed_to_external_at` column:** `timestamptz NULL` — already present in `0006_task.sql:156` (existing column with identical semantic; v1.2 amendment §0.3 Option A keeps the existing column rather than rename). Populated when SuiteFleet POST returns 2xx (code-anchored at `src/modules/tasks/repository.ts:531-543` `markTaskPushed` UPDATE; call sites at `src/modules/task-push/service.ts:723-728` cron-loop + `:1098-1104` single-task, both AFTER `pushResult` materializes). Surfaced on UI as integration-honesty indicator (§3.3.6). **Contract surface for forthcoming materialization/push decoupling (Day-14 own T3 plan PR per `memory/followups/cron_materialization_push_coupling.md`). Day-13 part 1 (PR #139, merged 875bfc4) made no schema change to this column; Day-14 work uses its existing semantics as the integration-honesty marker.**

**`webhook_events.raw_payload` column:** `jsonb NOT NULL`. Stores full SuiteFleet webhook payload at receipt time. Verify column exists; add migration if absent.

**`tenants.status` column:** `text NOT NULL` with values `'provisioning'`, `'active'`, `'suspended'`, `'inactive'`. Default `'provisioning'` on new tenant insert; transitions via Transcorp-staff `activateMerchant` (`provisioning → active`) and `deactivateMerchant` (`active → inactive`) services. `'suspended'` reserved (part-2 service-surface decision deferred per Day-13 plan §6). v1.2 amendment §1.7.1 — already in production with this 4-state lowercase canon; the original 2-state uppercase proposal was dropped at Day-13 plan-PR amendment time when prod verification (§0.2 Q1) surfaced the existing column. The 4-state is a better fit for the brief's separate `merchant.created` and `merchant.activated` audit events: `merchant.created` emits on `'provisioning'` (genuinely "created but not yet active") and `merchant.activated` emits on the `provisioning → active` transition (genuinely "activated"). PR #139 (merged 875bfc4) explicitly does NOT touch this column in `0017_tenants_pickup_address.sql`.

**`tenants.pickup_address` columns:** `pickup_address_line text`, `pickup_address_district text`, `pickup_address_emirate text` — all already shipped on production via PR #139 migration 0017 (`875bfc4`). v1.3 amendment §3.1.1 — brief text aligns to the migration-canonical naming (`pickup_address_*` prefix family); `pickup_district` / `pickup_emirate` short forms in earlier brief drafts are retired. Captured at merchant creation by Transcorp staff; surfaces as ship-from on every task. Service-layer DTO shape `pickup_address: { line, district, emirate }` (per §3.1.4 createMerchant signature) maps to the DB column names at the persistence layer.

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

**`suitefleet_regions` table (v1.14 amendment; v1.15 amendment adds `auth_method`):**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `client_id` | text | UNIQUE, `^[a-z][a-z0-9]*$` CHECK constraint |
| `display_name` | text | operator-facing label (e.g. "Transcorp UAE") |
| `status` | text CHECK | `'active'` \| `'inactive'` |
| `auth_method` | text CHECK NOT NULL | `'oauth'` \| `'api_key'` — selects per-region SF auth flavor. IMMUTABLE after region creation (v1.15) |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Seed rows (v1.15 — per-row `auth_method` assigned per SF OpsPortal posture):

| `client_id` | `display_name` | `auth_method` | `status` |
|---|---|---|---|
| `transcorpsb` | Sandbox | `oauth` | active |
| `transcorp` | Transcorp KSA | `api_key` | active |
| `transcorpuae` | Transcorp UAE | `api_key` | active |
| `transcorpqatar` | Transcorp Qatar | `api_key` | active |

Sandbox stays on the documented, working OAuth username/password flow — v1.15 overrides the v1.14 OQ-10 "clean OAuth cutover" ruling because retiring sandbox's auth path forces a re-credentialing event with no engineering benefit.

**`tenants` column additions (v1.14 amendment; v1.15 amendment renames credential columns):**

| Column | Type | Notes |
|---|---|---|
| `suitefleet_region_id` | uuid FK | references `suitefleet_regions(id)` `ON DELETE RESTRICT`; NOT NULL after backfill |
| `suitefleet_credential_1_vault_id` | uuid | nullable until credentials provisioned via `/admin/merchants/[id]/credentials`. Semantics by `region.auth_method` — see §3.7 |
| `suitefleet_credential_2_vault_id` | uuid | nullable until credentials provisioned via `/admin/merchants/[id]/credentials`. Semantics by `region.auth_method` — see §3.7 |

Backfill: all existing tenants (MPL, DNR, FBU, Demo Bistro) point at `transcorpsb`. `ON DELETE RESTRICT` matches the Day-22 pattern memory — `SET NULL` would silently break the NOT NULL CHECK at runtime; region deactivation is the operator-facing flow, not deletion.

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
- `region.created` — body includes `region_id`, `client_id`, `display_name` (v1.14)
- `region.updated` — body includes `region_id`, `changes` (flat-diff: `{ <field>: { before, after } }`) (v1.14)
- `region.deactivated` — body includes `region_id` (v1.14)
- `credentials.set` — body includes `tenant_id`, `classifier` (`'initial-set'` \| `'rotation'`). **NEVER contains plaintext credentials and NEVER contains Vault IDs** (v1.14)

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
- `merchant:update` (v1.12) — extended in v1.14 to gate `storeSuitefleetCredentials` (same operator scope; both are SF routing config)

**Region management (Transcorp-staff only, v1.14 amendment):**
- `region:manage` — umbrella permission covering region create / update / deactivate. Added to `API_KEY_FORBIDDEN_PERMISSIONS` (matches the `merchant:create` precedent for privilege-escalation guarding)

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

**`createConsignee(ctx, { identity, address })`:**

Decoupled from subscription creation (v1.12 amendment). Creates the `consignees` row + a single primary `addresses` row (`is_primary=true`) in one `withTenant` transaction. No subscription side-effects; no tasks materialised. Returns `{ consignee_id }`. Operator lands on `/consignees/[id]` Overview tab where the Create-subscription and Add-ad-hoc-task CTAs are surfaced (see §3.3.3). Supersedes the v1.11 `createConsigneeWithSubscription` orchestration; the existing `createSubscription` service is invoked separately from the Overview-tab CTA flow with no signature change.

**`createAdHocTask(ctx, consigneeId, { date, window, address_id?, notes? })`:**

One-off task creation against an existing consignee, independent of any subscription. Resolves `address_id` to the consignee's primary address when omitted; validates the supplied `address_id` belongs to the same consignee when provided. Inserts the `tasks` row immediately in Planner DB (`internal_status='PENDING'`) and enqueues the SF outbound push to QStash for near-real-time delivery — matches the optimistic-ack pattern from skip/cancel flows. Operator surfaces a "Saved — pushing to SuiteFleet" toast on success. Audit-emits `task.ad_hoc.created` with the consignee + date + address-id triplet for traceability. Permission: existing `task:create` (already registered Day-19 per `decision_task_module_amendment_v1.md`).

**`createMerchant(ctx, { name, slug, pickup_address })`** / **`updateMerchant(ctx, tenantId, { name?, slug?, pickup_address?, suitefleet_customer_code? })`** / **`activateMerchant`** / **`deactivateMerchant`:**

Transcorp-staff scoped. Audit-emits. `updateMerchant` (v1.12 amendment) audit-emits `merchant.updated` with the diff of changed fields only — unchanged columns omitted from the body to keep the audit row narrow. Cross-field validation: slug uniqueness across all tenants (collision returns `ConflictError`); `suitefleet_customer_code` must parse as positive integer; slug change surfaces a client-side warning dialog pre-submit ("Changing the slug will break any existing bookmarks or saved URLs that use the current slug. Continue?"). `tenants.status` is NOT editable through this method — activate/deactivate remain the only transition paths. Permission: `merchant:update` (new, transcorp-sysadmin only).

**`appendWithoutSkip(ctx, subscriptionId, { target_date?, reason })`:**

- Verify permission (`subscription:override_skip_rules`)
- Compute compensating date (or use target_date_override)
- Extend `end_date`, materialize new task on next horizon advance
- Insert `subscription_exceptions` row with `type='append_without_skip'`
- Emit `subscription.end_date.extended` with `triggered_by='append_without_skip'`

**`createRegion(ctx, { client_id, display_name })` / `updateRegion(ctx, regionId, params)` / `deactivateRegion(ctx, regionId)` (v1.14 amendment):**

Transcorp-staff scoped. `createRegion` validates `client_id` against the `^[a-z][a-z0-9]*$` CHECK (lowercase alphanumeric, must start with letter); UNIQUE violation returns `ConflictError`. `deactivateRegion` flips `status` to `inactive` (regions with tenants pointing at them remain in use; deactivation hides the row from the "available regions" picker for new merchant onboarding but does NOT cascade to existing tenants — the `ON DELETE RESTRICT` constraint makes that explicit). Audit-emits `region.created` / `region.updated` / `region.deactivated`. Permission: `region:manage`.

**`storeSuitefleetCredentials(ctx, tenantId, { apiKey, secretKey })` (v1.14 amendment):**

Transcorp-staff scoped. Wraps Supabase Vault:
1. Permission check: `merchant:update`
2. If `tenants.suitefleet_api_key_vault_id` IS NOT NULL (rotation path): `vault.update_secret(existing_uuid, new_plaintext)` for both keys; emit `credentials.set` with `classifier='rotation'`.
3. Else (initial-set path): `vault.create_secret(plaintext)` for each, store the returned UUIDs in the tenant row inside a single `withTenant` transaction; emit `credentials.set` with `classifier='initial-set'`.
4. On rotation, invalidate the in-memory token cache entry for this tenant so the next push triggers a fresh SF `login()` against the new credentials.
5. Plaintext NEVER stored in any other table, NEVER returned from this function, NEVER logged. The audit event body excludes both plaintext and Vault UUIDs.

**`resolveSuitefleetCredentials(ctx, tenantId)` (v1.14 amendment — replaces v1.7 env-backed resolver):**

Replaces the OAuth username/password resolver entirely. Read path:
1. SELECT `suitefleet_region_id`, `suitefleet_customer_code`, `suitefleet_api_key_vault_id`, `suitefleet_secret_vault_id` from the tenant row, JOIN `suitefleet_regions` on the region FK to read `client_id` and region `status`.
2. If region `status='inactive'` OR either Vault UUID is NULL: throw `ValidationError('credentials not configured for this merchant')`. Fail-closed.
3. Read both secrets from `vault.decrypted_secrets` (restricted to service-role by Supabase RLS).
4. Return `{ clientId, customerId, apiKey, secretKey }`. The result is never cached at the resolver layer; the token cache wraps the auth `login()` call separately, so resolver reads only fire on cache miss/refresh.
5. Plaintext never logged.

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

**Webhook payload format:** JSON array (batched per receipt; each entry is one event). The receiver iterates events; the dedup UNIQUE on `webhook_events` collapses retries. (v1.8 amendment — original `?sf-format=object` claim was empirically wrong; SF sends arrays. Receiver enforces `Array.isArray` and parser asserts the same.)

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

- `/admin/merchants` — list view, all merchants, status column, row-level EDIT + ACTIVATE/DEACTIVATE actions
- `/admin/merchants/new` — create form: name, slug, pickup address (street, district, emirate)
- `/admin/merchants/[id]/edit` — edit form (v1.12 amendment) mirroring the `/new` component pre-filled from the current `tenants` row. Editable fields: name, slug, pickup address (line/district/emirate), SF customer code, **SF region** (v1.14 — select from active rows in `suitefleet_regions`). `tenants.status` is intentionally read-only here — activate/deactivate remain their own row actions. Credentials are NOT editable here — see `/admin/merchants/[id]/credentials` below. Slug-change confirm dialog gates submit. Permission: `merchant:update` (transcorp-sysadmin only).
- `/admin/merchants/[id]/credentials` — write-only credentials surface (v1.14 amendment). Two password inputs (API Key + Secret Key), autocomplete=off. Submit button label depends on state: SET CREDENTIALS when both Vault IDs are null on the tenant, ROTATE CREDENTIALS otherwise. Rotation path gates submit on a confirmation modal ("Rotating credentials will invalidate the current API Key and Secret Key. Pushes from this merchant will fail until SuiteFleet's side is updated. Continue?"). Page NEVER displays existing credential values — write-only by design. Permission: `merchant:update`.
- `/admin/regions` — list view (v1.14 amendment). Columns: Display Name / Client ID / Status / In-Use Count (tenants pointing at this region) / Created / Actions (DEACTIVATE if active; ACTIVATE if inactive). NEW REGION CTA top-right.
- `/admin/regions/new` — create form (v1.14 amendment). Inputs: `client_id` (lowercase alphanumeric, must start with letter — mirrors the CHECK constraint), `display_name`. Submit CREATE REGION.
- `/admin/regions/[id]` — read-only detail (v1.14 amendment). Shows client_id, display_name, status badge, created date, in-use count. Deactivate action if no tenants point at the region (otherwise warning copy explaining deactivation hides region from picker but preserves existing assignments).

**Merchant detail page integration (PR #271 coordination):** The merchant detail page (`/admin/merchants/[id]`) renders a credentials status badge in the Routing section — "Credentials configured" (green) when both Vault IDs are present, "Credentials missing" (amber) when either is null — with a MANAGE CREDENTIALS link → `/admin/merchants/[id]/credentials`.

#### 3.2.2 Auth posture

- Middleware gates `(admin)/` route group on `transcorp_staff` role
- Merchant operators get 403
- `(admin)/` route group parallel to `(app)/`
- UI permission rendering rules per §3.3.10

### 3.3 Frontend additions — Merchant operator

#### 3.3.1 Consignee onboarding — flat form (`/consignees/new`)

**Flat single-page form** (v1.12 amendment; supersedes the v1.11 three-step wizard). Onboarding decouples from subscription creation — real operators onboard consignees before the plan is decided, or for one-off ad-hoc deliveries. Form aesthetic mirrors `/admin/merchants/new`: two visually-distinct sections with subtle dividers, single submit button, no step indicators.

**Identity section:**
- Full name (required)
- Primary phone (required, E.164 per-country validation)
- Email (optional, recommended for notifications)
- Delivery notes (optional, operator → driver hand-off context)
- Merchant internal reference (optional)
- Internal notes (operator-only)
- Alternative phone — **Phase 2** (single phone for v1)

**Address section — single primary delivery address (v1.11 amendment carries forward):**
- Address label (Home / Office / Other)
- Address line (building / villa / unit, street)
- District
- Emirate
- Lat / lng — **Phase 2** (smart geotag; v1 captures address text only)
- **Alternative addresses + per-weekday rotation deferred to Phase 2** per `memory/followup_multi_address_rotation_phase_2.md`. The schema (migration 0014) is multi-address-ready; v1 ships single primary so the UI lane stays in budget.

**On submit:** creates `consignees` row + single primary `addresses` row (`is_primary=true`) atomically via the v1.12 `createConsignee` service (see §3.1.4). No subscription, no tasks. Redirect to `/consignees/[id]` Overview tab where Create-subscription and Add-ad-hoc-task CTAs are surfaced for the second beat (see §3.3.3 empty-state behavior).

**Subscription creation** moves to its own standalone surface, reached from the Overview-tab CTA. Plan name, start/end date, days of week, delivery window, internal notes — all captured on a dedicated `/consignees/[id]/subscriptions/new` form using the existing `createSubscription` service (no signature change). Address rotation tile remains **Phase 2** (single primary fallback per migration 0014's COALESCE pattern handles per-day routing in v1).

**Schedule rules** (cut-off time, maximum skips, blackout dates, loyalty tier) — **Phase 2** (the v1 surfaces rely on merchant defaults and the existing 18:00 Dubai cut-off convention).

#### 3.3.2 Consignee list view (`/consignees`)

Evolved from current read-only list. New affordances:
- CRM state badge column (color-coded per state)
- **NO TASKS flag (v1.12 amendment)** — amber pill rendered on any row where the consignee has zero `tasks` rows (any `internal_status`). Flag is task-based, not subscription-based: clears the moment the first task lands, whether from a subscription's first materialised task or from an ad-hoc task creation (`createAdHocTask`). Catches the decoupled-onboarding gap — a consignee onboarded without a subscription stays visible-but-flagged until the operator wires work to them via either CTA on the Overview tab.
- Search by name / phone / email
- Filter: CRM state, district, today's delivery state
- Click row → `/consignees/[id]` Overview tab (calendar tab one click further)
- "Onboard new consignee" CTA

**Visual treatment per BRD §8.5:**
- High Risk consignees: row tinted red
- On Hold consignees: row greyed out
- Active: default styling

#### 3.3.3 Consignee detail page with calendar (`/consignees/[id]`)

Headline UI surface. Reference: `subplanner.vercel.app/consignee/c_001`.

**Overview tab empty state (v1.12 amendment).** A consignee with no subscription and no tasks renders the Overview tab as the decoupled-onboarding landing page:
- Identity block (name, phone, email)
- Primary address block
- CRM state badge (defaults `ACTIVE`)
- Two prominent CTAs: **Create subscription** (links to `/consignees/[id]/subscriptions/new`) and **Add ad-hoc task** (opens a dialog capturing date, window, optional notes, optional address override — backed by the `createAdHocTask` service in §3.1.4)
- Subscription / Calendar / History tabs render their natural empty states; no tab is hidden. The Subscription tab shows "No subscription yet — create one from Overview"; the Calendar tab shows the merchant week scaffold with all cells empty; the History tab shows the timeline view with just the `consignee.created` event.

Once a subscription or ad-hoc task lands, the Overview tab demotes the CTAs in favor of the standard header card below.

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

The Planner uses Transcorp's corporate-locked brand system. Codebase tokens at `src/styles/brand-tokens.css` are the implementation source of truth; this section is the design-intent source of truth. Both must match; drift between them is a v1.x bug.

**Palette — primary (locked by corporate, do not substitute):**

| Name | Hex | Use |
|---|---|---|
| Night Sky Navy | `#252d60` | Wordmark, headings, anchor surfaces (corporate logo fill) |
| Grass Green | `#3e7c4b` | Movement, go-signals, highlights, ACTIVE-state semantics (corporate logo accent fill) |
| Snow White | `#FAF8F4` | Default page surface (warm, not stark) |

**Palette — accent (sparingly):**

| Name | Hex | Use |
|---|---|---|
| Signal Amber | `#E8A33C` | Lead accent — alerts, stickers, CTAs, hi-vis trim |
| Bright Red | `#D93A2B` | Errors, hazardous, stop, HIGH_RISK-state semantics |
| Ocean Blue | `#1F6FA8` | Information, links, infographics |

**Signal Amber ladder (5-step):**

| Step | Hex | Use |
|---|---|---|
| Amber 100 | `#FBE4BD` | Background tint |
| Amber 300 | `#F1BF6B` | Soft hi-vis surface |
| Signal Amber | `#E8A33C` | Core amber |
| Amber 600 | `#C98726` | Hover / accent on light |
| Amber Deep | `#8E5A14` | Amber-on-light text |

**Neutrals:**

| Name | Hex | Use |
|---|---|---|
| Paper | `#FAF8F4` | Default page (same as Snow White) |
| Ivory | `#F2EEE6` | Surface / cards |
| Stone 200 | `#D3CEC2` | Dividers, hairline borders |
| Stone 600 | `#4E4A42` | Secondary text, ON_HOLD/INACTIVE/CHURNED-state styling |
| Ink | `#141414` | Body copy |

**Composition ratio (typical Transcorp surface):**

Snow White 58% · Navy 22% · Green 12% · Amber 8%.

Tints (10–100% in 10% steps) of Navy, Green, and Amber are available for backgrounds and infographics — never as substitutes for the core hex when the brand colour itself is required.

**Typography — three faces (locked by corporate):**

| Role | Typeface | Weights | Use |
|---|---|---|---|
| Display | Manrope | 400 / 500 / 600 / 700 / 800 | Slogan, cover statements, headlines, chapter opens |
| Primary (body) | Mulish | 300 / 400 / 500 / 600 / 700 / 800 | All running copy, captions, UI, sub-heads |
| Editorial serif | Sanchez (Slab) | 400 (Italic available) | Pull-quotes, editorial accents |

Mono / labels: Mulish caps with letter-spacing 0.10–0.14em (no separate mono face — discipline).

Arabic pair (Phase 2 i18n per §4): IBM Plex Sans Arabic (pairs with Manrope/Mulish) + Amiri (pairs with Sanchez).

**Type scale (Latin):**

| Token | Size / Line | Weight | Tracking |
|---|---|---|---|
| Display XL (cover) | 96–128 / 0.95 | 700 | −0.04em |
| Display L (h1) | 56–72 / 1.0 | 700 | −0.03em |
| Display M (h2) | 36–44 / 1.05 | 600 | −0.025em |
| Display S (h3) | 24–28 / 1.15 | 500–600 | −0.01em |
| Body L | 18 / 1.6 | 400 | 0 |
| Body M | 15–16 / 1.65 | 400 | 0 |
| Caption | 12–13 / 1.5 | 500 | 0 |
| Eyebrow / label | 10–11 / 1.2 | 500 caps | +0.10–0.14em |

**Typesetting rules:**

- Manrope minimum 18px. Below that, switch to Mulish.
- Body line-length: 60–75 characters (≈70ch max).
- Line-height: 1.55–1.65 for body; 0.95–1.15 for display.
- Tracking: tighten display (−0.025em to −0.04em); leave body at 0; open eyebrows/labels (+0.10–0.14em).
- Numerals: tabular for tables and specs; proportional for prose.
- Italics: reserve Sanchez italic for editorial pull-quotes; never italicise Manrope or Mulish for emphasis (use weight instead).
- Never substitute fonts. Never stretch, skew, or outline.

**Web font fallback stack:**

```css
font-family: "Manrope", "Mulish", ui-sans-serif, system-ui, sans-serif;  /* display */
font-family: "Mulish", ui-sans-serif, system-ui, sans-serif;             /* body */
font-family: "Sanchez", Georgia, serif;                                  /* editorial */
font-family: "IBM Plex Sans Arabic", system-ui, sans-serif;              /* Arabic body/display, Phase 2 */
font-family: "Amiri", Georgia, serif;                                    /* Arabic editorial, Phase 2 */
```

**Logo asset:**

Primary lockup: navy wordmark (`#252d60`) + green forward-arrow + navy curved swoop. Files at `public/brand/`. Lockup placement at app-shell top-left; per-page chrome should NOT repeat the logo. Minimum clear space around the lockup: equal to the wordmark cap height. Do not recolor, stretch, skew, or outline. Variants beyond the primary lockup (white-on-navy reverse, mark-only, monochrome) — Phase 2 if needed.

**Reference for visual treatment:** `transcorp-lofi-v2.vercel.app` for spacing, hairline-border discipline, and editorial cadence. Hairline borders 0.5px in Stone 200 (`#D3CEC2`); never use shadows. Sentence case throughout; never title case except eyebrow labels (which use Mulish caps with letter-spacing per typography).

**State-semantic color usage (CRM states — referenced from §3.3.2):**

- ACTIVE → Grass Green (`#3e7c4b`) — go-signal semantics per corporate spec
- HIGH_RISK → Bright Red (`#D93A2B`) — error/hazard semantics
- ON_HOLD → Stone 600 (`#4E4A42`) on Ivory (`#F2EEE6`) — muted hold
- INACTIVE → Stone 600 muted
- CHURNED → Stone 600 with strikethrough; "Churned" label
- SUBSCRIPTION_ENDED → Stone 600 with "Ended" label

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

Labels are proxied AS-IS from SuiteFleet's `/generate-label` endpoint. Operator clicks Print labels on `/tasks` page (single or multi-select); service layer translates Planner UUIDs → SF external_ids; SF returns the indv-small format PDF; PDF streams back to operator unmodified. Auth uses the post-A1 per-tenant resolver — region credentials env-backed (`transcorpsb` sandbox), per-merchant `customerId` from `tenants.suitefleet_customer_code`. AWB prefix on each label (alphanumeric, e.g. `MPL-...`) is the SF-side `customer.code` cosmetic field; not the routing identifier. See §3.6 + `memory/decision_brief_v1_7_amendment_sf_identifier_model.md`.

No PDF post-processing or logo swap. Decision locked at v1.6 per `memory/decision_brief_v1_6_amendment_no_logo_swap.md`.

### 3.6 SuiteFleet credential decision

**MVP (v1.14 — per-merchant credentials; v1.15 — dual-path auth at region level):** SF credentials are **per-merchant**, scoped via region for routing. Each region carries an `auth_method` (`'oauth'` or `'api_key'`) that selects how SF authenticates that region's merchants. Sandbox (`transcorpsb`) stays on the documented, working OAuth username/password flow. Production regions (`transcorp`, `transcorpuae`, `transcorpqatar`) use per-merchant API Key + Secret Key issued via SF OpsPortal. The same two Vault columns on `tenants` hold either flavor — semantics interpreted by `region.auth_method` (see §3.7). The wire body still carries `customerId` (numeric); the SF customer.code AWB prefix remains cosmetic.

**Architectural model (four identifier layers + region-level auth_method, locked Day 25 per v1.14 + v1.15 amendments):**

| Layer | Identifier | Storage | Scope |
|---|---|---|---|
| Region | `client_id` (e.g. `transcorpsb`, `transcorpuae`, `transcorpqatar`) | `suitefleet_regions.client_id` (DB-backed) — JOINed from `tenants.suitefleet_region_id` | Per region; multiple merchants per region |
| Region auth method | `auth_method` (`'oauth'` \| `'api_key'`) | `suitefleet_regions.auth_method` | Per region; IMMUTABLE after creation (v1.15) — changing requires re-credentialing every tenant |
| Merchant | `customerId` (numeric, e.g. 588 / 586 / 578) | `tenants.suitefleet_customer_code` | Per merchant within a region; routes tasks to correct SF merchant for invoicing |
| Auth — Credential 1 | OAuth username OR API Key, per `region.auth_method` | Supabase Vault — UUID stored in `tenants.suitefleet_credential_1_vault_id` | Per merchant; never shared, never logged |
| Auth — Credential 2 | OAuth password OR Secret Key, per `region.auth_method` | Supabase Vault — UUID stored in `tenants.suitefleet_credential_2_vault_id` | Per merchant; never shared, never logged |
| AWB prefix | `customer.code` (alphanumeric) | (SF-managed) | Cosmetic; AWB prefix only; NO routing role |

**Resolver (v1.14 + v1.15 — replaces v1.7 env-backed resolver):** `src/modules/credentials/suitefleet-resolver.ts` resolves all five identifier values from the database. Read path: SELECT the tenant row + JOIN `suitefleet_regions` on the region FK to fetch `client_id` + `auth_method` + region `status`; SELECT `decrypted_secret` from `vault.decrypted_secrets` for both Vault UUIDs. Returns a **discriminated union**:

```typescript
type SuitefleetCredentials =
  | { auth_method: 'oauth';   clientId: string; customerId: number; username: string; password: string }
  | { auth_method: 'api_key'; clientId: string; customerId: number; apiKey: string;   secretKey: string };
```

Throws `ValidationError('credentials not configured')` if either Vault UUID is NULL or the region row is `inactive`. The SF auth-client's `login()` branches on the discriminator: `oauth` uses the existing `POST /api/auth/authenticate` flow (sandbox preserved); `api_key` uses the Aqib-confirmed header pattern (still pending — code path remains blocked on Aqib's reply). Plaintext credentials are never logged and never cached past the SF token-cache scope (the token cache wraps the authenticated `login()` call, so the resolver only fires on cache miss/refresh). See §3.7 for the security posture.

**Fail-closed extension:** `pushSingleTask` (and any other resolver caller) returns / throws `ValidationError` if credentials are not configured. The existing missing-`customer_code` guard at `src/modules/task-push/service.ts` is supplemented by a missing-credentials guard immediately upstream.

**Phase 2:** Regional onboarding (UAE/Qatar going live) is operational work — adding the region row already happens via `/admin/regions/new` (in scope for v1.14 MVP; v1.15 adds the auth_method radio). Per-merchant credential provisioning happens via `/admin/merchants/[id]/credentials`. AWS Secrets Manager migration (Vault UUID → Secrets Manager ARN per tenant) remains Phase 2 — see `memory/followup_secrets_manager_swap_critical_path.md` (the `auth_method` enum is orthogonal to the at-rest storage primitive; both flavors carry through the swap).

**Demo Q&A rehearsal:**

> "Every merchant has its own SuiteFleet credentials, stored at rest in Supabase Vault. The auth flavor depends on the region: sandbox uses OAuth (the original, documented SF flow); production regions use per-merchant API Key + Secret Key issued via SF OpsPortal. The resolver returns a discriminated union — the SF client branches on the auth method at request time. Adding a new region — UAE, Qatar, future markets — is an operator-facing flow, not a deploy; the operator picks the auth method when the region is created. The three demo merchants currently share the `transcorpsb` region with OAuth, but each merchant authenticates with its own credentials, so SF sees three distinct authenticated callers."

### 3.7 Security posture — credential storage (v1.14 amendment; v1.15 amendment adds auth_method semantics)

**At-rest encryption.** SF credentials are stored in Supabase Vault (pgsodium AEAD). `tenants` row holds only the Vault UUIDs; plaintext never lives in the tenant row, never appears in logs, never returns from any service function outside the authenticated SF call path.

**Vault content semantics per `region.auth_method` (v1.15):**

The two Vault columns are deliberately named generically because they hold different semantics per the region's auth flavor:

| `region.auth_method` | `suitefleet_credential_1_vault_id` holds | `suitefleet_credential_2_vault_id` holds |
|---|---|---|
| `'oauth'` | OAuth username | OAuth password |
| `'api_key'` | API Key | Secret Key |

Operators never type "credential_1" or "credential_2" anywhere — the abstraction lives only in the persistence layer. The `/admin/merchants/[id]/credentials` form labels its fields based on the parent region's `auth_method` (Username/Password for OAuth regions; API Key/Secret Key for API Key regions). The resolver returns a discriminated union typed by `auth_method` so callers see the semantically correct field names.

**Storage primitive:**
- `vault.create_secret(plaintext)` returns the UUID; stored in `tenants.suitefleet_credential_1_vault_id` / `_2_vault_id`.
- `vault.update_secret(uuid, new_plaintext)` rotates in place (preserves the UUID).
- Reads via `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = $vault_id` — Supabase RLS restricts the view to service-role.

**Operational guardrails:**
- The `/admin/merchants/[id]/credentials` UI is write-only by design. Existing values cannot be displayed back to the operator under any flow; the only operations are SET (initial) and ROTATE.
- The `credentials.set` audit event body contains the tenant ID, the classifier (`'initial-set'` \| `'rotation'`), and the actor — never plaintext, never the Vault UUIDs themselves. The event body does NOT include `auth_method` either — the region binding is recoverable via `tenant_id → region_id → auth_method` for forensic queries that need it.
- Rotation invalidates the in-memory SF token cache for that tenant; the next push triggers a fresh authenticated `login()` against the new credentials.
- Region deactivation (`status='inactive'`) makes the resolver fail-closed for any tenant pointing at the deactivated region — operational kill-switch for compromised-region scenarios.
- `auth_method` is IMMUTABLE after region creation (v1.15). Changing it would invalidate every tenant's credentials under that region — a destructive operation requiring re-credentialing every merchant. Future enhancement: `migrateRegionAuthMethod` with an operator-driven re-credentialing flow (out of scope for v1.15).

**Future migration path:** AWS Secrets Manager swap (Phase 2 per §4) reshapes the `suitefleet_credential_1_vault_id` / `_2_vault_id` semantics from "Vault UUID" to "Secrets Manager ARN" — same column shape, different resolver implementation. The `auth_method` discriminator carries through the swap (the discriminated-union return shape is preserved). The service-layer interface (`resolveSuitefleetCredentials` return shape) remains stable across the swap.

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
| AWS Secrets Manager swap — Vault UUID → Secrets Manager ARN, per-merchant scope (v1.14 reshape) | `followup_secrets_manager_swap_critical_path.md` | Post-pilot |
| Adding new regions via tenant-admin (merchant-portal) UI (v1.14 — currently Transcorp-sysadmin scope only) | v1.14 amendment §3.2.1 | Post-pilot if ever needed |
| Webhook events admin UI | plan.docx §10 Day 12 | Post-pilot |
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

3. **Merchant operator first-touch (3 min, two-beat decoupled flow per v1.12 amendment):** Log in as Demo Bistro operator → land on operator home → onboard first consignee Fatima Al Mansouri via flat form (identity + primary address) → land on Fatima's Overview page → CRM state `ACTIVE` badge visible → click "Create subscription" CTA → set Mon-Fri lunch plan in standalone subscription form → `/consignees/[id]` calendar materializes immediately. Visible "Pushed to SuiteFleet ✓" indicators.

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
- Sarah Khouri pre-configured with ACTIVE CRM state and ≥2 FAILED deliveries to enable HIGH_RISK transition during demo

### 5.3 Pre-demo verification (`demo-preflight.sh`)

Runs twice on Day 19 (start of dry-run, 30 min before live demo):

1. Demo Bistro merchant exists, status=ACTIVE, pickup address set
2. ≥3 other seeded merchants (MPL, DNR, FBU)
3. Total consignees ≥ 845
4. Cron has run within last 24 hours
5. ≥1 task with status=DELIVERED and `tasks.pod_photos IS NOT NULL` (sourced via real webhook → Layer 2 status-fn write → Layer 3 POD-extraction populates the jsonb in the same UPDATE statement; v1.8 amendment binds the gate to the concrete column landed by the A2 plan-PR)
6. ≥1 subscription with applied skip + populated compensating_date
7. Fatima Al Mansouri has address rotation configured
8. Sarah Khouri has ≥2 FAILED deliveries in history; CRM state=ACTIVE pre-demo
9. SF integration responsive (ping known-safe endpoint)
10. Auth flows work for `transcorp_staff` test account and `tenant_admin` test account

If any check fails: stop, fix, or fall back to recorded screen capture.

### 5.4 Q&A rehearsal — anticipated questions

**"How does Transcorp prevent merchant A's tasks appearing in merchant B's SuiteFleet account?"**

> "SF `client_id` is region-scoped — sandbox, UAE, Qatar each have their own. All merchants within a region share that credential and route tasks via `customerId` in the wire body. Three demo merchants share `transcorpsb` because they're all sandbox-region. The resolver threads each tenant's `customerId` (588/586/578) into every `createTask` call so SF invoices each merchant correctly. SF console will show three distinct merchants with their respective task volumes — proof of multi-tenancy live."

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
- **Tier discipline.** T2 hard-stop at PR open for code; T3 hard-stop twice (plan + PR) for schema/auth/RLS/audit changes. See §7.1 for the §3.6 review-discipline checklist (codified Day 25 per `memory/decision_review_discipline_ci_gate.md`).
- **RLS verification.** Every new tenant-scoped table has RLS verified in PR review.
- **Audit correlation_id.** Causally related events (skip → end_date_extended; pause → end_date_extended) share correlation_id in same transaction.
- **Idempotency on mutating operations.** Skip API requires idempotency_key. Server stores, rejects duplicates with 409.
- **Webhook deduplication.** Every webhook event deduplicated via UNIQUE.
- **Pre-demo verification automated.** `demo-preflight.sh` is the gate before live demo.

### 7.1 Review discipline (§3.6 hard-stop checklist)

The "§3.6 hard-stop" convention referenced throughout EOD docs, plan
PRs, and decision memos codifies the structured review gate that
every T2 + T3 PR clears before merge. Codified Day 25 per
`memory/decision_review_discipline_ci_gate.md` (the gate existed
informally from Day 13 onward; this section makes the checklist
load-bearing).

**Reviewer checklist (both rounds — plan-PR round 1 + code-PR round 2):**

1. **Plan compliance.** Does the PR's scope match the approved plan?
   Findings + open questions resolved? §9 rulings honoured in code?
2. **Test signal.** Local test counts + tsc state surfaced; unit
   suite green; integration coverage at PR open for new SQL paths
   (Day-23 §F discipline).
3. **CI status verification.** Reviewer must check the PR's CI run
   status before clearing the §3.6 verdict. **CI red is a blocker.**
   Use `gh pr checks <PR#>` or `gh pr view <PR#> --json mergeStateStatus`.
   The only exception is demonstrably pre-existing main-side failures
   (verifiable via `gh run list --branch main`), and only when a
   parallel fix-PR is in flight. Otherwise: fix-first.
4. **Architectural gates.** RLS on new tenant-scoped tables; audit
   correlation_id for causally related events; idempotency on
   mutating ops; webhook dedup UNIQUE.
5. **Brand discipline.** New UI uses Transcorp design tokens; no
   shadows; hairline borders; sentence-case body.

**Builder responsibility:** report CI status in the PR-open message
alongside local test signal, in the format
`CI status: <PASS | FAIL | UNSTABLE | PENDING>. Local tests: <count>
passing, tsc <green | red>.` If CI is red or UNSTABLE, surface that
in the same message — not in a follow-up, not buried in the PR body.

**Merge gate:** Love-only. No `gh pr merge --admin` bypass without
explicit Love authorization quoted verbatim in-thread.

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
| v1.2 | 5 May 2026 (post-Day-13 part-1 merge) | Two-amendment sync from Day-13 plan-PR conditional approval and prod schema verification. Filed at `memory/decision_brief_v1_2_amendments_d13_part1.md`. **§3.1.1 `tasks.suitefleet_push_acknowledged_at` → `tasks.pushed_to_external_at`** (§0.3 Option A) — existing column at `0006_task.sql:156` has identical semantic; rename rejected as cross-cutting churn for stylistic gain. **§3.1.1 `tenants.status` → 4-state lowercase canon** (`provisioning`/`active`/`suspended`/`inactive`, default `provisioning`) — adopted from prod (already shipped); 2-step `provisioning → active` lifecycle is a better fit for separate `merchant.created` vs `merchant.activated` audit events than the originally proposed 2-state uppercase. PR #139 (T3 part-1 code, merged 875bfc4) is the canonical schema landing; this brief amendment realigns the brief text post-hoc. |
| v1.3 | 6 May 2026 (Day 16 morning) | One-amendment sync from Day-16 Block 1 schema-probe finding. **§3.1.1 `tenants.pickup_district` → `tenants.pickup_address_district`, `tenants.pickup_emirate` → `tenants.pickup_address_emirate`** — adopted from prod (already shipped via PR #139 migration 0017 `875bfc4`); brief text was outlier vs migration-canonical `pickup_address_*` prefix family. Service-layer DTO shape preserved (`{ line, district, emirate }`); persistence-layer mapping handles the column-name expansion. Filed at `memory/decision_brief_v1_3_amendment_pickup_address_canon.md`. |
| v1.4 | 7 May 2026 (Day 17 morning) | §3.3.11 rewritten in full to corporate-locked brand spec — palette (3 primary + 3 accent + 5-step amber ladder + 5 neutrals), composition ratio (58/22/12/8), three-face type system (Manrope display + Mulish body + Sanchez editorial + Mulish-caps mono discipline), 8-token type scale, typesetting rules, web fallback stack, logo asset reference, state-semantic color usage. Codebase brand-tokens.css already aligned with corporate spec; this amendment brings brief into alignment. Filed at `memory/decision_brief_v1_4_amendment_brand_tokens.md`. |
| v1.5 | 7 May 2026 (Day 17, post-PR-#168 visual refinement) | Color hex reconciliation to corporate SVG asset. Navy `#0F2A5C` → `#252d60`; Green `#2E8B4A` → `#3e7c4b`. SVG (transcorp-logo-color.svg, fill values from corporate vector source) is the canonical source of truth; brief and CSS variables (`src/styles/brand-tokens.css`) align to the asset. Composition ratio (58/22/12/8), type system, accent palette, 5-step amber ladder, neutrals all unchanged. Filed at `memory/decision_brief_v1_5_amendment_color_canon.md`. |
| v1.6 | 7 May 2026 (Day 17, ~1:30 PM Dubai) | Locked decision: labels proxied as-is from SF; no logo swap in scope (Phase 1 or Phase 2). §3.5 amended to reflect MVP-final state — current `/api/tasks/labels` flow (PR #170 drizzle hotfix + PR #172 UUID translation) IS the final label rendering path. Demo framing: SF logo on label is by design; Transcorp's value-add is upstream operator workflow, not label rendering. Filed at `memory/decision_brief_v1_6_amendment_no_logo_swap.md`. |
| v1.7 | 8 May 2026 (Day 18) | §3.6 rewritten to reflect actual SF identifier model — three layers locked: region `client_id` env-backed (transcorpsb / transcorpuae / transcorpqatar), per-merchant `customerId` DB-backed via `tenants.suitefleet_customer_code` and resolved per-tenant by `src/modules/credentials/suitefleet-resolver.ts`, AWB prefix `customer.code` cosmetic only with no routing role. Phase 2 (§4) row updated: "per-tenant SuiteFleet credential isolation" replaced with "regional credential expansion." §3.5 label-generation language reframed for region+customerId model. §5.4 Q&A rehearsal updated. Filed at `memory/decision_brief_v1_7_amendment_sf_identifier_model.md`; A1 code-PR landed the resolver swap + bundled scope (migration 0013 comment, two Day-10 memo amendments, this brief amendment, MEMORY.md index update, premise-correction memo at `memory/followup_a1_plan_section_2_5_premise_correction.md`). |
| v1.8 | 8 May 2026 (Day 18, post-A2-plan-PR) | Two amendments folded with the A2 webhook-handler 3-layer plan-PR. **§3.1.10 webhook payload format corrected** — original `?sf-format=object` (single-event JSON) was empirically wrong; SF sends JSON arrays per Day-7 capture and receiver/parser enforce array shape ([route.ts:146](../../src/app/api/webhooks/suitefleet/%5BtenantId%5D/route.ts#L146); [webhook-parser.ts:149](../../src/modules/integration/providers/suitefleet/webhook-parser.ts#L149)). New text describes batched array shape + dedup UNIQUE collapsing retries. **§5.3 Gate 5 reworded** to bind to the concrete column landed by the A2 plan-PR: `tasks.pod_photos IS NOT NULL` rather than free-text "POD photo URL." §3.3.8 cache-from-webhook commitment unchanged — POD remains the canonical example. Filed in `memory/plans/day-18-a2-webhook-handler-3-layer.md` §7. |
| v1.9 | 9 May 2026 (Day 19, post-A2-smoke-PASS) | §2.3 expansion to two Transcorp-staff workflows — adds the Phase 1.5 admin cross-tenant operational read surface (`/admin/tasks` / `/admin/consignees` / `/admin/subscriptions` with merchant-filter dropdown; backed by `task:read_all` / `consignee:read_all` / `subscription:read_all` systemOnly perms granted to the `transcorp-sysadmin` role). Read-only — no action capability. v1.6 if cross-tenant action capability is needed. Filed inline at §2.3 + §1.7 amendment; no separate decision memo — Phase 1.5 lane already shipped, brief catches up. |
| v1.10 | 10 May 2026 (Day 21, evening, post Session B Day-21 data-check) | **Sarah Khouri demo-persona pre-seed reconciliation.** §5.1 Step 5 narrative ("drill into Sarah → consignee timeline shows pattern of failed deliveries → click Change CRM state → mark High Risk") implies a **live-flip during the demo**. §5.2 (pre-seeded HIGH_RISK) and §5.3 Gate 8 (HIGH_RISK + ≥2 failures) implied a **pre-seed HIGH_RISK** state. Internal contradiction surfaced during Day-21 overnight prep when Session A's data-check found Sarah at `crm_state=ACTIVE` with 3 FAILED deliveries (May 2/5/7 2026) — empirical state matches the §5.1 live-flip narrative, NOT the §5.2/§5.3 pre-seed assumption. **Resolution: §5.1 wins.** §5.2 amended to "Sarah Khouri pre-configured with ACTIVE CRM state and ≥2 FAILED deliveries to enable HIGH_RISK transition during demo." §5.3 Gate 8 amended to "Sarah Khouri has ≥2 FAILED deliveries in history; CRM state=ACTIVE pre-demo." No data changes required — current sandbox state already matches the new pre-demo invariant. Filed at `memory/decision_brief_v1_10_amendment_sarah_khouri_pre_seed.md`. |
| v1.11 | 11 May 2026 (Day 22, AM) | **Single-address MVP for `/consignees/new` wizard (Day-22 forms lane scope ruling).** Discovery surfaced two service-layer gaps: (a) no `createAddress` service fn in `src/` — addresses are insert-side only via the seed scripts; (b) no `createConsigneeWithSubscription` orchestration — existing `createConsignee` + `createSubscription` each open their own `withTenant` tx, breaking the brief §3.3.1 "single transaction" final-submit requirement. Reviewer ruled bundle A2 + B1: wizard collapses 4 steps → 3, single primary address per consignee for v1, multi-address + per-weekday rotation deferred to Phase 2. New orchestration `createConsigneeWithSubscription` at `src/modules/consignees/onboarding.ts` opens ONE `withTenant` tx + inlines all 3 writes atomically. Brief §1 (line 62) + §3.3.1 amended; §3.3.1 wizard text rewritten in full. Phase-2 surface area filed at `memory/followup_multi_address_rotation_phase_2.md`. Filed at `memory/decision_brief_v1_11_amendment_single_address_mvp.md`; landed as a ride-along T1 commit in the Day-22 forms lane Sub-PR #1. **PR-#238 §3.6 ratification clarification (within v1.11 scope):** `/consignees/[id]/edit` excludes ALL address fields (including the legacy inline scalar columns `addressLine`/`district`/`emirateOrRegion`) — editing inline-only would silently desync display from routing. See decision memo §3.1 for rationale. |
| v1.12 | 13 May 2026 (Day 25 morning) | **Decoupled consignee creation from subscription creation.** Wizard removed; flat `/consignees/new` form lands operator on Overview page with Create-subscription + Add-ad-hoc-task CTAs. New `createConsignee` service method (no subscription side-effects); new `createAdHocTask` service method (optimistic ack via QStash). Consignee list adds amber NO TASKS flag (task-based, not subscription-based). §5.1 Ch.3 demo narrative updated to two-beat flow. **Edit-merchant surface added.** New `/admin/merchants/[id]/edit` route + `updateMerchant` service method + `merchant:update` permission (transcorp-sysadmin only). Slug-change warning dialog. EDIT row action on `/admin/merchants` list. Filed at `memory/decision_brief_v1_12_amendment_decouple_and_edit_merchant.md`. |
| v1.13 | 13 May 2026 (Day 25 evening) | **§3.6 review-discipline checklist codified — CI status gate locked.** New §7.1 sub-section under Quality gates that codifies the "§3.6 hard-stop" review convention (referenced informally since Day 13) as a structured five-point checklist: plan compliance, test signal, **CI status verification (red is a blocker)**, architectural gates, brand discipline. Builder must report CI state in PR-open messages alongside local test signal; reviewer must verify CI before clearing the §3.6 verdict. Exception path: pre-existing main failures may clear §3.6 only when a parallel fix-PR is in flight (otherwise fix-first). No `--admin` bypass without explicit Love authorization. Driver: PR #264 cleared both §3.6 rounds on a CI-red main without surfacing the state. Filed at `memory/decision_review_discipline_ci_gate.md`. |
| v1.14 | 13 May 2026 (Day 25 PM) | **Per-merchant SF credentials + multi-region `client_id` resolver.** §3.6 identifier model deepens from three layers to four (region + merchant + api_key + secret_key). New `suitefleet_regions` table (DB-backed regions; seeded sandbox + transcorp / transcorpuae / transcorpqatar — all `active`). `tenants` gains `suitefleet_region_id` (`ON DELETE RESTRICT`, NOT NULL after backfill to sandbox) plus two nullable Vault FK columns (`suitefleet_api_key_vault_id`, `suitefleet_secret_vault_id`). Supabase Vault (pgsodium AEAD) is the at-rest encryption primitive. New `region:manage` permission (Transcorp-sysadmin only, added to `API_KEY_FORBIDDEN_PERMISSIONS`); existing `merchant:update` extends to credentials write (same scope; both are SF routing config). Four new audit events: `region.created` / `region.updated` / `region.deactivated` / `credentials.set` (the credentials event carries `classifier: 'initial-set' \| 'rotation'` only; NO plaintext, NO Vault UUIDs in the body). New admin routes: `/admin/regions` (list / new / [id] read-only) + `/admin/merchants/[id]/credentials` (write-only — existing values intentionally undisplayable). Merchant detail page (PR #271) gains a credentials status badge. New §3.7 documents Vault-backed credential storage posture + rotation cache-invalidation + future Secrets Manager ARN swap path. §4 Phase 2 reshape: "AWS Secrets Manager swap" now means Vault UUID → Secrets Manager ARN per merchant; "Integrations page" and "Credential rotation UX" rows retire (now MVP via the new admin surfaces); "Regional credential expansion" row retires (regions no longer hold credentials). OAuth username/password resolver retires; auth migrates to API Key + Secret Key per SF OpsPortal (exact request-header shape pending Aqib confirmation — flagged in plan-PR §9 as the code-PR blocker). Filed at `memory/decision_brief_v1_14_amendment_per_merchant_sf_credentials.md`. |
| v1.15 | 13 May 2026 (Day 25 PM, post v1.14 merge) | **Dual-path SF auth at region level.** Overrides v1.14 OQ-10 "clean OAuth cutover" ruling. `suitefleet_regions` gains a NOT NULL `auth_method` enum column (`'oauth'` \| `'api_key'`) with seed assignments: `transcorpsb` → `oauth` (preserves working sandbox path); `transcorp` / `transcorpuae` / `transcorpqatar` → `api_key` (production regions targeting SF OpsPortal credentials). `auth_method` is IMMUTABLE after region creation. Tenant Vault columns renamed from `suitefleet_api_key_vault_id` / `_secret_vault_id` to `suitefleet_credential_1_vault_id` / `_2_vault_id` with semantic interpretation by `region.auth_method` (OAuth: username/password; API Key: api_key/secret_key). Resolver returns a discriminated union `{ auth_method: 'oauth', username, password, clientId } \| { auth_method: 'api_key', apiKey, secretKey, clientId }`. SF auth-client `login()` branches on the discriminator. Sandbox OAuth path ships independently of Aqib's API Key header confirmation; the `api_key` code path remains blocked on Aqib's reply. UI: `/admin/regions/new` adds an auth_method radio (immutable post-create); `/admin/merchants/[id]/credentials` form-field labels branch on the region's auth_method (Username/Password vs API Key/Secret Key). `credentials.set` event payload unchanged. Phase 2 AWS Secrets Manager swap is orthogonal — the auth_method enum carries through the swap. Filed at `memory/decision_brief_v1_15_amendment_dual_path_sf_auth.md`. Companion plan amendment: `memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md` (T3 plan amendment PR). |
| v1.16 | 18 May 2026 (Day 30 PM, post B2 plan-PR #308 §3.6 clearance) | **Cutoff-drift supersede record.** Day-3 decision memo `memory/decision_task_editability_cutoff_at_assigned.md` ("lock at TASK_HAS_BEEN_ASSIGNED") is SUPERSEDED. §3.1.8 is canonical: editability is gated by the time-based 18:00-Dubai-day-before cutoff (enforced at 10 service-layer sites via `isCutOffElapsedForDate`); `internal_status='ASSIGNED'` is mutation-eligible. The "task ASSIGNED before time-cutoff → merchant can cancel a dispatched task" edge is logged as KNOWN pre-existing post-demo hardening at `memory/followup_assigned_before_cutoff_dispatch_race.md` (NOT introduced by B2 — pre-existing on the calendar popover surface). Driver: B2 plan-PR #308 ruled OQ-6 = v1.16 brief append (record the supersede at source-of-truth). Scope-distinct from A1 plan-PR #306 OQ-7 ("no v1.16 for the status-mapping fix"); both rulings coexist. |

---

## 10. Acknowledge protocol for fresh sessions

When a new Claude Code session opens (Day 13, 14, 15, etc.):

1. Read this brief in full before any action.
2. Acknowledge briefly: confirm absorption of (a) Path 2-A scope, (b) Transcorp-microservice framing, (c) three-role permission catalogue, (d) backend exception model + 14-day horizon + bounded pause + address rotation, (e) frontend surfaces (Transcorp-staff admin + merchant operator + consolidated calendar + consignee detail with calendar + onboarding wizard + timeline), (f) Day-by-day plan and current day's slot, (g) demo posture and Q&A rehearsal.
3. First action of each session: verify brief is current (check version + last amendment); if newer version exists in main, sync.
4. Substantive PRs reference brief sections in PR description (e.g., "Implements PLANNER_PRODUCT_BRIEF.md §3.1.6").
5. Scope changes require: explicit `decision_*.md` filing + brief amendment + version bump in §9.

---

**End of v1.16.**

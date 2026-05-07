---
name: Day-17 EOD full MVP audit — exhaustive brief vs implementation gap analysis. Source of truth for Day-18 + Day-19 critical-path.
description: Comprehensive audit of brief §3 + §5 against shipped codebase as of main HEAD 3f70378. Triggered by Love hard constraint that this is the FINAL demo slip; demo cannot ship until 100% MVP-complete per brief. Surfaces all gaps including known (merchant-admin frontend, customer.code routing, webhook 3-layer) and unknown (consignee onboarding wizard, /subscriptions/[id] detail page, /calendar consolidated, popover action set, address rotation visualization, per-task timeline, full consignee timeline). Source of truth replaces incremental "Love remembers something missing" pattern.
type: project
---

# Day-17 EOD Full MVP Audit

**Filed:** Day 17 (7 May 2026), late evening, post-PR-#183 merge.
**Main HEAD at audit time:** `3f70378`.
**Trigger:** Love hard constraint — this is the FINAL demo slip; demo cannot ship until 100% MVP-complete per brief. Tonight surfaced merchant-admin frontend gap by coincidence; need exhaustive audit so Day-18 + Day-19 critical-path is complete, not incremental.

---

## §1 Methodology

For each MVP-scope item from brief §3 + §5, verified against codebase via:

- File presence (`find`/`ls`)
- Service-layer presence (`grep src/modules/`)
- API route presence (`find src/app/api -name 'route.ts'`)
- Frontend route presence (`find src/app/(app) -name 'page.tsx'`)
- Audit event registration (`grep src/modules/audit/event-types.ts`)
- Permission registration (`grep src/modules/identity/permissions.ts`)
- Migration presence (`ls supabase/migrations/`)

**Verdict legend:**
- **SHIPPED** — full implementation present + verifiable PR evidence
- **PARTIAL** — some implementation, gaps surfaced and listed
- **NOT BUILT** — no evidence in codebase

---

## §2 Findings — backend (§3.1)

### §2.1 §3.1.1 Schema migrations — **SHIPPED**

All required migrations present at `supabase/migrations/`:

- `0014_addresses_and_subscription_address_rotations.sql` ✅
- `0015_subscription_exceptions_and_materialization.sql` ✅
- `0016_consignee_crm_state_and_events.sql` ✅
- `0017_tenants_pickup_address.sql` ✅ (PR #139)
- `0018_webhook_events.sql` ✅
- `0019_tasks_internal_status_skipped.sql` ✅
- `0020_task_generation_runs_target_date_column_and_unique.sql` ✅ (PR #153 cron decoupling)
- `tasks.pushed_to_external_at` already present in `0006_task.sql` (v1.2 amendment §0.3 Option A)
- `tenants.status` 4-state lowercase canon already in prod (v1.2 amendment §1.7.1)

PR evidence: #139 (Day-13 T3 schema part-1).

### §2.2 §3.1.2 Audit events — **SHIPPED**

All 9 events registered at `src/modules/audit/event-types.ts`:

`subscription.exception.created` · `subscription.end_date.extended` · `subscription.address_override.applied` · `subscription.paused` · `subscription.resumed` · `consignee.crm_state.changed` · `merchant.created` · `merchant.activated` · `merchant.deactivated` ✅

PR evidence: #139 (registration), #160 (consumption).

### §2.3 §3.1.3 Permissions catalogue — **SHIPPED**

All 12 permissions registered at `src/modules/identity/permissions.ts`:

- Subscription: `skip` · `override_skip_rules` · `pause` · `resume` · `change_address_rotation` · `change_address_one_off` · `change_address_forward` ✅
- Consignee: `change_crm_state` ✅
- Merchant: `create` · `read_all` · `activate` · `deactivate` ✅

PR evidence: #139 (registration).

### §2.4 §3.1.4 Service-layer fns — **SHIPPED**

Modules present at `src/modules/`:

- `subscription-exceptions/service.ts` — `addSubscriptionException` (skip + 3 override variants) + `appendWithoutSkip` ✅
- `subscriptions/service.ts` — `pauseSubscription` (bounded) + `resumeSubscription` (manual + auto via cron) ✅
- `consignees/service.ts` — `changeConsigneeCrmState` ✅
- `merchants/service.ts` — `createMerchant` + `activateMerchant` + `deactivateMerchant` + `listMerchants` ✅
- `subscription-addresses/service.ts` — `changeAddressRotation` ✅
- `subscription-exceptions/skip-algorithm.ts` — pure `computeCompensatingDate` helper ✅

PR evidence: #160 (Day-16 T3 service-layer surface, 11 routes).

### §2.5 §3.1.5 Rolling 14-day horizon — **SHIPPED**

`src/modules/task-materialization/{service,run-row,queue,dubai-date}.ts` present. `/api/cron/generate-tasks` route + Day-15 cron-decoupling architecture. Day-16 EOD §4.4 verified clean first 12:00 UTC tick post-deploy.

PR evidence: #153 (Day-15 cron decoupling).

### §2.6 §3.1.6 Skip algorithm — **SHIPPED**

`src/modules/subscription-exceptions/skip-algorithm.ts` (pure helper) + `service.ts` (override variants — `target_date_override`, `skip_without_append`, `append_without_skip`). All 3 override variants reach service layer.

PR evidence: #160.

### §2.7 §3.1.7 CRM state transitions — **SHIPPED**

`src/modules/consignees/transitions.ts` (matrix + `canTransition` helper) + `service.ts:changeConsigneeCrmState`. CHURNED→ACTIVE keyword guard ("reactivation") present.

PR evidence: #160.

### §2.8 §3.1.8 Skip cutoff enforcement — **SHIPPED**

Cutoff (hardcoded 18:00 local) enforced in `subscription-exceptions/service.ts`. Per-merchant configurability is brief §4 Phase 2.

### §2.9 §3.1.9 API routes — **PARTIAL** (1 missing of 12)

Present at `src/app/api/`:
- `/api/admin/merchants` POST + GET ✅
- `/api/admin/merchants/[id]/activate` POST ✅
- `/api/admin/merchants/[id]/deactivate` POST ✅
- `/api/consignees` POST/GET ✅ (verify atomicity per brief §3.1.4 — out of scope for this audit; flagged)
- `/api/consignees/[id]/crm-state` POST ✅
- `/api/subscriptions/[id]/skip` POST ✅
- `/api/subscriptions/[id]/pause` POST ✅
- `/api/subscriptions/[id]/resume` POST ✅
- `/api/subscriptions/[id]/append-without-skip` POST ✅
- `/api/subscriptions/[id]/address-rotation` PATCH ✅
- `/api/subscriptions/[id]/address-override` POST ✅

**MISSING:**
- ❌ `/api/consignees/[id]/timeline` GET (brief §3.1.9) — required for §3.3.7 consignee timeline view

### §2.10 §3.1.10 Webhook event mapping — **SHIPPED**

`src/modules/integration/providers/suitefleet/webhook-parser.ts` + `status-mapper.ts` present. 15 SF event codes mapped per Day-6 `followup_suitefleet_webhook_policy.md`.

**Note:** Per `followup_webhook_handler_status_pod_date_sync_bug.md` (PR #179), the receiver writes `webhook_events` rows but **does NOT consume them** to mutate task state — Layer-2 service fn missing. Mapping infrastructure is present but data flow incomplete. Cross-flagged as architectural gap in §7.

### §2.11 §3.1.11 SF API endpoint mapping — **SHIPPED**

`src/modules/integration/providers/suitefleet/last-mile-adapter*.ts` covers `createTask`/`createBulk`/`updateTask`/`reschedule`/timeline. Webhook registration via existing flow.

**Cross-flag:** customer.code wire-body threading **NOT BUILT** per §6 below + `followup_per_tenant_merchant_id_routing.md` (PR #183).

---

## §3 Findings — Transcorp-staff frontend (§3.2)

### §3.1 §3.2.1 Routes — **NOT BUILT**

- ❌ `/admin/merchants` list page (no `src/app/(admin)/merchants/page.tsx` or `src/app/(app)/admin/merchants/page.tsx`)
- ❌ `/admin/merchants/new` create form

The `(app)/admin/` surface that exists (`failed-pushes`, `webhook-config`) is operator-side admin, NOT Transcorp-staff cross-tenant merchant admin.

### §3.2 §3.2.2 Auth posture — **NOT BUILT**

- ❌ No `src/app/(admin)/` route group exists
- ❌ Middleware (`src/middleware.ts`) does not gate any path on `transcorp_staff` role

**Estimated build time:** ~3.5-4 hr (per Day-17 diagnostic). Demo §5.1 Section 2 (3 min "Demo Bistro" walkthrough) BLOCKED on this work.

---

## §4 Findings — Merchant operator frontend (§3.3)

### §4.1 §3.3.1 Consignee onboarding wizard — **NOT BUILT**

- ❌ No `src/app/(app)/consignees/new/page.tsx`
- ❌ No 4-step wizard (Identity → Addresses → Subscription → Schedule rules)
- ❌ No address-rotation widget per brief §3.3.1 Step 3

**Estimated build:** ~5-6 hr (4-step wizard + per-weekday address rotation tile UI + atomic POST handling at `/api/consignees`). Demo §5.1 Section 3 (3 min "Fatima Al Mansouri" walkthrough) BLOCKED.

### §4.2 §3.3.2 Consignee list view — **SHIPPED**

`src/app/(app)/consignees/page.tsx` ships with CRM state badge column + row link to detail (PR #174). Search/filter Phase 2 per brief.

**PARTIAL note:** Brief specifies "search by name/phone/email" + "filter: CRM state, district, today's delivery state". Currently no search/filter widgets. Brief §3.3.2 lists these as MVP affordances. Estimated remaining: ~1-2 hr if MVP-strict; or accept current state and document as Phase 2 in audit acceptance.

### §4.3 §3.3.3 Consignee detail page with calendar — **PARTIAL**

`src/app/(app)/consignees/[id]/page.tsx` ships with 4 tabs (overview/subscription/calendar/history). Subscription tab is placeholder ("Coming in Day-17 next PRs").

- Week view: **SHIPPED** (PR #177)
- Month view: ❌ NOT BUILT
- Year view: ❌ NOT BUILT (heat-map per BRD §6.2.1)

**Estimated build:** Month view ~2-3 hr (similar grid pattern, larger cell density); Year view ~3-4 hr (heat-map aggregation, lazy-load by month). Demo §5.1 Section 4 explicitly switches to month view ("Switch to month view → see address rotation visualized").

### §4.4 §3.3.4 Address rotation visualization on calendar — **NOT BUILT**

Calendar Week view (PR #177) shows tasks but does NOT display per-day address indicator (Home/Office per rotation). Brief §3.3.3 specifies "address indicator (Home/Office per rotation)" on each day cell.

**Estimated build:** ~1 hr (read `subscription_address_rotations` for the subscription, render badge per day). Demo §5.1 Section 4 explicitly walks "see address rotation visualized (different address indicators per day)".

### §4.5 §3.3.5 Click-into-day popover full action set — **PARTIAL**

`DayActionPopover.tsx` ships with **skip-default action only** (PR #177). 6 actions deferred per `followup_calendar_popover_action_expansion.md`:

- ❌ `target_date_override` (Skip with override → date picker)
- ❌ `skip_without_append`
- ❌ `pause` (from this date)
- ❌ `address_override_one_off`
- ❌ `address_override_forward`
- ❌ `cancel_delivery`

Per Love's hard constraint, these are **MVP-blocking, not deferrals**.

**Estimated build:** ~3.5-4 hr total per memo §4 sequencing (target_date+skip_without_append bundle ~75 min; pause ~50 min; address pair ~90 min; cancel ~30-60 min). Demo §5.1 Section 4 explicitly walks "Skip with override → 'Move to specific date'" + Section 6 walks pause; both blocked.

### §4.6 §3.3.6 Per-task delivery status timeline — **NOT BUILT**

No drawer or detail page surface for per-task lifecycle (Created → Assigned → In transit → Delivered/Failed/Skipped).

**Estimated build:** ~2 hr (drawer component reading from cached webhook events). Brief lists this in popover action list ("View full task detail (opens timeline drawer)").

### §4.7 §3.3.7 Consignee timeline view — **PARTIAL**

`HistoryTab.tsx` exists but covers **CRM state events only** (reads `consignee_crm_events`). Brief §3.3.7 specifies the timeline must aggregate:

- ❌ Onboarding event
- ❌ All delivery events (Created → ... → Delivered/Failed)
- ❌ All exceptions (skips, pauses, address overrides)
- ✅ CRM state transitions
- ❌ Subscription resumed / extended events

The `consignee_timeline_events` view (brief §3.1.1) is also missing — verify; likely NOT BUILT.

**Estimated build:** ~3-4 hr (DB view + service fn + tab content). Demo §5.1 Section 5 walks "drill into Sarah → consignee timeline shows pattern of failed deliveries"; BLOCKED on full timeline.

### §4.8 §3.3.8 POD photo display — **NOT BUILT** (architectural blocker)

POD URL extraction not implemented per `followup_webhook_handler_status_pod_date_sync_bug.md` Layer 3. Even when `tasks.photos` jsonb is populated, no UI surface reads it (popover detail card, tasks page POD column both pending Day-18 work per `followup_day_18_smoke_surfaced_ui_gaps.md` §4 + `followup_calendar_popover_action_expansion.md` §6).

**Estimated build:** ~2 hr UI on top of webhook Layer-3 fix (~3-4 hr). Total ~5-6 hr coupled. Demo §5.1 Section 4 walks "click delivered Wednesday → popover shows POD photo".

### §4.9 §3.3.9 Consolidated merchant calendar — **NOT BUILT**

- ❌ No `src/app/(app)/calendar/page.tsx`
- ❌ No metric cards (Active / Today's deliveries / Delivered / Out for delivery / Failed)
- ❌ No filter bar (consignee search, CRM state, area, time window, status)
- ❌ No drill-down from day → task list
- ❌ No high-risk highlighting

**Estimated build:** ~4-5 hr (route + metric card aggregations + filter widgets + day grid + drill-down). Demo §5.1 Section 5 explicitly walks the full surface (3 min); BLOCKED.

### §4.10 §3.3.10 Permission rendering rules — **PARTIAL**

HIDE rule applied for `consignee:change_crm_state` button (PR #174 detail page) and `subscription:skip` button (PR #177 popover). DISABLE rule with tooltip not exercised; brief specifies "Skip override button visible-but-disabled with tooltip" pattern.

**Estimated effort:** ~1 hr to extend tooltip-disabled pattern across operator UI as actions land (couples with §4.5 popover expansion work).

### §4.11 §3.3.11 Brand pass per-page — **PARTIAL**

App-shell + UserMenu shipped (PR #168). Per-page surfaces partially branded (PR #174 + #177 use brand tokens for new components). Per-page legacy hardcoded hex (e.g. consignees list page `#0B1F3A`) NOT migrated; per Day-17 EOD §3.1 + `followup_day_18_frontend_style_audit.md`.

**Estimated build:** ~3 hr per-page audit + token migration (brief §6 Day-18 PM plan).

---

## §5 Findings — Subscription management UI (§3.4)

### §5.1 `/subscriptions/[id]` detail page — **NOT BUILT**

- `src/app/(app)/subscriptions/page.tsx` exists as read-only LIST (Day 6 artifact).
- ❌ NO `src/app/(app)/subscriptions/[id]/page.tsx` detail page

Brief specifies the detail page contains:
- ❌ Subscription rule summary (days of week visual grid + delivery window + addresses + rotation)
- ❌ Pause/Resume CTA with bounded-pause picker
- ❌ Skip workflow date picker + preview + confirm
- ❌ Skip override workflow (move-to-date / skip-without-append)
- ❌ Address rotation editor
- ❌ Recent exceptions list (last 10)

**Estimated build:** ~4-5 hr (route + 6 sub-surfaces). Demo §5.1 Section 6 walks "From Fatima's consignee detail click into subscription → bounded pause for 1 week" — could be re-routed via popover pause action (§4.5 above) without /subscriptions/[id] page; **but rotation editor + exception history have no other home**.

---

## §6 Findings — L4 labels (§3.5) + customer.code (§3.6)

### §6.1 §3.5 L4 label generation — **SHIPPED**

`/api/tasks/labels` route (PR #170 drizzle hotfix + PR #172 UUID translation). Brief v1.6 locked decision: labels proxied AS-IS from SF.

### §6.2 §3.6 customer.code routing per tenant — **NOT BUILT** (architectural blocker)

Per `followup_per_tenant_merchant_id_routing.md` (PR #183). Adapter does not thread `tenants.suitefleet_customer_code` into wire body. All tasks invoice as merchant 588.

**Estimated build:** ~5-8 hr (adapter + webhook receiver routing + tests + brief §3.6 amendment + Day-10 memo amendments). Bundles with webhook 3-layer fix (~7-9 hr combined).

---

## §7 Findings — Demo arc (§5.1)

| Demo section | Status | Blocking gap(s) |
|---|---|---|
| §5.1.2 Setup narration | DEMO-READY | Slide deck for §5.1.7 not built |
| §5.1.2 Section 2 — Transcorp-staff onboarding | **DEMO-BLOCKED** | §3.2 merchant admin frontend NOT BUILT |
| §5.1.3 Section 3 — Consignee onboarding (Fatima) | **DEMO-BLOCKED** | §3.3.1 onboarding wizard NOT BUILT |
| §5.1.4 Section 4 — Calendar workflow | **PARTIAL** | Week+skip-default ✓; Month view ❌; Skip override ❌; POD photo ❌ (webhook 3-layer); Address rotation viz ❌ |
| §5.1.5 Section 5 — Consolidated /calendar + Sarah | **DEMO-BLOCKED** | §3.3.9 /calendar NOT BUILT; full timeline §3.3.7 PARTIAL |
| §5.1.6 Section 6 — Bounded pause | **DEMO-BLOCKED** | Pause UI from popover ❌ (§4.5 expansion); /subscriptions/[id] NOT BUILT |
| §5.1.7 Three-numbers slide | NOT BUILT | Slide deck not authored |
| §5.1.8 Q&A | DEMO-READY | Brief §5.4 rehearsal questions cover the surface (with merchant-ID and webhook fixes assumed shipped) |

---

## §8 Synthesis — total gap (prioritized)

### §8.1 ARCHITECTURAL CORRECTIONS (must ship; surfaced via filed memos)

| # | Item | Hours | Memo |
|---|---|---|---|
| A1 | customer.code wire-body threading + adapter | 5-8 | `followup_per_tenant_merchant_id_routing.md` |
| A2 | Webhook 3-layer (Layer 1 scoping → Layer 2 service fn → Layer 3 POD/edit) | 3-8 | `followup_webhook_handler_status_pod_date_sync_bug.md` |
| | **Bundled (A1+A2 share adapter + receiver work)** | **7-9** | (collapses ~4 hr of duplicate work) |

### §8.2 CRITICAL UI GAPS (MVP-blocking per brief; demo-blocking per §7)

| # | Item | Hours | Brief §  | Demo § |
|---|---|---|---|---|
| C1 | Merchant admin frontend (`/admin/merchants` list + `/new` form + `(admin)/` group + middleware gate) | 3.5-4 | §3.2 | §5.1.2 |
| C2 | Consignee onboarding wizard (`/consignees/new` 4-step) | 5-6 | §3.3.1 | §5.1.3 |
| C3 | Consolidated `/calendar` (metric cards + filters + drill-down + high-risk highlight) | 4-5 | §3.3.9 | §5.1.5 |
| C4 | Popover action expansion — pause + skip-override (move-to-date + skip-without-append) | 2-2.5 | §3.3.5 | §5.1.4 + §5.1.6 |
| C5 | Calendar Month view + address rotation visualization on day cells | 3-4 | §3.3.3 + §3.3.4 | §5.1.4 |
| C6 | Subscriptions detail page (`/subscriptions/[id]`) — rotation editor + exception history | 3-4 | §3.4 | §5.1.6 (partial substitute via popover) |
| C7 | Consignee timeline view — full surface (deliveries + exceptions + state changes) + `/api/consignees/[id]/timeline` | 3-4 | §3.3.7 + §3.1.9 | §5.1.5 |
| C8 | POD photo display (popover detail card + tasks page POD icon) | 2 | §3.3.8 | §5.1.4 |
| C9 | Per-task delivery status timeline drawer | 2 | §3.3.6 | §5.1.4 (partial substitute via popover) |
| | **Subtotal C** | **~28-33** | | |

### §8.3 POLISH (brief-required, lower demo blast radius)

| # | Item | Hours | Source |
|---|---|---|---|
| P1 | 4 UI gaps from EOD smoke (sign-in logo, tasks page consignee column, AWB+order search, column reorder + POD icon) | 4 | `followup_day_18_smoke_surfaced_ui_gaps.md` |
| P2 | Brand pass per-page surfaces (consignees list hex migration + audit) | 3 | §3.3.11 + `followup_day_18_frontend_style_audit.md` |
| P3 | Calendar Year view (heat-map per BRD §6.2.1) | 3-4 | §3.3.3 |
| P4 | Popover action expansion — address one-off + address forward + cancel | 1.5-2 | §3.3.5 |
| P5 | Permission rendering DISABLE-with-tooltip pattern (currently HIDE-only) | 1 | §3.3.10 |
| P6 | Consignee list search + filter widgets | 1-2 | §3.3.2 |
| P7 | Slide deck (three-numbers velocity slide for §5.1.7) | 2 | §5.1.7 |
| P8 | Demo data prep + `demo-preflight.sh` | 3 | §5.2 + §5.3 |
| | **Subtotal P** | **~18-21** | |

### §8.4 Total estimate

| Bucket | Hours |
|---|---|
| Architectural (A1+A2 bundled) | 7-9 |
| Critical UI (C1-C9) | 28-33 |
| Polish (P1-P8) | 18-21 |
| **TOTAL** | **~53-63 hr** |

### §8.5 Available time

| Day | Available | Committed |
|---|---|---|
| Day 18 (8 May) | 10 hr | Full work day |
| Day 19 (9 May, prep day) | 10 hr | Full work day |
| Day 20 morning (10 May) | 4 hr | Final fixes + dry-run |
| **TOTAL** | **24 hr** | |

**Gap: ~29-39 hours short.**

---

## §9 Demo readiness verdict

**Not demo-ready at 100% MVP per brief without scope reduction OR demo slip.**

### §9.1 Path A — Hard slip demo

Slip demo to ~Day 22-23 (May 14-15) to absorb ~29-39 hr of work. Preserves brief §3 + §5 fidelity. Per Love's hard constraint that this is the FINAL slip, this requires escalation pre-Day-18.

### §9.2 Path B — Brief amendment to defer scope

Negotiate brief amendments to move some §3 items to Phase 2 (§4 deferral list). Candidates ranked by demo blast-radius:

**Lowest demo blast (defer first):**
- §3.3.7 full consignee timeline (history tab + per-event-type counts as MVP-acceptable proxy) — saves 3-4 hr. Demo §5.1.5 Sarah-drill could fall back to filtered tasks list.
- §3.3.6 per-task delivery timeline drawer (popover detail covers basics) — saves 2 hr.
- §3.3.4 address rotation visualization on calendar (rotation visible in subscription detail) — saves 1 hr.
- §3.3.5 address one-off/forward/cancel popover actions (skip + skip-override + pause cover demo) — saves 1.5-2 hr.
- §3.3.3 Year view (Month covers Section 4 needs) — saves 3-4 hr.
- §3.3.2 search/filter on consignees list (operators can scroll for demo's 845 consignees) — saves 1-2 hr.
- §3.3.10 DISABLE-with-tooltip (HIDE-only is functional) — saves 1 hr.

**Total Path B savings:** ~12-16 hr. Reduces gap to ~13-23 hr. Still tight but achievable with brief amendment + Path B + ~3-4 hr daily overrun across Day 18 + Day 19.

### §9.3 Path C — Hybrid (recommended)

Path B amendments + ~5-8 hr daily overrun (12-13 hr days vs 10 hr) + Day 20 morning compressed to dry-runs only (no fixes). Day 19 PM runs as half-day dry-run + half-day final-fix.

**Recommended:** Path C with Path B amendments scheduled Day-18 morning before any builder work begins.

---

## §10 Discipline rule for future EOD docs

Going forward, every EOD doc cross-references brief §3 and §5 explicitly. Silent slippage across multi-day windows must not recur.

### §10.1 Required EOD doc subsections (effective Day 18 onward)

```markdown
## §X Brief implementation status

### §X.Y Brief §3 + §5 items shipped today
- §3.X.Y [item] — PR #N
- ...

### §X.Y Brief §3 + §5 items in-progress (carry forward)
- §3.X.Y [item] — partial; remaining: [scope]; estimate: [hrs]
- ...

### §X.Y Brief §3 + §5 items NOT YET STARTED (full inventory)
- §3.X.Y [item] — estimate: [hrs]; demo § blocking: [§N or none]
- ...
```

Every Day-N EOD doc maintains this register. Items don't disappear — they're either shipped, in-progress (with carryover estimate), or not-yet-started. Tracks the burn-down explicitly so reviewer can ALWAYS see what remains vs what's done without recreating the audit.

### §10.2 Discipline rule rationale

The Day-17 EOD smoke + audit revealed that ~29-39 hr of MVP work was unsurfaced for ~5 days. Each day's EOD doc focused on what shipped (today's PRs) without comprehensive cross-reference to what's still owed. This rule prevents recurrence.

### §10.3 First application

Day-18 EOD doc applies this rule. Section header: "§X Brief implementation status — Day-18 burn-down."

---

## §11 Cross-references

### Brief sections referenced
- §3.1.1 schema · §3.1.2 audits · §3.1.3 perms · §3.1.4 services · §3.1.5 horizon · §3.1.6 skip · §3.1.7 CRM · §3.1.8 cutoff · §3.1.9 routes · §3.1.10 webhooks · §3.1.11 SF mapping
- §3.2.1 Transcorp-staff routes · §3.2.2 auth posture
- §3.3.1 onboarding wizard · §3.3.2 list · §3.3.3 detail+calendar · §3.3.4 rotation viz · §3.3.5 popover · §3.3.6 per-task timeline · §3.3.7 consignee timeline · §3.3.8 POD · §3.3.9 /calendar · §3.3.10 permissions · §3.3.11 brand
- §3.4 subscription management UI · §3.5 labels · §3.6 credentials
- §5.1 demo arc · §5.2 demo data · §5.3 preflight · §5.4 Q&A

### Filed memos cross-referenced
- `memory/handoffs/day-17-eod.md` (Day-17 EOD)
- `memory/followup_per_tenant_merchant_id_routing.md` (PR #183 — A1)
- `memory/followup_webhook_handler_status_pod_date_sync_bug.md` (PR #179 — A2)
- `memory/followup_day_18_smoke_surfaced_ui_gaps.md` (PR #179 + #181 + #182 — P1)
- `memory/followup_day_18_frontend_style_audit.md` (PR #182 — P2)
- `memory/followup_calendar_popover_action_expansion.md` (PR #177 + #182 — C4 + P4)
- `memory/followup_client_component_test_infra.md` (test-infra deferred)
- `memory/followup_label_print_500_cap_phase_2_batching.md` (Phase 2 trigger)
- `memory/decision_brief_v1_5_amendment_color_canon.md` (brand canon)
- `memory/decision_brief_v1_6_amendment_no_logo_swap.md` (no logo swap, ever)

### PR ledger
- Day 13: #139 (schema part-1)
- Day 14: #145 (cron-decoupling plan)
- Day 15: #153 (cron-decoupling code), #154 (Posture B Stage 2), #155 (part-2 plan)
- Day 16: #160 (T3 service-layer + 11 routes)
- Day 17: #162-#183 (21 PRs landed; 1 closed unmerged #126)

---

**End of audit. Source of truth for Day-18 + Day-19 critical-path. Reviewer triages Day-18 morning before any builder work begins.**

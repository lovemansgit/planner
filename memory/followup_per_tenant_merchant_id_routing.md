---
name: SF Merchant ID routing via customer.code wire body — billing-data correctness bug; Day-18 morning priority. Also corrects Day-10 architecture framing (client_id is REGION-scoped not merchant-scoped).
description: Day-17 EOD post-smoke finding (Love) corrects the Day-10 architectural framing. SF client_id is region-scoped (transcorpsb=sandbox, transcorpuae=UAE, transcorpqatar=Qatar), NOT merchant-scoped. Merchant ID routing happens via customer.code in the createTask wire body (per Aqib confirmation via Love's prior SF onboarding context). Three demo tenants MPL/DNR/FBU correctly share transcorpsb credentials (same sandbox region) but currently all invoice as merchant 588 because adapter does NOT thread tenants.suitefleet_customer_code into wire body. Day-18 morning fix: ~5-8 hr adapter work + webhook receiver payload routing. Day 10 decision memos require amendment.
type: project
---

# SF Merchant ID routing via customer.code — billing-data correctness + Day-10 framing correction

## §1 What we now understand (corrects Day-10 framing)

The SF data model has THREE distinct identifier layers, not two:

| Layer | SF concept | Example values | Scope |
|---|---|---|---|
| Region | `client_id` | `transcorpsb` (sandbox), `transcorpuae` (UAE), `transcorpqatar` (Qatar) | Per region; shared across all merchants in that region |
| Merchant | `customer.code` | 588 (MPL), 586 (DNR), 578 (FBU) | Per merchant within a region; threads through createTask wire body for billing |
| Tenant slug | `tenants.slug` | MPL, DNR, FBU | Planner-side AWB prefix; not part of SF data model |

Previous Day-10 memos (`decision_mvp_shared_suitefleet_credentials.md`, `followup_secrets_manager_swap_critical_path.md`) framed shared credentials as a "Path B sandbox-share" deferral with per-tenant credentials as the post-pilot hardening item. **That framing was incorrect.** Per-tenant credentials are NOT the architecture; per-region credentials are. The architectural intent is:

- All merchants in a region share that region's `client_id`
- Each merchant within a region tags its tasks with its `customer.code`

A real Transcorp Qatar deployment with 5 production merchants is correctly designed with all 5 merchants sharing `transcorpqatar` credentials and routing by `customer.code`. Same architecture as the sandbox. The "per-tenant credentials post-pilot hardening" framing was a misread of the SF data model.

What IS still a hardening item: regional expansion (adding `transcorpuae` and `transcorpqatar` credentials when those regions onboard). That's onboarding work, not isolation work.

## §2 What's actually broken

`tenants.suitefleet_customer_code` column EXISTS (migration 0013, Day 10). MPL/DNR/FBU rows can be populated with 588/586/578.

Per `followup_migration_0013_customer_code_comment_amendment.md` (Day 10 static analysis): **the column is NOT threaded into the SF createTask wire body.** Static analysis read it as a "cron-gate field (skip if NULL), not a wire-body field." That static analysis was correct for the current code — the column is not used for routing. It SHOULD be.

Consequences:
- Every createTask call goes to SF without `customer.code` in body OR defaults to merchant 588 inferred from sandbox credential context
- DNR consignees → invoiced as MPL (588) on SF side
- FBU consignees → invoiced as MPL (588)
- DNR (586) and FBU (578) show zero activity on SF console
- For real production merchants: structural billing-data corruption from day one of pilot
- For demo: panel asking for SF console proof of multi-tenancy will see one merchant with all activity, not three

## §3 Demo-blocking risk + Q&A reframing

The original `decision_mvp_shared_suitefleet_credentials.md` Q&A frame ("we deferred per-tenant credentials to post-pilot hardening") was based on the wrong architecture model. The correct frame is:

> "SF `client_id` is region-scoped — sandbox, UAE, Qatar each have their own. All merchants within a region share that credential and route their tasks via `customer.code` on the wire body. Three demo merchants share `transcorpsb` because they're all in sandbox. The adapter threads each tenant's `customer.code` (588/586/578) into every `createTask` call so SF invoices each merchant correctly."

If the panel asks for SF console proof of multi-tenancy, the screenshot shows three distinct merchants (588/586/578) with their respective task volumes. That's the demo-correctness deliverable from this work.

## §4 Webhook routing decision — Option α (selected) vs Option β

Per Aqib (via Love's prior SF onboarding context), two webhook architectures are supported:

**Option α (SELECTED for MVP):** Single webhook URL per region. SF fires all events for all merchants under `transcorpsb` to one URL. Receiver parses `customer.code` from inbound payload, routes to correct tenant. Smaller scope; cleaner demo narrative.

**Option β (PHASE 2):** Per-merchant webhook URLs. Each tenant gets its own webhook URL registered with SF during merchant onboarding. Architecturally cleaner separation, but adds new "webhook generation on merchant onboarding" feature: UI, SF API integration for `customer-hook-resource:create` per merchant, error handling, tests. ~4-6 hr by itself.

Locked: Option α for MVP. Option β filed for Phase 2 alongside merchant-onboarding wizard hardening.

## §5 Fix scope — Day 18 morning

### §5.1 Adapter modifications (~3-4 hr)

1. SF adapter (`src/modules/integration/providers/suitefleet/*`) reads `tenants.suitefleet_customer_code` from request context
2. Threads `customer.code` into wire body for: `createTask`, `createBulk`, `updateTask`, `reschedule`
3. Update type contracts (likely Zod schemas under `src/modules/integration/providers/suitefleet/types/`)
4. Update integration tests to assert `customer.code` reaches SF correctly per tenant

### §5.2 Webhook receiver routing (~2-3 hr)

1. Receiver at `/api/webhooks/suitefleet/[tenantId]/route.ts` (verify path) currently routes by URL-path tenantId
2. Refactor: parse `customer.code` from inbound payload; lookup tenant by `customer_code`; route accordingly
3. Validate URL-path tenantId matches payload `customer.code` (defense-in-depth — reject mismatch as 401)
4. May resolve part of tonight's webhook Layer-1 bug if SF was firing to a path-tenant mismatch

This work overlaps with `followup_webhook_handler_status_pod_date_sync_bug.md` Layer 2 (UPDATE-tasks service fn). Bundle as one architectural-correction PR not two parallel fixes — collapses budget.

### §5.3 Migration 0013 comment amendment (~30 min)

`followup_migration_0013_customer_code_comment_amendment.md` queued T1 amendment can finally land bundled with this work. Column purpose IS billing-routing (not just cron-gate as the original comment said).

### §5.4 Brief amendment (~30 min)

`memory/PLANNER_PRODUCT_BRIEF.md` §3.6 currently says "Single shared SF sandbox credential across all tenants. Hardcoded `customer.code = 588`."

Amend to: "SF `client_id` is region-scoped (`transcorpsb` sandbox, `transcorpuae` UAE, `transcorpqatar` Qatar). Three demo tenants share `transcorpsb` (sandbox region) and route to their respective merchant IDs (MPL=588, DNR=586, FBU=578) via `customer.code` in the `createTask` wire body."

Also update §3.5 if needed for label generation context.

Phase 2 list (§4) updated: per-tenant credentials REMOVED (was incorrectly framed); regional expansion (UAE/Qatar onboarding) replaces it.

### §5.5 Demo data verification (~1 hr)

1. Verify MPL/DNR/FBU tenant rows have correct `customer_codes` (588/586/578) populated
2. Run a manual `createTask` probe per tenant; verify SF console reflects task on the correct merchant
3. Webhook flow: trigger SF event for each merchant; verify Planner receives + routes correctly

### §5.6 Day-18 budget impact

Total Day-18 morning queue:
- Webhook handler 3-layer fix: ~2-4 hr (Layer-1 root-cause now narrowed; Layer 2-3 overlaps with §5.2)
- Merchant ID routing: ~5-8 hr (per §5.1-§5.5)
- 4 UI gaps: ~3.5 hr (per `followup_day_18_smoke_surfaced_ui_gaps.md`)

Bundling §5.2 webhook receiver + Layer-2 service fn as ONE architectural PR collapses ~3 hr of duplicate work. Net Day-18 morning: ~9-13 hr.

Day-18 afternoon queue (per brief §6):
- Brand pass on per-page surfaces: ~3 hr
- Demo data prep: ~2 hr
- `demo-preflight.sh`: ~1 hr

Total Day-18: ~15-19 hr against 10-hr day. Day-18 PM brand pass at risk; demo data prep + preflight non-negotiable.

**Slip risk:** if merchant-ID adapter work overruns, brand pass slips to Day 19 morning. Day 19 dry-runs absorb morning into PM. Demo-day morning becomes final-fix only.

### §5.7 Sequencing for Day 18

**AM Block 1:** Vercel logs probe for webhook Layer-1 (15 min — likely shows whether SF webhook URL registration is the issue for MPL, since Love registered MPL's URL on Day 17 EOD). DNR/FBU URL status TBD by Aqib check or by inference from probe results.

**AM Block 2:** Bundled architectural PR — adapter `customer.code` threading + webhook receiver payload routing + migration 0013 comment fix + Layer 2 service fn for UPDATE-tasks. ~7-9 hr. Largest substantive PR of the day.

**AM Block 3 → PM Block 1:** 4 UI gaps. ~3.5 hr.

**PM Block 2:** Brand pass on per-page surfaces. ~3 hr (compressed if needed).

**PM Block 3:** Demo data prep + `demo-preflight.sh`. ~3 hr non-negotiable.

**EOD:** Day-18 batched promotion + EOD doc.

## §6 Day-10 memo amendments needed

Two existing memos are now inaccurate and should be amended Day-18 morning:

1. `memory/decision_mvp_shared_suitefleet_credentials.md` — frame "shared customer code 588" as DEMO-WORKAROUND-PRE-FIX, not MVP architecture. After Day-18 fix lands, this memo describes the pre-fix state for historical context.

2. `memory/followup_secrets_manager_swap_critical_path.md` — clarify that Secrets Manager swap is for REGIONAL EXPANSION (adding UAE/Qatar credentials), not per-tenant isolation. The "every tenant authenticates as merchant 588" line is misleading; correct read is "every tenant authenticates as the sandbox region's client and was incorrectly invoicing as merchant 588."

These amendments can land in the same Day-18 architectural PR or as a separate T1 cleanup PR.

## §7 Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §3.5 (label generation) + §3.6 (credential decision; needs amendment) + §3.1.10 (15 SF event codes; webhook payload structure) + §3.1.11 (SF API endpoint mapping)
- `memory/decision_mvp_shared_suitefleet_credentials.md` (Day 10 — needs amendment per §6 above)
- `memory/followup_secrets_manager_swap_critical_path.md` (Day 10 — needs amendment per §6 above)
- `memory/followup_migration_0013_customer_code_comment_amendment.md` (Day 10 — bundle with Day-18 fix)
- `memory/followup_webhook_handler_status_pod_date_sync_bug.md` (Day 17 — webhook Layer-1; bundles with §5.2 of this memo)
- `memory/followup_day_18_smoke_surfaced_ui_gaps.md` (Day 17 — independent UI work; runs after architectural PR)
- `src/modules/integration/providers/suitefleet/*` (adapter; wire-body insertion points)
- `src/app/api/webhooks/suitefleet/[tenantId]/route.ts` (webhook receiver entry point)
- Day-1 enterprise build plan §6.2.1 (per-tenant credentials architecture; framing was correct at provider/tenant level but Day-10 memo conflated this with merchant-ID-routing within a region)

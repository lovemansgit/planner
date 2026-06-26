---
name: Day-57 MVP-gap audit — current gap analysis vs main fb907a8 (api_key sandbox PROVEN this session)
description: Fresh MVP-gap audit against main 402e29d/fb907a8, same methodology as audit_day_17 (file/service/route/audit-event/permission/migration presence) + the merged-vs-proven-live distinction. SUPERSEDES audit_day_17_full_mvp_gap.md and uat_mvp_scope_definition.md. Verified read-only 2026-06-26.
type: project
---

# Day-57 MVP-Gap Audit — current state

**Filed:** 2026-06-26 (audit session, Love-cleared). **Verified against:** main `402e29d` (code presence via `git show`/`git grep` at the ref) — origin/main has since advanced to `fb907a8`; the code surfaces audited are unchanged between them. **Method:** same as `audit_day_17_full_mvp_gap.md` — per capability, presence of route / service / audit-event / permission / migration; plus live-proof status (merged vs exercised on the real SuiteFleet wire), cross-checked against the Day-52/53 proving-pass handoffs, `uat_run_sheet_v2.md`, and this session's MPL api_key probe.

**SUPERSEDES:** `memory/audit_day_17_full_mvp_gap.md` (Day-17) and `memory/uat_mvp_scope_definition.md` (Day-52) — both stale, kept for history with supersession notes. The current UAT *script* remains `memory/uat_run_sheet_v2.md`.

**Verdict legend:** ✅ SHIPPED & PROVEN ON REAL WIRE · 🔶 SHIPPED, not proven on wire · 🔨 NOT BUILT · ⛔ BLOCKED ON EXTERNAL

## Headline
The Day-52 picture ("features built, integrations unproven, two features missing") has flipped. Every capability is now built and merged; the address-override features that were missing are built **and** proven; and the single biggest unproven integration — **sandbox api_key auth — was proven on the wire this session** (MPL, 2026-06-26: login 200 + authenticated read 200 through Planner's own resolver→Vault→loginApiKey chain; see `project_apikey_sandbox_proven_mpl_20260626` in session memory). What remains is almost entirely external-gated (production-region credentials from Aqib) plus two opportunistic live observations and one deferred bug.

## FLOW A — Transcorp admin
| Capability | Verdict | Evidence |
|---|---|---|
| Merchant CRUD (create/edit/list/detail) | 🔶 | `/admin/merchants/*`, `createMerchant`/`updateMerchant`/`deactivateMerchant`, audit `merchant.created/updated/deactivated`, perms `merchant:create/update`, migr 0001/0034. No admin-session real-wire walk on record. |
| Region management (auth_method per region, immutable) | 🔶 | `/admin/regions/*`, `createRegion`/`updateRegion`/`deactivateRegion`, audit `region.created/updated/deactivated`, perm `region:manage`, migr 0024. |
| Per-merchant SF credential provisioning | ✅ (sandbox) | `storeSuitefleetCredentials` + `setMerchantAuthMethodOverride` (clears Vault pair on switch), audit `credentials.set`/`credentials.method_changed`, perm `merchant:update`, migr 0024 (vault cols) + 0030 (override). Proven end-to-end this session — the MPL probe decrypted exactly these provisioned api_key creds and authed live. |
| Cross-tenant operational reads | 🔶 | `task/subscription/consignee:read_all` → `withServiceRole`; `/admin/tasks`, `/admin/subscriptions`, `/admin/consignees`. Rendered in prod walks; no dedicated admin-session UAT leg. |
| SF auth — OAuth (sandbox) | ✅ | `loginOAuth`; AWBs `MPL-08187661`/`MPL-64596425`, live in prod. |
| SF auth — api_key (sandbox) | ✅ | `loginApiKey` + resolver discriminated union + region/override selection. **Proven 2026-06-26** (login 200 + authed read 200, transcorpsb/meal-plan-scheduler). Closes the Day-53 401-empty-body inconclusive. |
| SF auth — api_key (PRODUCTION regions) | ⛔ | Code merged, shape now wire-proven on sandbox. Production provisioning still needs **Aqib prod credentials + Love's named prod-probe authorization**. Gate never opened. |

## FLOW B — Merchant admin
| Capability | Verdict | Evidence |
|---|---|---|
| Onboard consignee (single primary address) | 🔶 | `/consignees/new` + `createConsignee`, audit `consignee.created`, perm `consignee:create`, migr 0004/0014. Passes used pre-seeded consignees. |
| Create subscription (+ 14-day materialization) | ✅ | `createSubscription` → `materializeTenant` → `enqueueTaskPushBatch` → `createTask`. Exercised on real wire Day-53 PM (Fatima's sub → 16 tasks materialized + pushed + AWBs). |
| Calendar (consolidated + consignee-detail) | 🔶 | Server-component pages; renders in prod walks; read surface, no outbound integration. |
| Skip + tail (R1) | ✅ | `markTaskSkipped` + `computeCompensatingDate`, audit `subscription.exception.created`+`end_date.extended`, perm `subscription:skip`, SF `cancelTask`. Wire `MPL-48882801` (Day-52). |
| Pause → SF cancel fan-out (R2) | ✅ | `pauseSubscription` → `bulkCancelTasks`, audit `subscription.paused`+`pause_cancels_pushed`, perm `subscription:pause`. Wire `MPL-28787105`/`MPL-01868399` (Day-52). Resume/re-create (R16) proven in D54 prod walk. |
| Driver note → SF push (R3) | ✅ | `addNoteToDriver` → `updateTask`, audit `task.note_added`+`task.note_pushed_to_external`. Wire `MPL-76890591` (Day-52). |
| Address override — one-off (R4) + forward (R5) | ✅ | *Built since Day-52* (was 🔨). `addSubscriptionException` (both discriminants) → `updateTask`/`enqueueBulkUpdateTasks`, audit `subscription.address_override.applied` + pushed legs, migr 0029. Wire R4 `MPL-46009060`/`MPL-21097704`, R5 `MPL-61377363`/`MPL-50803723` (Day-53 PM). Caveat: no UI to add a 2nd consignee address → UAT uses pre-seeded multi-address consignees (only Fatima qualifies). |
| Cancel task → SF (single + bulk) | ✅ bulk / 🔶 operator-single | `cancelTask`/`bulkCancelTasks` + failed-push DLQ + retry UI. Bulk numeric-id PATCH proven Day-21; direct operator single-cancel not separately re-proven. |
| Print labels → SF | ✅ | `printLabelsForTasks` → `printLabels`, audit `task.labels_printed`. 500-id batch → 200, 2.2 MB PDF. |
| Task history / timeline (R8) | 🔶 | `getTaskHistory` keyset audit read, perm `task:view_timeline`. Read-only. |
| Inbound webhook status handling | 🔶 | Fix #521 merged `3adc90f` + promoted `fe79bf0`; correct by review + real-DB integration test. **Live production observation of a genuine SF webhook still pending real traffic** (Love: await real traffic, zero synthetic write). |
| POD photo path (proxy) | ✅ ingest/proxy/expired / 🔶 live render | Real SF S3 URLs (`tasks.pod_photos`) + durable capture (`tasks.pod_photo_captures`, migr 0031), same-origin proxy, past-TTL→410, unauth→401 proven Day-53 EVE. Live 200 byte-render still needs a fresh within-7-day driver photo on SF. |

## Moved to PROVEN/SHIPPED since Day-52
- **api_key sandbox auth → ✅ PROVEN this session** (the #1 prior unproven integration).
- **Address override R4 + R5 → built and ✅ PROVEN** (Day-53; were the only 🔨 items).
- **Pause/Resume (R16) → ✅ proven in D54 prod walk.**
- **POD proxy → ✅ proven** (Day-53 EVE).
- **Phase-8 courier-status filtering → shipped + promoted** (migr 0035 live); read surface, no SF integration.
- **Inbound-status webhook fix #521 → merged + promoted** (live observation pending).
- **Bag/asset tracking → shipped dark** (preview-walked; live SF scan pending Aqib).

## Remaining path to the UAT line
Sandbox UAT (Option A) is runnable now — the entire Day-52 blocking list is cleared and everything is promoted. What's left is running it:
1. Run the first Ops UAT on pre-seeded multi-address consignees (`uat_run_sheet_v2.md`). Capture Ops' "what else" list.
2. Two opportunistic live observations during UAT (neither blocks the line): POD live byte-render on a fresh delivered-with-photo order; one genuine inbound SF webhook advancing a task under the #521 deploy.
3. Post-UAT: tear down sandbox probe data.

A production-merchant UAT (Option B) additionally needs the external items below.

## ⛔ Blocked-on-external
- **Production-region api_key auth** (transcorp/uae/qatar) — Aqib production credentials + Love's named prod-probe authorization. (Shape proven on sandbox; this is the only true production gate.)
- **Bag-tracking live SF scan (leg 3)** — Aqib's staged sandbox scans.
- **Inbound-webhook #521 live observation** — genuine Dubai-hours SF traffic (not Aqib-dependent; Love ruled out synthetic injection).
- **POD live byte-render** — a driver uploading a photo on SF within 7 days (vendor human action).

**Not external, just deferred (flag, not a blocker):** the inbound edit-apply **TZ re-stamp bug** (`followup_inbound_webhook_edit_apply_two_bugs.md`) — `TASK_HAS_BEEN_UPDATED` reflections shift the delivery window −4h; parked post-demo, still open.

## Cross-references
- `memory/audit_day_17_full_mvp_gap.md` — superseded (Day-17 baseline).
- `memory/uat_mvp_scope_definition.md` — superseded (Day-52 scope baseline).
- `memory/uat_run_sheet_v2.md` — current UAT script (not superseded by this audit).
- Session memory: `project_apikey_sandbox_proven_mpl_20260626` (api_key sandbox ground truth).

# UAT-MVP Scope Definition — Transcorp Subscription Planner

> **⚠️ SUPERSEDED (2026-06-26) by `memory/audit_day_57_mvp_gap.md`.** This Day-52 scope definition is a historical baseline. Key deltas since: api_key sandbox auth is now PROVEN on the wire (2026-06-26 MPL probe); R4/R5 address overrides are built + proven (Day-53); the §5 "deaf integration" list is all proven. The current UAT *script* is `memory/uat_run_sheet_v2.md`; the current gap analysis is the Day-57 audit. Kept for history; do not action against this file.

**Filed:** Day-52 (2026-06-10), reviewer-counter session with Love.
**Status:** Working definition. This is a **UAT line, not a final MVP sign-off.**
**Purpose:** Define what "done enough to put in front of the Ops team" means, so the Ops demo surfaces real gaps rather than embarrassing ones. Love signs off on MVP only *after* the Ops team reviews this and tells him what else to add.

---

## 1. What this is (and isn't)

Love's definition, in his words, reduces to two end-to-end actor flows that must work without disappointment:

1. **Transcorp admin full flow** — creating merchants/customers, adjusting tasks, and the SuiteFleet integration working under *both* auth methods (OAuth and the API-key / "Secrets" method).
2. **Merchant admin full flow** — all edits, cancellations, landing clean, with **no broken or "deaf" integrations** — the full Planner↔SuiteFleet round-trip, everything genuinely tested, no surprises.

This is explicitly a **UAT (User Acceptance Testing) line**. The sequence is:

> Build to this line → Love demos to the Ops team → Ops tells Love what's missing → Love adds it → **only then** Love signs off on MVP.

So this document is the *entry ticket to UAT*, not the finish line.

### The single most important finding

**The features are largely built. The integrations are largely unproven on real wire. And nothing built since the calendar lane began has ever run in production** — production has not been promoted since before R1, so everything R1→R8 is main-only.

The work between here and a UAT line is therefore **mostly proving and closing, not building**:
- Close the one production auth gate (API-key probe).
- Prove the operator-action integrations actually fire on real SuiteFleet (they're merged but never exercised live).
- Build the last two operator-promise features (R4/R5 address overrides).
- Promote to production so a real-wire UAT is even possible.

---

## 2. The decision that sizes everything: which SuiteFleet does UAT run on?

This is the **one question Love must answer first**, because it changes the size of "how far" more than anything else.

| Option | What works today | What UAT proves | Dependency |
|---|---|---|---|
| **(A) Sandbox UAT** — UAT runs on the `transcorpsb` sandbox merchant, OAuth auth | Proven end-to-end on real wire (task create → AWB → webhook) | The operator flows against a *working* SF integration | **None external** — closest to ready |
| **(B) Production-merchant UAT** — UAT includes a real production-region merchant (transcorp / UAE / Qatar), API-key auth | Code merged, but **fail-closed** until the probe runs | The *real* production auth path Ops will actually use | **Blocked on:** production-region API-key test credentials (via Aqib/OpsPortal) **+** Love's explicit production-probe authorization |

**Why this matters:** Option A is close — the operator flows and the one proven SF path are largely there. Option B depends on Aqib delivering production credentials and on a probe Love must authorize, because the verified header shape (`clientId` + `clientApiKey` + `clientSecretKey`) is **documentation-asserted, not empirically tested** — and the last time a documented-but-unprobed SF shape went live (bulk-cancel AWBs, Day-21), it failed with a 500 on first contact.

**Love's call needed:** Does the first Ops UAT run on sandbox (fast, proven) or must it include a production-region merchant (real, gated on Aqib + probe)? *Recommendation in §7.*

---

## 3. Flow A — Transcorp admin, end-to-end

Legend: ✅ shipped & proven on real wire · 🔶 shipped, **not** proven on real wire · 🔨 not built · ⛔ blocked on external

| Capability | Status | Note |
|---|---|---|
| Create / edit merchants | 🔶 | `createMerchant` / `updateMerchant` shipped; not part of any real-wire pass |
| Region management (create/deactivate regions) | 🔶 | Admin route shipped; `auth_method` radio per v1.15 |
| Per-merchant SF credential provisioning (admin surface) | 🔶 | Surface exists; used successfully for MPL (Vault placeholder fix) |
| Cross-tenant operational read (`/admin/tasks`, `/consignees`, `/subscriptions`) | 🔶 | Phase-1.5 read-all surfaces shipped |
| **SF auth — OAuth (sandbox)** | ✅ | **The one proven path.** Login → task create → AWB `MPL-08187661` → webhook, live on production |
| **SF auth — API-key (production regions)** | ⛔ | Code merged but **fail-closed**; throws until the probe confirms the header shape against a live production endpoint. *Gate #1.* |
| Task adjustments (admin) | 🔶 | Update/cancel paths shipped; see Flow B integration caveats |
| Cross-tenant action capability | 🔨 | Phase-1.6 by design — admin acts via merchant-scoped surface, not cross-tenant. *Out of UAT scope unless Love adds it.* |

---

## 4. Flow B — Merchant admin, end-to-end

| Capability | Status | Note |
|---|---|---|
| Onboard consignee (single primary address) | 🔶 | Flat form, lands on Overview with CTAs (v1.12) |
| Create subscription | 🔶 | Standalone surface; materializes tasks on rolling 14-day horizon |
| Ad-hoc task creation | 🔶 | `createAdHocTask` shipped |
| Calendar surface (month/year views, day popover) | 🔶 | R7.2 month default ✅; R9 week-view removed ✅; R10 year heatmap closed no-code |
| **Skip a delivery** (+ tail reinsertion, R1) | 🔶 | R1 on-demand cron shipped; skip→cancel **real-wire leg never fired** |
| **Pause subscription** (→ SF cancel fan-out, R2) | 🔶 | Merged (#342); **never exercised on real wire** |
| **Driver note** (→ SF push, R3) | 🔶 | Merged (#344); **never exercised on real wire** |
| **Address override** — one-off (R4) + forward (R5) | 🔨 | **Not built.** The last operator-promise gaps; closes `address_edit_sf_outbound_gap` |
| Cancel task (single + bulk) → SF | ✅ (shape) / 🔶 (operator path) | Bulk-cancel numeric-id PATCH proven on real wire (Day-21); operator-initiated cancel path not separately re-proven |
| Print labels → SF | ✅ | 500-id batch proven on real wire (200, 2.2 MB PDF) |
| Task history drawer (R8) | 🔶 | Shipped today (#356); read-only, no integration |
| Full Planner↔SF round-trip, "no deaf integrations" | 🔶 | **This is the headline gap — see §5** |

---

## 5. Integration-honesty section — the core of this document

**Love's sharpest requirement: "no deaf integrations, everything tested, no disappointments."** This section lists what is *genuinely proven on real SuiteFleet wire* versus what only *looks* done.

### Proven on real wire (with evidence)
- **Task CREATE** — cron push → SF → AWB write-back. AWBs `MPL-08187661`, `MPL-64596425`. End-to-end on production.
- **Task CANCEL (bulk shape)** — numeric-id bulk PATCH → 200, webhook reflection ~400ms (Day-21).
- **LABELS** — 500-id batch → 200, real PDF.
- **Webhook INBOUND** — SF fires events; embedded-delta handling grounded on real AWBs (`MPL-80355079`, `MPL-38610276`).
- **Task UPDATE push (R4/R5 address override)** — **proven Day-53 PM.** R4 one-off (06-18 `MPL-46009060`, 06-19 `MPL-21097704`) + R5 forward-from-06-25 (fan-out echoes on `MPL-61377363`/`MPL-50803723`, boundary held at day 24 `MPL-44913455`). SF webhook echoes the `Updated` event back per task; `pending_update` badge sets + clears on ack. Evidence: `memory/handoffs/day-53-pm-proving-pass.md`.
- **POD photo path (proxy, #377)** — **proven Day-53 EVE** for ingest + proxy + expired-state. Real SF S3 URLs in `pod_photos` (`MPL-80355079`/`MPL-38610276`/`MPL-02403404`); the operator lightbox serves same-origin `/api/tasks/{id}/pod/{index}` (no raw S3 leak); past-TTL rows → proxy **410 Gone** / honest fallback; unauth → 401. **Open sub-leg:** the live 200 byte-render (needs a within-7-day driver photo upload on SF, not producible from Planner) — prove opportunistically at UAT. Evidence: `memory/handoffs/day-53-eve-pod-proof.md`.

### The "deaf integration" list — ALL legs proven (Day-52/53 proving passes)

> **Day-52 PM:** R2 pause-cancel fan-out (`MPL-28787105`, `MPL-01868399`), R3 note-push (`MPL-76890591`), skip→cancel (`MPL-48882801`) — all proven on real wire (`memory/handoffs/day-52-eod.md` §C).
>
> **Day-53 PM:** task-UPDATE push (R4/R5 address override) proven (`memory/handoffs/day-53-pm-proving-pass.md`). Caveat: no UI to give a consignee a 2nd address → override unreachable for UI-onboarded consignees (`memory/followup_no_ui_second_consignee_address.md`; demo-prep / Phase-2, not a wire failure; UAT uses pre-seeded multi-address consignees per Love's EVE ruling).
>
> **Day-53 EVE:** POD post-fix proven for ingest + proxy + expired-state (`memory/handoffs/day-53-eve-pod-proof.md`); only the live-render sub-leg is open (UAT-opportunistic, not a code gap).

1. **R2 pause → SF cancel fan-out** (#342) — ✅ proven Day-52 (`MPL-28787105`, `MPL-01868399`).
2. **R3 driver-note → SF push** (#344) — ✅ proven Day-52 (`MPL-76890591`).
3. **Skip → cancel** — ✅ proven Day-52 (`MPL-48882801`).
4. **Task UPDATE push (R4/R5 address override)** — ✅ **proven Day-53 PM**. Reachability caveat: no UI path to a 2nd consignee address (Phase-2).
5. **POD post-fix (proxy)** — ✅ **proven Day-53 EVE** for ingest + proxy + expired-state; live byte-render open (UAT-opportunistic, unit-tested in #377).

### Hardening items (UAT-grade)
- **Server-side metadata strip (R8)** — ✅ **closed** (#376, Day-53 EVE): the R8 allow-list now strips server-side so excluded fields never reach the browser; client filter stays belt-and-braces.
- **POD broken-image** — ✅ **closed** (#377, Day-53 EVE): same-origin authenticated proxy; expired links show an honest fallback instead of a leaked/mystery glyph. (Deferred: durable ingest-time photo capture — needs a migration + storage ruling.)
- **Resolved-rows visibility gap** — **deferred past the first UAT** per Love's Day-53 PM ruling (`memory/decision_d53_pm_uat_calls.md`).
- **Move-to-date placeholder** — calendar UI currently *promises* a reschedule the code doesn't fully deliver ("lies to the operator"). Closed by R4/R5 work.
- **Phone display readability** — cosmetic but visible.
- **Auth cookie httponly/secure hardening** — never confirmed shipped.

### Correctness / race risks under real operation
- **Inbound webhook TZ re-stamp (FOUND Day-52 PM, proving pass):** `TASK_HAS_BEEN_UPDATED` reflections carry SF's UTC delivery window and `apply-webhook-edit-event.ts` applies it as Dubai-local — every update reflection shifts the task window −4h (observed: 06:00–09:00 → 02:00–05:00 on the R3 note task). Operator-visible wrong window; outbound got the TZ fix (PR #307), inbound did not. Fix parked as its own PR (overnight Session A lane). Related: `followup_inbound_webhook_edit_apply_two_bugs.md`.

Lower-probability but real: assigned-before-cutoff dispatch race; auto-pause vs bounded-pause divergence (stranded subs); webhook row lost on update rollback; reconcile recovered-local-write failure (no-DLQ path); consignee deactivation doesn't cascade-cancel tasks (`mp_13`). *Triage these against the UAT line in §7.*

---

## 6. The production-promote gap (structural) — RESOLVED Day-53

_At filing this read: "Everything R1→R8 is main-only; production HEAD predates the
entire calendar lane; a real-wire UAT requires a promote first."_

**Resolved.** Production was promoted across Day-51→Day-53; the latest promote
(#384, prod HEAD `0665e8c`, Day-53 EVE) carries R1→R8 + R4/R5 + the POD proxy
(#377) + the metadata strip (#376). Each promote ran smoke + demo-preflight 10/10.
The real-wire proving passes (Day-52/53) ran **against this production**, so the
"no deaf integrations" claim is now grounded on shipped code, not main-only code.

---

## 7. MVP-blocking vs deferred — the actual checklist

### Genuinely blocking a UAT line — ALL CLEARED for sandbox (Option A) UAT
1. **Promote to production** — ✅ done (Day-51 → Day-53; latest prod HEAD carries R1→R8 + R4/R5 + POD proxy + metadata strip, EVE promote #384 `0665e8c`). Smoke + demo-preflight 10/10 each promote.
2. **R4 + R5** — ✅ built, merged (Phase 1 closed @ #368), proven on real wire (Day-53 PM).
3. **Real-wire proving pass** — ✅ complete: R2 pause-cancel, R3 note-push, skip→cancel (Day-52), task-update push (Day-53 PM), POD post-fix (Day-53 EVE). The "no deaf integrations" requirement is met; only the POD live-render sub-leg is UAT-opportunistic.
4. **SF production auth** — *Option B only.* Plan + code parked Day-53 EVE (#378/#380, Session A); standing Love-gated (credential entry + live probe). **Sandbox UAT (Option A) does not need it.**
5. **HEM 403** — *only if a production-region merchant is in UAT scope.* Blocked on Aqib diagnostic. N/A for sandbox UAT.

### Love's open product calls — ALL RULED (Day-53 PM/EVE, `decision_d53_pm_uat_calls.md` + `decision_d53_eve_final_clears.md`)
- **POD broken-image** — ruled UAT-blocking; **fixed** (#377 proxy, proven Day-53 EVE).
- **Resolved-rows visibility** — **deferred** past the first UAT.
- **Server-side metadata strip** — ruled UAT-blocking; **fixed** (#376, Day-53 EVE).
- **The §5 correctness/race items** — **accepted as controlled-UAT risk**; triage before production merchants onboard.
- **Multi-address (2nd consignee address) UI** — Phase 2; builds **before production merchants onboard, not before UAT**. UAT runs on pre-seeded multi-address consignees.

### Explicitly deferred — POST-MVP (parked so they can't creep into UAT)
**Love's recalled post-MVP items:**
- **Open APIs for meal-plan merchant integration** (third parties integrating *with* Planner).
- **Advanced reporting / BI module.**
- **Bag tracking** (asset-tracking inner record shape — outer wrapper real-wire, inner never ingested).

**From the brief's §4 + post-v1.16 followups:**
- Audit log *viewer* UI (broad surface — R8 built the spine, the viewer is post-pilot).
- Reconciliation job (Planner↔SF), failed-attempt manual retry workflow.
- SMS skip notifications, CSV export, Arabic/i18n, mobile-responsive operator UI.
- Custom roles / impersonation / SSO, configurable cutoffs / blackouts / max-skips per merchant.
- AWS Secrets Manager swap (Vault → Secrets Manager), multi-address rotation.
- Calendar R6/R7 tails (9-column layout, default-tab branching), R11 POD proxy, R12 resolved-rows route.
- SF auth rate-limit / lockout policy documentation (blocked on Aqib).
- Stale-CI-tenant cleanup (339+ test tenants), migration-drift check.

---

## 8. Honest summary — how far from a UAT line

**At the line (sandbox / Option A).** As of Day-53 EVE the entire blocking list is
cleared:

- ✅ R4/R5 built + merged (Phase 1 closed) + proven on real wire.
- ✅ Promoted to production + smoke + demo-preflight 10/10.
- ✅ Real-wire proving pass complete (R2/R3/skip/update + POD ingest/proxy/expired) — no "deaf integrations" left; one POD sub-leg (live byte-render) is UAT-opportunistic.
- ✅ Product calls ruled and the UAT-blocking ones fixed (POD proxy #377, metadata strip #376; resolved-rows deferred; race items accepted; 2nd-address UI is Phase-2-not-UAT-blocking).

**The first Ops UAT can run now**, on the pre-seeded multi-address consignees, per
`memory/uat_run_sheet_v1.md`. Sandbox probe data is the UAT demo data (torn down
after). What's left is **running** the UAT, not building for it.

If Love chooses **production-merchant UAT (Option B)**, add: Aqib production credentials, the API-key probe, Love's probe authorization, and HEM 403 resolution — all of which depend on external (Aqib/SF) timelines Love doesn't fully control.

**Recommendation:** run the **first** Ops UAT on **sandbox (Option A)** — it's proven, unblocked, and lets Ops surface their "what else" list fast — while the production-auth thread (Aqib credentials + probe) runs in parallel toward a **second, production-merchant UAT**. This decouples "get Ops feedback" (fast) from "prove production auth" (externally gated), so neither blocks the other.

---

## 9. Next actions

_§2 and the §7 product calls are now ruled (Day-53 PM/EVE); the blocking list is
built, proven, and promoted. Remaining:_

1. **Run the first Ops UAT** on the pre-seeded multi-address consignees per `memory/uat_run_sheet_v1.md` (sandbox / Option A). Capture Ops' "what else" list.
2. **Opportunistic POD live-render** — during UAT, on the first fresh delivered-with-photo order (within 7 days), confirm the photo streams through the proxy (the one open §5 sub-leg).
3. **After UAT:** tear down the Day-53 sandbox probe data (Fatima's probe subscription + its SF tasks).
4. **Before production merchants onboard:** build the Phase-2 add-address UI (`followup_no_ui_second_consignee_address.md`); resolve SF production auth (Option B: Aqib creds + Love's probe go, #378/#380); triage the §5 race items.
5. This document is filed in the repo (`memory/uat_mvp_scope_definition.md`), so it survives session boundaries and can be handed to Ops.

*This is a UAT definition. Final MVP sign-off follows Ops review.*

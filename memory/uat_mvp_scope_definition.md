# UAT-MVP Scope Definition — Transcorp Subscription Planner

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

### The "deaf integration" list — merged/looks-done but NOT proven on real wire
These are the items most likely to embarrass at an Ops demo:

1. **R2 pause → SF cancel fan-out** (#342) — merged, **never fired against real SF.** A pause that doesn't actually stop dispatch is exactly the "deaf integration" risk.
2. **R3 driver-note → SF push** (#344) — merged, **never fired against real SF.** A note the driver never receives.
3. **Skip → cancel** — integration-tested on real Postgres, but the **QStash→SF leg is mocked**; no record of a real skip firing a real cancel.
4. **Task UPDATE push** — shape doc-verified + a unit assertion, but **no live SF update round-trip on record.**
5. **POD ingestion post-fix** — the status/date sync bug was fixed, but **real POD ingestion post-fix is unconfirmed.**

### Hardening items (UAT-grade, not blockers but visible)
- **Server-side metadata strip (R8)** (`#360`, filed today) — the audit allow-list filters *client-side*; raw SF error text + internal IDs still reach the browser payload (fishable via dev-tools). Fix: apply the allow-list server-side. *Low-risk now (same-tenant, authenticated); worth closing before Ops.*
- **POD broken-image** — S3 pre-signed URL expiry → broken POD images in UI. 3 fix paths unpicked. **UAT-visible.**
- **Resolved-rows visibility gap** — resolved DLQ rows invisible in the UI.
- **Move-to-date placeholder** — calendar UI currently *promises* a reschedule the code doesn't fully deliver ("lies to the operator"). Closed by R4/R5 work.
- **Phone display readability** — cosmetic but visible.
- **Auth cookie httponly/secure hardening** — never confirmed shipped.

### Correctness / race risks under real operation
Lower-probability but real: assigned-before-cutoff dispatch race; auto-pause vs bounded-pause divergence (stranded subs); webhook row lost on update rollback; reconcile recovered-local-write failure (no-DLQ path); consignee deactivation doesn't cascade-cancel tasks (`mp_13`). *Triage these against the UAT line in §7.*

---

## 6. The production-promote gap (structural)

Everything R1→R8 is **main-only**. Production HEAD predates the entire calendar lane.

**Consequence:** a UAT that claims "both actor flows end-to-end, no deaf integrations" **cannot run against current production** — it would be testing months-old code. A real-wire UAT *requires a production promote first.* Under the current (pre-MVP) autonomy model, promotes flow on agent-agreement, so this is a "when Love says go" operational step, not a build — but it must happen before UAT, and it's worth a deliberate smoke pass immediately after.

---

## 7. MVP-blocking vs deferred — the actual checklist

### Genuinely blocking a UAT line (the short, real list)
1. **Promote to production** and smoke the current main (R1→R8). *Operational; do first.*
2. **R4 + R5** — address overrides (one-off + forward) with SF push. *The last operator-promise features.*
3. **Real-wire proving pass** over the merged-but-never-fired legs: **R2 pause-cancel, R3 note-push, skip→cancel, task-update push.** *This is the "no deaf integrations" requirement made concrete.*
4. **SF production auth** — *only if Love chooses Option B (§2).* Requires Aqib production credentials + Love's probe authorization. **If Option A (sandbox UAT), this is deferred to post-UAT.**
5. **HEM 403** — *only if a production-region merchant is in UAT scope.* Blocked on Aqib diagnostic.

### Love's open product calls (decide before/at UAT)
- **POD broken-image** — UAT-blocking or deferred? (It's visible; a broken POD image in front of Ops is a "disappointment.")
- **Resolved-rows visibility** — UAT or deferred?
- **Server-side metadata strip** — close before Ops, or accept for first UAT?
- **The §5 correctness/race items** — which (if any) are UAT-blocking vs accepted-risk for a controlled UAT?

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

**Closer than it feels, but gated on proving rather than building.** If Love chooses **sandbox UAT (Option A)**, the remaining work is:

- Build R4/R5 (the last two features).
- Promote to production + smoke.
- Run a real-wire proving pass over R2/R3/skip/update so they're not "deaf."
- Rule the handful of product calls (POD image, resolved-rows, metadata strip).

That's a bounded, countable list — not "lots more to build."

If Love chooses **production-merchant UAT (Option B)**, add: Aqib production credentials, the API-key probe, Love's probe authorization, and HEM 403 resolution — all of which depend on external (Aqib/SF) timelines Love doesn't fully control.

**Recommendation:** run the **first** Ops UAT on **sandbox (Option A)** — it's proven, unblocked, and lets Ops surface their "what else" list fast — while the production-auth thread (Aqib credentials + probe) runs in parallel toward a **second, production-merchant UAT**. This decouples "get Ops feedback" (fast) from "prove production auth" (externally gated), so neither blocks the other.

---

## 9. Next actions

1. **Love rules §2** — sandbox UAT or production-merchant UAT for the first Ops demo.
2. **Love rules the §7 product calls** — POD image, resolved-rows, metadata strip, race items.
3. Build the blocking list (§7): R4/R5, then the real-wire proving pass, gated by Love's §2 choice.
4. Promote + smoke before UAT.
5. This document is filed in the repo (`memory/uat_mvp_scope_definition.md`) and mirrored to the project cabinet, so it survives session boundaries and can be handed to Ops.

*This is a UAT definition. Final MVP sign-off follows Ops review.*

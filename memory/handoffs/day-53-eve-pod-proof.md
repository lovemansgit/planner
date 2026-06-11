---
name: Day-53 EVE — POD proxy real-wire proof (uat §5 item 5)
description: POD post-fix (#377 same-origin authenticated proxy) verified end-to-end on production — webhook-ingested SF S3 URLs serve through Planner, the raw S3 link never reaches the browser, and past-TTL rows return a clean 410/honest fallback. The live 200 byte-render is NOT producible on the current sandbox (no within-TTL POD; needs a driver upload on SF) — parked honestly, not faked.
type: handoff
---

# Day-53 EVE — POD proxy real-wire proof (2026-06-11)

**Gate:** waited (no nudge) until production carried #377. Session A promoted via
**#384** (`promote: 2026-06-11 EVE — Day-53 final clears`), prod HEAD `0665e8c`;
proxy route went live (probe `/api/tasks/{uuid}/pod/0` flipped 404 → 401).
Verified through the production UI as the UAT operator (`mpl-admin`, mpl sandbox).
Same evidence bar as Day-52 §C.

## What was proven on real wire ✅

The POD photo path (`uat_mvp_scope_definition.md` §5 item 5) for the
**ingest + proxy + expired-state** legs:

1. **Ingest is real.** The mpl sandbox carries four DELIVERED-with-photos tasks
   from Day-21 testing: `MPL-80355079`, `MPL-38610276` (20 May), `MPL-02403404`,
   `MPL-53512916` (21 May). Their `pod_photos` hold genuine SuiteFleet S3
   pre-signed URLs (`s3.eu-central-1.amazonaws.com/reseource-tracking-transcorpsb/
   image/task/…`), populated by the real DELIVERED webhook
   (`apply-webhook-status-event.ts` → `extractPodPhotos`). Not seed-synthetic.
2. **The proxy serves them — raw S3 link never reaches the browser.** Post-#377
   the operator lightbox renders **same-origin** paths
   `/api/tasks/{taskId}/pod/{index}` (e.g. `a4115023-…/pod/0`,
   `94ff51d9-…/pod/0`, `17a92e7c-…/pod/0`). No `amazonaws` URL in any lightbox
   `<img>` (`s3leak=false` on all three checked). Same security posture as the
   label-PDF proxy.
3. **Past-TTL rows return a clean 410 / honest fallback.** Every one of these
   URLs is **expired**: signed `X-Amz-Date=20260519`, `X-Amz-Expires=604800`
   (7 days) → expired 2026-05-26; S3 itself returns
   `403 AccessDenied — "Request has expired"`. The proxy fetches server-side,
   gets the 403, and returns **`410 Gone`** to the browser (verified on
   `MPL-80355079`, `MPL-38610276`, `MPL-02403404` — all `410 application/json`).
   The operator sees the honest broken-image fallback ("Proof of delivery photo"
   alt) — **not** the old mystery glyph and **not** a leaked S3 error.
4. **Authenticated-only.** Unauthenticated GET of a proxy path → **401**. The
   route gates on `task:read` + tenant scope (cross-tenant rows are 404-shaped).

## What is NOT proven — parked honestly ⚠️

**The live 200 byte-render** (a fresh, within-TTL POD photo streaming through the
proxy and rendering as an actual image). It is **not producible on the current
sandbox**:

- All four mpl POD rows are **weeks past** the 7-day S3 TTL (delivered 20/21 May;
  today 11 Jun).
- A within-TTL POD requires a **fresh DELIVERED-with-photos event** — i.e. a
  driver marking the task delivered **and uploading POD photos in the SuiteFleet
  driver app**. That is a vendor-side human action, **not triggerable from
  Planner** (Planner can push/cancel/update tasks, but cannot deliver them or
  attach driver photos). The Day-53 probe tasks even auto-advanced to DELIVERED
  on the sandbox but carry **no** photos — confirming auto-delivery alone doesn't
  produce POD.
- Expired URLs cannot be re-signed by Planner (only SF holds the bucket creds).

**Tried:** scanned all DELIVERED mpl rows Apr–Jul for a within-TTL POD (none);
confirmed fresh probe deliveries carry no photos; confirmed the expired URLs are
dead at the vendor (S3 403). The byte-streaming branch (`200 image/*` → bytes,
short private cache) is **unit-tested** in #377 (`pod-proxy.spec.ts`) but
**unproven on live wire** for lack of a producible fresh POD.

**Recommendation:** prove the 200 render opportunistically during the live Ops
UAT — the first time a real driver completes a sandbox delivery **with** a photo
upload (within 7 days), open that order's POD in the lightbox; it should stream
the image through the proxy. Until then this single sub-leg stays open. It is
**not** a code defect — the path is built and unit-covered; it's an
evidence-availability gap.

## Net for §5

Item 5 (POD post-fix) moves from "unconfirmed" to **proven for ingest + proxy +
expired-state**, with the **live-render sub-leg open** (UAT-opportunistic). No
remaining §5 leg is a code-confidence gap.

## Cross-references

- `memory/decision_d53_eve_final_clears.md` — Love's EVE ruling (POD UAT-blocking, Planner-only fix; this proves the merged fix).
- `memory/followup_pod_broken_image_pre_existing.md` — #377's grounding (7-day TTL, 410 mapping, deferred ingest-time capture).
- `memory/uat_run_sheet_v1.md` §D — the operator-facing POD step, written from this proof.
- `memory/handoffs/day-53-pm-proving-pass.md` — the R4/R5 proof (the other §5 legs).

---
name: POD broken-image rendering on consignee detail Calendar tab (pre-existing, surfaced Day-33 PM during PR-C eyeball)
description: A DELIVERED-day POD thumbnail rendered broken on the consignee detail Calendar tab during PR-C production eyeball at main `d25e812`. CalendarPodCard passes the SF-supplied URL straight through to `<img src>` without signing, rewriting, or auth-token interpolation; the URL itself is whatever SuiteFleet's delivery webhook wrote into `tasks.pod_photos`. Verified pre-existing on current production — NOT caused by PR-C. Triage requires a real-browser Network panel diagnostic with Img filter (current diagnostic captured Fetch/XHR only and missed the actual image request status code). Three plausible upstream shapes (404 CDN URL expired / 403 CDN behind auth Planner doesn't have / wrong-domain CORS rejection / other). NOT load-bearing for any active lane; Plan #317 PR-D in flight does not depend on this. Anchored Day-33 PM so the finding is not lost between now and the next calendar UX touch.
type: followup
---

# Origin

Day-33 PM (2026-05-21, Dubai) production eyeball pass on PR-C (Plan #317 outbound push pipeline §F-3 + migration 0028) at main HEAD `d25e812`, production deployment `dpl_5EHiBSWE1693hRJsN345voCrup7o`, alias `planner-olive-sigma.vercel.app`.

Love clicked through the consignee detail Calendar tab (`/consignees/<id>?tab=calendar`) on a DELIVERED-day cell and observed a **broken-image rendering** where the POD thumbnail should appear. Specifically: the `CalendarPodCard` (the variant of the calendar cell that renders for tasks with `internal_status === 'DELIVERED'` + `pod_photos` non-empty, per [`memory/diagnostic_calendar_management_full_surface_enumeration.md`](diagnostic_calendar_management_full_surface_enumeration.md) Axis 1.5 → POD photo thumbnail entry) showed the standard browser broken-image glyph instead of the SF-supplied delivery photo.

# Status at filing

- **Confirmed pre-existing.** Love verified the same broken-image rendering on the current production deployment for the same row. The bug pre-dates PR-C; PR-C did not introduce it.
- **No scoped fix yet.** Diagnostic findings (§Scope of resolution below) narrow the cause space but cannot pin the exact shape without a follow-up Network-panel pass.
- **No operator workaround.** Operators inspecting a DELIVERED day with a broken POD thumbnail have no Planner-side path to retry, re-fetch, or surface the underlying URL — the POD card click opens `PodLightboxModal`, which would render the same broken image in lightbox shape.
- **Visible to all operators.** Anyone with `task:read` permission on a tenant containing DELIVERED tasks whose SF-supplied POD URL fails to load will see this. No permission-scope mitigation.
- **Calendar-lane diagnostic memo says CalendarPodCard is "works end-to-end (Day-19 / A2 plan shipped)" — that classification is incomplete.** The code-level claim is correct (the component renders the URL it was given). The classification did not verify the upstream URL's reliability under real-tenant production data, which is where this gap lives. The diagnostic memo's classification stands at the code-shape layer; this memo extends it at the upstream-dependency layer.

# Scope of resolution (unknown without Network diagnostic)

The POD photo rendering pipeline (as established by Session A's earlier diagnostic today; **not re-investigated here**):

1. **Write path** — `extractPodPhotos` in [`src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts:540-561`](../src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts) reads `deliveryInformation.photos` from the SuiteFleet delivery webhook payload and writes the URLs verbatim into `tasks.pod_photos`. No transformation, no signing, no host-rewrite.
2. **Read path** — `mapPodPhotos` in [`src/modules/tasks/repository.ts:295-300`](../src/modules/tasks/repository.ts) projects the DB column into the DTO. Filters non-strings as a defensive narrower, but does NOT transform/sign URLs.
3. **Render** — [`src/app/(app)/consignees/[id]/_components/CalendarPodCard.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/_components/CalendarPodCard.tsx) around line 56 emits `<img src={photos[0]}>` — plain HTML pass-through. No Next.js Image optimization, no signed-URL fetch, no auth-token interpolation.

Conclusion from those three layers: **the rendered URL is whatever SuiteFleet handed us at delivery time**, almost certainly a CDN URL on SF's photo host. If the URL doesn't load in the browser, the failure mode is upstream of anything Planner controls.

**Three plausible upstream shapes** (the Network diagnostic discriminates between them):

1. **CDN URL expired (404).** SF's photo host TTL elapsed; the URL stored in `tasks.pod_photos` is now stale. Common pattern for short-TTL signed URLs from third-party CDNs. If this is the shape, the fix is server-side: re-fetch fresh URLs from SF on each read, OR sign URLs on the Planner side using shared credentials with SF.
2. **CDN behind auth Planner doesn't have (403).** SF's CDN requires a session-cookie / token / signed-URL component that the SuiteFleet operator session has but the Planner cross-origin `<img>` request does not. Common pattern when the URL is meant for SF's own UI and not for embedded use in third-party tools. If this is the shape, the fix involves either SF-side coordination (open the CDN to Planner's origin) OR a Planner-side proxy fetch with attached SF auth credentials.
3. **Wrong-domain CORS rejection (200 with CORS block).** The image request succeeds at HTTP layer but the browser blocks the response due to a missing `Access-Control-Allow-Origin` header from SF's CDN. Less common for `<img>` tags (which historically bypass CORS for display) but possible if `crossOrigin` attribute is set somewhere or if SF's CDN issues a CORS-required response. If this is the shape, the fix involves either SF-side CORS header change OR a Planner-side proxy.
4. **Other / unknown.** Stale URL string corruption (e.g., truncated), DNS resolution failure for SF's CDN, regional CDN egress block, or some condition not in the above three. The Network panel diagnostic surfaces whichever it is.

**The diagnostic owed to this issue:** real-browser Network panel with Img filter (not Fetch/XHR — Love's earlier pass missed this because the filter was set to Fetch/XHR), capturing:
- The actual image request URL (verbatim from `<img src>` after any browser-side resolution).
- HTTP status code (200 / 403 / 404 / other).
- Response headers (especially `Access-Control-Allow-Origin`, `Cache-Control`, `Content-Type`).
- Any browser-console error message accompanying the failed load.

Without those four data points, the resolution shape stays in the 4-option space above. With them, scope reduces to a single shape and a small T2 PR (or an Aqib-coordination thread if the fix lives on SF's side).

# Standing

- **NOT load-bearing for any active lane.**
  - **Plan #317** (T3 outbound push pipeline, OPEN at `f0ef560`): F-1..F-6 + CLEANUP-1 cover the queue-infrastructure surface only. PR-A + PR-B + PR-C all shipped without touching POD photo rendering; PR-D (CLEANUP-1, in flight via Session A) is the failed_pushes bulk-resolve tooling — also unrelated to POD URLs.
  - **Calendar-management full-resolution lane** (`memory/diagnostic_calendar_management_full_surface_enumeration.md`, R1-R7 enumerated): does NOT currently include POD-photo resolution as a ruling item. The diagnostic classified CalendarPodCard as works end-to-end at the code-shape layer; this memo's finding is at the upstream-dependency layer.
- **Lane-membership decision deferred.** At lane-open time (which sequences AFTER Plan #317 PR-D ships per the Day-32 calendar-lane shape proposal), Love can decide whether this issue:
  - (a) folds into the calendar-management lane as an additional ruling item (call it R8 if Love directs);
  - (b) ships as a small standalone T2 PR (likely 1-hour scope once the Network diagnostic narrows the shape);
  - (c) routes to Aqib for SF-side resolution (if the diagnostic surfaces shape #2 or #3).
- **Operator impact:** moderate. The broken-image is operator-visible on every DELIVERED-day cell whose SF URL fails to load. Operators investigating a delivery cannot visually verify the POD without working around to SF's own UI. NOT data-corrupting; NOT customer-facing.
- **Demo posture:** sandbox-region demo flows use sandbox SF (tenant `transcorpsb`, merchant 588). Whether sandbox SF POD URLs exhibit the same upstream behavior is not characterised. If the demo includes a DELIVERED-day click-through on a real POD, this could surface there — but the broken-image rendering is itself a recognisable failure mode and not actively misleading.

# Non-goals

This memo does NOT:

- Propose a fix for POD URL rendering. Resolution shape is unknown until the real-browser Network diagnostic narrows the cause.
- Re-investigate the three rendering pipeline layers Session A already characterised today. Those findings are anchored as-is; this memo cites them, does not re-do them.
- Speculate beyond what the diagnostic findings establish. The 4 plausible shapes above are exhaustive of the cause space Session A's diagnostic narrowed to — any expansion belongs in the post-diagnostic triage, not here.
- Re-classify the `diagnostic_calendar_management_full_surface_enumeration.md` Axis 1.5 POD photo thumbnail entry. That classification (works end-to-end at the code-shape layer) is correct; this memo extends it at a layer the diagnostic did not verify.
- Scope a code-PR. Whether the eventual fix is Planner-side, SF-side, or coordination depends entirely on the Network diagnostic's outcome.
- Touch Plan #317 lane (queue infrastructure, separate scope).
- Touch the calendar-management diagnostic memo (would risk re-classifying surfaces; the brief explicitly carved that out).

# Trigger for next-action

When Love runs the real-browser Network diagnostic (open dev tools on a consignee detail Calendar tab with a known broken-POD row → Network panel → Img filter → reload → capture the failed image request), the next action is:

1. **Classify which of the 4 shapes applies** based on the captured status code + response headers.
2. **If shape #1 (404 expired URL):** scope a small Planner-side re-fetch service (probe SF on read, replace stale URLs). T2 fix-PR, ~1-2 hour scope.
3. **If shape #2 (403 auth-required):** Aqib coordination thread — does SF intend POD URLs to be embeddable cross-origin, or are they session-bound? If session-bound, Planner needs a proxy fetch with SF auth. T2 fix-PR if proxy path; Aqib-coordinated if SF-side change.
4. **If shape #3 (CORS rejection):** Aqib coordination on SF CDN headers OR Planner-side proxy. Same shape as #2's proxy path.
5. **If shape #4 (other):** investigate per the surfaced detail; scope a fix once the cause is pinned.

In all cases, post-resolution housekeeping: verify a previously-broken row renders correctly, append the resolution path to this memo, and decommission it from any active-followup digest if/when filed there.

# Day-33 PM amendment — Network diagnostic findings

The trigger above ("Love runs the real-browser Network diagnostic") fired Day-33 PM. Operator-browser capture on the consignee detail Calendar tab (Marwan consignee, May 20 DELIVERED cell) under Network filter = **Img** (not Fetch/XHR — prior eyeballs missed this) surfaced the actual failing image request. Diagnosis below.

## Captured failing image URL (verbatim from operator browser)

```
https://s3.eu-central-1.amazonaws.com/reseource-tracking-transcorpsb/image/task/image_lQ0z8BIzhQEjbkxlwpVbpAVhLoS6XR.jpg?X-Amz-Security-Token=…&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260519T082824Z&X-Amz-SignedHeaders=host&X-Amz-Expires=604800&X-Amz-Credential=ASIA2JW2OEETTA6Z7PWR%2F20260519%2Feu-central-1%2Fs3%2Faws4_request&X-Amz-Signature=df1827021a153510dd5cd2f0e87b8c145fac7427085ebb13a1a888ab0c736030
```

**Browser-reported failure:** `(failed) net::ERR_BLOCKED_BY_RESPONSE`.

## Diagnosis — AWS S3 pre-signed GET URL (SigV4)

The URL is an AWS S3 pre-signed GET URL using Signature Version 4. Three decisive query parameters determine signature validity:

- `X-Amz-Date=20260519T082824Z` — signature **generated** at 2026-05-19 08:28:24 UTC.
- `X-Amz-Expires=604800` — TTL = 7 days = 604,800 seconds.
- **Signature absolute expiry:** 2026-05-26 08:28:24 UTC.

Today (Day-33, 2026-05-22) the link is **technically still inside its TTL** — the signature is valid for another ~4 days. The failure surface is therefore NOT a simple "signature expired" case (which would manifest as a 403 with an `AccessDenied` / `SignatureExpired` XML body). Instead the failure is the **structural mismatch** between SF's signed-URL contract and Planner's storage model:

- Pre-signed URLs are inherently short-lived (AWS designed for "click within minutes," not "store and render forever").
- Planner stores the SF-supplied URL **verbatim** in `tasks.pod_photos` (a `jsonb` column populated by `extractPodPhotos` at [`src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts:540-561`](../src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts)).
- The calendar renders the URL as-is via `<img src={photos[0]}>` in [`CalendarPodCard`](../src/app/%28app%29/consignees/%5Bid%5D/_components/CalendarPodCard.tsx) (~line 56).

When the signature is past expiry — OR when any browser-side condition makes S3 return the XML error envelope instead of image bytes (e.g., CORP / COEP-related browser rules, a transient region-level edge condition, or other) — the browser blocks the response with `ERR_BLOCKED_BY_RESPONSE` (browser shorthand for "S3 returned an XML error body, not an image"). The image tag renders the standard broken-image glyph.

Today's exact failure path (within-TTL but still blocked) implies the response body shape OR a browser-policy reaction, not a simple signature timeout. Either way, Planner's verbatim-storage-and-direct-render model is structurally mismatched against SF's short-TTL signed-URL contract — the fix shape needs to address the storage/retrieval architecture, not just refresh a single stale URL.

## Reclassification within the original 4-shape enumeration

The Day-33 AM memo enumerated 4 plausible upstream shapes: (a) CDN URL expired (404), (b) CDN behind auth Planner doesn't have (403), (c) wrong-domain CORS rejection (200 with CORS block), (d) other/unknown. Findings reclassify as a **5th narrower shape**:

- **(e) S3 pre-signed URL signature stale relative to render time** — OR a browser-policy reaction to the response body — rooted in the structural mismatch between SF's short-TTL signed-URL contract and Planner's verbatim-storage-and-render model.

Closest in the original four was **(a) "404 expired"**, but the distinction matters for fix shape: the underlying S3 object is **not** deleted, and even within-TTL renders can fail. The Planner-side fix needs to bridge the storage/retrieval gap, not just retry on expiry.

## Three fix shapes (enumerated, NOT picked — eventual lane plan-PR rules)

1. **Proxy POD images through Planner.** Server-side route fetches from SF (or re-signs locally) at render time. Planner becomes an authenticated proxy.
   - *Pros:* durable forever; works across signature expiry; no DB rewrites needed; bypasses the storage-vs-signed-URL mismatch entirely.
   - *Cons:* bandwidth + latency cost on every POD render; new authenticated `/api/pod-images/[task_id]/[index]` route shape needed; tenant-scoped auth on the proxy route required.
2. **Re-sign on read.** When the calendar loads, Planner checks the stored URL's `X-Amz-Date` + `X-Amz-Expires` and, if past a threshold (e.g., 1 day before expiry), refreshes by re-calling SF.
   - *Pros:* simpler than proxying; preserves S3 direct-fetch architecture.
   - *Cons:* requires SF API support for re-issuing a pre-signed URL on an existing photo (**not confirmed available** — Aqib question, see below); Planner needs the SF call shape; cache layer needed to avoid re-signing on every render.
3. **Download + re-host on webhook receipt.** On `TASK_STATUS_UPDATED_TO_DELIVERED` webhook, Planner downloads the photo from SF and re-uploads to a Planner-owned S3 bucket with a permanent URL (or long-lived signed URL). DB stores the Planner-bucket URL.
   - *Pros:* complete independence from SF; URLs durable; existing POD photos can be backfilled (one-shot migration job).
   - *Cons:* storage cost (POD photos accumulate); bandwidth cost; bucket lifecycle policy needed; webhook handler latency increases (download + upload synchronously, or async via QStash).

**Aqib coordination note.** Shape 2 (re-sign on read) is gated on SF answering: *"Does the SF API expose a re-sign endpoint for an existing task's POD photo, given the AWB + photo index?"* Recommend filing as an Aqib-coordination thread if shape 2 surfaces as the preferred direction. Shapes 1 and 3 are Planner-side only and do NOT require Aqib coordination.

## Standing post-amendment

- **NOT load-bearing for any current lane** (unchanged from original).
- **Demo posture:** flagged Day-33 as not blocking demo — demo personas do not navigate to past DELIVERED dates with broken POD photos. Refinement: even if they did, the failure is browser-side ERR_BLOCKED_BY_RESPONSE (no Planner crash, no data corruption, no other-surface contagion); the broken-image glyph is the worst case.
- **Lane-membership decision unchanged.** [`memory/diagnostic_calendar_management_full_surface_enumeration.md`](diagnostic_calendar_management_full_surface_enumeration.md) is the candidate parent lane if Love folds this; alternatively stand-alone T2/T3 PR. This amendment narrows the diagnostic question from "what is the shape?" (answered) to "which of the three fix paths?" (lane-open ruling).

# Cross-references

- [`memory/diagnostic_calendar_management_full_surface_enumeration.md`](diagnostic_calendar_management_full_surface_enumeration.md) — Day-33 calendar full-surface diagnostic. Axis 1.5 → POD photo thumbnail (`CalendarPodCard`) classified as works end-to-end. This memo extends that classification at the upstream-dependency layer.
- [`memory/followup_calendar_management_full_resolution.md`](followup_calendar_management_full_resolution.md) — Day-32 calendar lane memo. POD photo not in current lane scope; lane-open ruling will decide whether to fold this in.
- Source code anchors:
  - [`src/app/(app)/consignees/[id]/_components/CalendarPodCard.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/_components/CalendarPodCard.tsx) line ~56 — render layer.
  - [`src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts`](../src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts) lines 540-561 — write path (`extractPodPhotos`).
  - [`src/modules/tasks/repository.ts`](../src/modules/tasks/repository.ts) lines 295-300 — read path (`mapPodPhotos`).
- Plan #317 plan-PR: [`lovemansgit/planner#317`](https://github.com/lovemansgit/planner/pull/317) at `f0ef560` — out-of-scope cross-reference; POD photo issue is NOT in the #317 lane.
- PR #323 (PR-B eyeball pass) + PR #326 (PR-C eyeball pass) — both eyeball passes missed this row class because POD photo on a DELIVERED day was not in either's verification checklist. Discipline lesson, NOT a rule to add now: the post-T3-PR eyeball checklist should include a DELIVERED-day POD click-through.
- Day-33 housekeeping precedent: [`memory/followup_hem_403_credential_failure.md`](followup_hem_403_credential_failure.md) — same shape of memo (durable anchor for a verified-but-unresolved issue surfaced during production eyeball; resolution scope unknown without further triage; NOT load-bearing).
- Day-33 reviewer handoff §4-B (POD Network diagnostic) — Day-33 PM amendment trigger context; operator-browser Network capture on 2026-05-22, Marwan consignee, May 20 DELIVERED cell.

# Meta

Filed Day-33 PM (2026-05-21) as a T1 docs-only PR off main HEAD `d25e812`. Single commit, single file. Memo-only — the institutional record is the diagnostic context preservation + the trigger-for-next-action enumeration. Branch: `docs/d33-followup-pod-broken-image-pre-existing`. Merged via PR #327 at main `3a3e2ea`.

**Day-33 PM amendment** — Love ran the real-browser Network diagnostic (the trigger documented above) and captured the failing image request. Findings reclassify the 4-shape enumeration to a 5th narrower shape (e) S3 pre-signed URL signature stale relative to render time — OR a browser-policy reaction to the response body — rooted in the structural mismatch between SF's short-TTL signed-URL contract and Planner's verbatim-storage-and-render model. Memo amended with a new "Day-33 PM amendment — Network diagnostic findings" section between "Trigger for next-action" and "Cross-references"; cross-reference entry added for the reviewer handoff §4-B + operator browser capture anchor. Original sections (Origin, Status at filing, Scope of resolution unknown-shape enumeration, Standing, Non-goals, Trigger for next-action, Cross-references' prior entries) all unchanged. Three fix shapes enumerated with explicit tradeoffs (proxy / re-sign on read / download + re-host); memo does NOT pick — eventual lane plan-PR decides. Filed Day-33 PM as a T1 docs-only amendment PR off main HEAD `557126b`. Single commit. Branch: `docs/d33-pod-broken-image-network-diagnostic-amendment`.

# Day-53 PM resolution — grounded scope + smallest Planner-only fix (PR'd)

**Ruling:** Day-53 PM check-in (`memory/decision_d53_pm_uat_calls.md` ruling 4): UAT-blocking; scope the smallest Planner-only fix; vendor-needing paths fall back to Love's call.

**Day-53 grounding (real rows, production DB, read-only):**
- 18 pod_photos rows; 2 carry REAL SF URLs (rest are test fixtures). Both real URLs: S3 SigV4, `X-Amz-Expires=604800` (7 days), minted **~1 second** before their DELIVERED webhook landed (X-Amz-Date vs webhook event_timestamp) — at ingest, Planner holds an essentially full-TTL URL.
- Server-side probe of an expired stored URL: `403 AccessDenied "Request has expired"` XML. Past-TTL rows are **vendor-dead** — no Planner-only recovery; only SF can re-sign.
- The Day-33 within-TTL failure (`ERR_BLOCKED_BY_RESPONSE`) is a **browser** response-policy block; server-side fetches are immune.

**Conclusion: a Planner-only fix IS achievable.** Chosen smallest shape = **render-time authenticated proxy** (fix-shape 1 of the Day-33 enumeration): operator surfaces render `/api/tasks/[id]/pod/[index]`; the route gates on `task:read` + tenant scope, resolves the stored URL server-side, fetches it (immune to browser policy), streams the bytes. Expired upstream → honest `410 Gone`. No migration, no storage, no new spend, no vendor dependency. Covers UAT, where PODs are same-day fresh.

**Surfaces note:** the live operator POD surface is the `/tasks` POD cell → lightbox. `CalendarPodCard` (this memo's original anchor surface) is **orphaned dead code** since the calendar-management rework — no call sites. The admin POD cell (`/admin/tasks`) keeps raw URLs (separate read path + cross-tenant gate shape) — same pre-existing breakage class, NOT UAT-blocking, follow-on below.

**Deferred follow-ons (not this PR):**
1. **Durable ingest-time capture** — download bytes at DELIVERED-webhook receipt (URL is fresh) into Planner-owned storage; needs a migration + a storage decision (Postgres bytea vs Supabase Storage — the latter brushes the cost trigger). Post-UAT lane; also the only path that revives >7-day-old photos going forward (already-expired rows are unrecoverable regardless).
2. **Admin POD cell** routing through a cross-tenant-gated variant of the proxy.
3. **CalendarPodCard** — orphaned; delete or rewire at the next calendar UX touch.

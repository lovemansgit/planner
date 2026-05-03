---
name: D8-6 label-token observability audit — pre-Day-14 production check
description: D8-6's label-client.ts logs host-only (not the full URL) to keep the SF bearer token out of application logs. But Vercel/Sentry/APM HTTP instrumentation can auto-capture outbound request URLs including query params — bypassing the application logger entirely. Pre-Day-14 production audit required to confirm the token doesn't leak through framework-level instrumentation.
type: project
---

# D8-6 label-token observability audit

**Captured:** 2 May 2026 (Day 8 closing-commit self-review, post-D8-6 merge)
**Trigger to revisit:** pre-Day-14 production hardening audit. Blocking gate before pilot go-live if any framework-level instrumentation captures URLs with the bearer token.

---

## The gap

D8-6's `src/modules/integration/providers/suitefleet/label-client.ts` enforces the token-in-query security rule at the **application layer**:

- The constructed URL string lives only inside the function body (no return / no log of the URL itself).
- The application logger explicitly logs **host only** (`new URL(url).host`) — not the full URL — so log aggregation pipelines that ingest the application's structured logs don't see the token.

What the application layer does NOT control:

1. **Vercel function logs** — Vercel's serverless runtime may auto-instrument outbound `fetch` calls and surface URLs in invocation logs / observability dashboards. URLs in those logs include the query string with the token.
2. **Sentry HTTP integration** (`@sentry/nextjs` defaults) — captures outbound HTTP requests on breadcrumbs by default. The breadcrumb URL field includes the full querystring unless explicitly filtered.
3. **APM / tracing instrumentation** (Datadog APM, NewRelic, OpenTelemetry HTTP instrumentation) — same shape: spans for outbound fetches typically capture `http.url` as the full URL with query params. Most ship to a SaaS retention layer.
4. **Reverse-proxy / CDN access logs** between the Vercel function and SF — if the request goes through any intermediary, that intermediary's access log captures the URL.
5. **Browser devtools (defence-in-depth)** — operator browser never makes this request directly; the application architecture rules that out. But if a future commit accidentally moves URL construction to a client component, the URL goes through the operator's browser. The architectural rule is the load-bearing prevention; this audit is the verification.

The application-layer host-only logging is correct AND necessary AND not sufficient.

---

## Why this matters

Bearer tokens leaked into observability tooling are leaked credentials. Even if retention is bounded:
- Sentry / Datadog / Vercel function logs are SaaS surfaces — leaked tokens flow to vendor systems with their own access controls (or lack thereof).
- A leaked token is valid for the SF auth-token TTL (24h access per ADR-007). Window is bounded but real.
- Audit-log compliance: if a SOC 2 / ISO 27001 audit asks "show me where you log bearer tokens," the answer must be "we don't" — not "only host-only" with a footnote about framework instrumentation.

---

## Audit checklist (Day 9+ / pre-Day-14)

1. **Vercel function logs** — make a test invocation (e.g. trigger `/api/tasks/labels` against a sandbox tenant), inspect the invocation logs in the Vercel dashboard. Search for the bearer token string. If it appears, work needed: either disable Vercel's outbound-fetch instrumentation OR rewrite the SF call path to avoid framework auto-capture (e.g. drop fetch altogether and use `node:http` directly with manual logging).
2. **Sentry breadcrumbs** — if Sentry is configured (it is, per Day 7 / C-6), check the SDK's HTTP integration default behaviour:
   ```ts
   // In sentry.server.config.ts, look for / add:
   import * as Sentry from "@sentry/nextjs";
   Sentry.init({
     // ...
     beforeBreadcrumb(breadcrumb) {
       if (breadcrumb.category === "http" || breadcrumb.category === "fetch") {
         if (breadcrumb.data?.url?.includes("shipment-label.suitefleet.com")) {
           // Either drop the breadcrumb entirely, or scrub the token query param
           if (breadcrumb.data?.url) {
             const u = new URL(breadcrumb.data.url);
             u.searchParams.delete("token");
             breadcrumb.data.url = u.toString();
           }
         }
       }
       return breadcrumb;
     },
   });
   ```
3. **APM / tracing** — if Datadog or similar lands post-pilot, the same audit applies. Document the scrub rule alongside the existing observability config.
4. **Reverse-proxy / CDN** — Vercel itself proxies the function's outbound requests. Confirm that intermediate proxy logs aren't separately captured / retained.

---

## Mitigation if framework instrumentation can't be cleanly suppressed

Lean: **inline a token-scrubbing wrapper around the SF fetch call** in `label-client.ts`. The wrapper would:

1. Construct the SF URL.
2. Attach a synthetic-stripped URL to a request-context AsyncLocalStorage so any framework instrumentation that walks the context picks up the scrubbed version.
3. Make the actual `fetch` call.

This is more invasive than the current implementation. Only land it if step 1 of the audit shows actual leakage.

---

## Cross-references

- `src/modules/integration/providers/suitefleet/label-client.ts` — the file with the host-only logger and the URL-construction code path
- `memory/followup_suitefleet_label_endpoint.md` — the original token-in-query security constraint
- `memory/feedback_vercel_env_scope_convention.md` — adjacent: env-var Production+Preview convention. Different concern, same observability surface.
- D8-6 PR #84 — the commit that surfaced this gap during closing-commit self-review

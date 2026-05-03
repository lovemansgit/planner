---
name: D8-8 webhook auth model — credential-based verification not viable
description: SF webhook authentication is opt-in per-merchant, not platform-standard. Production merchants typically don't configure Client ID/Secret. The "Sub P" placeholder on test merchant 588 is incidental, not a foundation D8-8 can build on. D8-8 verification primitive must be chosen from IP allowlist / path-embedded tenant ID / HMAC (vendor-confirmed) — surface as design question in D8-8's plan rather than assuming credential-based verification.
type: project
---

# D8-8 webhook auth model — credential-based verification not viable

**Surfaced:** 3 May 2026 (Day 9 P2 — webhook env-var add aborted mid-execution)
**Trigger:** P2 was originally scoped to add `SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_ID` + `SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_SECRET` to Vercel ahead of D8-8 webhook hardening. Override during P2 execution: don't add — the vars would be dead on production with no code path referencing them.

---

## Finding

1. **SF webhook authentication is opt-in per-merchant, not platform-standard.** Each merchant in the SF dashboard can configure Client ID/Secret on their outbound webhook endpoint, or leave it blank. There is no platform-wide guarantee that any given inbound webhook carries authentication credentials.

2. **Production merchants don't configure Client ID/Secret.** The pilot's real merchants (and Transcorp's existing operational merchants on SF) typically skip this. Building D8-8 to *require* credential-based verification would mean the receiver rejects every legitimate production webhook — exactly the opposite of what hardening is supposed to do.

3. **The "Sub P" placeholder on test merchant 588 is incidental, not foundational.** Sandbox merchant 588 happens to have the literal string `Sub P` configured in both Client ID and Client Secret fields. This is dev-time scaffolding from SF onboarding, not a real shared secret. Even on the sandbox, treating it as a credential is theatre — it's not rotatable, not secret, and not present in production. The Day-7 empirical capture in `followup_webhook_auth_architecture.md` (clientid/clientsecret lowercase headers observed on inbound webhooks) was correct as captured but mis-generalised: those headers only carry meaningful values when the originating merchant opted in. **Open: confirm with vendor whether SF still emits the headers (with empty/null values) on merchants who didn't opt in, or whether the headers are absent entirely.**

4. **D8-8 verification primitive must come from elsewhere.** Three candidates to probe in D8-8's plan:
   - **IP allowlist** — restrict POSTs to known SF egress IPs. Cheap to implement if SF publishes a stable IP range; brittle if they rotate without notice. **Vendor question for Aqib:** does SF publish outbound webhook IPs? Are they stable across merchants?
   - **Path-embedded tenant ID as shared secret** — the receiver URL already carries `/api/webhooks/suitefleet/<tenant-uuid>` (e.g. `8bfc84b0-c139-4f43-b966-5a12eaa7a302`). UUIDv4 is ~122 bits of entropy → not enumerable; tenant-scoped naturally; doesn't depend on per-merchant SF config. Weaker than a real secret because it's not rotatable and is exposed any time the URL is logged, but stronger than no auth and stronger than the merchant-optional credential model. Lowest implementation cost — the URL pattern already exists.
   - **HMAC signature header** — if SF supports outbound HMAC signing (typical webhook auth pattern), this is the strongest option. **Vendor question for Aqib:** does SF emit an HMAC signature header on outbound webhooks (e.g. `X-Suitefleet-Signature`)? If yes: what algorithm, what does the signature cover (body only? body + URL? body + timestamp?), and how is the signing key configured per merchant?

---

## How to apply

D8-8's plan must surface the auth-primitive question at PR open, NOT assume credential-based verification. Pre-impl plan should:

- Quote this finding's three candidates verbatim
- Surface the two vendor questions (HMAC support, IP allowlist publication) for Aqib — these are blocking for the strongest options
- Land a fallback path even if the vendor answer takes days. Path-embedded tenant ID as shared secret is the no-vendor-input fallback because the URL pattern already exists in the receiver code; it's a known-weaker but immediately-implementable defence-in-depth
- Pilot can't ship without webhook receiver hardened, so D8-8 can't wait indefinitely on vendor answer — deciding the fallback explicitly is the load-bearing call

---

## Cross-references

- `memory/followup_webhook_auth_architecture.md` (Day 7 EOD capture) — original empirical capture of webhook payload + headers; the clientid/clientsecret lowercase headers observed there were correct as captured but mis-generalised in the assumption that they'd be present on production traffic
- `memory/followup_suitefleet_bulk_push_empirical.md` "Bonus finding" (Day 8 D8-4a third trigger) — first surface of the missing-env-vars warn line from the receiver, originally treated as a Day-9 env-add candidate
- `memory/handoffs/day-8-eod.md` §6 P2 — original "webhook env var gap" framing — superseded by this memo
- `memory/feedback_vercel_env_scope_convention.md` — the env-scope convention (Production + Preview only) was respected in the P2 execution that reduced to CUSTOMER_ID-only; convention itself unchanged

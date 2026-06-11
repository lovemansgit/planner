# Day-53/54 NIGHT — sandbox api_key enablement lane (Love's correction + directives)

**Filed:** Day-53/54 night (11 Jun 2026), Session A, with the lane's plan-PR. Supersedes all prior night prompts for this session.

## The ruling, verbatim

> "Love's correction, 2026-06-11: SuiteFleet accepts BOTH auth methods on ALL tenants, sandbox included — 'sandbox is OAuth-only' was a Planner-side assumption, not a vendor limitation. Love directs, all in one lane, built tonight: (1) wire the secret (api_key) method for the sandbox region; (2) the build must allow updating the authentication method for ALL existing merchants from OAuth to the secret method, not only new merchants; (3) OAuth is not required in production for now; (4) Demo Bistro is the proof merchant — Love creates its Client Credentials on the SF sandbox and enters the two secrets via the admin screen himself; its switch and the wire proof proceed tonight on Love's clearance of the parked PRs; (5) every other sandbox merchant — including all UAT/demo merchants — remains on OAuth untouched until Love's explicit post-UAT word; the first Ops UAT runs tomorrow on the proven path regardless of this lane's state."

## What this corrects

"Sandbox is OAuth-only / there is NO sandbox api_key endpoint" appears as vendor-fact in: `decision_aqib_api_key_auth_header_verified.md` (probe-gate §, annotated append-only alongside this memo), `scripts/probe-sf-api-key-auth.mjs` header (scrubbed in the code-PR), and `memory/plans/day-53-sf-apikey-production-auth-lane.md` §1 (annotated in the code-PR). It was a **Planner-side assumption**. Consequence: the api_key header shape AND the Q4 refresh-wire residual become provable on **sandbox** evidence — no production credentials or production-probe authorization needed for the proof.

## Dispositions

| # | Directive | Disposition |
|---|---|---|
| 1 | Wire api_key for the sandbox region | Per-merchant auth-method override (plan §2) — the sandbox REGION row stays `oauth` (= default for all existing merchants, ruling 5); api_key becomes per-merchant opt-in. |
| 2 | Method updatable for ALL existing merchants | The override is writable on every merchant via `/admin/merchants/[id]/credentials` (new method-switch control + service action, `merchant:update` gate, `merchant.updated` audit). |
| 3 | OAuth not required in production for now | No change needed — production regions are already seeded `api_key`; nothing in this lane touches them. |
| 4 | Demo Bistro = proof merchant | Runbook staged (`memory/runbooks/day-54-demo-bistro-apikey-proof.md`): Love flips the method + enters both secrets himself via the admin screen; proof = sandbox `loginApiKey` 200 + one authenticated call + the refresh-wire observation (closes Q4 on sandbox evidence). **Nothing executes before Love's clearance sentence.** |
| 5 | All other merchants stay OAuth until post-UAT word | Override default NULL → region method (oauth). No backfill, no bulk action built. **UAT hard line: nothing in this lane touches the mpl tenant, UAT data, or any live config tonight.** |

## Cross-references

- Plan: `memory/plans/day-54-sandbox-apikey-method-switch.md` (this PR).
- Corrected record: `decision_aqib_api_key_auth_header_verified.md` Day-54 annotation (this PR, append-only).
- Q4 residual + renewal strategy: #378/#380 (merged Day-53 EVE) — unchanged by this lane; the probe's refresh-wire observation now has a sandbox target.

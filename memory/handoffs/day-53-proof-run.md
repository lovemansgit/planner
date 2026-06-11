# Day-53 — Demo Bistro api_key proof run + display fix: Session A close-out

**Date:** 2026-06-11. **Dispatch:** Love's Day-53 proof run + merchant-page method display fix.

## 1. The proof: WIRE REJECTED — stopped per dispatch, evidence parked

Pre-flight was clean (override `api_key`, vault pair present, flip→entry audit sequence correct), but the **first-ever wire test of the api_key login returned HTTP 401 with an empty body** — one attempt through Planner's own resolver→Vault→`loginApiKey` chain, then full stop per the dispatch (no retry-loop, no rollback without Love's word). Read + refresh-wire legs never fired; **Q4 stays open**. Full evidence: `memory/decision_d53_demo_bistro_apikey_wire_evidence.md`; append-only annotation on `decision_aqib_api_key_auth_header_verified.md`.

The 401 cannot distinguish wrong key values (wrong client scope / inactive pair / swapped fields) from wrong header shape (the documentation-asserted `clientId`/`clientApiKey`/`clientSecretKey` names were never wire-confirmed). **Demo Bistro currently fails loud on any outbound push — the designed between-state.** Every other merchant untouched on OAuth; UAT path unaffected.

**Love's one-word options** (detailed in the evidence memo): re-check/re-enter the SF pair → "re-entered" re-runs the one-shot proof; authorize a single header-shape diagnostic probe (values pasted in Love's own shell); or rollback (two admin actions).

## 2. The display fix: built, APPROVED r1, PARKED as #396

Merchant detail page now renders the EFFECTIVE auth method (`override ?? region default`) with the credentials-page annotation copy "(merchant override)". Surface sweep found exactly one stale surface (the detail page); regions pages correctly show their own default, merchants list has no auth column, credentials page already effective-aware. RED-first (3 unit + 2 real-Postgres cases watched fail); 2015 unit / 485 integration green; reviewer APPROVE round 1; parked `parked-t2` at head `399c0d960339dc62e1320578150748d91dbca374`.

## 3. Standing state

- Parked queue at close: #396 (this lane, parked-t2) + #398 (Session B docs, needs-directional-ruling). #394 was merged by Love mid-session.
- Temp proof spec kept untracked at `tests/sandbox/demo-bistro-apikey-proof.spec.ts` for an instant re-run on Love's "re-entered" — never to be committed.
- Production provisioning gate: CLOSED (header shape still wire-unconfirmed).

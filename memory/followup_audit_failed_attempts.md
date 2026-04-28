---
name: Audit trail for failed mutation attempts
description: Service-layer methods (deleteRoleAssignment, deleteUser) emit audit events only on success. NotFound / Conflict / Forbidden failures leave no forensic record. Surfaced 27 April 2026 in C-21.
type: project
originSessionId: 745ed780-25c9-41f2-a58d-a5c1bbf8d5df
---
After C-21 (PR #19) landed, the identity service's `deleteRoleAssignment` and `deleteUser` emit `role_assignment.deleted` and `user.deleted` audit events on the success path only. Every failure path — `ForbiddenError` (permission missing), `ValidationError` (no tenant context), `NotFoundError` (target doesn't exist), `ConflictError` (C-21 violated) — throws without emitting any audit event. The forensic trail records who succeeded; it does not record who tried and was refused.

This is consistent with audit-after-commit (correctly avoiding ghost events for rolled-back mutations), but it leaves a real visibility gap: an attacker probing the surface, or a confused operator trying to delete the last Tenant Admin, leaves no fingerprint in `audit_events`.

**Why:** Adding audit-on-failure requires (a) new vocabulary entries because the existing `*.deleted` events imply success-tense ("deleted" = it was deleted), and (b) a try/catch wrapper at each service method that emits the denied event before re-throwing. Out of scope for C-21 — no admin endpoints exist yet, so the gap has no live consequence today.

**How to apply:** Open a small T2/T3 PR after Day 2 lands. Suggested shape:

1. **Vocabulary additions** in `src/modules/audit/event-types.ts` — at minimum:
   - `role_assignment.delete_denied_permission` — actor lacked `role_assignment:delete`
   - `role_assignment.delete_denied_invariant` — would have violated C-21
   - `role_assignment.delete_target_not_found` — actor passed an unknown id
   - `user.delete_denied_permission`
   - `user.delete_denied_invariant`
   - `user.delete_target_not_found`
   - Generic counterparts as the surface grows: `<resource>.<action>_denied_permission` etc.

   Use `denied_*` and `target_not_found` suffixes (past tense, matches the catalogue's convention) rather than `attempted_*` — the event is "we denied this," not "they tried."

2. **Service-method wrapper.** Two options:
   - **Inline try/catch in each method** — explicit, matches the audit metadata exactly to the failure path. Verbose if many methods need it.
   - **Higher-order wrapper** — a `withAuditedFailure(eventTypeMap, fn)` helper that runs `fn`, catches typed errors, maps `ForbiddenError → *.delete_denied_permission`, `ConflictError → *.delete_denied_invariant`, etc., emits, then re-throws. Concise; one wrapper per service method.

   Prefer the higher-order wrapper unless the metadata between cases differs enough that inline catch reads better.

3. **Tests.** For each service method add a case-per-failure-path test that asserts the right denied-event is emitted before the error propagates. Existing service.spec.ts shape adapts directly.

4. **Audit-on-failure caveat — `withServiceRole` itself can fail.** If the audit emit fails (DB transient, etc.), the rule "fire-and-forget on failure path" applies: catch + log via Sentry once Day-9 SDK init lands; don't let the audit failure mask the original error.

**Surfaced:** Confirmed by Love during C-21 review on 27 April 2026, deferred to a follow-up commit. The current code's gap is documented in `src/modules/identity/service.ts`'s leading comment: "no audit event is emitted on the denied path (the typed error is the visible signal — a future PR can add a denied-event to the audit vocabulary if forensic visibility is wanted there)."

**Day-4 update (2026-04-29):** S-2 (PR #28) extends the same gap to SuiteFleet auth. `src/modules/integration/providers/suitefleet/auth-client.ts` throws `CredentialError` on every failure path — 401 (creds invalid), other 4xx, 5xx-after-retry, network-after-retry, malformed body, past-dated expiration — and emits no audit event for any of them. Login/refresh failures are forensically invisible: an attacker probing the SuiteFleet auth surface, or a tenant whose creds rotated out from under us, leaves no fingerprint. Apply the §2 wrapper pattern when this follow-up lands. Suggested vocabulary: `suitefleet.login_denied_credentials` (401), `suitefleet.login_failed_unreachable` (network-exhausted), `suitefleet.login_failed_server_error` (5xx-exhausted), `suitefleet.refresh_denied_credentials`, `suitefleet.refresh_failed_unreachable`. Note tense: "denied" for client-side rejections (401/403/422); "failed" for upstream-unavailable (5xx, network) — keeps the existing audit-vocabulary convention.

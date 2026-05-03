---
name: D8-8 Tier-2 mismatch 401 path — auditEmit awaited before response (latency observation candidate)
description: D8-8's Tier-2 credential mismatch path awaits auditEmit before returning the 401 response. Acceptable today (try/catch ensures audit failure doesn't block the 401), but if production observes elevated p99 latency on 401s, the optimisation is fire-and-forget with the catch logging the audit failure. Surfaced by counter-reviewer at D8-8 PR #86 close as a non-blocking observation. Production-observation candidate, NOT a bug.
type: project
---

# D8-8 Tier-2 mismatch 401 path — auditEmit await latency observation

**Surfaced:** 3 May 2026 (D8-8 PR #86 counter-review close)
**Source:** Counter-reviewer observation #1 at D8-8 merge approval — flagged for post-merge observation, not for the D8-8 PR itself.

---

## The pattern in question

[`src/app/api/webhooks/suitefleet/[tenantId]/route.ts`](../src/app/api/webhooks/suitefleet/[tenantId]/route.ts) Tier-2 mismatch branch (the `if (!verification.ok)` block):

```ts
try {
  await auditEmit({
    eventType: "webhook.auth_failed",
    actorKind: "system",
    actorId: "system:webhook_receiver",
    tenantId,
    requestId,
    metadata: { failure: "creds_mismatch", tenant_id: tenantId, header_keys_present: headerKeysPresent },
  });
} catch (err) {
  // non-blocking error path
}
return new Response(null, { status: 401 });
```

The `await auditEmit(...)` precedes the 401 response. Audit emit involves a `withServiceRole` transaction + a single INSERT into `audit_events` — typically <50ms but variable depending on DB load.

## Why it's acceptable today

- **Try/catch ensures audit failure doesn't block the 401.** Even if the audit pipeline is down, the response still goes back to SF.
- **Tier-2 mismatch is a low-frequency path.** Production merchants who configure credentials are the only path that exercises this branch; mismatches require both the merchant to opt in AND an attacker (or operator-side credential drift) to attempt the call. The bcrypt check itself dominates the wall-clock cost (~50-100ms intentional) anyway.
- **Pilot scale is small.** No paged on-call, no SLO on 401 latency. If the audit emit takes 30ms, the 401 returns in ~80-130ms — well within any reasonable SF retry tolerance.
- **Forensic value of the audit row is load-bearing.** A fire-and-forget pattern adds a small but real chance the audit row never lands (process killed mid-emit on a serverless cold-shutdown). Awaiting guarantees the row exists before SF gets the 401.

## When to flip to fire-and-forget

The optimisation is justified when:

- **Production p99 latency on 401 paths exceeds a threshold** (e.g. 500ms baseline drift, or any incident where SF retry windows interact with 401-path latency). Set up a Sentry / Vercel-analytics dashboard query for `auth_tier=tier_2_failed` request durations once D8-8 has 7+ days of production traffic.
- **Audit emit pipeline becomes a hot path elsewhere.** If audit-table contention surfaces in unrelated incidents, fire-and-forget on this path reduces one back-pressure source.
- **Tier-2 traffic grows substantially.** If P4 (admin UI) lands and operators heavily configure credentials, Tier-2 mismatch volume rises and the cumulative await-latency cost compounds.

## Implementation if/when triggered

```ts
// Replace the await + try/catch block with:
void auditEmit({
  eventType: "webhook.auth_failed",
  actorKind: "system",
  actorId: "system:webhook_receiver",
  tenantId,
  requestId,
  metadata: { failure: "creds_mismatch", tenant_id: tenantId, header_keys_present: headerKeysPresent },
}).catch((err) => {
  requestLog.error({
    operation: "audit_emit",
    tenant_id: tenantId,
    error_code: "audit_emit_failed",
    message: err instanceof Error ? err.message : "unknown",
  });
  captureException(err, {
    component: "suitefleet_webhook_receiver",
    operation: "audit_emit",
    tenant_id: tenantId,
    request_id: requestId,
  });
});
return new Response(null, { status: 401 });
```

The change is a 1-line removal of `await` + try/catch wrapping inverts to a `.catch(...)` chain. Test impact: the existing "audit failure non-blocking" test stays valid; one assertion on emit-call ordering may need adjustment.

T2 commit when triggered. Surface this memo at PR open as the upstream rationale.

## Cross-references

- D8-8 PR #86 — the source PR + counter-review thread
- `memory/followup_d8_8_webhook_auth_model.md` — the auth-model reshape that anchored D8-8
- `src/app/api/webhooks/suitefleet/[tenantId]/route.ts` — the file the optimisation would touch
- `src/modules/audit/event-types.ts` — `webhook.auth_failed` event registration

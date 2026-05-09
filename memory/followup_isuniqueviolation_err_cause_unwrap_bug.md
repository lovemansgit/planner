---
name: isUniqueViolation err.cause unwrap bug — webhook handler dedup path dead
description: Day-19 morning — applyWebhookStatusEvent / applyWebhookEditEvent isUniqueViolation only checks err.code, but postgres.js sql.begin() wraps the inner PostgresError so err.code is undefined and err.cause.code === '23505'. Catch fails → throw rethrows → duplicate replays 500 instead of returning {applied: false, reason: 'duplicate'}. Demo-blocker for A2 production smoke.
type: project
---

# isUniqueViolation err.cause unwrap bug — webhook handler dedup path dead

## §1 Surfaced

Day-19 morning T1 audit_events column fix-up (`day19/t1-audit-events-occurred-at`) re-ran the two affected integration specs after the 5 `created_at` → `occurred_at` substitutions. Result: 10 of 12 tests green; 2 fail with `PostgresError: duplicate key value violates unique constraint "webhook_events_dedup_idx"` thrown OUT of the handler instead of caught:

| Spec | Test | Line |
|---|---|---|
| `tests/integration/webhook-status-event-applied.spec.ts` | `"duplicate event returns reason='duplicate', no double-write to webhook_events or audit"` | 155 |
| `tests/integration/webhook-edit-event-applied.spec.ts` | `"duplicate edit-event replay returns reason='duplicate'"` | 333 (approx; call site at :335) |

These are NOT cascade from the column-name bug. The 5 column substitutions are correct; the previously-failing tests now reach assertion stage and pass. These two are a pre-existing, independent failure that PR #200's CI also exhibited (per Day-18 EOD §6.1 + bootstrap brief §4.1 caveat).

## §2 Hypothesis

Production handlers wrap the INSERT inside a `try/catch` keyed on `isUniqueViolation`:

- `src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts:99-186` (try/catch); `:221-225` (`isUniqueViolation`).
- `src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts:189` (catch site); `:443-446` (`isUniqueViolation`).

Both `isUniqueViolation` implementations are identical:

```ts
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}
```

The vitest trace shows `Caused by: PostgresError: duplicate key value violates unique constraint "webhook_events_dedup_idx"` — the `Caused by` framing implies `postgres.js`'s `sql.begin()` (called by `withTenant` at `src/shared/db.ts:124`) wraps the inner `PostgresError` before it exits the transaction scope. The outer error has `err.cause.code === '23505'` while `err.code` is undefined; `isUniqueViolation` returns `false` → `throw err` rethrows.

The dedup-detection code path is therefore dead in production.

## §3 Production impact

Any duplicate webhook replay (SF retry, double-fire, manual replay) returns 500 to the receiver instead of `{applied: false, reason: "duplicate"}`. Two demo-relevant consequences:

1. **A2 production smoke (Day-19 carry §6.1)** — if the smoke triggers a redelivery (path (b) Aqib-initiated test event re-fired, or path (a) SF redelivery during transient network failure), the receiver 500s and the smoke fails on a path orthogonal to the actual handler logic.
2. **Steady-state pilot operations** — SF retries on its own schedule; first duplicate after any production webhook lands as a 500 + Sentry alert + `webhook_events` row missing for the duplicate (because the catch never runs to record it as a deduped no-op).

## §4 Diagnostic next step

5-min spike before fix:

1. Add a deliberate-INSERT-twice harness (sandbox spec or one-off node script) that calls `applyWebhookStatusEvent` twice on the same `(tenant_id, awb, action, event_timestamp)`.
2. Inside the catch, log `err.code`, `err.cause?.code`, `err.cause?.constructor?.name`, `err.constructor?.name`, and `JSON.stringify(err, null, 2).slice(0, 500)`.
3. Confirms which of:
   - **(a) Widen `isUniqueViolation`** to walk the `err.cause` chain — fix is a 5-line shared helper landing in both handlers.
   - **(b) `postgres.js` / `drizzle-orm` wrapper config gap** — investigate whether the wrapper is configurable to surface the original `code` on the top-level error; may require a small `withTenant` adapter change.

Hypothesis (a) is far more likely (single one-line widening); (b) is the alternative if `postgres.js` is wrapping aggressively and unwrapping at the `withTenant` boundary is more idiomatic.

## §5 Cross-references

- `src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts:99-186` — try/catch wrapping the `withTenant` block; `:221-225` — `isUniqueViolation` implementation.
- `src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts:189` — catch site mirroring status handler; `:443-446` — duplicate `isUniqueViolation` implementation.
- `src/shared/db.ts:124` — `withTenant` wrapper using `postgres.js sql.begin`.
- `tests/integration/webhook-pod-received.spec.ts` — bootstrap brief §4.1 flagged this as a separate failing test on PR #200 CI; likely same root cause (its own duplicate-replay or 23505-adjacent path). Verification deferred to spike step 1.
- `memory/plans/day-18-a2-webhook-handler-3-layer.md` §10 step 7 — A2 production smoke gated on this fix landing if smoke path includes any redelivery.
- `memory/handoffs/day-18-eod.md` §6.1 — Day-19 carry-forward for A2 smoke.

## §6 Sequencing

T2 fix PR opens AFTER the T1 column-name PR (`day19/t1-audit-events-occurred-at`) merges. Sequence:

1. T1 column-name PR merges (5 substitutions only).
2. Diagnostic spike (5 min) confirms hypothesis (a) vs (b).
3. T2 fix PR — widen `isUniqueViolation` (or adapter fix), add a regression spec covering duplicate replay shape, re-run all 3 webhook integration specs (`status-event`, `edit-event`, `pod-received`) green.
4. Vercel preview verification (no production migration required — runtime-only change).
5. THEN A2 production smoke per A2 plan §10 step 7.

Estimated total: 30-45 min for spike + fix + tests; smoke remains 30-45 min on top.

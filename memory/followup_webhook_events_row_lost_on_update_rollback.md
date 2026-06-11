# Followup · `webhook_events` row lost on `UPDATE` rollback

**Filed:** Day-28 webhook code-PR open. **Status:** NOT load-bearing for any active lane. Post-demo cleanup. Out of scope for the Day-28 inbound-webhook two-bug fix lane per plan PR #294 §8.1 + Day-28 EOD §G locked decision (§8.1-§8.4 OUT OF SCOPE).

**Site:** `src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts:103-198` — the entire `withTenant(...)` transaction.

## Mechanism

The `applyWebhookEditEvent` flow opens one `withTenant(tx, ...)` transaction wrapping **both** the forensic `webhook_events` INSERT (lines 105-115) and the downstream `tasks` UPDATE (lines 372-376). If the UPDATE throws (e.g., concurrent modification, FK violation under race, transient Postgres error), the entire tx rolls back — including the `webhook_events` row INSERTed at the top.

**Net effect:** when the apply path fails mid-tx, **no forensic record remains** that SF ever delivered the payload. The receipt is lost.

This is in contrast to the existing structured-return outcomes (`task_not_found`, `no_diff`, `duplicate`, `payload_validation_failed`) which return from inside the tx without throwing → tx commits → `webhook_events` row preserved. The gap is specifically the throw-and-rollback path (UPDATE failure, audit-emit failure inside tx, etc.).

## Why it matters

The audit ledger relies on `webhook_events.raw_payload` as the canonical record of what SF actually sent. When the apply path silently rolls back, an operator inspecting the audit history sees no trace of the failed delivery — they cannot reconstruct what SF tried to send, debug the failure, or replay manually.

## Why it's NOT this lane

- The Day-28 two-bug fix targets correctness of the apply path itself (Bug 1: snake_case extraction; Bug 2: `changedFields` overload). The forensic-row-on-failure question is a structurally separate concern.
- §3.6 reviewer locked §8.1 as OUT OF SCOPE for the Day-28 lane (plan PR #294 + EOD §G).
- Scope creep here would risk re-opening locked decisions on tx boundaries.

## Candidate fixes for the future lane

1. **Move `webhook_events` INSERT outside the apply tx.** A separate forensic-only tx writes the receipt; the apply tx writes the task UPDATE + emits the audit event. Trade-off: orphan `webhook_events` rows if subsequent apply tx is never run.
2. **Use a savepoint inside the apply tx around the UPDATE.** Rollback the savepoint on UPDATE failure but commit the outer tx (preserving `webhook_events`). Trade-off: requires Postgres SAVEPOINT semantics + structured outcome on caught-and-released UPDATE errors.
3. **Catch + re-emit pattern.** Wrap the UPDATE in try/catch inside the tx; on failure, write a structured `webhook_events.apply_failed = true` marker column + return a new outcome reason (`apply_failed_preserve_receipt`). Trade-off: new schema column + new outcome reason + need to define semantics for "we received but failed to apply."

## Sequencing

Post-demo (Monday 18 May 2026 sandbox demo). Likely Day-31+ alongside other post-demo §H cleanups from Day-27 EOD (webhook_events policy narrowing, defensive-depth RULEs, view-grant cleanup).

## Cross-references

- [`memory/plans/day-28-inbound-webhook-edit-apply-fix.md`](plans/day-28-inbound-webhook-edit-apply-fix.md) §8.1 — original surfacing in the plan-PR.
- [`memory/handoffs/day-28-eod.md`](handoffs/day-28-eod.md) §G — locked-decision restatement.
- [`memory/followup_inbound_webhook_edit_apply_two_bugs.md`](followup_inbound_webhook_edit_apply_two_bugs.md) — the parent two-bug followup; this memo is a sibling, not a child.

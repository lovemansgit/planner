# Inbound SF webhook edit-apply: two compounding bugs (`delivery_date` dropped + misleading audit)

**Filed:** Day-27 (15 May 2026) EOD-addendum, late-PM (Session B revised mechanism, post-discipline-driven re-diagnose).
**Status:** **NOT load-bearing** for any currently active lane. Post-demo T3 reconciliation lane. The Aqib API-key auth-header followup (`memory/followup_aqib_api_key_auth_header_pending.md`) remains the load-bearing pointer; this memo is filed-but-deferred. Zero overlap with outbound push path → demo-safe.
**Discovery anchor:** AWB **DMB-99123608**. Operator changed delivery date `2026-05-25 → 2026-06-01` in the SuiteFleet OpsPortal late Day-27 PM. SF emitted an outbound webhook to Planner; Planner emitted a `task.edit_applied_via_webhook` audit row at `01:50:28`; the task's `delivery_date` column did not advance.

## Headline

Two **distinct bugs** in `src/.../apply-webhook-edit-event.ts`. They compound: each one alone would produce a clean failure mode (one writes nothing without auditing; one audits without writing). Together they produce the worst of both — the audit ledger records "edit applied" while zero task columns move. The two bugs are independently fixable but mutually masking — fixing only Bug 1 would leave Bug 2's misleading audits in place; fixing only Bug 2 would still leave the date silently dropped.

## Mechanism — Session B's revised root-cause (after discipline-driven re-diagnose)

### Bug 1 — `apply-webhook-edit-event.ts:247` reads snake_case against SF camelCase

The line extracts the new delivery date from the webhook root with `root.delivery_date`. SF's outbound payload uses camelCase (`deliveryDate`). The field reference resolves to `undefined`; the date is silently dropped from the extracted shape. The `changedFields`-from-data computation therefore sees no date change in the payload and does not append a date entry.

### Bug 2 — `apply-webhook-edit-event.ts:306-311` unconditionally pushes an address audit-only entry with `previous:null`

Lines 306-311 push a `{ field: 'address', previous: null, ... }` entry into `changedFields` for **every** webhook regardless of whether the payload contains an address change. The hard-coded `previous:null` means the entry contributes **zero to the DB UPDATE block** (no column to update) — but it tips a downstream array into non-empty.

The `changedFields` array is overloaded across **four distinct responsibilities** in the same code path:

| Responsibility | What it's used for | Effect of the address-only entry |
|---|---|---|
| (a) DB UPDATE field list | Which columns to write | Zero (entry has no real previous→new transition) |
| (b) Audit-emit field list | Which fields to mention in the audit row | One (the address mention rides along, harmless on its own) |
| (c) `no_diff` gate input | Skip the whole flow if the array is empty | Flipped from empty → non-empty (gate passes) |
| (d) `outcome.applied` flag input | Whether to fire `task.edit_applied_via_webhook` audit | Flipped from `not_applied` → `applied` |

Decoupling these four responsibilities is the structural fix.

### Compounded effect

1. Webhook arrives with date change (`deliveryDate: '2026-06-01'`).
2. Bug 1: `root.delivery_date` reads `undefined` → `changedFields`-from-data has no date entry.
3. Bug 2: lines 306-311 push the unconditional address entry → `changedFields` is `[{ field: 'address', previous: null, ... }]`.
4. `no_diff` gate (c): array length > 0 → gate passes → flow continues.
5. DB UPDATE block (a): iterates `changedFields`; the only entry has `previous: null` and no real column mapping → SET clause is empty → `UPDATE tasks SET WHERE id = ...` either silently no-ops or short-circuits before issuing → `delivery_date` stays at `2026-05-25` and `updated_at` does not advance.
6. Audit emit (b)+(d): the array is non-empty → outcome is `applied` → `task.edit_applied_via_webhook` audit row fires with the address mention in metadata.

Net: audit ledger says "edit applied"; DB says "no edit applied". The two narratives are inconsistent.

## Four-fact reconciliation

The discipline-driven re-diagnose was forced by an audit-events confirming read whose result falsified the initial single-bug hypothesis. The four production facts that any candidate root-cause must explain together:

| # | Fact | Initial hypothesis (Bug 1 alone → `no_diff` silent-exit) | Two-bug compounded mechanism |
|---|---|---|---|
| 1 | Operator changed delivery date `2026-05-25 → 2026-06-01` in SF OpsPortal for AWB DMB-99123608 | explained (input fact) | explained (input fact) |
| 2 | `audit_events` table shows 3 rows for the AWB, the third being a `task.edit_applied_via_webhook` row at `01:50:28` (initial hypothesis predicted only 2 rows with no `edit_applied` for this attempt) | **CONTRADICTED** — `no_diff` silent-exit branch does not emit an audit row | explained — Bug 2 inflates the array, gate (c) passes, outcome (d) is `applied`, audit emits |
| 3 | `tasks.delivery_date` in DB is still `2026-05-25` (not `2026-06-01`) | explained — date never extracted | explained — Bug 1 drops the date AND Bug 2's entry has `previous:null` so no column moves |
| 4 | `tasks.updated_at` did not advance after the webhook | explained | explained — same reason as fact 3 (no `SET` clause produced) |

**Only the two-bug compounded mechanism reconciles all four facts.** The initial hypothesis was falsified at fact 2 by the confirming read.

## Plan-PR scope (post-demo T3 lane)

Four scope items, ordered. Items 1 + 2 are the runtime fix; item 3 is the historical-data reconciliation; item 4 is the type-system hardening to prevent regressions.

1. **Line-247 read fix.** Change `root.delivery_date` to `root.deliveryDate`, OR route the extraction through the codebase's existing webhook-payload camelCase normalization helper (if one exists; if not, file as a sub-item under scope 4). Verify by integration spec replaying a real SF outbound-edit-event payload and asserting `tasks.delivery_date` advances.

2. **`changedFields` decoupling — split the array into four discrete signals.** Replace the single overloaded array with four typed values: (a) `columnsToUpdate` (driving the SET clause), (b) `auditMetadataFields` (driving the audit row's `metadata.changed_fields`), (c) `hasAnyChange` (driving the `no_diff` gate), (d) `wasApplied` (driving the outcome flag). Bug 2's address-only push then flows ONLY into (b) — it cannot inflate (a)(c)(d). This is the design surface that makes Bug 2 a T3 lane (not T2): audit-integrity decisions are involved. §3.6 review required pre-implementation.

3. **Audit-ledger historical-integrity reconciliation.** Rows of `task.edit_applied_via_webhook` filed during the buggy window may record `applied` for edits that applied nothing. The 0002 RULE on `audit_events` (`audit_events_no_update`, `audit_events_no_delete`) blocks direct mutation; reconciliation must use the same append-only pattern as a correction. Two possible approaches: (i) emit a new `task.edit_applied_via_webhook.correction` event for each affected row carrying the corrected `outcome: not_applied` flag (Day-26-pattern: superseded-by pointer); (ii) emit a single bulk `audit_integrity.reconciled` event with the affected_row_ids array. Decide at plan-PR time. **Scope to identify:** SQL query to find affected rows — `audit_events` rows where `event_type = 'task.edit_applied_via_webhook'` AND the corresponding `tasks.updated_at` does NOT match the audit's `occurred_at` (proxy for "audit fired but no column moved"). Possibly cross-referenced with `tasks_history` if it exists.

4. **`Date | string` hardening.** SF payload date fields arrive as ISO strings; internal types may expect `Date` instances. The mishandling at the type boundary contributed to Bug 1 not being caught earlier (`undefined.toISOString()`-style errors would have failed loudly; silent `undefined` propagation did not). Consolidate webhook-payload date parsing through a single validated path (Zod parser with explicit `string()` → `transform(parseISO)`; reject non-ISO inputs at the boundary). Co-files with the codebase's existing webhook-payload normalization layer if present.

## Cross-references

- [Day-27 EOD §H item 12](handoffs/day-27-eod.md) — carry-forward row that captures this memo's existence at the EOD level.
- [Single-diagnostic-surprise discipline followup](followup_single_diagnostic_surprise_discipline.md) — **this bug's diagnosis is the discipline memo's first live application.** Session B presented an initial confident root-cause (Bug 1 alone → `no_diff` silent-exit → no audit); the reviewer required the audit-events confirming read per the just-filed discipline; the read diverged from prediction (3 audit rows incl. an `edit_applied`, not 2 with none); re-diagnosis produced the two-bug compounded mechanism in §"Mechanism" above. The discipline filed that same morning prevented a T2 fix being scoped against a falsified premise.
- `src/.../apply-webhook-edit-event.ts:247` — Bug 1 site.
- `src/.../apply-webhook-edit-event.ts:306-311` — Bug 2 site.
- AWB `DMB-99123608` — the behavioural anchor that surfaced the divergence.

## What's NOT in scope for this memo

- **Outbound SF push path.** Entirely separate code path (`task-push/service.ts`, `auth-client.ts`); zero overlap. Outbound path is the demo flow.
- **Materialization cron.** Separate code path that writes the initial task row; not involved in the edit-apply flow.
- **Operator-driven exception edits.** UI-driven path (`subscription-exceptions` service); separate code path.
- **The `task.edit_received_via_webhook` event** (the receive-side audit upstream of the apply-side `edit_applied` event). Reception is correct; only the apply-side is buggy.

## Demo positioning

Both bugs sit in the inbound webhook-apply path only. The demo flow runs on the outbound push path (sandbox-region: create merchant → consignee → subscription → cron materialization → outbound push to SF sandbox) which never enters this code. The bugs do not affect any demo-narrative surface. They DO affect Planner's audit-ledger fidelity for inbound SF-originated edits, which is a real correctness concern — but post-demo.

---

**End of memo. Awaits post-demo plan-PR per the 4 scope items above.**

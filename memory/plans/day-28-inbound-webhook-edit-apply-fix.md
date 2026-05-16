# Day-28 plan-PR — inbound SF webhook edit-apply: two-bug fix

**Filed:** 2026-05-16 (Day-28). **Lane tier:** T3 (the `outcome.applied` semantic in Item 2 is the genuine design surface). **Plan-PR scope:** docs only (this file). **Eventual code-PR scope:** three items, single PR, fix-forward only.

**Status:** AWAITING §3.6 reviewer review on this plan-PR. T3 hard-stop #1 is this plan-PR's §3.6.

---

## §1 — Lane entry conditions + locked constraints

**Lane entry.** Love (product owner) opened this lane Day-28 AM. Demo has moved to Monday May 18. Sandbox smoke checks 5 / 5b / 6 are green; production-region credentials lane is externally blocked on Aqib's API-key auth-header reply (per [`memory/followup_aqib_api_key_auth_header_pending.md`](../followup_aqib_api_key_auth_header_pending.md)). Demo-readiness work exhausted on the Planner side. The post-demo-deferred inbound-webhook two-bug lane is opened as the Day-28 substantive work — superseding the Day-27 EOD-addendum "fix-forward only, NOT opening" carry-forward hold per Love's product-owner override.

**Working state.**

- Main HEAD `fe65d47` at lane open.
- Brief on main: v1.15. **No amendment forced by this lane** — no schema change, no public-API change, no audit-event-vocabulary change under the recommended X-set in §4.
- Production LIVE at `dpl_J7zoFC2zv8CKLbMMkksQxfNfwA8F` on `planner-olive-sigma.vercel.app`. Schema reconciled to v1.15-intended. **This lane does not require any schema migration, env change, or Vercel re-promote.**

**Locked constraints (restated from the reviewer-scoped prompt; do not deviate).**

1. **Established ground truth.** The two-bug mechanism documented at [`memory/followup_inbound_webhook_edit_apply_two_bugs.md`](../followup_inbound_webhook_edit_apply_two_bugs.md) is the working diagnosis — re-diagnosed via the single-diagnostic-surprise discipline ([`memory/followup_single_diagnostic_surprise_discipline.md`](../followup_single_diagnostic_surprise_discipline.md), PR #293) on Day-27 PM-late, confirmed by a four-fact reconciliation. **This plan builds ON that mechanism. It does not re-derive it.** If anything in the code contradicts the documented mechanism, the lane STOPS and surfaces to the reviewer. See §2 below for the read-the-code transparency note (precision delta only, not a contradiction).

2. **Fix-forward only (locked Day-27 EOD-addendum).** **No historical replay, no ledger reconciliation, no correction of already-affected audit rows.** Affected rows are demo/test data slated for clearing. The 4-item original scope from the early version of the followup memo is REDUCED TO THREE. This plan does not propose any backfill / replay / correction. §9 of this plan restates this in full.

3. **Three scope items, no scope creep.** The lane's scope is the three items the memo defines + Day-27 EOD §H item 12: (1) line-247 extraction fix, (2) `changedFields` four-responsibility decoupling + `outcome.applied` semantic definition (the DECISION NEEDED surface — §4 of this plan), (3) `Date | string` strict-equality hardening. **No self-tier-escalation.** Anything I found outside these three is surfaced as an open question in §8 — not folded into scope unilaterally.

4. **Integration spec at code-PR open** (Day-23 §F discipline) for the changed extraction path. §6 of this plan enumerates which integration specs the eventual code-PR carries.

5. **§3.6 review gates everything.** Plan-PR §3.6 (this PR) is T3 hard-stop #1. Code-PR §3.6 is T3 hard-stop #2. Integration spec runtime confirmation is T3 hard-stop #3.

**Lane out-of-scope (already documented; restated for clarity):**

- Outbound SF push path. Entirely separate; demo flow.
- Materialization cron. Separate.
- Operator-driven exception edits. Separate.
- The `task.edit_received_via_webhook` event. Reception is correct; only apply-side is buggy.

---

## §2 — Established two-bug mechanism (cited, not re-derived)

Cite: [`memory/followup_inbound_webhook_edit_apply_two_bugs.md`](../followup_inbound_webhook_edit_apply_two_bugs.md) §"Mechanism — Session B's revised root-cause."

**Bug 1 — `src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts:247`.** `delivery_date: pickString(root.delivery_date)` reads snake_case against an SF payload that uses camelCase (`deliveryDate`). Every other extraction in the same function (lines 248-258) correctly reads camelCase. **Line 247 is the lone snake_case read.** The result is `undefined`; the date is silently dropped from the extracted shape.

**Bug 2 — `src/.../apply-webhook-edit-event.ts:303-312`.** The `computeChangedFields` function pushes `{ field: 'address', previous: null, new: location }` into the `changedFields` array whenever `root.consignee.location` is present in the payload — empirically every SF TASK_HAS_BEEN_UPDATED webhook on production. The hard-coded `previous: null` is a forensic "we observed an address but didn't apply it" marker per the Day-18 plan §4.3 Option (ii) ruling.

**Four responsibilities the `changedFields` array carries — and where they are coupled in the actual code:**

| # | Responsibility | Source-line site | Effect of the address-only entry |
|---|---|---|---|
| (a) | DB UPDATE column list | line 172 filters `changedFields` → `columnChanges` excluding `field === 'address'`; line 173 short-circuits if `columnChanges.length === 0` | **Already decoupled.** Address-only entries do NOT cause UPDATE to fire. |
| (b) | Audit-emit `metadata.changed_fields` field list | line 181 + `emitEditAppliedAudit`'s `meta.changedFields` consumer at line 460 | The address entry rides along in metadata (harmless on its own). |
| (c) | `no_diff` gate input | line 161 (`changedFields.length === 0`) | The address entry inflates array length from 0 → 1; gate passes. |
| (d) | `outcome.applied` flag input | lines 184-191 (`applied: true` set when we reach this point post-gate) | Outcome is `applied: true`; downstream audit emit at line 200-202 fires. |

**Four facts reconciled** (from AWB DMB-99123608, Day-27 PM-late production reads):

1. Operator changed `delivery_date 2026-05-25 → 2026-06-01` in SF OpsPortal. **Input fact.**
2. `audit_events` shows 3 rows including a `task.edit_applied_via_webhook` at `01:50:28`. **Explained:** Bug 2 inflates `changedFields` → gate (c) passes → outcome (d) is `applied` → audit (b) emits.
3. `tasks.delivery_date` still `2026-05-25`. **Explained:** Bug 1 drops the date from `extracted`; Bug 2's address-only entry contributes zero to (a) via the existing line-172 filter; no UPDATE is issued.
4. `tasks.updated_at` did not advance. **Explained:** Same as fact 3 — no UPDATE ran.

### §2.1 — Mechanism precision note for the §3.6 reader (not a contradiction)

The followup memo's prose description of step 5 reads "SET clause is empty → `UPDATE tasks SET WHERE id = ...` either silently no-ops or short-circuits before issuing." The actual code's no-op path is slightly tighter: line 172 filters out the address entry → `columnChanges` is `[]` → line 173 (`columnChanges.length > 0`) is false → `applyConditionalUpdate` is **never called**. **The UPDATE is never issued at all.**

Net outcome (no column change, no `updated_at` advance) is **identical** to the memo's framing. The four-fact reconciliation holds. **This precision delta is surfaced for §3.6 transparency — to demonstrate the code has been read carefully — and is not actionable.** The memo does not need amendment (mechanism stands; only the step-5 prose could be sharpened in a future cleanup). Per the locked constraint #1, this is precision, NOT re-diagnosis.

**Discovery anchor.** AWB DMB-99123608. The four facts above come from production audit/DB reads against this AWB, Day-27 PM-late. The integration spec replays a sanitized version of this payload as its primary regression case (§6 spec I1).

---

## §3 — Item 1: line-247 extraction fix

**Site:** `src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts:247`.

**Current code:**

```ts
delivery_date: pickString(root.delivery_date),
```

**Fix (literal level):**

```ts
delivery_date: pickString(root.deliveryDate),
```

**One-key change at the extraction site.** All other extractions in the same function already read camelCase (`deliveryStartTime`, `deliveryEndTime`, `recipientName`, ...). Line 247 is the lone snake_case read; the fix brings it into alignment.

**Helper-routing question raised by the followup memo.** The memo asks whether the extraction should "route through the codebase's existing webhook-payload camelCase normalization helper, if one exists." **It does not exist** in this file or in the providers/suitefleet directory. The eventual code-PR introduces a Zod parser at the boundary as part of Item 3 (§5 below); that parser becomes the typed shape Item 1's extraction reads from. After Item 3, the extraction line reads from a `z.infer`'d type where `deliveryDate` is the declared field — **a future snake_case typo would not compile.** This is the strongest mechanism against Bug-1-class regressions: not "fix the typo," but "make the typo a compile error."

**Sequencing implication.** If only Item 1's literal one-key fix lands (Items 2 + 3 skipped), Bug 1 is fixed but Bug 2 still produces misleading "edit_applied" audits on no-op webhooks (since the column would now move in the date-change case but every webhook would still flip `outcome.applied = true` via the address-only entry). This is why the lane is one PR (per §7), not three.

---

## §4 — Item 2: `changedFields` decoupling + `outcome.applied` semantic — **DECISION NEEDED**

This is the lane's one genuine design surface and the reason the lane is T3 (not T2).

### §4.1 — The four responsibilities, decoupled

Replace the single overloaded `changedFields: ChangedField[]` with four typed values, each driving exactly one responsibility:

| New value | Type | Drives | Source |
|---|---|---|---|
| `columnsToUpdate` | `readonly ChangedField[]` (non-address only) | (a) DB UPDATE column list — feeds `applyConditionalUpdate` directly; no filter step | Field-by-field `diffField` / `diffNumeric` results, address explicitly excluded |
| `auditMetadataFields` | `readonly ChangedField[]` (column moves PLUS optional address mention) | (b) Audit-emit `metadata.changed_fields` | `columnsToUpdate` + the optional address audit-only entry |
| `hasAnyChange` | `boolean` | (c) `no_diff` gate (current line 161) | Derived from `columnsToUpdate` and/or address presence per the DECISION below |
| `wasApplied` | `boolean` | (d) `outcome.applied` flag (current lines 184-191) | Derived per the DECISION below |

Bug 2 then flows ONLY into `auditMetadataFields` (responsibility (b)). It cannot inflate `columnsToUpdate` (a), it cannot flip `hasAnyChange` from false to true (c), and it cannot flip `wasApplied` from false to true (d) — **regardless of whether the address entry is present in the payload.**

Conceptual code shape (not yet implementation):

```ts
const columnMoves    = diffAllColumns(row, extracted);    // 12 column diffs; excludes address
const addressMention = extractAddressMention(payload);    // optional; previous:null per §4.3 Option (ii)

const columnsToUpdate     = columnMoves;
const auditMetadataFields = addressMention
  ? [...columnMoves, addressMention]
  : columnMoves;
const hasAnyChange        = /* DECISION — see §4.2 */;
const wasApplied          = columnsToUpdate.length > 0;   // independent of address mention
```

### §4.2 — DECISION NEEDED: semantic definition of `outcome.applied` + the `no_diff` gate

The followup memo's stated direction is: **"`applied` MUST mean '≥1 column actually moved on the row,' not '≥1 entry was in the `changedFields` array.'"** That phrasing settles `wasApplied` (responsibility (d)). It leaves two coupled sub-decisions for the reviewer.

**Sub-decision X — what does `outcome.applied: false` look like when only an address mention rode along but no columns moved?**

- **X.A.** Return the existing `{ applied: false, reason: 'no_diff' }`. The `no_diff` reason vocabulary expands to mean "no column moved" (which subsumes "no diff" since a no-diff payload also has no column moves). **Simplest.** No new reason vocabulary.
- **X.B.** Introduce a new reason `'address_audit_only'`. Operators see a distinct outcome for "we saw an address but didn't apply it." **More forensic detail at the outcome surface.** Touches the return-type union at lines 42-48; no public-API change (this is a service-internal return shape).
- **X.C.** Same as X.A but introduce a separate audit event `task.address_observed_via_webhook` for the address-only case. **Richest forensic model.** Touches `src/modules/audit/event-types.ts` (new event-type vocabulary). The audit-event count is currently 9 per `project_brief_audit_event_count_correction.md`; X.C bumps it to 10 — **brief amendment likely required** if §3.1.2's event count is enumerated.

**Recommendation: X.A.** Matches the memo's stated direction. Smallest blast radius. The forensic signal "SF told us about an address but we didn't apply it" is **already preserved** in `webhook_events.raw_payload` (the JSONB column populated unconditionally at lines 105-115). Operators can recover the address mention from the webhook_events row whenever they need it. Adding a new outcome reason or a new audit event would be additive UX value that does not solve a correctness problem. If a future lane wants richer surface, that's a follow-on lane; X.A leaves room for it without prejudicing the choice.

**Sub-decision Y — should `auditMetadataFields` include the address mention even when no columns moved?**

This only matters in worlds where `task.edit_applied_via_webhook` still emits with an address-only payload. Under any of X.A / X.B / X.C with `wasApplied = false`, **the audit row does not emit at all** in the address-only case → sub-decision Y is moot. Under X.C the new `task.address_observed_via_webhook` event carries the address in its own metadata. **Sub-decision Y collapses under any choice of X** — `task.edit_applied_via_webhook` only emits when `wasApplied = true`, and its `metadata.changed_fields` then contains the column moves plus (optionally) the address mention if it rode along with a real column edit. No separate Y decision needed.

**Sub-decision Z — what does `hasAnyChange` (responsibility (c), the `no_diff` gate input) test against?**

The current `no_diff` gate at line 161 tests `changedFields.length === 0`. Post-decoupling, two candidates:

- **Z.A.** `hasAnyChange = columnsToUpdate.length > 0`. Address-only entries return early at the `no_diff` gate (or `address_audit_only` under X.B). No UPDATE attempted. `webhook_events` row already preserves the receipt; audit emit is gated by `wasApplied`.
- **Z.B.** `hasAnyChange = columnsToUpdate.length > 0 || hasAddressMention`. Address-only entries do NOT return `no_diff` — flow continues past the gate. But `applyConditionalUpdate` is still not called (because `columnsToUpdate.length === 0`), and the audit emit is still gated by `wasApplied`. **Net behaviour is identical to Z.A except for the outcome reason.** Z.B exists only if X.B is chosen and we want `applied: false, reason: 'address_audit_only'` to be the path the flow takes — which requires not short-circuiting at the `no_diff` gate.

**Z.A and X.A together yield the smallest fix surface.** Z.B and X.B together yield the richer-vocabulary surface.

### §4.3 — Recommendation bundle

**Recommend X.A + Z.A.** Minimal vocabulary expansion. Audit-ledger fidelity restored — `task.edit_applied_via_webhook` only emits when DB actually moves. Bug 2 cannot reoccur — the four-responsibility decoupling means address mentions cannot inflate `wasApplied` regardless of array contents. Address forensics preserved in `webhook_events.raw_payload`.

**The DECISION NEEDED is** the reviewer's pick between {X.A, X.B, X.C} (and, if X.B is chosen, between Z.A and Z.B). All three Xs are defensible; X.A is the smallest surface and matches the followup memo's stated direction. **I am not unilaterally locking — surfacing for the §3.6 ruling.**

### §4.4 — Why this is T3 and not T2

The line-247 fix alone is a T1-T2 typo fix. What makes the lane T3 is sub-decision X: the **semantic definition of `outcome.applied` is a forensic-ledger contract** that future code paths (and potentially other webhook event types in `event-types.ts`) inherit. Locking it once at §3.6 is the right altitude. T2 would commit reviewer attention to the diff alone and miss the contract decision. Per the no-self-tier-escalation rule, surfacing the tier rationale here for §3.6 confirmation; if the reviewer rules this is T2, the X-decision still must be locked pre-implementation.

---

## §5 — Item 3: `Date | string` strict-equality hardening

### §5.1 — The mechanism the followup memo flags

SF payload date fields arrive as ISO strings; internal `extractEditFields` reads them as `string | undefined` via `pickString` (lines 247-258). Postgres `date` columns return as `YYYY-MM-DD` strings via drizzle (`TaskRow.delivery_date: string | null`, line 213). The `diffField` helper at line 317-326 compares with `current === incoming`.

**The risk surface:**

- **R1.** SF sends `'2026-06-01'`, DB has `'2026-06-01'` → strict equality works. **Common case, fine.**
- **R2.** SF sends `'2026-06-01T00:00:00Z'` (ISO datetime variant), DB has `'2026-06-01'` → strict equality is false → falsely registers as a change → falsely UPDATEs. With Bug 2 still in place, also flips into the misleading-audit failure mode.
- **R3.** SF sends `'2026-06-01T08:00:00+04:00'` (timezone offset), DB has `'2026-06-01'` → same risk as R2; timezone semantics also become silent.
- **R4.** The boundary is silent: a non-ISO input would not throw — `pickString` accepts any string. The propagated `undefined` (Item 1's Bug 1 failure mode) is also silent. **Loud type errors at the boundary are the structural defense.**

### §5.2 — Fix approach: introduce a Zod parser for the TASK_HAS_BEEN_UPDATED payload

Add a `webhookEditPayloadSchema` Zod schema at the suitefleet provider boundary. The schema:

- Declares all 12 tracked camelCase fields (`deliveryDate`, `deliveryStartTime`, ..., `completionLongitude`) plus the optional `consignee.location` shape.
- Constrains date fields to `z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()`. **Non-`YYYY-MM-DD` strings are rejected at parse time** — loud failure, not silent. This addresses R2 / R3 / R4 in one move: ISO datetime variants and timezone-offset strings throw at the boundary; the rest of the function never sees them.
- Constrains time fields similarly (`HH:MM:SS` regex; reject anything else).
- Constrains numeric fields (`completionLatitude`, `consigneeRating`, etc.) to `z.number()`.
- `safeParse` at the entry of `extractEditFields` so a malformed payload returns a typed failure rather than crashing the webhook handler (see §5.3).

**Equality comparison post-parser.** With the regex-constrained shapes, `current === incoming` on `YYYY-MM-DD` strings is correct: both sides are guaranteed to be in the same canonical form. **No need for `dateFns.isEqual` or epoch-ms compare.** The structural defense (the regex at parse time) does the work that runtime equality logic would otherwise carry.

This is a deliberate **lighter-weight choice than the followup memo's suggestion** ("Consolidate webhook-payload date parsing AND equality comparison through a single validated path (Zod parser with explicit `string()` → `transform(parseISO)`; reject non-ISO inputs at the boundary; equality comparison via `dateFns.isEqual` or epoch-ms compare, not `===`)"). The memo's parseISO + isEqual path works but is heavier than needed: if the boundary rejects non-canonical date forms, runtime equality is trivial string equality and the codebase doesn't gain a date-arithmetic dependency in this code path. **Calling this trade-off out for §3.6 in case the reviewer prefers the memo's heavier path.** Defaulting to the lighter regex-constrained approach.

### §5.3 — Sub-item: a new outcome reason `payload_validation_failed`?

If `safeParse` rejects, what does the function return? Two options:

- **A.** `{ applied: false, reason: 'payload_validation_failed' }` — new outcome reason, distinct telemetry signal. Touches the return-type union at lines 42-48 (additive). **Symmetric with existing `'task_not_found'` / `'duplicate'` / `'wrong_action'` / `'no_diff'` vocabulary.**
- **B.** Throw — the SF webhook receiver catches at the upstream layer and emits a `webhook_events` row with a quarantine flag (if that path exists; **needs verification** — I have not traced the upstream handler in this plan).

**Recommendation: A.** Smallest blast radius; observable via the outcome enum without disrupting the upstream layer's contract. The `webhook_events` row is still preserved (the INSERT at lines 105-115 happens before parsing under the current code; the eventual code-PR sequences parser-after-insert or parser-before-insert per the §3.6 reviewer ruling on this minor ordering question).

Flagged for §3.6 ruling alongside the X-set decisions in §4. If the reviewer prefers B, the implementation has additional discovery work in the upstream handler (a §8.3-tracked open question).

---

## §6 — Test plan: unit + integration coverage per item

### §6.1 — Unit tests (vitest)

| # | Item | Test |
|---|---|---|
| U1 | Item 1 + 3 | `webhookEditPayloadSchema.safeParse({ deliveryDate: '2026-06-01' })` → `{ success: true }`; extracted shape has `delivery_date: '2026-06-01'`. |
| U2 | Item 1 + 3 | `safeParse({ delivery_date: '2026-06-01' })` (snake_case key) → `delivery_date` field is `undefined` in the parsed shape, codifying "we only read camelCase." (Behaviour depends on Zod strict mode — strict rejects unknown keys; lenient ignores them. §3.6 to lock the strict-vs-lenient posture.) |
| U3 | Item 3 | `safeParse({ deliveryDate: '2026-06-01T00:00:00Z' })` → `{ success: false }` (ISO datetime variant rejected by the date regex). |
| U4 | Item 3 | `safeParse({ deliveryDate: 'not-a-date' })` → `{ success: false }`. |
| U5 | Item 2 | `computeChangedFields(rowUnchanged, extractedUnchanged, payloadWithAddressOnly)` → `columnsToUpdate = []`, `auditMetadataFields = [addressEntry]`, `wasApplied = false`. |
| U6 | Item 2 | `computeChangedFields(row, extractedWithDateChange, payloadWithAddress)` → `columnsToUpdate = [dateChange]`, `auditMetadataFields = [dateChange, addressEntry]`, `wasApplied = true`. |
| U7 | Item 2 | `computeChangedFields(rowUnchanged, extractedUnchanged, payloadNoAddress)` → `columnsToUpdate = []`, `auditMetadataFields = []`, `wasApplied = false`; outcome is `no_diff`. |

### §6.2 — Integration tests (vitest with real Postgres per Day-23 §F discipline)

The code-PR opens with these specs **already passing** — Day-23 §F integration-spec-at-PR-open is non-negotiable for any new SQL path.

| # | Spec | Scenario | Asserts |
|---|---|---|---|
| **I1** | DMB-99123608 regression | Replay sanitized real-payload (date change `2026-05-25 → 2026-06-01` + `consignee.location` present) against a seeded test task | After apply: `tasks.delivery_date = '2026-06-01'`, `tasks.updated_at` advanced, `audit_events` has **exactly one** `task.edit_applied_via_webhook` row with `metadata.changed_fields` containing the date change + address mention. |
| **I2** | Address-only no-op | Replay payload with only `consignee.location` present (no column changes) | After apply: `tasks.delivery_date` unchanged, `tasks.updated_at` unchanged, **zero** `task.edit_applied_via_webhook` rows emitted (under X.A), outcome is `{ applied: false, reason: 'no_diff' }`, `webhook_events` row preserved. |
| **I3** | True no-diff | Replay payload with all 12 fields matching current row state | After apply: outcome is `{ applied: false, reason: 'no_diff' }`, no audit row, no UPDATE, `webhook_events` row preserved. |
| **I4** | Payload validation failure (Item 3) | Send payload with `deliveryDate: '2026-06-01T00:00:00Z'` | Outcome is `{ applied: false, reason: 'payload_validation_failed' }` (under §5.3 Option A), `webhook_events` row preserved, no audit row, no UPDATE, structured warning log emitted. |

**Day-23 §F minimum-required for code-PR open:** I1 + I2. I3 is a regression seatbelt. I4 is Item 3's hardening confirmation. **All four ride in the code-PR opening commit.**

---

## §7 — Sequencing — recommend single T3 code-PR, three staged commits

**Recommendation: ONE code-PR, three commits.**

- **Commit 1:** Item 3 — introduce `webhookEditPayloadSchema` + the `safeParse` boundary + the `payload_validation_failed` outcome reason. **Establishes the typed shape Items 1 and 2 read from.** Unit tests U1, U3, U4. Integration test I4.
- **Commit 2:** Item 1 — change `root.delivery_date` to the parsed-shape `deliveryDate` field. **One-key change** against the parsed shape (no longer against `rawPayload` directly). Unit test U2. Integration test I1 (assertion on `tasks.delivery_date` advancing).
- **Commit 3:** Item 2 — decouple `columnsToUpdate` / `auditMetadataFields` / `hasAnyChange` / `wasApplied` per the §3.6 ruling on the X-set. Unit tests U5, U6, U7. Integration tests I1 (now asserting the audit row's `metadata.changed_fields` shape), I2, I3.

**Rationale for single PR over three small PRs:**

1. **The bugs are compound.** Reviewer §3.6 verifies the compound fix as a whole — Bug 1 fixed AND Bug 2 fixed AND no new failure mode introduced by the interaction. Splitting into three PRs trades reviewer attention for nothing.
2. **Commit 3 depends on Commit 1's parser shape.** Splitting means follow-on PRs rebase on the prior, with merge churn against any concurrent work.
3. **§3.6 can still drill into individual commits** if the reviewer wants — staged commits preserve the per-item review surface within a single PR.

**Hard-stops (T3):**

- **#1 (current).** This plan-PR's §3.6 — particularly the X-set decision in §4.2 + the §5.2 light-vs-heavy date-parser trade-off + the §5.3 outcome-reason recommendation.
- **#2.** Code-PR §3.6 review pre-merge — verifies the X-set decision was implemented as locked, the four responsibilities are cleanly decoupled, and the integration specs are present + passing.
- **#3.** Integration spec runtime confirmation — the code-PR's CI must show I1-I4 passing against a real test-database before merge.

**Effort estimate.** ~1 day single-session execution (matches the followup memo's revised estimate). Code change is small; reviewer time on the §4 design decision is the gating factor.

---

## §8 — Open questions (NOT folded into scope; surfaced for §3.6 ruling)

Items found while reading the code that are NOT in the locked 3-item scope. Per the no-self-tier-escalation rule and no-scope-creep constraint, **surfacing — not folding.**

### §8.1 — `webhook_events` row preservation under partial-apply rollback

The `webhook_events` INSERT (lines 105-115) and the `tasks` UPDATE (lines 372-376) are inside one `withTenant` tx — if the UPDATE throws, **both roll back together.** Net effect: **no forensic `webhook_events` row preserved on UPDATE failure.** The receipt is lost.

Is this intended? The comment block at lines 17-18 says "Idempotency posture matches Layer 2 (plan §3.4): UNIQUE catches SF retries; structured return on duplicate." It doesn't speak to UPDATE-failure forensics.

**Recommendation: OUT OF SCOPE for this lane.** File as a separate followup memo. The two bugs we're fixing are correctness on the apply path; the forensic-row-on-failure question is a different shape of issue. §3.6 to confirm.

### §8.2 — Audit emit happens outside the tx (lines 200-202)

`emitEditAppliedAudit` runs **after** the tx commits. If it fails (e.g., audit-emit backend is down), the `tasks` UPDATE is already committed without the corresponding audit row → audit-ledger inconsistency in the opposite direction from Bug 2 (write occurred, no audit). This is documented elsewhere as a codebase-wide post-tx best-effort pattern; flagging here because Item 2's `wasApplied` semantic touches the same audit-emit decision surface.

**Recommendation: OUT OF SCOPE for this lane.** Filing as a flag so the §3.6 reviewer confirms the post-tx pattern is in fact the intended design and not something to revisit alongside Item 2's contract decision.

### §8.3 — `safeParse` failure: structured-return vs throw-and-quarantine

§5.3 of this plan recommends a new `'payload_validation_failed'` outcome reason (Option A). The alternative — throw and let the upstream webhook handler catch with a quarantine flag — depends on a quarantine-flag path in the receiver that **I have not verified exists.** If §3.6 prefers Option B (throw), the implementation has additional discovery work in the upstream handler (the receiver code path).

**Recommendation: surface to §3.6.** Reviewer picks A vs B. Plan defaults to A.

### §8.4 — Mechanism precision delta (§2.1 footnote)

Documented above in §2.1. The followup memo's step-5 prose says "SET clause is empty"; the actual code's no-op path is via the explicit line-172 filter + line-173 length-guard. **Net outcome identical**; the four-fact reconciliation holds.

**Recommendation: not actionable.** Surfacing only for §3.6 transparency that the code has been read with care. The followup memo does not need amendment — the mechanism stands; only the step-5 prose could be sharpened in a future cleanup pass that is **not this lane's work.**

---

## §9 — Fix-forward only: no historical reconciliation

**Locked, restated for the §3.6 record:**

- This lane introduces **NO migration, NO query, NO script, NO backfill, NO replay, NO correction of already-affected audit rows.**
- All `task.edit_applied_via_webhook` audit rows that exist on production today and were emitted during the buggy window remain as-recorded. They will be cleared via the planned demo/test-data cleanup (Day-27 EOD §H item 4, the 501-orphan-tenants integration-test-residue cleanup), **not via this lane.**
- Post-fix, `task.edit_applied_via_webhook` correctly reflects "≥1 column actually moved on the row" (under the recommended X.A + Z.A in §4.3). The historical ledger remains misleading for the pre-fix window; this is accepted per the Day-27 EOD-addendum reviewer ruling at [`memory/followup_inbound_webhook_edit_apply_two_bugs.md`](../followup_inbound_webhook_edit_apply_two_bugs.md) top-of-memo.
- The 501-orphan-tenants cleanup is a separate post-demo lane; it will incidentally clear most/all of the affected audit rows when the residue tenants are deleted. **This lane does not depend on that cleanup, nor does it block on it.**

**Anything that smells like "let's also fix the historical record" — even softly — is OUT OF SCOPE.** If a §3.6 review surfaces a felt need to reconcile the historical ledger, the response is "no; it's demo/test data slated for clearing per the Day-27 reviewer ruling." This is the locked posture.

---

End of plan. Awaiting §3.6 reviewer review on the four surfaced decisions: §4.2 X-set (the central one), §5.2 light-vs-heavy date-parser trade-off, §5.3 outcome-reason A-vs-B, and §6.1 U2 Zod strict-vs-lenient. Plus the four open questions in §8 (all recommended OUT OF SCOPE; §3.6 to confirm).

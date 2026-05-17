# Day-29 plan-PR — inbound SF webhook edit-apply: null-tolerance regression fix

**Filed:** 2026-05-17 (Day-29). **Lane tier:** T2 (mechanical 8-leaf schema relaxation; no design surface, no architectural decision). **Plan-PR scope:** docs only (this file). **Eventual code-PR scope:** one source file + one integration test file, fix-forward only.

**Status:** AWAITING §3.6 reviewer review on this plan-PR. T2 hard-stop is this plan-PR's §3.6.

---

## §1 — Lane entry conditions + locked constraints

**Lane entry.** Love (product owner) ruled REGRESSION CONFIRMED on Day-29 AM after the Day-29 forensic of the two cancel-twin `webhook_events` rows (a402bae8, 197b1af0) + 10 historical real production `TASK_HAS_BEEN_UPDATED` raw_payloads, all 12 structurally identical. The Monday May 18 demo plank "edit on SuiteFleet → live sync to Planner" is currently BROKEN on production `1a7da84`: every real date-edit will hit the same `payload_validation_failed` outcome the two cancel-twins did, because the all-null `deliveryInformation` block SF emits is universal across cancel and edit shapes, not a cancel-only quirk.

**Working state.**

- Origin/main HEAD `1a7da84` at lane open (production-live `dpl_2F11ck2jyo5f4sH8wY69oogv6jm5` on `planner-olive-sigma.vercel.app`).
- Brief on main: v1.15. **No amendment forced by this lane** — no schema change, no public-API change, no audit-event-vocabulary change, no audit-event-count change. Pure leaf-tolerance widening on a Zod boundary parser.
- This lane does **not** require any schema migration, env change, or Vercel re-promote beyond the code-PR's standard build+deploy.

**Locked constraints (restated from the reviewer-scoped prompt; do not deviate).**

1. **Established ground truth.** REGRESSION mechanism is precisely identified and proven from 12 real production `webhook_events` raw_payloads (10 historical pre-`cc811d8` + 2 post-`cc811d8` cancel-twins). All 12 carry a fully-populated `deliveryInformation` object whose 8 leaves are JSON `null` for any not-yet-delivered task — `recipientName: null, signature: null, consigneeRating: null, consigneeComment: null, driverComment: null, numberOfAttempts: null, completionLatitude: null, completionLongitude: null`. **This plan builds ON that mechanism. It does not re-derive it.**

2. **The fix is "extend the existing nullish pattern to its 8 siblings," not a redesign.** The asymmetry is the proof: `failureReasonComment` in the same schema is already declared `.nullable().optional()` and correctly passes for every payload; the other 8 leaves are declared `.optional()` only and reject the same null shape. The minimal coherent change is to match the existing intra-file idiom on the 8 siblings.

3. **Fix-forward only (Day-27 EOD-addendum precedent, reaffirmed for this lane).** No historical replay, no ledger reconciliation, no correction of the audit rows the two cancel-twins generated (they are forensic markers in `webhook_events` already — the cancel path applied correctly via `applyWebhookStatusEvent`; the TASK_HAS_BEEN_UPDATED twin returning `payload_validation_failed` is the only side-effect of the regression, and that outcome is itself a non-mutating log entry). §9 below restates.

4. **No scope widening.** The lane's scope is exactly: 8 schema leaves change from `.optional()` to `.nullable().optional()`; the corresponding 8 extractor lines coerce `null → undefined` (mechanical type-correctness tagalong); one regression fixture pinned in the integration test suite. **No date-format changes, no strip-posture changes, no refactor of the #298 C3 changedFields decouple, no touching the inbound dedup UNIQUE.** Anything outside is surfaced as an open question in §9 — not folded.

5. **§3.6 review gates merge.** Plan-PR §3.6 (this PR) is T2 hard-stop. The code-PR carries its own §3.6 review pre-merge.

**Lane out-of-scope (already documented; restated for clarity):**

- Outbound SF push path. Entirely separate; Session B's §D(2) skip-path work is in flight on a different branch; this lane must not collide.
- Date/time regex strictness on `deliveryDate` / `deliveryStartTime` / `deliveryEndTime`. CLEAN in all 12 real payloads (`YYYY-MM-DD` and `HH:MM:SS` respectively); not the problem; do not touch.
- The Zod strip-posture on root + `deliveryInformation` (plan #294 §6.1 U2 lenient-on-unknown-keys). Already correctly shipped; nothing to change.
- The `consignee.location` passthrough (`.passthrough()`). Correctly captures full SF location object for audit metadata; nothing to change.
- The #298 C3 `changedFields` four-responsibility decouple (`columnsToUpdate` vs `auditMetadataFields`). Verified correct via the Day-28 integration tests; nothing to change.
- The `webhook_events` UNIQUE-constraint shape (no `tenant_id` in UNIQUE — Day-29 Phase-1 forensic flagged this for awareness, separate post-demo item).

---

## §2 — Proven mechanism (cited, not re-derived)

**Cite.** Day-29 Phase-1.5 forensic Session A report; raw_payload corpus pulled by Love from production `webhook_events` table (10 historical pre-`cc811d8` `TASK_HAS_BEEN_UPDATED` rows + 2 post-`cc811d8` cancel-twins at `id IN ('a402bae8-1082-42b3-adf1-b55b267f84e5', '197b1af0-a1b4-4477-9d16-c4a0771b8736')`).

**The empirical observation.** Every one of the 12 real SF `TASK_HAS_BEEN_UPDATED` raw_payloads carries `deliveryInformation` as a fully-populated object — not absent, not partial — with the following 8 leaves set to JSON `null` whenever the task is not yet delivered:

```json
{
  "deliveryInformation": {
    "recipientName": null,
    "signature": null,
    "consigneeRating": null,
    "consigneeComment": null,
    "driverComment": null,
    "numberOfAttempts": null,
    "failureReasonComment": null,
    "completionLatitude": null,
    "completionLongitude": null
  }
}
```

**The parser rejection.** In `src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts` lines 58–68 at SHA 1a7da84, the schema:

```ts
const deliveryInformationSchema = z.object({
  recipientName: z.string().optional(),
  signature: z.string().optional(),
  consigneeRating: z.number().optional(),
  consigneeComment: z.string().optional(),
  driverComment: z.string().optional(),
  numberOfAttempts: z.number().optional(),
  failureReasonComment: z.string().nullable().optional(),
  completionLatitude: z.number().optional(),
  completionLongitude: z.number().optional(),
});
```

Zod `.optional()` admits `T | undefined`. An explicit JSON `null` is a PRESENT value at the wire-format level (`"recipientName": null` is not the same as omitting the key); `null` is not `undefined` from Zod's perspective. Each of the 8 non-nullable leaves raises `invalid_type` (expected=string/number, received=null). **8 null leaves → exactly the observed `zod_issue_count=8`.** `failureReasonComment` is already `.nullable().optional()` and correctly passes — that asymmetry is the proof the fix is structurally trivial.

**The downstream effect.** `safeParse` fails → `payload_validation_failed` outcome → no task UPDATE issued → `tasks.delivery_date` does not advance → audit emit skipped. The receiver still 200s (per-event isolation in `processWebhookAsync`), so SF does not retry, and the edit is silently lost on the Planner side. This is the exact failure pattern for both cancel-twins and would replay identically for any real Monday date-edit.

**Fields that are CLEAN in all 12 payloads** (so DO NOT touch their schema constraints):

- `deliveryDate` — `YYYY-MM-DD` in every payload; matches `ISO_DATE_REGEX` `/^\d{4}-\d{2}-\d{2}$/`.
- `deliveryStartTime` / `deliveryEndTime` — `HH:MM:SS` 24h in every payload; matches `HMS_TIME_REGEX` `/^\d{2}:\d{2}:\d{2}$/`.
- `consignee.location.*` — already passthrough; not part of the 8-issue tally.
- `failureReasonComment` — already `.nullable().optional()`.

---

## §3 — Exact change

**File touched (source):** `src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts` — ONE file.

### §3.1 — Schema (8 lines)

**Site:** lines 59–67 (the `deliveryInformationSchema` block). Line 65 (`failureReasonComment`) is the reference idiom and is NOT touched.

**Before:**

```ts
// line 59
  recipientName: z.string().optional(),
// line 60
  signature: z.string().optional(),
// line 61
  consigneeRating: z.number().optional(),
// line 62
  consigneeComment: z.string().optional(),
// line 63
  driverComment: z.string().optional(),
// line 64
  numberOfAttempts: z.number().optional(),
// line 66
  completionLatitude: z.number().optional(),
// line 67
  completionLongitude: z.number().optional(),
```

**After (8 lines):**

```ts
// line 59
  recipientName: z.string().nullable().optional(),
// line 60
  signature: z.string().nullable().optional(),
// line 61
  consigneeRating: z.number().nullable().optional(),
// line 62
  consigneeComment: z.string().nullable().optional(),
// line 63
  driverComment: z.string().nullable().optional(),
// line 64
  numberOfAttempts: z.number().nullable().optional(),
// line 66
  completionLatitude: z.number().nullable().optional(),
// line 67
  completionLongitude: z.number().nullable().optional(),
```

**Pattern source.** Existing line 65: `failureReasonComment: z.string().nullable().optional(),`. The change replicates this exact ordering — `.nullable()` before `.optional()` — across all 8 siblings. **No new pattern introduced.**

### §3.2 — Extractor coercion (8 lines, mechanical tagalong)

After §3.1, `di?.recipientName` is typed `string | null | undefined`. The `ExtractedFields` interface at lines 310–323 declares each corresponding field as `string | undefined` / `number | undefined`. **TypeScript will fail to compile without per-field null-coercion.** The minimal, idiom-matching change is to mirror line 344's existing handling of `failureReasonComment` (`di?.failureReasonComment ?? undefined`) across the 8 siblings.

**Site:** lines 336–346 in `extractEditFields` (line 344 is the reference idiom and is NOT touched).

**Before:**

```ts
// line 336
    recipient_name: di?.recipientName,
// line 337
    signature: di?.signature,
// line 338
    consignee_rating: di?.consigneeRating,
// line 339
    consignee_comment: di?.consigneeComment,
// line 340
    driver_comment: di?.driverComment,
// line 341
    number_of_attempts: di?.numberOfAttempts,
// line 345
    completion_latitude: di?.completionLatitude,
// line 346
    completion_longitude: di?.completionLongitude,
```

**After (8 lines):**

```ts
// line 336
    recipient_name: di?.recipientName ?? undefined,
// line 337
    signature: di?.signature ?? undefined,
// line 338
    consignee_rating: di?.consigneeRating ?? undefined,
// line 339
    consignee_comment: di?.consigneeComment ?? undefined,
// line 340
    driver_comment: di?.driverComment ?? undefined,
// line 341
    number_of_attempts: di?.numberOfAttempts ?? undefined,
// line 345
    completion_latitude: di?.completionLatitude ?? undefined,
// line 346
    completion_longitude: di?.completionLongitude ?? undefined,
```

**Why `?? undefined` and not something else.** Identical to line 344. Preserves the existing "field absent → leave column alone" semantic at the `diffField` boundary (line 384: `if (incoming === undefined) return;`). A null from SF is interpreted as "field not yet captured by SF" — semantically equivalent to absence; not as a directive to nullify the Planner-side column. This is the only interpretation consistent with the SF wire shape (every not-yet-delivered task has these as null) and the existing `failureReasonComment` handling.

**Comment update (1 line, optional cleanup).** The comment at lines 342–343 currently reads "Zod schema allows null for failureReasonComment; coerce null → undefined to preserve 'field absent' semantics for diffField." After §3.1 this is true for 9 fields, not just one. **Recommend updating this comment to reflect the now-uniform handling**, or extracting it as a header note above the `extractEditFields` body. This is a comment-only tweak, not a behavior change; surfaced as an OPEN QUESTION in §9 so the reviewer rules.

### §3.3 — Total change summary

- **Source LOC churn:** 16 lines edited (8 schema + 8 extractor), all in one file.
- **Net semantic change:** Zod parser now accepts `null` in addition to `undefined` / string / number for the 8 non-`failureReasonComment` `deliveryInformation` leaves. Downstream behavior is identical to "field absent" — the column is not written, the diff is not recorded.
- **No new functions, no new types, no signature changes, no API changes.**

---

## §4 — Preservation list (explicit non-touch confirmation)

Per reviewer's locked-scope rule, the following surfaces are UNCHANGED by this lane. Each is explicitly named so the §3.6 reader can verify no accidental drift:

| Surface | Lines (1a7da84) | Status |
|---|---|---|
| Root `webhookEditPayloadSchema` strip-posture (default Zod object, unknown root keys silently dropped) | 70–76 | UNCHANGED — plan #294 §6.1 U2 stays |
| `deliveryInformationSchema` strip-posture (default Zod object on the inner schema, unknown sub-keys silently dropped) | 58–68 (the object itself, not its leaves) | UNCHANGED |
| `consigneeSchema` / `consigneeLocationSchema.passthrough()` (audit-metadata richness) | 53–56 | UNCHANGED |
| `ISO_DATE_REGEX` for `deliveryDate` | 56 | UNCHANGED — all 12 payloads clean |
| `HMS_TIME_REGEX` for `deliveryStartTime` / `deliveryEndTime` | 57 | UNCHANGED — all 12 payloads clean |
| `failureReasonComment: z.string().nullable().optional()` (already correct; idiom source) | 65 | UNCHANGED |
| `failure_reason_comment: di?.failureReasonComment ?? undefined` (already correct; idiom source) | 344 | UNCHANGED |
| `extractEditFields` function signature + `ExtractedFields` interface shape | 310–323, 325 | UNCHANGED — interface declares `T \| undefined`; per-field coercion in §3.2 keeps this contract intact |
| `computeChangedFields` (`#298 C3` decouple: `columnsToUpdate` vs `auditMetadataFields`) | ~195–225 | UNCHANGED — Day-28 #298 fix is correct and out of scope |
| `applyConditionalUpdate` / `EXTRACTED_COLUMN_NAMES` / `buildSetFragment` | ~395–470 | UNCHANGED |
| Receiver path (`src/app/api/webhooks/suitefleet/[tenantId]/route.ts`) — dispatch, verification, per-event isolation | entire file | UNCHANGED |
| `webhook_events` migration / UNIQUE constraint | `supabase/migrations/0018_webhook_events.sql` | UNCHANGED (the no-`tenant_id`-in-UNIQUE flag from Phase-1 forensic is a separate post-demo item) |
| Audit-event vocabulary (`task.edit_applied_via_webhook` and all siblings) | `src/modules/audit/event-types.ts` | UNCHANGED — brief §3.1.2 audit event count stays at 9 |
| Outbound SF push path | `src/modules/integration/providers/suitefleet/task-client.ts` and adjacent | UNCHANGED — Session B's §D(2) lane, must not collide |

---

## §5 — Blast radius

**Source files touched (1):**

- `src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts` — 16 LOC across §3.1 + §3.2; optional 1-LOC comment tweak per §3.3.

**Test files touched (1):**

- `tests/integration/webhook-edit-event-applied.spec.ts` — append one regression test case (the pinned all-null `deliveryInformation` fixture; see §6).

**Migrations touched:** zero.
**Env changes:** zero.
**Public API changes:** zero.
**Vercel re-promote required:** zero beyond the standard code-PR merge → CI → preview → main deploy.
**Brief amendments forced:** zero.

**Side-channel surfaces not touched but verified inert:**

- `src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts` — different code path, services lifecycle codes (incl. `TASK_STATUS_UPDATED_TO_CANCELED`); confirmed already working via Love's Day-29 cancel-twin observation (`applied: true` on the cancel side).
- `src/modules/integration/providers/suitefleet/webhook-parser.ts` — outer parser unchanged; the inner `webhookEditPayloadSchema` is the only schema this lane modifies.

---

## §6 — Test plan — load-bearing regression fixture

**The gap that hid this bug.** The Day-28 integration suite (`tests/integration/webhook-edit-event-applied.spec.ts`) covers happy-path full-field, address-audit-only, deprecated-field-ignored, wrong-action, no-diff, and idempotent-replay cases. **None of them populate `deliveryInformation` with an all-null leaf-block.** Every existing test that populates `deliveryInformation` does so with non-null values. The bug class — "SF emits PRESENT-and-NULL" — was structurally invisible to the test fixtures. The fix MUST close this gap or the regression can reopen.

### §6.1 — Pinned regression fixture (MANDATORY)

**Source.** A VERBATIM real SuiteFleet `TASK_HAS_BEEN_UPDATED` payload from the 12-row corpus pulled by Love during the Day-29 Phase-1.5 forensic. Recommended pin: **AWB DMB-17621675 / 2026-05-19 / clean ORDERED edit** (per reviewer's named candidate). This payload's `deliveryInformation` is the canonical present-and-all-null shape.

**Where the fixture lives.** Inlined into `tests/integration/webhook-edit-event-applied.spec.ts` as a frozen JSON object literal under a new `describe.it` block. The fixture is sanitized minimally (PII fields like `recipientName` are already null in the source payload, so no PII redaction is needed; only the AWB and any tenant identifiers are remapped to the test's `AWB_*` / `TENANT` constants per the existing pattern at lines 37–47).

**Fixture identity discipline.**

- The fixture **MUST be VERBATIM** in shape — all 9 `deliveryInformation` leaves present, all 8 non-`failureReasonComment` leaves null (plus `failureReasonComment: null`, total 9 nulls in the original SF payload; the parser must accept all 9).
- A fixture that **omits** `deliveryInformation` does NOT close this gap.
- A fixture that **populates** `deliveryInformation` with non-null values does NOT close this gap (that path is already covered by the Day-28 full-fields test).
- A fixture that **partially** nulls some leaves does not close this gap either — must be all 8 non-`failureReasonComment` leaves null, mirroring the wire-truth shape.
- The fixture comment header MUST cite the source AWB (`DMB-17621675`) and the Day-29 forensic pull as ground truth, so future maintainers know not to "fix the fixture to look more normal."

### §6.2 — Test assertions (the regression test, in full)

The new `it()` block asserts ALL of the following in order against the pinned fixture, replayed through `applyWebhookEditEvent` on real Postgres:

1. **`safeParse` passes.** The schema accepts the all-null `deliveryInformation` block. (Negative-test framing: if §3 is not applied, this assertion fails first and immediately.)
2. **`outcome.applied === true`.** The `delivery_date` change in the payload drives a non-empty `columnsToUpdate`.
3. **`outcome.changedFieldCount === 1`.** Exactly one DB column moves (`delivery_date`); the 8 null leaves do NOT contribute to `columnsToUpdate` because the extractor coerces them to `undefined` and `diffField` short-circuits on `undefined`.
4. **`tasks.delivery_date` moved** to the payload's `deliveryDate` value (pre-test snapshot vs post-test SELECT).
5. **`tasks.updated_at` advanced** strictly past the pre-test snapshot.
6. **None of the 8 nullable columns (`recipient_name`, `signature`, `consignee_rating`, `consignee_comment`, `driver_comment`, `number_of_attempts`, `completion_latitude`, `completion_longitude`) moved** — pre-test value === post-test value for each. This is the load-bearing safety assertion: the null-leniency widening must NOT cause the parser to overwrite Planner columns with `null`.
7. **`audit_events` row emitted** with `event_type = 'task.edit_applied_via_webhook'` and `metadata.changed_fields` containing exactly one entry: `field='delivery_date', previous=<old>, new=<new>`. The 8 null leaves do NOT appear in `metadata.changed_fields` (since `diffField` short-circuits on `undefined` before the `push`).
8. **`webhook_events` row inserted** with the verbatim raw payload preserved (forensic discipline).

**Negative regression check (one additional it-block recommended, low cost):** replay the same fixture twice in sequence; second call must return `{ applied: false, reason: 'duplicate' }` via the existing `isUniqueViolation` catch. Confirms the fix didn't accidentally route around the dedup gate. (This is a sanity check; if the existing idempotency test in `webhook-edit-event-applied.spec.ts` already covers replay against an all-non-null fixture, the all-null replay is a strict superset — surface as OPEN QUESTION in §9 whether to add the dup-test variant or rely on the existing one.)

### §6.3 — Unit-test layer

No new unit tests required. The schema-only contract is fully exercised by the integration spec above (which runs `safeParse` as its first assertion). A pure-Zod unit test would be duplicative and would risk drifting from the integration spec if the schema is ever moved. **Stay at the integration layer.** Open question in §9 if reviewer disagrees.

---

## §7 — Integration spec assertion (Day-23 §F discipline)

Per Day-23 §F integration-spec-at-PR-open discipline, the code-PR carries the §6.1 fixture + §6.2 assertions as the canonical integration spec for this lane. The spec mirrors the fresh-task live test that will run on stage post-merge:

| Step | Integration spec (CI, real Postgres) | Fresh-task live test (post-merge, production sandbox tenant) |
|---|---|---|
| Setup | Insert tenant + consignee + task with `delivery_date=D0`; AWB matches the pinned fixture's `awb` | Pick a zero-history task on sandbox-region demo tenant per Day-29 Phase-1 §4 SQL; capture pre-test snapshot |
| Trigger | Call `applyWebhookEditEvent(TENANT, buildEditEvent(...), 'TASK_HAS_BEEN_UPDATED')` with the verbatim raw payload (with `deliveryDate=D1`, all 8 `deliveryInformation` leaves null) | Love edits `delivery_date` on the SuiteFleet UI; SF emits the real `TASK_HAS_BEEN_UPDATED` webhook |
| Expect | `outcome.applied=true`, `delivery_date=D1`, `updated_at>pre-test`, 1 audit row, 1 webhook_events row, 8 null-leaf columns untouched | Same — verified via the §6 of the Day-29 Phase-1 report's PASS rubric SQL |

**Equivalence claim.** Because the integration-spec fixture is verbatim from a real SF payload (§6.1), passing the integration spec is necessary AND sufficient evidence that the same payload shape would parse on production. The fresh-task live test then confirms the SF→Planner runtime plumbing end-to-end, completing the diamond.

---

## §8 — Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| The 12-payload corpus is unrepresentative (some other SF edit variant emits a non-null `deliveryInformation` leaf in a way that NOW would unexpectedly write to a column) | Low — corpus spans 10 historical real edits + 2 cancel-twins | The §3.2 `?? undefined` coercion means null leaves cannot write columns; only ACTUAL non-null SF values would. Behavior under non-null is unchanged from #298 (already covered by the Day-28 full-fields test). |
| `failureReasonComment` idiom was wrong all along and we're propagating a bad pattern | Very low | The idiom passes today for the one field that uses it; the `failureReasonComment` column on the existing happy-path tests is correctly handled. Adopting it for 8 siblings is risk-neutral. |
| TypeScript compile breaks because `ExtractedFields` interface needs widening rather than per-field coercion | Zero | §3.2 coerces at the assignment site, leaving the interface contract intact. `pnpm tsc --noEmit` is a CI gate; the code-PR will surface any compile drift immediately. |
| The pinned fixture's AWB (DMB-17621675) is not stable in production beyond the demo cycle and a future maintainer can't trace it back | Low | The fixture is inlined as a literal in the test file (not fetched at runtime); the source-AWB citation is in the fixture comment header. Independent of any production-DB lifecycle. |
| Session B's outbound skip-path lane edits the same file | Zero | Session B's §D(2) lane is on the outbound path (`task-client.ts` / push-side code); this lane is inbound (`apply-webhook-edit-event.ts`). Files do not overlap. Pre-merge rebase will catch any drift. |

---

## §9 — Open questions for the §3.6 reviewer

1. **Comment refresh at lines 342–343.** The existing comment scopes `null → undefined` coercion narrative to `failureReasonComment` only. After §3.1 the same handling is uniform across 9 fields. **Recommend** rewriting the comment as a one-line note above `extractEditFields`'s `return` block: "All `deliveryInformation` leaves are `.nullable().optional()` in the schema; coerce null → undefined here to preserve diffField's 'field absent → leave column alone' semantics." **Alternative:** leave comment as-is (now slightly stale but accurate for line 344 specifically). Builder's recommendation: rewrite as the one-line header. Reviewer rules.

2. **Negative regression check (§6.2 tail).** Add a second `it()` block that replays the all-null fixture twice and asserts `reason='duplicate'` on the second call? Or rely on the existing idempotency test in the same spec (which uses a non-all-null fixture)? Builder's recommendation: add the second `it()` — it is low-cost (~10 LOC) and the only place the all-null shape is exercised against the dedup gate. Reviewer rules.

3. **Unit-vs-integration split for the schema contract.** §6.3 recommends integration-only (no pure-Zod unit test). Reviewer may prefer a thin unit-test surface for the schema itself as a faster-fail signal in CI. Builder's recommendation: integration-only, because the contract is semantically tied to `applyWebhookEditEvent`'s downstream behavior and a unit test could drift independently. Reviewer rules.

4. **Memorialize as followup memo?** A new `memory/followup_inbound_webhook_null_tolerance_regression.md` summarizing the Day-29 forensic + 12-payload corpus + mechanism would make this lane the cited ground truth for any future inbound-webhook schema changes (mirrors the role `followup_inbound_webhook_edit_apply_two_bugs.md` played for #294/#298). Builder's recommendation: yes, in the code-PR (NOT in this plan-PR — keep plan-PR docs-only). Reviewer rules.

5. **Brief amendment.** None forced by this lane (per §1 working state). Confirm: no §3.1.2 audit-event-count change, no schema change, no public-API change, no behavior change visible outside the inbound webhook apply path's tolerance to all-null `deliveryInformation`. **Confirm reviewer agrees no v1.16 amendment.**

**No question on the 8 schema lines themselves** — the mechanism is empirically proven from 12 real payloads; the idiom is already in the same file; the fix is mechanical.

---

## §10 — Code-PR shape (preview, for reviewer's planning)

When the eventual code-PR opens (after §3.6 on this plan-PR):

- **One PR, one commit** (rationale: the schema change and the extractor coercion are inseparable for TypeScript to compile; staging them as two commits would leave `main` red between them).
- **Commit message:** `fix(d29): inbound SF webhook edit-apply — null-tolerance on 8 deliveryInformation leaves (#<N>)`.
- **PR body:** cite this plan doc + the 12-payload corpus + the pinned fixture AWB.
- **CI gates:** `pnpm typecheck`, `pnpm test`, `pnpm test:integration` — the new fixture must surface in `test:integration` output as a PASS.
- **Post-merge:** Vercel auto-deploys; Love runs the Day-29 Phase-1 §4 candidate SQL to pick a fresh sandbox task; Love performs the SF-side delivery_date edit; the fresh-task live test runs against the §7 PASS rubric. **PASS verdict required before Monday demo.**

---

**End of plan.** Awaiting §3.6 ruling.

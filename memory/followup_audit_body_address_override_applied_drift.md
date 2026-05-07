---
name: subscription.address_override.applied — registered metadataNotes drifts from Service-A-shipped emit shape; resolve by updating metadataNotes to match shipped reality
description: Day-16 Block 4-E pre-flight verification surfaced a drift between the registered metadataNotes for subscription.address_override.applied at audit/event-types.ts:663-664 and Service A's actual emit shape at subscription-exceptions/service.ts:564-577 (commit 9f576f9). Three deltas: scope discriminator field, always-populated effective_from (vs branched target_date / effective_from), address_override_id (vs address_id), and a correlation_id field. Resolution per Block 4-E reviewer §A ruling: update registered metadataNotes to match shipped emit. Actual emit is more useful and more honest than the under-spec'd contract; the §A discipline rule from Block 4-D ("registered metadataNotes is the contract") applies asymmetrically — when the contract is under-specified relative to working code, fix the contract.
type: project
---

# subscription.address_override.applied — registered metadataNotes drift

**Surfaced:** Day-16 Block 4-E pre-flight verification (Service E address services).

## §1 The drift — registered vs shipped

| Source | Body shape |
|---|---|
| **Registered `metadataNotes`** at `src/modules/audit/event-types.ts:663-664` (Day-13 PR #139 origin) | `subscription_id (uuid), exception_id (uuid), target_date (YYYY-MM-DD — populated for one-off, null for forward) OR effective_from (YYYY-MM-DD — populated for forward, null for one-off), address_id (uuid)` |
| **Service A actual emit** at `src/modules/subscription-exceptions/service.ts:564-577` (Day-16 commit 9f576f9) | `subscription_id, exception_id, scope: 'one_off' \| 'forward', effective_from (always), address_override_id, correlation_id` |

## §2 Three deltas

1. **`scope` discriminator field** — Service A added a `scope: 'one_off' | 'forward'` field that disambiguates the variant at the audit-row level without requiring a join back to `subscription_exceptions.type`. The registered metadataNotes does not mention it. Useful: forensic queries on `audit_events.metadata->>'scope'` are simpler than joining through to subscription_exceptions.

2. **`effective_from` always-populated vs branched `target_date OR effective_from`** — registered metadataNotes specifies different field names for one_off (`target_date`) vs forward (`effective_from`). Service A always populates `effective_from` regardless of variant, then uses `scope` to discriminate. Simpler emit; aligns with the underlying `subscription_exceptions.start_date` column (which is the same column for both variants per migration 0015).

3. **`address_override_id` vs `address_id`** — registered metadataNotes uses `address_id`; Service A emits `address_override_id` (matches the `subscription_exceptions.address_override_id` column name). Renaming would churn cross-module references; keeping `address_override_id` matches the column-name contract.

4. **(bonus) `correlation_id`** — Service A adds `correlation_id` to the audit body; metadataNotes does not mention it. Consistent with the cross-event correlation pattern from brief §3.1.2 (skip + end_date.extended share correlation_id; address_override.applied + exception.created likewise).

## §3 Resolution per Block 4-E reviewer §A ruling — update metadataNotes to match shipped

The §A discipline rule from Block 4-D ("registered metadataNotes is the contract for audit body shape; plan-text and gate ruling are subordinate") applies asymmetrically:

- When **shipped code drifts from a load-bearing registered contract**, fix the code (e.g., Block 4-D Service C/D Gate 4 → Option C nested).
- When **the registered contract is under-specified relative to working code**, fix the contract.

Service A's actual emit shape is more useful and more honest than the under-spec'd `metadataNotes`:
- `scope` simplifies forensic queries.
- `effective_from`-always aligns with the column-level reality (`subscription_exceptions.start_date`).
- `correlation_id` is consistent with the cross-event correlation pattern.
- `address_override_id` matches the column name.

**Plan-sync amendment:** replace `event-types.ts:663-664` `metadataNotes` text with the actual shipped shape:

```
subscription_id (uuid), exception_id (uuid), scope ('one_off' | 'forward'),
effective_from (YYYY-MM-DD — start_date of the address override),
address_override_id (uuid — references addresses.id), correlation_id (uuid).
```

No code change in Service A; no code change in Block 4-E (Service E thunks delegate to Service A's existing emit unchanged).

## §4 Why Block 4-E does not touch Service A's emit shape

Block 4-E Service E ships `changeAddressRotation` (no audit emit per §10.6 default — rotation is routine config) + extends Service A with cross-consignee address ownership validation (per §B B1 ruling). The emit-shape drift is informational; resolving it requires:
- (a) registry text update at `event-types.ts` — a trivial line replacement, no code-PR-blocking risk
- (b) zero code changes at the emit site

Both belong in the next plan-sync bundle alongside the other 6 followups (5 Service A/B + 1 push-handler header) plus the 2 Block 4-D memos. Plan-sync becomes 9 items.

## §5 Cross-references

- **`src/modules/subscription-exceptions/service.ts:564-577`** — Service A's actual emit (commit 9f576f9; Day-16 Block 4-B)
- **`src/modules/audit/event-types.ts:663-664`** — registered metadataNotes (Day-13 PR #139)
- **`memory/followup_audit_body_vs_plan_text_drift.md`** — sibling Block 4-D memo on `merchant.created` body shape; same §A discipline rule, applied symmetrically (code-fix when contract is load-bearing; this memo is the asymmetric case — contract-fix when code is the better reality)
- **Block 4-E reviewer §A ruling** — Day-16 turn closing Service E pre-flight verification; resolution: update metadataNotes to match shipped, file this memo for plan-sync

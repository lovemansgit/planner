---
name: Merchant lifecycle state-machine expansion (reactivation + suspended-state surface) — Phase 2 bundle
description: Day-16 Block 4-D Service D ships plan-strict per merged plan PR #155 §5.2.2 + §5.2.3 + brief v1.3 §3.1.1 + registered metadataNotes literals (activateMerchant only provisioning → active; deactivateMerchant only active → inactive). Three from-state expansions surfaced during reviewer drafting-order item d / watch item 3 are deferred to Phase 2 as a single coherent lifecycle decision: (1) inactive → active reactivation; (2) suspended → active un-suspend; (3) suspended → inactive deactivation. Phase 2 picker decides them together with brief amendment + audit metadataNotes update + service code in one bundle — they are NOT separable items.
type: project
---

# Merchant lifecycle state-machine expansion — Phase 2 bundle

**Surfaced:** Day-16 Block 4-D Service D pre-flight verification, after reviewer Option C ruling on activate/deactivate state machine.

## §1 Scope — three from-state expansions deferred to Phase 2

Service D MVP ships plan-strict transitions only:
- `activateMerchant`: `provisioning → active` ONLY (all other from-states 409 ConflictError).
- `deactivateMerchant`: `active → inactive` ONLY (all other from-states 409 ConflictError).

Three Phase 2 expansion candidates surfaced during reviewer drafting-order discussion. They are deferred as a single bundle:

1. **`activateMerchant`: `inactive → active`** — operator-driven reactivation of a deactivated merchant. MVP says reactivation is Phase 2 (no UI surface, no Q&A rehearsal coverage in brief §5.4).
2. **`activateMerchant`: `suspended → active`** — un-suspend a previously-suspended merchant. Coupled to brief §3.1.1 reserved-state question.
3. **`deactivateMerchant`: `suspended → inactive`** — deactivate a suspended merchant. Coupled to suspended-state-surface question.

## §2 Why these three are NOT separable

The expansions are coupled at three layers; none can land independently.

### §2.1 Registered audit `metadataNotes` (LOAD-BEARING)

Per reviewer §A discipline rule from Block 4-D Service C turn: *"registered metadataNotes is the contract for audit body shape; plan-text and gate ruling are subordinate."*

- **`merchant.activated`** at `src/modules/audit/event-types.ts:716-717`: `metadataNotes` declares `from_status (literal 'provisioning')`. Any expansion to allow `inactive → active` or `suspended → active` REQUIRES relaxing this literal to a union/enum at the `metadataNotes` level FIRST. Code change without `metadataNotes` update is non-compliant per §A.
- **`merchant.deactivated`** at `src/modules/audit/event-types.ts:728-729`: `metadataNotes` declares `from_status (literal 'active')`. Expansion to allow `suspended → inactive` requires the same literal-to-union relaxation.

The `metadataNotes` field is the registered contract. Audit emits whose body diverges from the registered shape produce a stream-vs-registry drift that downstream forensic queries depend on.

### §2.2 Brief v1.3 §3.1.1 (load-bearing)

Brief §3.1.1 documents `'suspended'` as: *"reserved (part-2 service-surface decision deferred per Day-13 plan §6)."*

The `'suspended'` state has no MVP surface — it cannot be entered, cannot be exited. Adding `suspended → active` or `suspended → inactive` transitions implies the inverse transition (something → suspended) is also a Phase 2 surface decision. The brief amendment that lands "suspended is now operator-reachable" must specify all entry + exit transitions in one pass; piecemeal landing creates a stranded state.

### §2.3 Plan PR #155 §5.2.2 + §5.2.3 (load-bearing)

Plan §5.2.2 explicitly: *"reject 404 if not found OR 409 if `status !== 'provisioning'`"* — `provisioning → active` only.

Plan §5.2.3 explicitly: *"reject 409 if `status !== 'active'`"* — `active → inactive` only.

The plan is not silent. Reviewer's own fallback rule from Block 4-D Service D turn: *"If plan specifies otherwise, follow plan; if silent, default and surface."* Plan-strict wins.

## §3 Phase 2 picker requirements

Whoever picks up the lifecycle expansion in Phase 2 must:

1. **Brief amendment** — extend brief v1.3 §3.1.1 with the full state machine including `'suspended'` entry/exit semantics. Decide whether `'suspended'` is operator-reachable from `'active'` (suspendMerchant fn?) or system-only (e.g., billing-driven). File a `decision_*.md` per brief §10 protocol.
2. **Registered audit `metadataNotes` update** — relax `merchant.activated.metadataNotes` `from_status (literal 'provisioning')` → `from_status (enum: 'provisioning' | 'inactive' | 'suspended')` (or whichever subset the brief amendment authorizes). Same for `merchant.deactivated.metadataNotes`. Optionally introduce a `merchant.suspended` event (registration first, then service code).
3. **Service code update** — relax the `assertCurrentStatus` checks in `src/modules/merchants/service.ts:activateMerchant` + `:deactivateMerchant`. Pre-existing rejected-from-state tests at `src/modules/merchants/tests/service.spec.ts` must be UPDATED (not removed) — the rejected paths become accepted paths; CI catches accidental over-relaxation.
4. **API route layer** — Block 4-F's `/api/admin/merchants/[id]/activate` + `/deactivate` route handlers may need 4xx-error-message updates if the relaxed transitions surface different operator-visible messages.

## §4 What Service D ships in MVP (this commit)

- `activateMerchant(ctx, id)` accepts `provisioning` only → `active`. All other states (active, suspended, inactive) → 409.
- `deactivateMerchant(ctx, id)` accepts `active` only → `inactive`. All other states (provisioning, suspended, inactive) → 409.
- `listMerchants` returns all rows regardless of status — read-only is unaffected.
- Tests cover the rejected-from-state cells explicitly. They're the lock-in for the Phase 2 expansion question — anyone expanding the matrix without updating tests + `metadataNotes` literals + brief gets a CI failure.

## §5 Cross-references

- **`memory/PLANNER_PRODUCT_BRIEF.md`** v1.3 §3.1.1 — `tenants.status` 4-state lifecycle spec; `'suspended'` reserved.
- **`memory/plans/day-14-part2-service-layer.md`** §5.2.2 + §5.2.3 — plan-strict transitions, the load-bearing source.
- **`src/modules/audit/event-types.ts:716-717`** — `merchant.activated.metadataNotes` registered literal `from_status='provisioning'`.
- **`src/modules/audit/event-types.ts:728-729`** — `merchant.deactivated.metadataNotes` registered literal `from_status='active'`.
- **`memory/followup_audit_body_vs_plan_text_drift.md`** — sibling Day-16 memo on registered-contract-wins precedence (the §A discipline rule applied here).
- **`src/modules/identity/tenant-lookup.ts:14`** — already-shipped semantic on `'suspended'` (webhook receiver drops `'suspended'` tenants); any Phase 2 brief amendment authorizing operator-reachable `'suspended'` must be consistent with this existing contract.
- **Reviewer Block-4-D Service D turn ruling** — Option C (plan-strict code + this followup memo). Reviewer's drafting-order item d expansion + watch item 3 deactivate-from-suspended fallback both retracted per the same turn.

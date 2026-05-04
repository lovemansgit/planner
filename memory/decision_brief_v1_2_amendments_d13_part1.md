---
name: PLANNER_PRODUCT_BRIEF.md v1.2 amendments — §3.1.1 column-name + status enum corrections post-Day-13 part-1 merge
description: Per brief §10 amendment protocol, this decision memo documents two §3.1.1 amendments queued at the Day-13 plan-PR conditional approval and filed post-merge of PR #139 (875bfc4). Amendment 1 — tasks.suitefleet_push_acknowledged_at → tasks.pushed_to_external_at (Option A keep existing column, identical semantic, code-anchored at markTaskPushed UPDATE). Amendment 2 — tenants.status → 4-state lowercase canon adopted from prod (provisioning/active/suspended/inactive, default provisioning), better fit for separate merchant.created vs merchant.activated audit events than the originally-proposed 2-state uppercase. No code changes — brief text realignment only.
type: project
---

# Brief v1.2 amendments — §3.1.1 column-name + status enum corrections

**Filed:** Day 13 (5 May 2026), post-merge of PR #139 (`875bfc4`).
**Decision driver:** Per brief §10 amendment protocol — "Scope changes require: explicit `decision_*.md` filing + brief amendment + version bump in §9." Both amendments were queued at the Day-13 plan-PR conditional approval (Conditions 1 and 2 of PR #138's amendment cycle); filing the decision memo + brief edit was sequenced for after the part-1 code PR merged so the brief realigns to schema that's actually shipped.
**Tier:** T1 — documentation correction; no code surface.
**Sequencing:** combined PR per Day-13 plan §6 (single brief-amendment PR covers both §0.3 and §1.7.1 corrections).

---

## Amendment 1 — `tasks.suitefleet_push_acknowledged_at` → `tasks.pushed_to_external_at`

### What changed

Brief §3.1.1, line that previously read:

> **`tasks.suitefleet_push_acknowledged_at` column:** `timestamptz NULL`. Populated when SuiteFleet POST returns 2xx. Surfaced on UI as integration-honesty indicator (§3.3.6).

Now reads (with §3.3.6 cross-reference unchanged):

> **`tasks.pushed_to_external_at` column:** `timestamptz NULL` — already present in `0006_task.sql:156` (existing column with identical semantic; v1.2 amendment §0.3 Option A keeps the existing column rather than rename). Populated when SuiteFleet POST returns 2xx (code-anchored at `src/modules/tasks/repository.ts:531-543` `markTaskPushed` UPDATE; call sites at `src/modules/task-push/service.ts:723-728` cron-loop + `:1098-1104` single-task, both AFTER `pushResult` materializes). Surfaced on UI as integration-honesty indicator (§3.3.6). **Contract surface for forthcoming materialization/push decoupling (Day-14 own T3 plan PR per `memory/followups/cron_materialization_push_coupling.md`). Day-13 part 1 (PR #139, merged 875bfc4) made no schema change to this column; Day-14 work uses its existing semantics as the integration-honesty marker.**

### Why (Option A — keep existing column)

Day-13 plan-PR §0.3 surfaced three options:

| Option | Cost | Benefit | Tradeoff |
|---|---|---|---|
| **A. Keep `pushed_to_external_at`; amend brief** | One-line brief amendment | Zero migration churn; existing audit metadata + integration code + tests stay coherent | Brief column name slightly less precise than the proposed name |
| B. Rename `pushed_to_external_at` → `suitefleet_push_acknowledged_at` | `ALTER TABLE … RENAME COLUMN`; touches `task-push/service.ts`, audit metadata field name, all test fixtures, type re-export at `@/shared/types`; possible drift between local and prod renames | Brief stays as written | Production renames are operational risk (writes-in-flight); coordinated deploy + migration ordering; cross-cutting code churn for stylistic gain |
| C. Add NEW column; deprecate old | Two-column window (write to both; backfill; future migration removes old) | Clean cut-over with zero downtime | Doubles complexity for the same semantic; Phase-2 cleanup debt |

**Option A locked** at conditional approval. CLAUDE.md "Don't add features ... beyond what the task requires" — renaming for stylistic fit when the existing column already works correctly is unjustified work. The brief amendment cost is one-line.

### Code-read confirmation that the semantic matches (§0-Q9)

The semantic claim "populated when SuiteFleet POST returns 2xx, never before request initiation" was code-verified at plan-PR amendment time and re-confirmed against `origin/main` HEAD `18bbb2a` before plan-PR merge:

- `tasks.pushed_to_external_at` is set by `markTaskPushed` at [`src/modules/tasks/repository.ts:531-543`](../src/modules/tasks/repository.ts) — single `UPDATE tasks SET … pushed_to_external_at = now() WHERE id = …`.
- `markTaskPushed` is called from two sites in [`src/modules/task-push/service.ts`](../src/modules/task-push/service.ts):
  - **Cron-loop success path** (lines 723–728): inside `// Success: mark task pushed` block AFTER `pushResult` materializes from the SF createTask call.
  - **Single-task success path** (lines 1098–1104): inside `// Step 5: success — mark task pushed` block AFTER `pushResult` materializes.
- The Sentry-loud comment at line 1116–1119 (`"the next cron pass will see pushed_to_external_at IS NULL and re-attempt"`) confirms the column is the integration-honesty marker for confirmed-acknowledged-by-SF state, never request-initiated state.

---

## Amendment 2 — `tenants.status` → 4-state lowercase canon

### What changed

Brief §3.1.1, line that previously read:

> **`tenants.status` column:** `text` with values `'ACTIVE'` / `'INACTIVE'`. Default `'ACTIVE'` on new tenant insert. Verify; add migration if absent.

Now reads:

> **`tenants.status` column:** `text NOT NULL` with values `'provisioning'`, `'active'`, `'suspended'`, `'inactive'`. Default `'provisioning'` on new tenant insert; transitions via Transcorp-staff `activateMerchant` (`provisioning → active`) and `deactivateMerchant` (`active → inactive`) services. `'suspended'` reserved (part-2 service-surface decision deferred per Day-13 plan §6). v1.2 amendment §1.7.1 — already in production with this 4-state lowercase canon; the original 2-state uppercase proposal was dropped at Day-13 plan-PR amendment time when prod verification (§0.2 Q1) surfaced the existing column. The 4-state is a better fit for the brief's separate `merchant.created` and `merchant.activated` audit events: `merchant.created` emits on `'provisioning'` (genuinely "created but not yet active") and `merchant.activated` emits on the `provisioning → active` transition (genuinely "activated"). PR #139 (merged 875bfc4) explicitly does NOT touch this column in `0017_tenants_pickup_address.sql`.

### Why (4-state lowercase wins over 2-state uppercase)

§0.2 Q1 prod verification surfaced that `tenants.status` already exists in production as `text NOT NULL DEFAULT 'provisioning'` with CHECK `('provisioning', 'active', 'suspended', 'inactive')`. Q1a row counts at the verification moment: 340 `'provisioning'`, 3 `'active'` (MPL/DNR/FBU), 0 `'suspended'`/`'inactive'`.

Three reasons the prod canon wins:

1. **Already in prod with 343+ rows behind it.** Changing the enum would require a data migration alongside the schema change, not just a column rewrite.
2. **2-step `provisioning → active` lifecycle is the better fit for separate `merchant.created` + `merchant.activated` audit events.** Under the originally-proposed 2-state ('ACTIVE' default), `merchant.created` would emit on a tenant that's already in its terminal active state — collapsing two semantically distinct events into the same state. With the 4-state canon, `merchant.created` emits on `'provisioning'` (genuinely "created but not yet active") and `merchant.activated` emits on the `provisioning → active` transition (genuinely "activated"). The audit-event vocabulary in PR #139 reflects this with explicit `from_status`/`to_status` payload fields.
3. **Lowercase is consistent with prod's existing convention.** Uppercase would introduce a casing-mismatch precedent. (Note: `consignees.crm_state` enum stays UPPERCASE per brief §3.1.1 line 153 — the casing-mismatch between the two enums is brief-driven, not a typo. Both casings are documented at the point of use in `0016_consignee_crm_state_and_events.sql` header.)

### `'suspended'` reserved — part-2 service-surface decision deferred

`'suspended'` is in the prod CHECK enum but has no current MVP service-surface action. Day-13 plan §6 defers the decision: part-2 (Day 14) decides whether `'suspended'` becomes an additional service action surface (e.g. `merchant:suspend` permission + `suspendMerchant` service + `merchant.suspended` audit event) OR stays operationally-set-only (DB-only state, no API). Default if undecided: stays reserved, no part-2 service work, revisit Phase 2.

---

## Sequencing log

| Date | Event |
|---|---|
| Day 13 mid-day | Plan-PR (#138) drafted with the original `suitefleet_push_acknowledged_at` and 2-state uppercase `tenants.status` text |
| Day 13 mid-day | Plan-PR conditional approval — Conditions 1 (§0.3 Option A) + 2 (§1.7.1 4-state lowercase) queued for post-merge brief realignment |
| Day 13 mid-day | Plan-PR amendment fixup (`f8c13ce`) inside #138 reflected the §1.7.1 amendment in plan §1.7 + §3 + §4 + §6 + §7 + §9 |
| Day 13 mid-day | Plan-PR (#138) merged (`8772aae`) — plan reflects the locked decisions; brief still pending |
| Day 13 evening | Code-PR (#139) opened with schema reflecting the locked decisions: `tasks.pushed_to_external_at` untouched (no rename), `tenants.status` no-op (`0017` does NOT touch the column) |
| Day 13 evening | Code-PR (#139) merged (`875bfc4`) — schema landed |
| Day 13 evening | **This memo + brief v1.2 amendment** — brief realigned post-hoc to match the schema that shipped |

---

## Cross-references

- `PLANNER_PRODUCT_BRIEF.md §3.1.1` (amended in this PR), §9 (v1.2 entry added), §10 (amendment protocol)
- `memory/plans/day-13-exception-model-part-1.md` — full plan; §0.3 + §0-Q9 + §1.7.1 sections drove these amendments
- PR #138 — plan PR (merged `8772aae`); its conditional approval queued these amendments
- PR #139 — code PR (merged `875bfc4`); its schema is what the brief now realigns to
- `supabase/migrations/0017_tenants_pickup_address.sql` — explicitly documents `tenants.status` no-op + the prod canon
- `supabase/migrations/0006_task.sql:156` — existing `tasks.pushed_to_external_at` column anchor
- `src/modules/tasks/repository.ts:531-543` — `markTaskPushed` UPDATE (the §0-Q9 anchor)
- `src/modules/task-push/service.ts:723-728` + `:1098-1104` — call sites confirming AFTER-2xx ordering

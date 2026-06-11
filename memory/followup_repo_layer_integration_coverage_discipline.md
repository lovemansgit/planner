---
name: Repository-layer integration-coverage discipline rule
description: Day-17 production smoke test caught the third occurrence of a drizzle-array-splat bug class. Mock-only unit tests at the repository layer let real-Postgres-only bugs through (single-element 22P02, multi-element 42846 type-cast failures). Discipline rule going forward — any new repository function (or any function using sqlTag with a JS array binding) MUST have a real-Postgres integration test before merge.
type: project
---

# Repository-layer integration-coverage discipline

**Surfaced:** Day-17 production smoke (`/api/tasks/labels` HTTP 500).

## §1 Pattern observed — three independent occurrences

The same bug class — drizzle-orm template-tag substitution splatting JS arrays into Postgres tuple/record literals that cannot cast to `uuid[]` — has fired three times so far in the codebase:

1. **PR #153 cron-decoupling drizzle array-splat blocker batch (Day 14).** Caught in CI iteration during PR open; fixed in-flight as part of the cron-decoupling code PR.
2. **`listVisibleTaskIds` at `src/modules/tasks/repository.ts:392` (Day 8 ship → Day 17 surface).** Latent for ~9 days. Fired the first time an operator clicked Print labels against a real DB-backed task — Day-17 morning smoke test.
3. **`assertCanRemoveAssignments` `removingAdminRows` query at `src/modules/identity/tenant-admin-invariant.ts:108` (latent until Day-17 audit).** Never invoked in pilot — single tenant-admin per merchant, no role-removal flow exercised. Caught pre-emptively during Day-17 hotfix audit.

Mock-only unit tests at the repository layer never trigger the bug because the JS `mockExecute` function isn't constrained by Postgres parameter binding. The bug is invisible until real Postgres processes the query parameters.

## §2 Discipline rule going forward

**Any new repository function (or any function using `sqlTag` with a JS array binding) MUST have a real-Postgres integration test before merge.**

Mocked-repo unit tests are NOT sufficient. The integration test must:
- Run against a real Postgres connection (CI service container or local equivalent)
- Execute the function with array inputs of size 1, mid (5-50), and the upper bound the function permits
- Verify the array binding works under the actual driver's parameter semantics

This rule extends, not replaces, existing unit-test coverage. Unit tests still own logic-level correctness (permission gating, state transitions, error mapping). Integration tests own the SQL boundary.

## §3 Pattern E established — the codebase array-binding convention

`uuid[]` and `integer[]` array bindings use the manual-array-literal pattern documented at `src/shared/sql-helpers.ts`:

```typescript
sqlTag`WHERE col = ANY(${'{' + arr.join(',') + '}'}::uuid[])`
```

Type-restriction is contractual: Pattern E is safe for value types whose serialized form cannot contain `,`, `{`, `}`, `"`, or whitespace. Text-with-arbitrary-chars and JSONB are explicitly OUT of Pattern E's safe set; future text[]/jsonb[] introductions trigger a different pattern (or a drizzle upgrade) per §5 below.

## §4 Phase 2 — full repository-layer audit

Post-demo Phase 2 task: dedicated PR auditing every function in `src/modules/**/repository.ts` (and any sibling files using `sqlTag`) for:

1. **JS array bindings via template substitution** — find any remaining `${jsArr}` pattern that needs Pattern E migration
2. **Real-Postgres integration coverage** — flag any function that lacks integration test coverage; either add coverage or document why the function doesn't need it (e.g., trigger-only path tested at the schema layer, or function never invoked with array inputs)
3. **Code-header documentation** — every repository function with array bindings should reference `src/shared/sql-helpers.ts` in a header comment so future readers find the pattern

The audit is mechanical-but-tedious; not blocker-priority but should land before the first post-pilot hardening sprint to prevent the fourth surfacing of this bug class.

## §5 Phase 2 escalation triggers

The current Pattern E type-restriction is acceptable because the codebase has zero `text[]` or `jsonb[]` bindings today. Triggers to revisit:

- **First `text[]` or `jsonb[]` array binding introduced.** Pattern E is unsafe; needs a type-safe alternative. Options listed in `src/shared/sql-helpers.ts` (drizzle upgrade, custom encoder, or postgres-js array helper with encapsulation refactor).
- **Drizzle 0.46+ release** if it exposes `sql.array(value, type)` natively. Re-evaluate Pattern D as the cleaner long-term path; Pattern E becomes a deprecated migration target.
- **Performance complaint on large array bindings.** Pattern E sends the array as a serialized string; very large arrays (>10K elements) might benefit from a different approach. No current call sites approach this scale (route caps at 100 IDs).

## §6 Cross-references

- `src/shared/sql-helpers.ts` — Pattern E + type-restriction documentation block
- `src/modules/tasks/repository.ts:392` — `listVisibleTaskIds` (fixed Day-17 hotfix)
- `src/modules/identity/tenant-admin-invariant.ts:108` — `assertCanRemoveAssignments` removingAdminRows query (fixed Day-17 hotfix)
- `tests/integration/list-visible-task-ids.spec.ts` — regression pin (caught the broken Pattern A first attempt)
- `tests/integration/tenant-admin-invariant-array-binding.spec.ts` — regression pin
- PR #153 cron-decoupling — first occurrence of the bug class, fixed in-flight
- `memory/followup_admin_middleware_phase2.md` — sibling Phase 2 hardening item; same priority bucket as the §4 audit

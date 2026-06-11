// SQL helper conventions for the codebase.
//
// This file is currently doc-only. If a runtime helper becomes
// necessary (e.g., a typed array-bind wrapper), add it here so the
// pattern stays in one place.

/**
 * Drizzle/postgres-js array-binding pattern.
 *
 * BUG: `sqlTag\`WHERE col = ANY(${jsArray}::TYPE[])\`` does NOT work
 * in drizzle-orm 0.45.2 with postgres-js. The template-tag substitution
 * splats JS arrays into a record/tuple ($1, $2, ..., $n), not a
 * Postgres array. Postgres cannot cast record to TYPE[]:
 *   - Single element  → 22P02 malformed array literal
 *   - Multi element   → 42846 cannot cast type record to TYPE[]
 *
 * NEITHER `unnest()` NOR `sql.array()` is a fix:
 *   - `unnest(${jsArray}::TYPE[])` — same record-vs-array failure
 *     INSIDE the unnest call
 *   - drizzle-orm 0.45.2 has no `sql.array()`; postgres-js's
 *     `sql.array()` is a connection-instance method, not reachable
 *     through drizzle's sqlTag without breaking the
 *     withServiceRole / withTenant encapsulation
 *
 * USE: `sqlTag\`WHERE col = ANY(${'{' + arr.join(',') + '}'}::TYPE[])\``
 * which constructs the Postgres array literal as a single string
 * parameter server-side. The string `{a,b,c}` is parsed by Postgres
 * as an array literal and cast cleanly to TYPE[].
 *
 * TYPE RESTRICTION — CRITICAL:
 * Pattern E (manual array literal) is safe for value types whose
 * serialized form cannot contain `,`, `{`, `}`, `"`, or whitespace:
 *   ✓ uuid[]    (alphanumeric + hyphens only)
 *   ✓ integer[] (digits + minus only)
 *   ✗ text[]    (arbitrary characters; needs escaping)
 *   ✗ jsonb[]   (object syntax conflicts with array delimiters)
 *
 * For text[] / jsonb[] / any-type-with-special-chars: DO NOT use
 * Pattern E without explicit escaping. The codebase has no text[] or
 * jsonb[] array bindings today. First contributor introducing one
 * must extend this file with a type-safe alternative — likely options:
 *   1. Drizzle upgrade if a future version exposes `sql.array()`
 *   2. Custom drizzle encoder via `sql.param(value, encoder)`
 *   3. Postgres-js `array()` helper (requires breaking encapsulation)
 *
 * History: surfaced via Day-17 production smoke after three
 * independent occurrences of this bug class:
 *   - PR #153 cron-decoupling drizzle array-splat blocker batch (Day 14)
 *   - listVisibleTaskIds (Day 8 ship, Day 17 surface)
 *   - tenant-admin-invariant removingAdminRows (latent; never invoked
 *     in pilot before Day-17 audit caught it)
 *
 * The Day-17 hotfix's first attempt (Pattern A — `unnest()`) was
 * caught failing by the integration tests landed in the same PR. The
 * test infrastructure that mocked-only unit tests would have missed
 * this is the regression-grade safety net for this bug class.
 *
 * See memory/followup_repo_layer_integration_coverage_discipline.md
 * for the integration-coverage discipline rule that catches this
 * class of bug at regression grade.
 */
export const SQL_HELPERS_DOC_ONLY = true;

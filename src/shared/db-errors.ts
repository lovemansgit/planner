// Postgres driver error inspection helpers shared across modules.
//
// Why this lives here, not co-located with each caller:
// drizzle-orm wraps the original PostgresError in a `DrizzleQueryError`
// at `node_modules/drizzle-orm/pg-core/session.js` (PostgresJsPreparedQuery
// .queryWithCache) before the error propagates out of `db.transaction(...)`
// or `tx.execute(...)`. The wrapper exposes the original PG error via
// `err.cause`. A naive `err.code === '23505'` check returns false on the
// outer DrizzleQueryError, dropping the unique-violation branch.
//
// Confirmed empirically by Day-19 spike (memory/followup_isuniqueviolation_
// err_cause_unwrap_bug.md §2 — drizzle attribution corrected).

/**
 * SQLSTATE 23505 — unique_violation. The Postgres error code emitted when
 * an INSERT or UPDATE violates a UNIQUE constraint or unique index.
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PG_UNIQUE_VIOLATION = "23505";

/**
 * True when `err` is (or wraps) a PG unique-violation. Walks the
 * `err.cause` chain so wrappers like drizzle's `DrizzleQueryError` are
 * unwrapped automatically. Caller does not need to know whether their
 * INSERT path hits drizzle, raw postgres.js, or a future driver swap.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === PG_UNIQUE_VIOLATION) return true;
  const cause = (err as { cause?: unknown }).cause;
  return isUniqueViolation(cause);
}

// Shared domain primitives. Per plan §3.4, shared code depends on
// nothing application-specific — these types are domain-agnostic
// aliases used across all eight modules.

/** UUID v4 string. Validated at the system boundary by Zod schemas. */
export type Uuid = string;

/** ISO 8601 timestamp with timezone (e.g., the output of `new Date().toISOString()`). */
export type IsoTimestamp = string;

/**
 * Permission identifier of the form `resource:action` per plan §7.3.
 * The frozen catalogue lives in `src/modules/identity/permissions.ts`
 * and is the runtime source of truth (per resolutions R-1, including
 * the `systemOnly` system-actor permissions). This template-literal
 * type is the structural shape used by `shared/tenant-context.ts` so
 * that `Set<Permission>` does not have to import from the identity
 * module (plan §3.4 forbids shared → application-specific imports).
 */
export type Permission = `${string}:${string}`;

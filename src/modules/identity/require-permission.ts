// requirePermission helper per resolutions R-2 / plan §7.4.1.
//
// "Every callable service method takes a RequestContext and calls
// requirePermission(ctx, perm)" — that's the §11.3 non-negotiable. This
// helper is the single chokepoint for that check. Callers that take a
// `RequestContext` and do anything tenant-scoped MUST go through this
// before reading or writing data. The catalogue from R-1 supplies the
// `PermissionId` type so callers can only pass known permission ids;
// arbitrary strings get a compile-time rejection.
//
// Why a free function and not a class method or decorator:
//   - Service methods in this codebase are plain async functions, not
//     class methods. A free function is the lowest-friction call site.
//   - Decorators in TS are still experimental for the patterns we'd
//     want (parameter introspection); a function call is unambiguous.
//   - Throwing rather than returning a boolean enforces the "fail loud"
//     posture — a forgotten check turns into a TypeScript-flagged
//     unused-variable warning, not a silent allow.

import { ForbiddenError } from "../../shared/errors";
import type { RequestContext } from "../../shared/tenant-context";
import type { PermissionId } from "./permissions";

/**
 * Assert that the actor in `ctx` carries `permission`. Throws
 * `ForbiddenError` (code `FORBIDDEN`) if not. Returns `void` on success
 * — call sites use it as an early-exit guard, not a value-returning
 * predicate.
 *
 * Error message format: `permission denied: <permission> (actor=<kind>)`.
 * Includes the permission id (public information, intentionally exposed
 * so the call site shows which gate fired) and the actor kind (`user`
 * or `system` per the Actor type in shared/tenant-context.ts) for
 * triage. Does NOT include the actor's id, tenant id, or full permission
 * set — that information is for audit emit (R-4), not for the
 * client-visible error.
 */
export function requirePermission(ctx: RequestContext, permission: PermissionId): void {
  if (!ctx.actor.permissions.has(permission)) {
    throw new ForbiddenError(`permission denied: ${permission} (actor=${ctx.actor.kind})`);
  }
}

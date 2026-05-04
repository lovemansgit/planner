// Typed error hierarchy. Lives in shared because every module throws
// these and the boundary rules from PR #3 forbid cross-module imports
// of internal files. See plan §11.1 stub list.
//
// Discriminated-union shape for exhaustiveness:
// -----------------------------------------------------------------------------
// `AppError`'s `code` field is the discriminant — every subclass pins it
// to a unique string literal, and `AppErrorCode` is the union of those
// literals. `KnownAppError` is the union of every concrete subclass and
// is what the API error-mapping helper at src/app/api/_lib/error-response.ts
// switches on. Adding a new typed error means:
//
//   1. Add a class extending `AppError` with a fresh literal `code`.
//   2. Add the literal to `AppErrorCode`.
//   3. Add the class to `KnownAppError`.
//   4. The switch in errorResponse will fail to typecheck until the new
//      case is handled — `const _exhaustive: never = err` enforces it.
//
// Step 4 is the point. Without the discriminated-union shape, the
// previous `instanceof X || instanceof Y || ...` chain in errorResponse
// allowed silent fall-through to a generic 500 when a new typed error
// was added.

/** Closed union of every AppError subclass's `code` field. */
export type AppErrorCode =
  | "FORBIDDEN"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CREDENTIAL"
  | "NO_TENANT_CONFIGURED"
  | "UNAUTHORIZED";

export abstract class AppError extends Error {
  abstract readonly code: AppErrorCode;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/**
 * RBAC denial — the actor lacks the required permission, or attempts a
 * cross-tenant operation. Thrown by `requirePermission` per plan §7.4.1.
 */
export class ForbiddenError extends AppError {
  readonly code = "FORBIDDEN";
}

/** Input validation failure — schema, format, or business rule. */
export class ValidationError extends AppError {
  readonly code = "VALIDATION";
}

/**
 * Resource not found by id or natural key. Distinguished from
 * `ForbiddenError` so callers can choose to obscure or reveal existence
 * (RLS often hides instead of denying).
 */
export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND";
}

/**
 * Credential supply / fetch / verify / refresh failure. See plan §8.4
 * (per-tenant credential SDK) and ADR-007 (SuiteFleet 401-after-retry
 * surfaces here).
 */
export class CredentialError extends AppError {
  readonly code = "CREDENTIAL";
}

/**
 * State-conflict — a request is well-formed and the actor is permitted,
 * but performing it would leave the system in an invalid state. Thrown
 * by service-layer invariant checks: the canonical example is C-21
 * ("at least one Tenant Admin per tenant"), which throws this when an
 * operation would remove the last Tenant Admin.
 *
 * Distinct from ValidationError (input-shape failure) and
 * ForbiddenError (permission failure). Maps to HTTP 409 at the API
 * boundary.
 */
export class ConflictError extends AppError {
  readonly code = "CONFLICT";
}

/**
 * "No tenants configured yet." Thrown by the demo-context bootstrap
 * (src/shared/demo-context.ts) when its first-tenant lookup returns
 * empty. Lives in this file (rather than alongside the demo helper)
 * so it participates in the AppError union and the errorResponse
 * switch's exhaustiveness check.
 *
 * Distinct from NotFoundError because "the system is uninitialised" is
 * an operator-level signal, not a request-level "your input was wrong";
 * the HTTP boundary maps it to 503 (service unavailable) rather than 404.
 *
 * Will be removed when real auth wiring lands and the demo-context path
 * goes away.
 */
export class NoTenantConfiguredError extends AppError {
  readonly code = "NO_TENANT_CONFIGURED";
  constructor() {
    super("No tenants configured yet — onboard at least one tenant before using the demo API");
  }
}

/**
 * Day 10. The actor has no authenticated session — login is required to
 * proceed. Distinct from ForbiddenError (which means "session present but
 * permission insufficient"). Maps to HTTP 401 at the API boundary; pages
 * catch this and redirect to /login.
 *
 * Thrown by buildRequestContext (src/shared/request-context.ts) when no
 * Supabase Auth session is present AND ALLOW_DEMO_AUTH is not opted in.
 */
export class UnauthorizedError extends AppError {
  readonly code = "UNAUTHORIZED";
  constructor(message: string = "login required") {
    super(message);
  }
}

/**
 * Closed union of every concrete typed error. Use as the parameter
 * type when you want exhaustiveness via `switch (err.code)` with a
 * `const _exhaustive: never = err` default branch.
 */
export type KnownAppError =
  | ForbiddenError
  | ValidationError
  | NotFoundError
  | ConflictError
  | CredentialError
  | NoTenantConfiguredError
  | UnauthorizedError;

/** Type guard: narrows `unknown` to `KnownAppError`. */
export function isKnownAppError(err: unknown): err is KnownAppError {
  return err instanceof AppError;
}

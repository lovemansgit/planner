// Typed error hierarchy. Lives in shared because every module throws
// these and the boundary rules from PR #3 forbid cross-module imports
// of internal files. See plan §11.1 stub list.

export abstract class AppError extends Error {
  abstract readonly code: string;
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

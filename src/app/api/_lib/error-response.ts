// Map AppError subclasses to HTTP responses with a stable JSON shape.
//
// Single chokepoint for error → response mapping so every route emits
// the same { error: { code, message } } envelope and the same HTTP
// status for the same error class. Adding a new typed error means
// adding one branch here, not editing every route.
//
// The status mapping:
//   ForbiddenError      → 403
//   ValidationError     → 400
//   NotFoundError       → 404
//   ConflictError       → 409
//   CredentialError     → 502  (upstream credential failure — see plan §8.4)
//   NoTenantConfigured  → 503  (system uninitialised; from demo-context)
//
// Anything that isn't a known typed error is re-thrown — the framework
// then renders a 500 with the generic Next error page. We do NOT
// stringify unknown errors into the JSON response, because the
// internal message could leak implementation detail to a client.

import "server-only";

import { NextResponse } from "next/server";

import { NoTenantConfiguredError } from "@/shared/demo-context";
import {
  AppError,
  ConflictError,
  CredentialError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";

const STATUS_BY_CODE: Record<string, number> = {
  FORBIDDEN: 403,
  VALIDATION: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CREDENTIAL: 502,
};

function statusFor(err: AppError): number {
  return STATUS_BY_CODE[err.code] ?? 500;
}

/**
 * Convert a thrown error into a NextResponse. If the error is not a
 * known typed error, re-throws so the framework's default 500 path
 * renders.
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof NoTenantConfiguredError) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: 503 });
  }
  if (
    err instanceof ForbiddenError ||
    err instanceof ValidationError ||
    err instanceof NotFoundError ||
    err instanceof ConflictError ||
    err instanceof CredentialError
  ) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: statusFor(err) }
    );
  }
  // Unknown error type — let the framework's 500 handler take it.
  // Stringifying an unknown error to the client could leak detail.
  throw err;
}

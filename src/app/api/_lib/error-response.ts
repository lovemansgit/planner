// Map AppError subclasses to HTTP responses with a stable JSON shape.
//
// Single chokepoint for error → response mapping so every route emits
// the same { error: { code, message } } envelope and the same HTTP
// status for the same error class.
//
// Exhaustiveness via discriminated union (PR #23 review):
//   - `KnownAppError` in src/shared/errors.ts is the closed union of
//     every concrete typed error.
//   - The switch below is keyed on `err.code`, the discriminant.
//   - The default branch assigns to `const _exhaustive: never = err`,
//     which only typechecks when every variant is covered. Adding a
//     new typed error means: add the class + add the code literal +
//     add to the union — and the build breaks at this file until the
//     new case is handled here.
//
// Anything that isn't a KnownAppError is re-thrown — the framework's
// default 500 path then renders. We do NOT stringify unknown errors
// into the JSON response, because the internal message could leak
// implementation detail to a client.

import "server-only";

import { NextResponse } from "next/server";

import { isKnownAppError, type KnownAppError } from "@/shared/errors";

/** Stable JSON envelope returned by every typed-error path. */
function envelope(err: KnownAppError, status: number): NextResponse {
  return NextResponse.json({ error: { code: err.code, message: err.message } }, { status });
}

/**
 * Convert a thrown error into a NextResponse. Re-throws unknown errors
 * so the framework's 500 handler renders.
 */
export function errorResponse(err: unknown): NextResponse {
  if (!isKnownAppError(err)) {
    // Unknown error type — let the framework's 500 handler take it.
    // Stringifying an unknown error to the client could leak detail.
    throw err;
  }

  switch (err.code) {
    case "FORBIDDEN":
      return envelope(err, 403);
    case "VALIDATION":
      return envelope(err, 400);
    case "NOT_FOUND":
      return envelope(err, 404);
    case "CONFLICT":
      return envelope(err, 409);
    case "CREDENTIAL":
      // Upstream credential failure — see plan §8.4 (per-tenant credential SDK)
      // and ADR-007 (SuiteFleet 401-after-retry).
      return envelope(err, 502);
    case "NO_TENANT_CONFIGURED":
      // System uninitialised; from demo-context bootstrap. 503 (service
      // unavailable) rather than 404 because the caller's request is
      // well-formed; the system isn't ready yet.
      return envelope(err, 503);
    case "UNAUTHORIZED":
      // No authenticated session. Distinct from FORBIDDEN (session
      // present but permission insufficient). API consumers receive
      // 401 + JSON envelope; page-level callers catch UnauthorizedError
      // upstream and redirect to /login instead of bubbling here.
      return envelope(err, 401);
    default: {
      // Exhaustiveness guard. If `err` here is anything other than
      // `never`, it's because a new variant was added to KnownAppError
      // without being handled above — TS will fail to compile this
      // assignment, breaking the build at the right place.
      const _exhaustive: never = err;
      return _exhaustive;
    }
  }
}

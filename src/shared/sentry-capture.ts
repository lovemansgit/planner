// Safe Sentry capture wrapper.
//
// Day 7 / C-6. Replaces silent fire-and-forget drops with a non-throwing
// `captureException` call. Two layered guarantees:
//
//   1. If SENTRY_DSN is unset (development scope per
//      memory/feedback_vercel_env_scope_convention.md), Sentry init in
//      sentry.server.config.ts was a no-op and `Sentry.captureException`
//      is still a no-op writer to /dev/null. Calling it is safe.
//
//   2. If Sentry init succeeded but the runtime capture fails (network
//      down, transport error, JSON serialisation throw on a circular
//      `extra` object), the try/catch below swallows the failure. A
//      Sentry capture must NEVER throw upstream — the audit emit
//      failure path that calls this is already non-fatal; if Sentry
//      capture about the audit failure is itself fatal, we lose the
//      whole telemetry stack on transient Sentry outages.
//
// What this wrapper does NOT cover: a failure of the static
// `@sentry/nextjs` import itself. That would manifest at module-load
// time, before any caller reaches captureException, and would crash
// the whole app boot regardless of how this function is written.
// We accept that failure mode — Sentry is a hard dependency.
//
// Always import this wrapper — never `Sentry.captureException` directly
// in fire-and-forget paths. A direct call is one missing try/catch
// away from cascading a Sentry transport hiccup into a service-layer
// 5xx.

import * as Sentry from "@sentry/nextjs";

import { logger } from "./logger";

const log = logger.with({ component: "sentry_capture" });

/**
 * Capture an exception to Sentry, swallowing any internal failure.
 *
 * `context` is attached as `extra` on the Sentry event. Avoid passing
 * objects that could carry credentials or PII — Sentry does not
 * strip these the way the structured logger does (the logger's
 * REDACTED_FIELDS list is independent).
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  try {
    Sentry.captureException(err, context !== undefined ? { extra: context } : undefined);
  } catch (innerErr) {
    // Sentry capture itself failed. Log at warn — the wrapped error is
    // already lost, but the metadata about the loss is worth keeping.
    log.warn(
      {
        original_error: err instanceof Error ? err.message : String(err),
        sentry_error: innerErr instanceof Error ? innerErr.message : String(innerErr),
      },
      "sentry capture failed; original error dropped",
    );
  }
}

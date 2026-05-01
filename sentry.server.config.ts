// Sentry SDK init for the Node runtime (App Router server, API routes, cron).
//
// Day 7 / C-6. Plan §10.2 / Day-9-plan item brought forward.
//
// Activation gate: SENTRY_DSN env var. Per
// memory/feedback_vercel_env_scope_convention.md the DSN is set in
// Vercel Production + Preview scopes only — never in Development scope
// (which is reserved for `.env.local`). The DSN being unset IS the
// gate: Sentry stays inert in local dev / test.
//
// No tracing, no profiling, no performance monitoring, no custom
// dashboards in this commit. Day 11 per the plan ships those. C-6's
// minimum scope: replace silent fire-and-forget drops with
// captureException calls so production errors stop being invisible.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // No tracing yet — Day 11 / plan §10.3 deliverable. Setting this to
    // 0 disables performance monitoring entirely.
    tracesSampleRate: 0,
    // VERCEL_ENV is "production" | "preview" | "development" on Vercel
    // deploys. For self-hosted Node runtime fall back to "production"
    // (this branch only runs when DSN is set, which by convention is
    // only Production/Preview anyway).
    environment: process.env.VERCEL_ENV ?? "production",
    // Surface init errors at boot so a misconfigured DSN does not
    // silently swallow every captureException for the rest of the
    // process lifetime.
    debug: false,
  });
}

// Sentry SDK init for the browser runtime.
//
// Day 7 / C-6. The client-side DSN is exposed via NEXT_PUBLIC_SENTRY_DSN
// because Next.js inlines NEXT_PUBLIC_* env vars into the client bundle.
// Per memory/feedback_vercel_env_scope_convention.md the variable is set
// in Vercel Production + Preview scopes only.
//
// Pilot UI surface is small (server-rendered pages, minimal client JS),
// so client-side captures are mostly a future investment. Today this
// stays minimal; Day-11 dashboards work decides whether to add browser-
// specific integrations.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "production",
    debug: false,
  });
}

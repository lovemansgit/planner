// Sentry SDK init for the Edge runtime.
//
// Day 7 / C-6. The pilot does NOT currently use the Edge runtime — every
// route is `runtime: "nodejs"`. This file exists because Next.js'
// instrumentation.ts dispatches by runtime and importing a missing edge
// config raises a build warning. A trivial init that respects the same
// DSN gate is the safest no-op.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    environment: process.env.VERCEL_ENV ?? "production",
    debug: false,
  });
}

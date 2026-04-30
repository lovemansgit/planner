// SuiteFleet LastMileAdapter singleton — Day 6 / W-1.
//
// Production wiring for `LastMileAdapter`. The adapter holds a token
// cache (S-7) that is supposed to persist across requests; constructing
// a fresh adapter per call would defeat the cache. One adapter per
// process, lazily initialised on first call.
//
// Tests inject a different adapter via vi.mock at the module level —
// see tests/integration/webhook-receiver.spec.ts for the pattern.
//
// Day-7+: when the cron + Secrets Manager swap lands, `clock` and
// `fetch` stay injected here and the credential resolvers (read from
// the factory's defaults) start hitting Secrets Manager. This file
// does not change at that point.

import "server-only";

import { createSuiteFleetLastMileAdapter } from "./last-mile-adapter-factory";

import type { LastMileAdapter } from "../../last-mile-adapter";

let cachedAdapter: LastMileAdapter | null = null;

export function getSuiteFleetAdapter(): LastMileAdapter {
  if (cachedAdapter === null) {
    cachedAdapter = createSuiteFleetLastMileAdapter({
      fetch: globalThis.fetch,
      clock: () => new Date(),
    });
  }
  return cachedAdapter;
}

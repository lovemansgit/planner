// LastMileAdapter assembled-end-to-end sandbox tests — Day 5 / T-9.
//
// Real-network tests against api.suitefleet.com exercising the
// constructed adapter (T-8) rather than the individual primitives.
// Where S-9 wired the auth client + task client by hand, T-9 calls
// `createSuiteFleetLastMileAdapter(deps)` once and drives every
// method through the resulting LastMileAdapter handle. Proves the
// assembly point itself works against the real provider.
//
// Tagged in the `sandbox` vitest project — opt in via
// `npm run test:sandbox`. Default CI doesn't run these.
//
// All tests self-skip if:
//   (a) Sandbox is unreachable (network probe fails inside 5 seconds), OR
//   (b) Required SUITEFLEET_SANDBOX_* env vars are missing.
//
// Brief §11 test list:
//   1. Construction succeeds given valid deps
//   2. adapter.authenticate(TENANT) returns a session
//   3. adapter.createTask(session, ...) returns a task result
//   4. adapter.parseWebhookEvents(samplePayload) returns one event
//   5. adapter.mapStatusToInternal("TASK_HAS_BEEN_ORDERED") returns "CREATED"
//
// Tests #4 and #5 are pure (no network), but they live here to prove
// the assembled adapter delegates correctly. Construction + the two
// network-touching tests (auth, createTask) are the real T-9 value.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveSuiteFleetCredentials } from "@/modules/credentials";
import type { SuiteFleetCredentials } from "@/modules/credentials";
import { createSuiteFleetLastMileAdapter } from "@/modules/integration";
import type { LastMileAdapter } from "@/modules/integration";
import type { Uuid } from "@/shared/types";

const SANDBOX_BASE = "https://api.suitefleet.com";
const PROBE_TIMEOUT_MS = 5_000;
const TENANT: Uuid = "00000000-0000-0000-0000-000000000001";

interface SandboxState {
  readonly creds: SuiteFleetCredentials;
}

let sandbox: SandboxState | null = null;
let skipReason = "";

beforeAll(async () => {
  let creds: SuiteFleetCredentials;
  try {
    creds = await resolveSuiteFleetCredentials(TENANT);
  } catch (err) {
    skipReason = `creds unavailable: ${err instanceof Error ? err.message : "unknown"}`;
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(SANDBOX_BASE + "/", { signal: controller.signal });
    sandbox = { creds };
  } catch (err) {
    skipReason = `sandbox unreachable: ${err instanceof Error ? err.message : "unknown"}`;
  } finally {
    clearTimeout(timeout);
  }
}, 15_000);

afterAll(() => {
  if (skipReason !== "") {
    console.warn(`[T-9 sandbox suite] skipped: ${skipReason}`);
  }
});

function requireSandbox(state: SandboxState | null): asserts state is SandboxState {
  if (state === null) {
    throw new Error("sandbox unavailable — test should have been skipped");
  }
}

/**
 * Build an adapter using the live sandbox creds. Resolver is supplied
 * inline so the adapter doesn't accidentally re-read env every call —
 * test-side stability matches what the production cron will see once
 * the resolver caches behind it.
 */
function buildAdapter(creds: SuiteFleetCredentials): LastMileAdapter {
  return createSuiteFleetLastMileAdapter({
    fetch: globalThis.fetch,
    clock: () => new Date(),
    resolveCredentials: async () => creds,
    // Webhook creds are not needed for the auth + task-create paths
    // exercised here. The factory still requires the resolver to be
    // present (or to default) — pass a never-call stub so a webhook
    // path mistakenly invoked from this suite would fail loudly.
    resolveWebhookCredentials: async () => {
      throw new Error("T-9 sandbox: resolveWebhookCredentials should not be called");
    },
  });
}

describe("T-9 — LastMileAdapter end-to-end via assembly factory", () => {
  it("construction: createSuiteFleetLastMileAdapter(deps) returns a valid adapter handle", async (ctx) => {
    if (sandbox === null) {
      ctx.skip();
      return;
    }
    requireSandbox(sandbox);

    const adapter = buildAdapter(sandbox.creds);
    expect(typeof adapter.authenticate).toBe("function");
    expect(typeof adapter.refreshSession).toBe("function");
    expect(typeof adapter.createTask).toBe("function");
    expect(typeof adapter.verifyWebhookRequest).toBe("function");
    expect(typeof adapter.parseWebhookEvents).toBe("function");
    expect(typeof adapter.mapStatusToInternal).toBe("function");
  });

  it("authenticate: real /api/auth/authenticate via the assembled adapter returns a session", async (ctx) => {
    if (sandbox === null) {
      ctx.skip();
      return;
    }
    requireSandbox(sandbox);

    const adapter = buildAdapter(sandbox.creds);
    const session = await adapter.authenticate(TENANT);

    expect(session.tenantId).toBe(TENANT);
    expect(typeof session.token).toBe("string");
    expect(session.token.length).toBeGreaterThan(0);
    expect(typeof session.renewalToken).toBe("string");
    expect(session.renewalToken.length).toBeGreaterThan(0);

    // Both expirations are ISO-8601 strings parseable to a future
    // instant relative to "now"; same probe shape as S-9.
    const tokenExpiresMs = Date.parse(session.tokenExpiresAt);
    const renewalExpiresMs = Date.parse(session.renewalTokenExpiresAt);
    expect(Number.isFinite(tokenExpiresMs)).toBe(true);
    expect(Number.isFinite(renewalExpiresMs)).toBe(true);
    expect(tokenExpiresMs).toBeGreaterThan(Date.now());
    expect(renewalExpiresMs).toBeGreaterThan(Date.now());
  });

  it("createTask: assembled adapter creates a task end-to-end against the real sandbox", async (ctx) => {
    if (sandbox === null) {
      ctx.skip();
      return;
    }
    requireSandbox(sandbox);

    const adapter = buildAdapter(sandbox.creds);
    const session = await adapter.authenticate(TENANT);

    const orderNumber = `T9-ROUNDTRIP-${Date.now()}`;
    const result = await adapter.createTask(session, {
      tenantId: TENANT,
      customerOrderNumber: orderNumber,
      kind: "DELIVERY",
      consignee: {
        name: "T9 Round-trip Consignee",
        contactPhone: "+971500000009",
        address: {
          addressLine1: "Villa T9",
          city: "Dubai",
          district: "Jumeirah 3",
          countryCode: "AE",
          latitude: 25.1972,
          longitude: 55.2744,
          addressCode: "AXD",
        },
      },
      shipFrom: {
        addressLine1: "Warehouse T9",
        city: "Dubai",
        countryCode: "AE",
        latitude: 25.0,
        longitude: 55.0,
      },
      window: {
        date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        startTime: "09:00:00",
        endTime: "12:00:00",
      },
      paymentMethod: "PrePaid",
      itemQuantity: 1,
      weightKg: 1,
      declaredValue: 100,
    });

    expect(result.externalId).toMatch(/^\d+$/);
    expect(result.trackingNumber).toMatch(/^MPS-\w+/);
    expect(result.status).toBe("CREATED");
    expect(typeof result.createdAt).toBe("string");
  });

  it("parseWebhookEvents: assembled adapter parses a sample payload to one event", () => {
    // Pure (no network). Lives in this suite to prove the assembled
    // adapter delegates to parseSuiteFleetWebhookEvents and the
    // wiring is intact. Sample shape mirrors S-5's known-action
    // entry for TASK_HAS_BEEN_ORDERED.
    if (sandbox === null) {
      // Adapter doesn't need creds for this method; build with a
      // skip-safe stub if the sandbox happened to be unreachable.
      // The test only exercises the parser delegation.
    }
    const adapter = createSuiteFleetLastMileAdapter({
      fetch: globalThis.fetch,
      clock: () => new Date(),
      resolveCredentials: async () => {
        throw new Error("T-9 parse test: resolveCredentials should not be called");
      },
      resolveWebhookCredentials: async () => {
        throw new Error("T-9 parse test: resolveWebhookCredentials should not be called");
      },
    });

    const samplePayload = [
      {
        action: "TASK_HAS_BEEN_ORDERED",
        taskId: "59000",
        eventId: "evt-1",
        eventTime: "2026-04-29T10:00:00.000Z",
      },
    ];

    const events = adapter.parseWebhookEvents(samplePayload);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("TASK_STATUS_CHANGED");
    expect(events[0].externalTaskId).toBe("59000");
    // internalStatus is intentionally NOT asserted — the parser
    // (S-5) leaves it undefined and the assembly point delegates 1:1
    // rather than composing with mapStatusToInternal. The S-5 file
    // header notes the original design intent was for the adapter
    // assembly point to compose; T-8 didn't implement the composition,
    // so callers (the Day-6 webhook receiver) compose at their layer.
    // Tracked as a Day-6 follow-up in the T-9 PR description.
  });

  it("mapStatusToInternal: assembled adapter maps TASK_HAS_BEEN_ORDERED to CREATED", () => {
    // Pure (no network). Same delegation shape as parseWebhookEvents.
    const adapter = createSuiteFleetLastMileAdapter({
      fetch: globalThis.fetch,
      clock: () => new Date(),
      resolveCredentials: async () => {
        throw new Error("T-9 map test: resolveCredentials should not be called");
      },
      resolveWebhookCredentials: async () => {
        throw new Error("T-9 map test: resolveWebhookCredentials should not be called");
      },
    });

    expect(adapter.mapStatusToInternal("TASK_HAS_BEEN_ORDERED")).toBe("CREATED");
  });
});

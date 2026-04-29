// SuiteFleet sandbox round-trip tests — Day 4 / S-9.
//
// Real-network tests against api.suitefleet.com. Tagged in a separate
// vitest project (`sandbox`) so default CI doesn't run them — opt in
// via `npm run test:sandbox`.
//
// All tests self-skip if:
//   (a) Sandbox is unreachable (network probe fails inside 5 seconds), OR
//   (b) Required SUITEFLEET_SANDBOX_* env vars are missing.
//
// Brief §12 test list:
//   1. Login round-trip
//   2. Refresh round-trip
//   3. Token cache hit
//   4. Token cache expiry
//   5. Task create round-trip
//   6. Webhook verification — covered by the unit suite (S-4); not
//      duplicated here because it's local-only and doesn't need SF
//
// Plus, per memory/followup_paymentmethod_field_resolution.md:
//   7. paymentMethod recovery — GET task by id after creation, check
//      whether deliveryInformation.paymentMethod surfaces. Marks
//      `it.todo` if it doesn't, capturing the gap.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveSuiteFleetCredentials } from "@/modules/credentials";
import type { SuiteFleetCredentials } from "@/modules/credentials";
import {
  createSuiteFleetAuthClient,
  createSuiteFleetTaskClient,
  createSuiteFleetTokenCache,
} from "@/modules/integration";
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
  // (a) Resolve credentials from env. Skip everything if missing.
  let creds: SuiteFleetCredentials;
  try {
    creds = await resolveSuiteFleetCredentials(TENANT);
  } catch (err) {
    skipReason = `creds unavailable: ${err instanceof Error ? err.message : "unknown"}`;
    return;
  }

  // (b) Probe sandbox reachability. Any HTTP response counts as
  // "reachable" (we'll get 401/404 for unauth requests, that's fine —
  // it proves the host is up and routing).
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
    console.warn(`[sandbox suite] skipped: ${skipReason}`);
  }
});

function requireSandbox(state: SandboxState | null): asserts state is SandboxState {
  if (state === null) {
    throw new Error("sandbox unavailable — test should have been skipped");
  }
}

describe("SuiteFleet sandbox — login / refresh round-trips", () => {
  it("login: real /api/auth/authenticate returns tokens with future expirations", async (ctx) => {
    if (sandbox === null) {
      ctx.skip();
      return;
    }
    requireSandbox(sandbox);

    const auth = createSuiteFleetAuthClient({
      fetch: globalThis.fetch,
      clock: () => new Date(),
    });
    const tokens = await auth.login(sandbox.creds);

    expect(typeof tokens.accessToken).toBe("string");
    expect(tokens.accessToken.length).toBeGreaterThan(20);
    expect(typeof tokens.refreshToken).toBe("string");
    expect(tokens.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(tokens.refreshTokenExpiresAt.getTime()).toBeGreaterThan(
      tokens.accessTokenExpiresAt.getTime(),
    );
  });

  it("refresh: login, then refresh with the returned refresh token, returns new tokens", async (ctx) => {
    if (sandbox === null) {
      ctx.skip();
      return;
    }
    requireSandbox(sandbox);

    const auth = createSuiteFleetAuthClient({
      fetch: globalThis.fetch,
      clock: () => new Date(),
    });
    const initial = await auth.login(sandbox.creds);
    const refreshed = await auth.refresh({
      clientId: sandbox.creds.clientId,
      refreshToken: initial.refreshToken,
    });

    expect(typeof refreshed.accessToken).toBe("string");
    expect(refreshed.accessToken.length).toBeGreaterThan(20);
    expect(refreshed.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("SuiteFleet sandbox — token cache behaviour", () => {
  it("cache hit: second getSession within TTL returns cached, no second network call", async (ctx) => {
    if (sandbox === null) {
      ctx.skip();
      return;
    }
    requireSandbox(sandbox);

    let fetchCount = 0;
    const countingFetch = ((...args: Parameters<typeof globalThis.fetch>) => {
      fetchCount++;
      return globalThis.fetch(...args);
    }) as typeof globalThis.fetch;

    const cache = createSuiteFleetTokenCache({
      authClient: createSuiteFleetAuthClient({
        fetch: countingFetch,
        clock: () => new Date(),
      }),
      resolveCredentials: resolveSuiteFleetCredentials,
      clock: () => new Date(),
    });

    const first = await cache.getSession(TENANT);
    const callsAfterFirst = fetchCount;

    const second = await cache.getSession(TENANT);

    expect(callsAfterFirst).toBe(1);
    expect(fetchCount).toBe(callsAfterFirst);
    expect(second.token).toBe(first.token);
    expect(second.tokenExpiresAt).toBe(first.tokenExpiresAt);
  });

  it("cache expiry: advance fake clock past T-1h, second getSession refreshes via real network", async (ctx) => {
    if (sandbox === null) {
      ctx.skip();
      return;
    }
    requireSandbox(sandbox);

    let fetchCount = 0;
    const countingFetch = ((...args: Parameters<typeof globalThis.fetch>) => {
      fetchCount++;
      return globalThis.fetch(...args);
    }) as typeof globalThis.fetch;

    let now = Date.now();
    const cache = createSuiteFleetTokenCache({
      authClient: createSuiteFleetAuthClient({
        fetch: countingFetch,
        clock: () => new Date(now),
      }),
      resolveCredentials: resolveSuiteFleetCredentials,
      clock: () => new Date(now),
      refreshLeadTimeMs: 60 * 60 * 1000,
    });

    const first = await cache.getSession(TENANT);
    expect(fetchCount).toBe(1);

    // Advance 23.5h — leaves 30 minutes before access-token expiry,
    // inside the 60-minute refresh-lead window. Second getSession
    // should trigger a real refresh call.
    now += 23.5 * 60 * 60 * 1000;

    const second = await cache.getSession(TENANT);

    // The fetchCount === 2 is the load-bearing assertion — it proves
    // the cache made a real refresh call rather than returning the
    // cached session. SuiteFleet may legitimately return the same
    // physical access token on refresh (its issuer choice), so we
    // don't assert second.token !== first.token.
    expect(fetchCount).toBe(2);
    expect(typeof second.token).toBe("string");
    expect(second.token.length).toBeGreaterThan(20);
    expect(Date.parse(second.tokenExpiresAt)).toBeGreaterThanOrEqual(
      Date.parse(first.tokenExpiresAt),
    );
  });
});

describe("SuiteFleet sandbox — task create round-trip", () => {
  it("creates a task end-to-end via auth + task client", async (ctx) => {
    if (sandbox === null) {
      ctx.skip();
      return;
    }
    requireSandbox(sandbox);

    const auth = createSuiteFleetAuthClient({
      fetch: globalThis.fetch,
      clock: () => new Date(),
    });
    const taskClient = createSuiteFleetTaskClient({
      fetch: globalThis.fetch,
      clientId: sandbox.creds.clientId,
      clock: () => new Date(),
    });

    const tokens = await auth.login(sandbox.creds);

    const orderNumber = `S9-ROUNDTRIP-${Date.now()}`;
    const result = await taskClient.createTask({
      session: {
        tenantId: TENANT,
        token: tokens.accessToken,
        renewalToken: tokens.refreshToken,
        tokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
        renewalTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      },
      customerId: sandbox.creds.customerId,
      request: {
        tenantId: TENANT,
        customerOrderNumber: orderNumber,
        kind: "DELIVERY",
        consignee: {
          name: "S9 Round-trip Consignee",
          contactPhone: "+971500000005",
          address: {
            addressLine1: "Villa S9",
            city: "Dubai",
            district: "Jumeirah 3",
            countryCode: "AE",
            latitude: 25.1972,
            longitude: 55.2744,
            addressCode: "AXD",
          },
        },
        shipFrom: {
          addressLine1: "Warehouse S9",
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
      },
    });

    expect(result.externalId).toMatch(/^\d+$/);
    expect(result.trackingNumber).toMatch(/^MPS-\w+/);
    expect(result.status).toBe("CREATED");
    expect(typeof result.createdAt).toBe("string");
  });
});

describe("SuiteFleet sandbox — paymentMethod field resolution (followup)", () => {
  // Per memory/followup_paymentmethod_field_resolution.md — verifies
  // whether deliveryInformation.paymentMethod we send surfaces under
  // any field name in the GET-task response. Marked `it.todo` because
  // we already know from S-8 capture that the create response doesn't
  // echo it back; the GET-task path may or may not. Resolution lands
  // in a follow-up commit once we know the answer.
  it.todo("GET /api/tasks/:id returns paymentMethod under some field name (verify path)");
});

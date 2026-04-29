// SuiteFleet token cache — Day 4 / S-7 unit tests.
//
// Mocked auth client + resolver + clock; no real network calls.
// Covers: cache miss → login, cache hit → no network, T-1h proactive
// refresh, refresh-on-failure → login fallback, expired-refresh →
// login, multi-tenant isolation, invalidate semantics.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Uuid } from "../../../../../shared/types";

import type { SuiteFleetCredentials } from "../../../../credentials";

import { createSuiteFleetTokenCache } from "../token-cache";

const TENANT_A: Uuid = "00000000-0000-0000-0000-000000000001";
const TENANT_B: Uuid = "00000000-0000-0000-0000-000000000002";

const SAMPLE_CREDENTIALS: SuiteFleetCredentials = {
  username: "planner@transcorp-intl.com",
  password: "sandbox-secret",
  clientId: "transcorpsb",
  customerId: 588,
};

function makeTokens(opts: {
  accessToken?: string;
  refreshToken?: string;
  accessExpiresInMs?: number;
  refreshExpiresInMs?: number;
  fromTime?: number;
} = {}) {
  const from = opts.fromTime ?? Date.now();
  return {
    accessToken: opts.accessToken ?? "access-token-default",
    refreshToken: opts.refreshToken ?? "refresh-token-default",
    accessTokenExpiresAt: new Date(from + (opts.accessExpiresInMs ?? 24 * 60 * 60 * 1000)),
    refreshTokenExpiresAt: new Date(from + (opts.refreshExpiresInMs ?? 180 * 24 * 60 * 60 * 1000)),
  };
}

interface CacheHarness {
  cache: ReturnType<typeof createSuiteFleetTokenCache>;
  loginMock: ReturnType<typeof vi.fn>;
  refreshMock: ReturnType<typeof vi.fn>;
  resolveMock: ReturnType<typeof vi.fn>;
  clock: { now: number };
}

function buildHarness(initialNow = Date.parse("2026-04-29T09:00:00.000Z")): CacheHarness {
  const clock = { now: initialNow };
  const loginMock = vi.fn();
  const refreshMock = vi.fn();
  const resolveMock = vi.fn().mockResolvedValue(SAMPLE_CREDENTIALS);

  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  const cache = createSuiteFleetTokenCache({
    authClient: {
      login: loginMock,
      refresh: refreshMock,
    },
    resolveCredentials: resolveMock,
    clock: () => new Date(clock.now),
  });

  return { cache, loginMock, refreshMock, resolveMock, clock };
}

describe("SuiteFleetTokenCache — cache miss (first call)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls the credential resolver and the auth client login on the first getSession", async () => {
    const h = buildHarness();
    h.loginMock.mockResolvedValueOnce(makeTokens({ fromTime: h.clock.now }));

    const session = await h.cache.getSession(TENANT_A);

    expect(h.resolveMock).toHaveBeenCalledWith(TENANT_A);
    expect(h.loginMock).toHaveBeenCalledWith(SAMPLE_CREDENTIALS);
    expect(h.refreshMock).not.toHaveBeenCalled();
    expect(session.tenantId).toBe(TENANT_A);
    expect(session.token).toBe("access-token-default");
  });

  it("converts SuiteFleetTokenSet to AuthenticatedSession (camelCase translation)", async () => {
    const h = buildHarness();
    h.loginMock.mockResolvedValueOnce(
      makeTokens({
        accessToken: "AT.123",
        refreshToken: "RT.456",
        fromTime: h.clock.now,
      }),
    );

    const session = await h.cache.getSession(TENANT_A);

    expect(session.token).toBe("AT.123");
    expect(session.renewalToken).toBe("RT.456");
    expect(session.tokenExpiresAt).toMatch(/^2026-04-30T09:00:00\.000Z$/);
  });
});

describe("SuiteFleetTokenCache — cache hit (fresh session)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the cached session without any network call", async () => {
    const h = buildHarness();
    h.loginMock.mockResolvedValueOnce(makeTokens({ fromTime: h.clock.now }));

    await h.cache.getSession(TENANT_A);

    h.loginMock.mockClear();
    h.refreshMock.mockClear();
    h.resolveMock.mockClear();

    const second = await h.cache.getSession(TENANT_A);

    expect(h.loginMock).not.toHaveBeenCalled();
    expect(h.refreshMock).not.toHaveBeenCalled();
    expect(h.resolveMock).not.toHaveBeenCalled();
    expect(second.token).toBe("access-token-default");
  });

  it("returns the cached session 30 minutes after issue (well outside the T-1h window)", async () => {
    const h = buildHarness();
    h.loginMock.mockResolvedValueOnce(makeTokens({ fromTime: h.clock.now }));

    await h.cache.getSession(TENANT_A);
    h.loginMock.mockClear();
    h.refreshMock.mockClear();

    h.clock.now += 30 * 60 * 1000;

    await h.cache.getSession(TENANT_A);

    expect(h.loginMock).not.toHaveBeenCalled();
    expect(h.refreshMock).not.toHaveBeenCalled();
  });
});

describe("SuiteFleetTokenCache — proactive refresh (T-1h window)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refreshes via auth client when within 1 hour of access-token expiry", async () => {
    const h = buildHarness();
    h.loginMock.mockResolvedValueOnce(makeTokens({ fromTime: h.clock.now }));
    await h.cache.getSession(TENANT_A);

    // Advance to 30 minutes before expiry — inside the T-1h window
    h.clock.now += 23.5 * 60 * 60 * 1000;

    h.refreshMock.mockResolvedValueOnce(
      makeTokens({
        accessToken: "AT.refreshed",
        refreshToken: "RT.refreshed",
        fromTime: h.clock.now,
      }),
    );

    const refreshed = await h.cache.getSession(TENANT_A);

    expect(h.refreshMock).toHaveBeenCalledTimes(1);
    expect(h.refreshMock).toHaveBeenCalledWith({
      clientId: SAMPLE_CREDENTIALS.clientId,
      refreshToken: "refresh-token-default",
    });
    expect(refreshed.token).toBe("AT.refreshed");
    expect(refreshed.renewalToken).toBe("RT.refreshed");
  });

  it("does NOT refresh exactly at T-1h-and-1ms (boundary stays in cache)", async () => {
    const h = buildHarness();
    h.loginMock.mockResolvedValueOnce(makeTokens({ fromTime: h.clock.now }));
    await h.cache.getSession(TENANT_A);
    h.loginMock.mockClear();

    // Default refresh lead time = 1h. Token expires 24h after issue.
    // Move to 23h - 1ms = still > 1h before expiry → cache hit
    h.clock.now += 23 * 60 * 60 * 1000 - 1;

    await h.cache.getSession(TENANT_A);

    expect(h.refreshMock).not.toHaveBeenCalled();
  });

  it("falls back to login when the refresh call throws", async () => {
    const h = buildHarness();
    h.loginMock.mockResolvedValueOnce(makeTokens({ fromTime: h.clock.now }));
    await h.cache.getSession(TENANT_A);

    h.clock.now += 23.5 * 60 * 60 * 1000; // inside T-1h window

    h.refreshMock.mockRejectedValueOnce(new Error("upstream 5xx"));
    h.loginMock.mockResolvedValueOnce(
      makeTokens({
        accessToken: "AT.fallback",
        fromTime: h.clock.now,
      }),
    );

    const result = await h.cache.getSession(TENANT_A);

    expect(h.refreshMock).toHaveBeenCalledTimes(1);
    expect(h.loginMock).toHaveBeenCalledTimes(2); // initial + fallback
    expect(result.token).toBe("AT.fallback");
  });
});

describe("SuiteFleetTokenCache — refresh token expired", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not call refresh when the cached refresh token is past expiry", async () => {
    const h = buildHarness();
    h.loginMock.mockResolvedValueOnce(
      makeTokens({
        accessExpiresInMs: 24 * 60 * 60 * 1000,
        refreshExpiresInMs: 25 * 60 * 60 * 1000, // refresh expires 1h after access for this test
        fromTime: h.clock.now,
      }),
    );
    await h.cache.getSession(TENANT_A);

    // Advance past both expirations
    h.clock.now += 26 * 60 * 60 * 1000;

    h.loginMock.mockResolvedValueOnce(makeTokens({ fromTime: h.clock.now }));

    await h.cache.getSession(TENANT_A);

    expect(h.refreshMock).not.toHaveBeenCalled();
    expect(h.loginMock).toHaveBeenCalledTimes(2);
  });
});

describe("SuiteFleetTokenCache — multi-tenant isolation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("caches sessions per-tenant (different tenants do not share)", async () => {
    const h = buildHarness();
    h.loginMock
      .mockResolvedValueOnce(
        makeTokens({ accessToken: "AT.A", fromTime: h.clock.now }),
      )
      .mockResolvedValueOnce(
        makeTokens({ accessToken: "AT.B", fromTime: h.clock.now }),
      );

    const sessionA = await h.cache.getSession(TENANT_A);
    const sessionB = await h.cache.getSession(TENANT_B);

    expect(sessionA.token).toBe("AT.A");
    expect(sessionB.token).toBe("AT.B");
    expect(h.loginMock).toHaveBeenCalledTimes(2);

    h.loginMock.mockClear();

    const cachedA = await h.cache.getSession(TENANT_A);
    const cachedB = await h.cache.getSession(TENANT_B);

    expect(cachedA.token).toBe("AT.A");
    expect(cachedB.token).toBe("AT.B");
    expect(h.loginMock).not.toHaveBeenCalled();
  });
});

describe("SuiteFleetTokenCache — invalidate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("invalidate(tenantId) drops one tenant's cache (next call re-logs in)", async () => {
    const h = buildHarness();
    h.loginMock
      .mockResolvedValueOnce(
        makeTokens({ accessToken: "AT.first", fromTime: h.clock.now }),
      )
      .mockResolvedValueOnce(
        makeTokens({ accessToken: "AT.relog", fromTime: h.clock.now }),
      );

    await h.cache.getSession(TENANT_A);
    h.cache.invalidate(TENANT_A);

    const relog = await h.cache.getSession(TENANT_A);

    expect(h.loginMock).toHaveBeenCalledTimes(2);
    expect(relog.token).toBe("AT.relog");
  });

  it("invalidate() with no argument drops every tenant's cache", async () => {
    const h = buildHarness();
    h.loginMock
      .mockResolvedValueOnce(makeTokens({ fromTime: h.clock.now }))
      .mockResolvedValueOnce(makeTokens({ fromTime: h.clock.now }))
      .mockResolvedValueOnce(makeTokens({ fromTime: h.clock.now }))
      .mockResolvedValueOnce(makeTokens({ fromTime: h.clock.now }));

    await h.cache.getSession(TENANT_A);
    await h.cache.getSession(TENANT_B);

    h.cache.invalidate();

    await h.cache.getSession(TENANT_A);
    await h.cache.getSession(TENANT_B);

    expect(h.loginMock).toHaveBeenCalledTimes(4);
  });
});

describe("SuiteFleetTokenCache — still-serviceable cached fallback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns cached session when refresh fails AND login fails AND cached is still serviceable", async () => {
    const h = buildHarness();
    h.loginMock.mockResolvedValueOnce(
      makeTokens({ accessToken: "AT.original", fromTime: h.clock.now }),
    );
    await h.cache.getSession(TENANT_A);

    // Move into the T-1h refresh window (23.5h after issue, 30m remaining)
    h.clock.now += 23.5 * 60 * 60 * 1000;

    h.refreshMock.mockRejectedValueOnce(new Error("refresh upstream 5xx"));
    h.loginMock.mockRejectedValueOnce(new Error("login upstream 5xx"));

    const session = await h.cache.getSession(TENANT_A);

    expect(session.token).toBe("AT.original");
    expect(h.refreshMock).toHaveBeenCalledTimes(1);
    expect(h.loginMock).toHaveBeenCalledTimes(2); // initial + the failed retry
  });

  it("returns cached session when credential resolver fails AND cached is still serviceable", async () => {
    const h = buildHarness();
    h.loginMock.mockResolvedValueOnce(
      makeTokens({ accessToken: "AT.original", fromTime: h.clock.now }),
    );
    await h.cache.getSession(TENANT_A);

    h.clock.now += 23.5 * 60 * 60 * 1000;

    h.resolveMock.mockRejectedValueOnce(new Error("Secrets Manager unreachable"));

    const session = await h.cache.getSession(TENANT_A);

    expect(session.token).toBe("AT.original");
    expect(h.refreshMock).not.toHaveBeenCalled();
    expect(h.loginMock).toHaveBeenCalledTimes(1); // only the initial
  });

  it("propagates error when all renewal paths fail AND cached has hard-expired", async () => {
    const h = buildHarness();
    h.loginMock.mockResolvedValueOnce(makeTokens({ fromTime: h.clock.now }));
    await h.cache.getSession(TENANT_A);

    // Past the access-token hard expiry (24h+1h = 25h, both inside refresh
    // token's 180-day window so refresh would normally be tried)
    h.clock.now += 25 * 60 * 60 * 1000;

    h.refreshMock.mockRejectedValueOnce(new Error("refresh failed"));
    h.loginMock.mockRejectedValueOnce(new Error("login failed"));

    await expect(h.cache.getSession(TENANT_A)).rejects.toThrow("login failed");
  });

  it("propagates error when no cached token exists at all", async () => {
    const h = buildHarness();
    h.resolveMock.mockRejectedValueOnce(new Error("Secrets Manager unreachable"));

    await expect(h.cache.getSession(TENANT_A)).rejects.toThrow(
      "Secrets Manager unreachable",
    );
    expect(h.loginMock).not.toHaveBeenCalled();
    expect(h.refreshMock).not.toHaveBeenCalled();
  });
});

describe("SuiteFleetTokenCache — concurrent-request dedup", () => {
  afterEach(() => vi.restoreAllMocks());

  it("dedupes 100 concurrent getSession calls into a single login", async () => {
    const h = buildHarness();
    h.loginMock.mockResolvedValueOnce(
      makeTokens({ accessToken: "AT.shared", fromTime: h.clock.now }),
    );

    const promises = Array.from({ length: 100 }, () => h.cache.getSession(TENANT_A));
    const sessions = await Promise.all(promises);

    expect(h.loginMock).toHaveBeenCalledTimes(1);
    expect(h.resolveMock).toHaveBeenCalledTimes(1);
    expect(sessions).toHaveLength(100);
    for (const session of sessions) {
      expect(session.token).toBe("AT.shared");
    }
  });

  it("dedupes concurrent refresh attempts within the refresh window", async () => {
    const h = buildHarness();
    h.loginMock.mockResolvedValueOnce(makeTokens({ fromTime: h.clock.now }));
    await h.cache.getSession(TENANT_A);

    h.clock.now += 23.5 * 60 * 60 * 1000; // inside T-1h window

    h.refreshMock.mockResolvedValueOnce(
      makeTokens({ accessToken: "AT.refreshed.shared", fromTime: h.clock.now }),
    );

    h.loginMock.mockClear();
    h.resolveMock.mockClear();

    const promises = Array.from({ length: 50 }, () => h.cache.getSession(TENANT_A));
    const sessions = await Promise.all(promises);

    expect(h.refreshMock).toHaveBeenCalledTimes(1);
    expect(h.resolveMock).toHaveBeenCalledTimes(1);
    expect(h.loginMock).not.toHaveBeenCalled();
    for (const session of sessions) {
      expect(session.token).toBe("AT.refreshed.shared");
    }
  });

  it("clears the in-flight entry on failure so retries can proceed", async () => {
    const h = buildHarness();
    h.loginMock.mockRejectedValueOnce(new Error("first attempt fails"));

    await expect(h.cache.getSession(TENANT_A)).rejects.toThrow("first attempt fails");

    // Second call (sequential, after the first failed) should attempt
    // a fresh renewal — not block on a stale in-flight entry.
    h.loginMock.mockResolvedValueOnce(
      makeTokens({ accessToken: "AT.recovered", fromTime: h.clock.now }),
    );

    const session = await h.cache.getSession(TENANT_A);
    expect(session.token).toBe("AT.recovered");
    expect(h.loginMock).toHaveBeenCalledTimes(2);
  });
});

describe("SuiteFleetTokenCache — custom refreshLeadTimeMs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("respects an injected refreshLeadTimeMs of 30 minutes", async () => {
    const clock = { now: Date.parse("2026-04-29T09:00:00.000Z") };
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const loginMock = vi.fn().mockResolvedValueOnce(makeTokens({ fromTime: clock.now }));
    const refreshMock = vi.fn();
    const resolveMock = vi.fn().mockResolvedValue(SAMPLE_CREDENTIALS);

    const cache = createSuiteFleetTokenCache({
      authClient: { login: loginMock, refresh: refreshMock },
      resolveCredentials: resolveMock,
      clock: () => new Date(clock.now),
      refreshLeadTimeMs: 30 * 60 * 1000,
    });

    await cache.getSession(TENANT_A);

    // Token expires 24h after issue. Lead time is 30 min — refresh
    // triggers in the last 30 min before expiry. Advance to T+22h
    // (2h remaining → outside the window) → cache hit, no network.
    clock.now += 22 * 60 * 60 * 1000;

    await cache.getSession(TENANT_A);

    expect(refreshMock).not.toHaveBeenCalled();

    // Advance another 1h 45m → T+23h45m, 15m remaining → inside
    // the 30-min window → refresh
    clock.now += 1 * 60 * 60 * 1000 + 45 * 60 * 1000;
    refreshMock.mockResolvedValueOnce(makeTokens({ fromTime: clock.now }));

    await cache.getSession(TENANT_A);

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

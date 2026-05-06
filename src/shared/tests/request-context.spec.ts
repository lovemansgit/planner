// Unit tests for buildRequestContext + resolveUserContext.
//
// Branches under test:
//   - session present, valid user → resolved tenant + permissions
//   - session present, multi-role user → unioned permission set
//   - session present, user has no public.users mirror → throws Unauthorized
//   - session present, user.disabled_at set → throws Unauthorized
//   - session present, user has no role_assignments → throws Unauthorized
//   - session present, user's tenant has status != 'active' → throws
//     Unauthorized (Day-16 §10.5; the JOIN tenants + status='active'
//     filter is pinned at the SQL layer via the queryChunks regression
//     test below — full 4-state matrix lives in the integration test)
//   - session absent → throws Unauthorized (fail-closed; Posture B
//     hard cutover landed Day 15 — no ALLOW_DEMO_AUTH fallback exists)
//
// Cookie contract (watch-list addition #1) — the cookies.setAll function
// MUST swallow throws so RSC contexts (read-only cookieStore) don't
// surface refresh-token-write failures to the caller. Pinned via the
// "RSC swallow" test below.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockGetUser = vi.fn();
const mockExecute = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, opts: { cookies: { setAll: (xs: unknown[]) => void } }) => {
    // Stash the cookie adapter for the cookie-throw-swallow test.
    cookieAdapterRef.value = opts.cookies;
    return { auth: { getUser: mockGetUser } };
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: () => {
      throw new Error("RSC: cookies are read-only");
    },
  })),
}));

vi.mock("../db", () => ({
  withServiceRole: vi.fn(async (_reason: string, fn: (tx: unknown) => Promise<unknown>) => {
    return await fn({ execute: mockExecute });
  }),
}));

const cookieAdapterRef: { value: { setAll: (xs: unknown[]) => void } | null } = { value: null };

import { UnauthorizedError } from "../errors";
import {
  __resetSessionCacheForTests,
  buildRequestContext,
  resolveSession,
  resolveSessionImpl,
  resolveUserContext,
} from "../request-context";

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
  mockGetUser.mockReset();
  mockExecute.mockReset();
  cookieAdapterRef.value = null;
  // Day-11 P4 double-resolve fix — React's cache() falls back to
  // module-scoped memoization in vitest's no-React-renderer environment.
  // Reset the wrapped resolver so test #N doesn't observe test #(N-1)'s
  // cached session result.
  __resetSessionCacheForTests();
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
  vi.clearAllMocks();
});

/**
 * Flatten drizzle's queryChunks into a single string. queryChunks is an
 * array of StringChunk objects (with `.value: string[]` holding static
 * SQL fragments) and parameter placeholders. For SQL inspection we only
 * care about the static fragments — they carry the JOINs, WHEREs, and
 * keyword clauses that pin query shape. Same pattern as the cron-list
 * tenant-filter regression test.
 */
function flattenSql(sql: unknown): string {
  type Chunk = { value?: readonly string[] };
  const chunks = (sql as { queryChunks?: readonly Chunk[] })?.queryChunks ?? [];
  return chunks
    .flatMap((c) => (Array.isArray(c.value) ? c.value : []))
    .join("");
}

describe("resolveUserContext", () => {
  it("returns null when no rows match (no mirror, no role_assignments, disabled_at set, or non-active tenant)", async () => {
    mockExecute.mockResolvedValueOnce([]);
    const result = await resolveUserContext("user-1");
    expect(result).toBeNull();
  });

  it("queries with JOIN tenants + t.status = 'active' filter (§10.5 regression pin)", async () => {
    // Day-16 §10.5: users on provisioning / suspended / inactive tenants
    // must NOT resolve. The SQL layer is the load-bearing filter — pin
    // its shape at the chunks level so a future refactor can't silently
    // strip the JOIN or the status='active' clause. Real-DB matrix
    // verification lives in tests/integration/auth-end-to-end.spec.ts.
    mockExecute.mockResolvedValueOnce([]);
    await resolveUserContext("user-1");
    const sql = flattenSql(mockExecute.mock.calls[0][0]);
    expect(sql).toMatch(/JOIN\s+tenants\s+t\s+ON\s+t\.id\s*=\s*u\.tenant_id/);
    expect(sql).toMatch(/t\.status\s*=\s*'active'/);
  });

  it("returns tenantId + permissions for a single-role user", async () => {
    mockExecute.mockResolvedValueOnce([
      {
        tenant_id: "tenant-1",
        role_slug: "cs-agent",
        email: "agent@planner.test",
        display_name: "Aria Agent",
      },
    ]);
    const result = await resolveUserContext("user-1");
    expect(result).not.toBeNull();
    expect(result?.tenantId).toBe("tenant-1");
    expect(result?.permissions.has("consignee:read")).toBe(true);
    expect(result?.permissions.has("user:create")).toBe(false);
    expect(result?.email).toBe("agent@planner.test");
    expect(result?.displayName).toBe("Aria Agent");
  });

  it("unions permissions across multiple roles", async () => {
    mockExecute.mockResolvedValueOnce([
      {
        tenant_id: "tenant-1",
        role_slug: "cs-agent",
        email: "agent@planner.test",
        display_name: null,
      },
      {
        tenant_id: "tenant-1",
        role_slug: "ops-manager",
        email: "agent@planner.test",
        display_name: null,
      },
    ]);
    const result = await resolveUserContext("user-1");
    // ops-manager grants subscription:bulk_create; cs-agent does not.
    expect(result?.permissions.has("subscription:bulk_create")).toBe(true);
    // cs-agent grants consignee:read; both roles do.
    expect(result?.permissions.has("consignee:read")).toBe(true);
  });

  it("skips unknown role slugs without throwing (custom roles, post-pilot)", async () => {
    mockExecute.mockResolvedValueOnce([
      {
        tenant_id: "tenant-1",
        role_slug: "tenant-admin",
        email: "admin@planner.test",
        display_name: null,
      },
      {
        tenant_id: "tenant-1",
        role_slug: "unknown-custom-role",
        email: "admin@planner.test",
        display_name: null,
      },
    ]);
    const result = await resolveUserContext("user-1");
    // Tenant-admin's permissions should still be present.
    expect(result?.permissions.has("consignee:bulk_create")).toBe(true);
  });
});

describe("buildRequestContext", () => {
  it("returns the resolved RequestContext when session is present and user is provisioned", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "user-1" } }, error: null });
    mockExecute.mockResolvedValueOnce([
      {
        tenant_id: "tenant-1",
        role_slug: "tenant-admin",
        email: "tenant1@planner.test",
        display_name: "Tenant One",
      },
    ]);

    const ctx = await buildRequestContext("/api/tasks", "req-1");

    expect(ctx.actor.kind).toBe("user");
    if (ctx.actor.kind === "user") {
      expect(ctx.actor.userId).toBe("user-1");
      expect(ctx.actor.tenantId).toBe("tenant-1");
      expect(ctx.actor.email).toBe("tenant1@planner.test");
      expect(ctx.actor.displayName).toBe("Tenant One");
    }
    expect(ctx.tenantId).toBe("tenant-1");
    expect(ctx.requestId).toBe("req-1");
    expect(ctx.path).toBe("/api/tasks");
  });

  it("throws UnauthorizedError when session is present but user has no provisioning", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "user-1" } }, error: null });
    mockExecute.mockResolvedValueOnce([]);

    await expect(buildRequestContext("/api/tasks", "req-2")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("throws UnauthorizedError when no session is present (Posture B fail-closed)", async () => {
    // Post-Stage-2 cutover: no ALLOW_DEMO_AUTH gate exists. No session
    // → UnauthorizedError → 401 / login-redirect. There is no demo
    // fallthrough path remaining. Pinned even with ALLOW_DEMO_AUTH set
    // in the environment (defence against stale Vercel env caches or
    // local-dev legacy configs) — the runtime gate has been retired.
    process.env.ALLOW_DEMO_AUTH = "true";
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    await expect(buildRequestContext("/api/tasks", "req-no-session")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

describe("resolveSession — cache + cross-tenant isolation invariant", () => {
  // React's cache() scopes memoization to the current server-component
  // render lifecycle in production; in vitest's node-without-RSC-renderer
  // environment it falls through (no memoization). The unit tests here
  // verify the design invariants rather than call counts that would only
  // appear under a real RSC render. The end-to-end memoization behavior
  // is observable in production via the auth-end-to-end integration test.

  it("returns the same shape as the underlying impl (cache is shape-preserving)", async () => {
    // Both calls go through impl in tests — but their shapes must match
    // exactly so the cache wrapper can't accidentally re-shape the result.
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockExecute.mockResolvedValue([
      {
        tenant_id: "tenant-1",
        role_slug: "tenant-admin",
        email: "t@planner.test",
        display_name: null,
      },
    ]);

    const cached = await resolveSession();
    const uncached = await resolveSessionImpl();

    expect(cached).toEqual(uncached);
    expect(cached?.userId).toBe("user-1");
    expect(cached?.resolved.tenantId).toBe("tenant-1");
  });

  it("does not leak tenantId across requests (cache reset surfaces the new tenant)", async () => {
    // Request #1: tenant-A.
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "user-A" } }, error: null });
    mockExecute.mockResolvedValueOnce([
      {
        tenant_id: "tenant-A",
        role_slug: "tenant-admin",
        email: "a@planner.test",
        display_name: null,
      },
    ]);

    const reqA = await resolveSession();
    expect(reqA?.resolved.tenantId).toBe("tenant-A");

    // Simulate the next request boundary — fresh cache, different
    // tenant's cookies/session.
    __resetSessionCacheForTests();
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "user-B" } }, error: null });
    mockExecute.mockResolvedValueOnce([
      {
        tenant_id: "tenant-B",
        role_slug: "tenant-admin",
        email: "b@planner.test",
        display_name: null,
      },
    ]);

    const reqB = await resolveSession();
    expect(reqB?.resolved.tenantId).toBe("tenant-B");

    // The two requests resolve distinct tenants — the cache memoizes
    // the lookup within a request, never the identity across requests.
    // Cross-tenant isolation invariant (session-resolved tenantId is the
    // only scoping source) preserved by construction.
    expect(reqA?.resolved.tenantId).not.toBe(reqB?.resolved.tenantId);
  });

  it("uncached resolveSessionImpl always re-runs the full lookup (regression pin for direct callers)", async () => {
    // The exported uncached function is what new code should reach for
    // when isolating from any cache layer — pinned here so a future
    // refactor can't silently introduce caching at the impl boundary.
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockExecute.mockResolvedValue([
      {
        tenant_id: "tenant-1",
        role_slug: "tenant-admin",
        email: "t@planner.test",
        display_name: null,
      },
    ]);

    await resolveSessionImpl();
    await resolveSessionImpl();

    expect(mockGetUser).toHaveBeenCalledTimes(2);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});

describe("@supabase/ssr cookie contract (watch-list addition #1)", () => {
  it("setAll swallows throws from a read-only cookieStore (RSC context simulation)", async () => {
    // Simulate the SDK trying to write a refreshed token cookie. In
    // RSC the underlying cookieStore.set throws; our adapter must
    // swallow so the caller sees the original auth result.
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    // First call wires up cookieAdapterRef inside createServerClient.
    await expect(buildRequestContext("/", "req-cookie")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    expect(cookieAdapterRef.value).not.toBeNull();
    expect(() => {
      cookieAdapterRef.value!.setAll([
        { name: "sb-test", value: "v", options: {} },
      ]);
    }).not.toThrow();
  });
});

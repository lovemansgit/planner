// Unit tests for buildRequestContext + resolveUserContext.
//
// Branches under test:
//   - session present, valid user → resolved tenant + permissions
//   - session present, multi-role user → unioned permission set
//   - session present, user has no public.users mirror → throws Unauthorized
//   - session present, user.disabled_at set → throws Unauthorized
//   - session present, user has no role_assignments → throws Unauthorized
//   - session absent + ALLOW_DEMO_AUTH=true → falls through to demo
//   - session absent + no ALLOW_DEMO_AUTH → throws Unauthorized
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

vi.mock("../demo-context", () => ({
  buildDemoContext: vi.fn(async (path: string, requestId: string) => ({
    actor: {
      kind: "user",
      userId: "demo-user",
      tenantId: "demo-tenant",
      permissions: new Set<string>(),
    },
    tenantId: "demo-tenant",
    requestId,
    path,
  })),
}));

const cookieAdapterRef: { value: { setAll: (xs: unknown[]) => void } | null } = { value: null };

import { buildDemoContext } from "../demo-context";
import { UnauthorizedError } from "../errors";
import { buildRequestContext, resolveUserContext } from "../request-context";

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
  delete process.env.ALLOW_DEMO_AUTH;
  mockGetUser.mockReset();
  mockExecute.mockReset();
  cookieAdapterRef.value = null;
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
  vi.clearAllMocks();
});

describe("resolveUserContext", () => {
  it("returns null when no rows match (no mirror or no role_assignments)", async () => {
    mockExecute.mockResolvedValueOnce([]);
    const result = await resolveUserContext("user-1");
    expect(result).toBeNull();
  });

  it("returns tenantId + permissions for a single-role user", async () => {
    mockExecute.mockResolvedValueOnce([
      { tenant_id: "tenant-1", role_slug: "cs-agent" },
    ]);
    const result = await resolveUserContext("user-1");
    expect(result).not.toBeNull();
    expect(result?.tenantId).toBe("tenant-1");
    expect(result?.permissions.has("consignee:read")).toBe(true);
    expect(result?.permissions.has("user:create")).toBe(false);
  });

  it("unions permissions across multiple roles", async () => {
    mockExecute.mockResolvedValueOnce([
      { tenant_id: "tenant-1", role_slug: "cs-agent" },
      { tenant_id: "tenant-1", role_slug: "ops-manager" },
    ]);
    const result = await resolveUserContext("user-1");
    // ops-manager grants subscription:bulk_create; cs-agent does not.
    expect(result?.permissions.has("subscription:bulk_create")).toBe(true);
    // cs-agent grants consignee:read; both roles do.
    expect(result?.permissions.has("consignee:read")).toBe(true);
  });

  it("skips unknown role slugs without throwing (custom roles, post-pilot)", async () => {
    mockExecute.mockResolvedValueOnce([
      { tenant_id: "tenant-1", role_slug: "tenant-admin" },
      { tenant_id: "tenant-1", role_slug: "unknown-custom-role" },
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
      { tenant_id: "tenant-1", role_slug: "tenant-admin" },
    ]);

    const ctx = await buildRequestContext("/api/tasks", "req-1");

    expect(ctx.actor.kind).toBe("user");
    if (ctx.actor.kind === "user") {
      expect(ctx.actor.userId).toBe("user-1");
      expect(ctx.actor.tenantId).toBe("tenant-1");
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

  it("falls through to demo context when no session AND ALLOW_DEMO_AUTH=true", async () => {
    process.env.ALLOW_DEMO_AUTH = "true";
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const ctx = await buildRequestContext("/admin/webhook-config", "req-3");
    expect(ctx.tenantId).toBe("demo-tenant");
    expect(buildDemoContext).toHaveBeenCalledWith("/admin/webhook-config", "req-3");
  });

  it("throws UnauthorizedError when no session AND no ALLOW_DEMO_AUTH opt-in", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    await expect(buildRequestContext("/api/tasks", "req-4")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(buildDemoContext).not.toHaveBeenCalled();
  });

  it("does NOT fall through to demo when session is present and user is unprovisioned (defence-in-depth)", async () => {
    process.env.ALLOW_DEMO_AUTH = "true";
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "user-1" } }, error: null });
    mockExecute.mockResolvedValueOnce([]);

    // Posture A only allows demo as fallback when there's NO session.
    // A session-bearing-but-unprovisioned user must surface the
    // UnauthorizedError, not silently demote to demo.
    await expect(buildRequestContext("/api/tasks", "req-5")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(buildDemoContext).not.toHaveBeenCalled();
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

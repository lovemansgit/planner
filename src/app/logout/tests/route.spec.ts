// Unit tests for the /logout route handler.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockSignOut = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: () => {},
  })),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      signOut: mockSignOut,
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
  })),
}));

vi.mock("@/shared/db", () => ({
  withServiceRole: vi.fn(),
  setServiceRoleObserver: vi.fn(),
  withTenant: vi.fn(),
}));

import { GET, POST } from "../route";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
  mockSignOut.mockReset();
  mockSignOut.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("/logout POST", () => {
  it("calls supabase.auth.signOut and redirects to /login (303)", async () => {
    const req = new Request("https://app.example/logout", { method: "POST" });
    const res = await POST(req);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://app.example/login");
  });

  it("redirects to /login even when signOut throws (best-effort)", async () => {
    mockSignOut.mockRejectedValueOnce(new Error("transient"));
    const req = new Request("https://app.example/logout", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://app.example/login");
  });
});

describe("/logout GET", () => {
  it("dispatches to POST semantics (signOut + 303 to /login)", async () => {
    const req = new Request("https://app.example/logout", { method: "GET" });
    const res = await GET(req);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://app.example/login");
  });
});

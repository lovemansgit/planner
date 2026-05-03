// Unit tests for the loginAction server action.
//
// Coverage:
//   - empty form fields → inline error, NO audit emit
//   - signInWithPassword failure → user.login_failed audit + reason mapping
//   - reason mapping: invalid_credentials | rate_limited | account_disabled | unknown
//   - tenant resolution on failure: known email → tenant_id set; unknown → null
//   - public.users mirror missing post-auth → sign back out + audit-fail unknown
//   - public.users mirror has disabled_at set → sign back out + audit-fail account_disabled
//   - successful login → user.login_succeeded audit, redirect
//
// LOAD-BEARING HYGIENE TEST (watch-list addition #2): assert that NO
// emitted metadata contains the submitted password under any encoding.
// The test below introspects every emit() call and fails on any value
// that matches the password (or its first/last few characters, or its
// length, or its bcrypt-shape).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockSignInWithPassword = vi.fn();
const mockSignOut = vi.fn();
const mockGetUser = vi.fn();
const mockEmit = vi.fn();
const mockExecute = vi.fn();
const mockHeaders = vi.fn();
const mockRedirect = vi.fn((url: string) => {
  // Match Next.js redirect() semantics: throws a sentinel that the
  // framework would normally catch.
  const e = new Error(`NEXT_REDIRECT:${url}`);
  (e as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};303`;
  throw e;
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mockHeaders()),
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: () => {},
  })),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
      getUser: mockGetUser,
    },
  })),
}));

vi.mock("@/modules/audit", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

vi.mock("@/shared/db", () => ({
  withServiceRole: vi.fn(async (_reason: string, fn: (tx: unknown) => Promise<unknown>) => {
    return await fn({ execute: mockExecute });
  }),
  setServiceRoleObserver: vi.fn(),
}));

import { loginAction } from "../actions";

const PASSWORD = "Sup3rSecret-Pa55word!";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
  mockSignInWithPassword.mockReset();
  mockSignOut.mockReset();
  mockGetUser.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockExecute.mockReset();
  mockHeaders.mockReset();
  mockRedirect.mockClear();
  mockHeaders.mockReturnValue({
    get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.7" : null),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function buildFormData(over: Partial<{ email: string; password: string; next: string }> = {}): FormData {
  const fd = new FormData();
  fd.set("email", over.email ?? "ops@test.example");
  fd.set("password", over.password ?? PASSWORD);
  if (over.next !== undefined) fd.set("next", over.next);
  return fd;
}

/**
 * Verify that no emit call's metadata contains anything derivable from
 * the submitted password. Per watch-list addition #2, password MUST
 * never appear in audit metadata under any encoding.
 */
function assertPasswordNotInAnyEmit(password: string): void {
  for (const call of mockEmit.mock.calls) {
    const arg = call[0] as { metadata?: Record<string, unknown> };
    if (!arg?.metadata) continue;
    const json = JSON.stringify(arg.metadata);
    expect(json).not.toContain(password);
    // Also reject substrings — first 3 / last 3 / length-as-string
    // encodings shouldn't show up either.
    expect(json).not.toContain(password.slice(0, 3));
    expect(json).not.toContain(password.slice(-3));
    expect(json).not.toContain(`"${password.length}"`);
  }
}

describe("loginAction — input validation", () => {
  it("returns inline error when email is missing", async () => {
    const fd = new FormData();
    fd.set("email", "");
    fd.set("password", PASSWORD);
    const result = await loginAction({}, fd);
    expect(result.error).toMatch(/required/i);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("returns inline error when password is missing", async () => {
    const fd = new FormData();
    fd.set("email", "ops@test.example");
    fd.set("password", "");
    const result = await loginAction({}, fd);
    expect(result.error).toMatch(/required/i);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("loginAction — signInWithPassword failure paths", () => {
  it("invalid_credentials reason on Supabase 'Invalid login credentials'", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });
    mockExecute.mockResolvedValueOnce([]); // unknown email

    const result = await loginAction({}, buildFormData());
    expect(result.error).toMatch(/invalid email or password/i);

    expect(mockEmit).toHaveBeenCalledTimes(1);
    const arg = mockEmit.mock.calls[0][0];
    expect(arg.eventType).toBe("user.login_failed");
    expect(arg.actorKind).toBe("system");
    expect(arg.actorId).toBe("auth:login");
    expect(arg.tenantId).toBeNull();
    expect(arg.metadata.reason).toBe("invalid_credentials");
    expect(arg.metadata.email).toBe("ops@test.example");
    expect(arg.metadata.ip_address).toBe("203.0.113.7");
    assertPasswordNotInAnyEmit(PASSWORD);
  });

  it("rate_limited reason on Supabase 'rate limit exceeded'", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Email rate limit exceeded" },
    });
    mockExecute.mockResolvedValueOnce([]);

    const result = await loginAction({}, buildFormData());
    expect(result.error).toMatch(/too many attempts/i);
    expect(mockEmit.mock.calls[0][0].metadata.reason).toBe("rate_limited");
    assertPasswordNotInAnyEmit(PASSWORD);
  });

  it("account_disabled reason on Supabase 'User is banned'", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "User is banned" },
    });
    mockExecute.mockResolvedValueOnce([]);

    const result = await loginAction({}, buildFormData());
    expect(result.error).toMatch(/disabled/i);
    expect(mockEmit.mock.calls[0][0].metadata.reason).toBe("account_disabled");
    assertPasswordNotInAnyEmit(PASSWORD);
  });

  it("unknown reason on unrecognised Supabase error message", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Mystery error from upstream" },
    });
    mockExecute.mockResolvedValueOnce([]);

    const result = await loginAction({}, buildFormData());
    expect(result.error).toMatch(/sign-in failed/i);
    expect(mockEmit.mock.calls[0][0].metadata.reason).toBe("unknown");
    assertPasswordNotInAnyEmit(PASSWORD);
  });

  it("scoped to user's tenant when email matches a known user", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });
    mockExecute.mockResolvedValueOnce([
      { id: "user-1", tenant_id: "tenant-7", disabled_at: null },
    ]);

    await loginAction({}, buildFormData());

    expect(mockEmit.mock.calls[0][0].tenantId).toBe("tenant-7");
    assertPasswordNotInAnyEmit(PASSWORD);
  });

  it("overrides reason to account_disabled when mirror has disabled_at set", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });
    mockExecute.mockResolvedValueOnce([
      { id: "user-1", tenant_id: "tenant-7", disabled_at: "2026-04-30T00:00:00Z" },
    ]);

    await loginAction({}, buildFormData());

    expect(mockEmit.mock.calls[0][0].metadata.reason).toBe("account_disabled");
    expect(mockEmit.mock.calls[0][0].tenantId).toBe("tenant-7");
    assertPasswordNotInAnyEmit(PASSWORD);
  });
});

describe("loginAction — post-success guards", () => {
  it("sign-out + login_failed/unknown when public.users mirror is missing", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "ops@test.example" } },
      error: null,
    });
    mockExecute.mockResolvedValueOnce([]);
    mockSignOut.mockResolvedValueOnce(undefined);

    const result = await loginAction({}, buildFormData());
    expect(result.error).toMatch(/not provisioned/i);
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit.mock.calls[0][0].eventType).toBe("user.login_failed");
    expect(mockEmit.mock.calls[0][0].metadata.reason).toBe("unknown");
    assertPasswordNotInAnyEmit(PASSWORD);
  });

  it("sign-out + login_failed/account_disabled when mirror.disabled_at is set", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "ops@test.example" } },
      error: null,
    });
    mockExecute.mockResolvedValueOnce([
      { id: "user-1", tenant_id: "tenant-7", disabled_at: "2026-04-30T00:00:00Z" },
    ]);
    mockSignOut.mockResolvedValueOnce(undefined);

    const result = await loginAction({}, buildFormData());
    expect(result.error).toMatch(/disabled/i);
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockEmit.mock.calls[0][0].metadata.reason).toBe("account_disabled");
    assertPasswordNotInAnyEmit(PASSWORD);
  });
});

describe("loginAction — success path", () => {
  it("emits user.login_succeeded and redirects to '/' when next is unset", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "ops@test.example" } },
      error: null,
    });
    mockExecute.mockResolvedValueOnce([
      { id: "user-1", tenant_id: "tenant-7", disabled_at: null },
    ]);

    await expect(loginAction({}, buildFormData())).rejects.toThrow(/NEXT_REDIRECT:\//);

    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit.mock.calls[0][0].eventType).toBe("user.login_succeeded");
    expect(mockEmit.mock.calls[0][0].actorKind).toBe("user");
    expect(mockEmit.mock.calls[0][0].actorId).toBe("user-1");
    expect(mockEmit.mock.calls[0][0].tenantId).toBe("tenant-7");
    expect(mockEmit.mock.calls[0][0].metadata.ip_address).toBe("203.0.113.7");
    // Hygiene: success-path metadata does NOT carry email either
    // (derivable via user_id join).
    expect(mockEmit.mock.calls[0][0].metadata).not.toHaveProperty("email");
    assertPasswordNotInAnyEmit(PASSWORD);
  });

  it("redirects to ?next= when supplied and relative", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "ops@test.example" } },
      error: null,
    });
    mockExecute.mockResolvedValueOnce([
      { id: "user-1", tenant_id: "tenant-7", disabled_at: null },
    ]);

    await expect(loginAction({}, buildFormData({ next: "/admin/webhook-config" }))).rejects.toThrow(
      /NEXT_REDIRECT:\/admin\/webhook-config/,
    );
  });

  it("ignores absolute next and redirects to '/' (open-redirect defence)", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "ops@test.example" } },
      error: null,
    });
    mockExecute.mockResolvedValueOnce([
      { id: "user-1", tenant_id: "tenant-7", disabled_at: null },
    ]);

    await expect(
      loginAction({}, buildFormData({ next: "https://evil.example/phish" })),
    ).rejects.toThrow(/NEXT_REDIRECT:\/(?!\/)/);
  });

  it("ignores protocol-relative next (//evil.example) and redirects to '/'", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "ops@test.example" } },
      error: null,
    });
    mockExecute.mockResolvedValueOnce([
      { id: "user-1", tenant_id: "tenant-7", disabled_at: null },
    ]);

    await expect(loginAction({}, buildFormData({ next: "//evil.example" }))).rejects.toThrow(
      /NEXT_REDIRECT:\/(?!\/)/,
    );
  });
});

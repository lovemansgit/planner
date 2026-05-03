// Webhook configuration page queries — unit tests (Day 9 / P4a).
//
// Mocks @/shared/db so unit tests don't need a real DB. Pins the
// permission gate (webhook_config:read), the SQL shape, the
// withTenant reason string, and the URL builder's normalisation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Uuid } from "../../../shared/types";

const mocks = vi.hoisted(() => ({
  withTenant: vi.fn(),
}));

vi.mock("../../../shared/db", () => ({
  withTenant: mocks.withTenant,
}));

import {
  buildWebhookUrl,
  countTier2MismatchesLast24h,
  resolvePublicBaseUrl,
  tier2CredentialsConfigured,
} from "../queries";

const TENANT_ID: Uuid = "8bfc84b0-c139-4f43-b966-5a12eaa7a302";
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";

function makeCtx(perms: ReadonlySet<string>): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      tenantId: TENANT_ID,
      permissions: perms as ReadonlySet<never>,
    },
    tenantId: TENANT_ID,
    requestId: REQUEST_ID,
    path: "/admin/webhook-config",
  } as RequestContext;
}

describe("countTier2MismatchesLast24h", () => {
  beforeEach(() => {
    mocks.withTenant.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the count when audit_events has rows", async () => {
    const fakeTx = { execute: vi.fn(async () => [{ count: 7 }]) };
    mocks.withTenant.mockImplementation(async (_tenantId, fn) => fn(fakeTx));

    const ctx = makeCtx(new Set(["webhook_config:read"]));
    const result = await countTier2MismatchesLast24h(ctx);

    expect(result).toEqual({ count: 7 });
    expect(fakeTx.execute).toHaveBeenCalledTimes(1);
  });

  it("returns count=0 when audit_events has no rows", async () => {
    const fakeTx = { execute: vi.fn(async () => []) };
    mocks.withTenant.mockImplementation(async (_tenantId, fn) => fn(fakeTx));

    const ctx = makeCtx(new Set(["webhook_config:read"]));
    const result = await countTier2MismatchesLast24h(ctx);

    expect(result).toEqual({ count: 0 });
  });

  it("coerces string counts (some pg drivers return COUNT() as string)", async () => {
    const fakeTx = { execute: vi.fn(async () => [{ count: "12" }]) };
    mocks.withTenant.mockImplementation(async (_tenantId, fn) => fn(fakeTx));

    const ctx = makeCtx(new Set(["webhook_config:read"]));
    const result = await countTier2MismatchesLast24h(ctx);

    expect(result).toEqual({ count: 12 });
  });

  it("throws ForbiddenError when actor lacks webhook_config:read", async () => {
    const ctx = makeCtx(new Set(["task:read"]));
    await expect(countTier2MismatchesLast24h(ctx)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });

  it("uses withTenant scoped to ctx.tenantId (not withServiceRole)", async () => {
    const fakeTx = { execute: vi.fn(async () => [{ count: 0 }]) };
    mocks.withTenant.mockImplementation(async (_tenantId, fn) => fn(fakeTx));

    const ctx = makeCtx(new Set(["webhook_config:read"]));
    await countTier2MismatchesLast24h(ctx);

    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    expect(mocks.withTenant.mock.calls[0][0]).toBe(TENANT_ID);
  });
});

describe("tier2CredentialsConfigured", () => {
  beforeEach(() => {
    mocks.withTenant.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns true when EXISTS subquery returns true", async () => {
    const fakeTx = { execute: vi.fn(async () => [{ configured: true }]) };
    mocks.withTenant.mockImplementation(async (_tenantId, fn) => fn(fakeTx));

    const ctx = makeCtx(new Set(["webhook_config:read"]));
    const result = await tier2CredentialsConfigured(ctx);

    expect(result).toBe(true);
  });

  it("returns false when EXISTS subquery returns false", async () => {
    const fakeTx = { execute: vi.fn(async () => [{ configured: false }]) };
    mocks.withTenant.mockImplementation(async (_tenantId, fn) => fn(fakeTx));

    const ctx = makeCtx(new Set(["webhook_config:read"]));
    const result = await tier2CredentialsConfigured(ctx);

    expect(result).toBe(false);
  });

  it("returns false when query returns no rows (defence)", async () => {
    const fakeTx = { execute: vi.fn(async () => []) };
    mocks.withTenant.mockImplementation(async (_tenantId, fn) => fn(fakeTx));

    const ctx = makeCtx(new Set(["webhook_config:read"]));
    const result = await tier2CredentialsConfigured(ctx);

    expect(result).toBe(false);
  });

  it("throws ForbiddenError when actor lacks webhook_config:read", async () => {
    const ctx = makeCtx(new Set([]));
    await expect(tier2CredentialsConfigured(ctx)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });
});

describe("buildWebhookUrl", () => {
  it("composes the URL with tenant id and standard path", () => {
    const url = buildWebhookUrl(TENANT_ID, "https://planner-olive-sigma.vercel.app");
    expect(url).toBe(
      `https://planner-olive-sigma.vercel.app/api/webhooks/suitefleet/${TENANT_ID}`,
    );
  });

  it("normalises a trailing slash on the base URL", () => {
    const url = buildWebhookUrl(TENANT_ID, "https://planner-olive-sigma.vercel.app/");
    expect(url).toBe(
      `https://planner-olive-sigma.vercel.app/api/webhooks/suitefleet/${TENANT_ID}`,
    );
  });

  it("normalises multiple trailing slashes", () => {
    const url = buildWebhookUrl(TENANT_ID, "https://planner-olive-sigma.vercel.app///");
    expect(url).toBe(
      `https://planner-olive-sigma.vercel.app/api/webhooks/suitefleet/${TENANT_ID}`,
    );
  });
});

describe("resolvePublicBaseUrl", () => {
  it("returns PUBLIC_BASE_URL when set", () => {
    expect(resolvePublicBaseUrl({ PUBLIC_BASE_URL: "https://custom.example.com" })).toBe(
      "https://custom.example.com",
    );
  });

  it("falls back to the current Production alias when PUBLIC_BASE_URL absent", () => {
    expect(resolvePublicBaseUrl({})).toBe("https://planner-olive-sigma.vercel.app");
  });

  it("falls back when PUBLIC_BASE_URL is undefined", () => {
    expect(resolvePublicBaseUrl({ PUBLIC_BASE_URL: undefined })).toBe(
      "https://planner-olive-sigma.vercel.app",
    );
  });
});

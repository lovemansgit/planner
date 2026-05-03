// Tenant-lookup unit tests (D8-8). Mocks withServiceRole so unit
// tests don't need a real DB; pins the status policy ('provisioning'
// + 'active' accept; 'suspended' + 'inactive' deny; absence denies).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Uuid } from "../../../shared/types";

const mocks = vi.hoisted(() => ({
  withServiceRole: vi.fn(),
}));

vi.mock("../../../shared/db", () => ({
  withServiceRole: mocks.withServiceRole,
}));

import { tenantAcceptsWebhooks } from "../tenant-lookup";

const TENANT_ID: Uuid = "8bfc84b0-c139-4f43-b966-5a12eaa7a302";

describe("tenantAcceptsWebhooks — DB-backed gate", () => {
  beforeEach(() => {
    mocks.withServiceRole.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns true when the SQL match returns a row", async () => {
    const fakeTx = { execute: vi.fn(async () => [{ accepts: true }]) };
    mocks.withServiceRole.mockImplementation(async (_reason, fn) => fn(fakeTx));

    const accepts = await tenantAcceptsWebhooks(TENANT_ID);

    expect(accepts).toBe(true);
    expect(fakeTx.execute).toHaveBeenCalledTimes(1);
  });

  it("returns false when the SQL match returns no rows (unknown OR denied status)", async () => {
    const fakeTx = { execute: vi.fn(async () => []) };
    mocks.withServiceRole.mockImplementation(async (_reason, fn) => fn(fakeTx));

    const accepts = await tenantAcceptsWebhooks(TENANT_ID);

    expect(accepts).toBe(false);
  });

  it("propagates DB errors (so the route can 500)", async () => {
    mocks.withServiceRole.mockRejectedValue(new Error("connection refused"));

    await expect(tenantAcceptsWebhooks(TENANT_ID)).rejects.toThrow("connection refused");
  });

  it("uses withServiceRole with the documented reason string", async () => {
    const fakeTx = { execute: vi.fn(async () => []) };
    mocks.withServiceRole.mockImplementation(async (_reason, fn) => fn(fakeTx));

    await tenantAcceptsWebhooks(TENANT_ID);

    expect(mocks.withServiceRole).toHaveBeenCalledTimes(1);
    expect(mocks.withServiceRole.mock.calls[0][0]).toBe("webhook receiver: accept-webhooks gate");
  });
});

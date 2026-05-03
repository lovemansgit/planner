// SuiteFleet webhook credential resolver — D8-8 unit tests.
//
// Tests the per-tenant DB-backed read shape: returns the row when
// present, returns null when absent, propagates DB errors. Mocks
// withServiceRole to avoid any real DB connection in unit tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Uuid } from "../../../shared/types";

const mocks = vi.hoisted(() => ({
  withServiceRole: vi.fn(),
}));

vi.mock("../../../shared/db", () => ({
  withServiceRole: mocks.withServiceRole,
}));

import { resolveSuiteFleetWebhookCredentials } from "../suitefleet-webhook-resolver";

const SANDBOX_MERCHANT_588_TENANT_ID: Uuid = "8bfc84b0-c139-4f43-b966-5a12eaa7a302";

describe("resolveSuiteFleetWebhookCredentials — DB-backed lookup", () => {
  beforeEach(() => {
    mocks.withServiceRole.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the row mapped to camelCase shape when a credentials row exists", async () => {
    const fakeTx = {
      execute: vi.fn(async () => [
        {
          client_id: "transcorp-planner-sandbox",
          client_secret_hash: "$2a$10$" + "x".repeat(53),
        },
      ]),
    };
    mocks.withServiceRole.mockImplementation(async (_reason, fn) => fn(fakeTx));

    const result = await resolveSuiteFleetWebhookCredentials(SANDBOX_MERCHANT_588_TENANT_ID);

    expect(result).toEqual({
      clientId: "transcorp-planner-sandbox",
      clientSecretHash: "$2a$10$" + "x".repeat(53),
    });
    expect(fakeTx.execute).toHaveBeenCalledTimes(1);
  });

  it("returns null when the credentials table has no row for the tenant", async () => {
    const fakeTx = { execute: vi.fn(async () => []) };
    mocks.withServiceRole.mockImplementation(async (_reason, fn) => fn(fakeTx));

    const result = await resolveSuiteFleetWebhookCredentials(SANDBOX_MERCHANT_588_TENANT_ID);

    expect(result).toBeNull();
  });

  it("uses withServiceRole (not withTenant) — receiver has no tenant context", async () => {
    const fakeTx = { execute: vi.fn(async () => []) };
    mocks.withServiceRole.mockImplementation(async (_reason, fn) => fn(fakeTx));

    await resolveSuiteFleetWebhookCredentials(SANDBOX_MERCHANT_588_TENANT_ID);

    expect(mocks.withServiceRole).toHaveBeenCalledTimes(1);
    expect(mocks.withServiceRole.mock.calls[0][0]).toBe("webhook receiver: resolve creds");
  });

  it("propagates DB errors (so the route can map them to 500)", async () => {
    mocks.withServiceRole.mockRejectedValue(new Error("connection refused"));

    await expect(
      resolveSuiteFleetWebhookCredentials(SANDBOX_MERCHANT_588_TENANT_ID),
    ).rejects.toThrow("connection refused");
  });

  it("never logs the client_secret_hash value", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const hash = "$2a$10$" + "z".repeat(53);
    const fakeTx = {
      execute: vi.fn(async () => [{ client_id: "ci", client_secret_hash: hash }]),
    };
    mocks.withServiceRole.mockImplementation(async (_reason, fn) => fn(fakeTx));

    await resolveSuiteFleetWebhookCredentials(SANDBOX_MERCHANT_588_TENANT_ID);

    const all = [...logSpy.mock.calls, ...errSpy.mock.calls].map((c) => String(c[0])).join("\n");
    expect(all).not.toContain(hash);
  });
});

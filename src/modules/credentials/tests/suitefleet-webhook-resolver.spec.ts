// SuiteFleet webhook credential resolver — Day 4 / S-4 unit tests.
//
// Same shape as the auth-resolver spec: env-presence + logging hygiene
// + Day-5+ contract (async signature, accepts and ignores tenantId).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialError } from "../../../shared/errors";
import type { Uuid } from "../../../shared/types";

import { resolveSuiteFleetWebhookCredentials } from "../suitefleet-webhook-resolver";

// Sandbox tenant seeded by supabase/seed.sql — see W-1 PR for context.
const SANDBOX_MERCHANT_588_TENANT_ID: Uuid = "8bfc84b0-c139-4f43-b966-5a12eaa7a302";
const TENANT_B: Uuid = "00000000-0000-0000-0000-000000000002";

const COMPLETE_ENV: Readonly<Record<string, string>> = {
  SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_ID: "transcorp-planner-sandbox",
  SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_SECRET: "deadbeefdeadbeefdeadbeefdeadbeef",
};

describe("resolveSuiteFleetWebhookCredentials — happy path", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("returns the two-field webhook secret shape", async () => {
    const creds = await resolveSuiteFleetWebhookCredentials(
      SANDBOX_MERCHANT_588_TENANT_ID,
      COMPLETE_ENV
    );
    expect(creds.clientId).toBe(COMPLETE_ENV.SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_ID);
    expect(creds.clientSecret).toBe(COMPLETE_ENV.SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_SECRET);
  });

  it("returns identical credentials for different tenant ids (Day-4 single-secret behaviour)", async () => {
    const credsA = await resolveSuiteFleetWebhookCredentials(
      SANDBOX_MERCHANT_588_TENANT_ID,
      COMPLETE_ENV
    );
    const credsB = await resolveSuiteFleetWebhookCredentials(TENANT_B, COMPLETE_ENV);
    expect(credsA).toEqual(credsB);
  });

  it("never logs the client secret", async () => {
    await resolveSuiteFleetWebhookCredentials(SANDBOX_MERCHANT_588_TENANT_ID, COMPLETE_ENV);
    const all = [...logSpy.mock.calls, ...errSpy.mock.calls].map((c) => String(c[0])).join("\n");
    expect(all).not.toContain(COMPLETE_ENV.SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_SECRET);
  });

  it("logs the tenant_id for forensic traceability", async () => {
    await resolveSuiteFleetWebhookCredentials(SANDBOX_MERCHANT_588_TENANT_ID, COMPLETE_ENV);
    const all = [...logSpy.mock.calls, ...errSpy.mock.calls].map((c) => String(c[0])).join("\n");
    expect(all).toContain(SANDBOX_MERCHANT_588_TENANT_ID);
  });
});

describe("resolveSuiteFleetWebhookCredentials — missing env vars", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("throws CredentialError when clientId is missing", async () => {
    const env = { ...COMPLETE_ENV, SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_ID: "" };
    await expect(
      resolveSuiteFleetWebhookCredentials(SANDBOX_MERCHANT_588_TENANT_ID, env)
    ).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_ID/),
    });
  });

  it("throws CredentialError when clientSecret is missing", async () => {
    const env = { ...COMPLETE_ENV, SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_SECRET: "" };
    await expect(
      resolveSuiteFleetWebhookCredentials(SANDBOX_MERCHANT_588_TENANT_ID, env)
    ).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_SECRET/),
    });
  });

  it("names every missing var when both are blank", async () => {
    let captured: unknown = null;
    try {
      await resolveSuiteFleetWebhookCredentials(SANDBOX_MERCHANT_588_TENANT_ID, {});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(CredentialError);
    const msg = (captured as Error).message;
    expect(msg).toContain("SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_ID");
    expect(msg).toContain("SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_SECRET");
  });

  it("never logs the client secret on the error path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = { ...COMPLETE_ENV, SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_ID: "" };
    await expect(
      resolveSuiteFleetWebhookCredentials(SANDBOX_MERCHANT_588_TENANT_ID, env)
    ).rejects.toBeInstanceOf(CredentialError);
    const all = [...logSpy.mock.calls, ...errSpy.mock.calls].map((c) => String(c[0])).join("\n");
    expect(all).not.toContain(COMPLETE_ENV.SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_SECRET);
  });
});

describe("resolveSuiteFleetWebhookCredentials — async signature contract", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns a Promise even though Day-4 reads are synchronous", () => {
    const result = resolveSuiteFleetWebhookCredentials(
      SANDBOX_MERCHANT_588_TENANT_ID,
      COMPLETE_ENV
    );
    expect(result).toBeInstanceOf(Promise);
  });
});

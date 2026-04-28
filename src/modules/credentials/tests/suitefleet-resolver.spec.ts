// SuiteFleet credential resolver — Day 4 / S-3 unit tests.
//
// Covers env-var presence + parsing + the Day-5+ contract (signature is
// async-ready, accepts and ignores tenantId, doesn't leak values).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialError } from "../../../shared/errors";
import type { Uuid } from "../../../shared/types";

import { resolveSuiteFleetCredentials } from "../suitefleet-resolver";

const TENANT_A: Uuid = "00000000-0000-0000-0000-000000000001";
const TENANT_B: Uuid = "00000000-0000-0000-0000-000000000002";

const COMPLETE_ENV: Readonly<Record<string, string>> = {
  SUITEFLEET_SANDBOX_USERNAME: "planner@transcorp-intl.com",
  SUITEFLEET_SANDBOX_PASSWORD: "sandbox-secret-string",
  SUITEFLEET_SANDBOX_CLIENT_ID: "transcorpsb",
  SUITEFLEET_SANDBOX_CUSTOMER_ID: "588",
};

describe("resolveSuiteFleetCredentials — happy path", () => {
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

  it("returns the four-field SuiteFleet credential shape", async () => {
    const creds = await resolveSuiteFleetCredentials(TENANT_A, COMPLETE_ENV);

    expect(creds.username).toBe(COMPLETE_ENV.SUITEFLEET_SANDBOX_USERNAME);
    expect(creds.password).toBe(COMPLETE_ENV.SUITEFLEET_SANDBOX_PASSWORD);
    expect(creds.clientId).toBe(COMPLETE_ENV.SUITEFLEET_SANDBOX_CLIENT_ID);
    expect(creds.customerId).toBe(588);
  });

  it("parses customerId as a number, not a string", async () => {
    const creds = await resolveSuiteFleetCredentials(TENANT_A, COMPLETE_ENV);
    expect(typeof creds.customerId).toBe("number");
  });

  it("returns identical credentials for different tenant ids (Day-4 single-secret behaviour)", async () => {
    const credsA = await resolveSuiteFleetCredentials(TENANT_A, COMPLETE_ENV);
    const credsB = await resolveSuiteFleetCredentials(TENANT_B, COMPLETE_ENV);
    expect(credsA).toEqual(credsB);
  });

  it("never logs the password or username", async () => {
    await resolveSuiteFleetCredentials(TENANT_A, COMPLETE_ENV);
    const all = [...logSpy.mock.calls, ...errSpy.mock.calls]
      .map((c) => String(c[0]))
      .join("\n");
    expect(all).not.toContain(COMPLETE_ENV.SUITEFLEET_SANDBOX_PASSWORD);
    expect(all).not.toContain(COMPLETE_ENV.SUITEFLEET_SANDBOX_USERNAME);
  });

  it("logs the tenant_id for forensic traceability", async () => {
    await resolveSuiteFleetCredentials(TENANT_A, COMPLETE_ENV);
    const all = [...logSpy.mock.calls, ...errSpy.mock.calls]
      .map((c) => String(c[0]))
      .join("\n");
    expect(all).toContain(TENANT_A);
  });
});

describe("resolveSuiteFleetCredentials — missing env vars", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("throws CredentialError when username is missing", async () => {
    const env = { ...COMPLETE_ENV, SUITEFLEET_SANDBOX_USERNAME: "" };
    await expect(resolveSuiteFleetCredentials(TENANT_A, env)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/SUITEFLEET_SANDBOX_USERNAME/),
    });
  });

  it("throws CredentialError when password is missing", async () => {
    const env = { ...COMPLETE_ENV, SUITEFLEET_SANDBOX_PASSWORD: "" };
    await expect(resolveSuiteFleetCredentials(TENANT_A, env)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/SUITEFLEET_SANDBOX_PASSWORD/),
    });
  });

  it("throws CredentialError when clientId is missing", async () => {
    const env = { ...COMPLETE_ENV, SUITEFLEET_SANDBOX_CLIENT_ID: "" };
    await expect(resolveSuiteFleetCredentials(TENANT_A, env)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/SUITEFLEET_SANDBOX_CLIENT_ID/),
    });
  });

  it("throws CredentialError when customerId is missing", async () => {
    const env = { ...COMPLETE_ENV, SUITEFLEET_SANDBOX_CUSTOMER_ID: "" };
    await expect(resolveSuiteFleetCredentials(TENANT_A, env)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/SUITEFLEET_SANDBOX_CUSTOMER_ID/),
    });
  });

  it("names every missing var when several are blank", async () => {
    const env = { SUITEFLEET_SANDBOX_USERNAME: "x" };
    let captured: unknown = null;
    try {
      await resolveSuiteFleetCredentials(TENANT_A, env);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(CredentialError);
    const msg = (captured as Error).message;
    expect(msg).toContain("SUITEFLEET_SANDBOX_PASSWORD");
    expect(msg).toContain("SUITEFLEET_SANDBOX_CLIENT_ID");
    expect(msg).toContain("SUITEFLEET_SANDBOX_CUSTOMER_ID");
  });

  it("never logs credential values when reporting missing vars", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = { ...COMPLETE_ENV, SUITEFLEET_SANDBOX_USERNAME: "" };
    await expect(resolveSuiteFleetCredentials(TENANT_A, env)).rejects.toBeInstanceOf(
      CredentialError,
    );
    const all = [...logSpy.mock.calls, ...errSpy.mock.calls]
      .map((c) => String(c[0]))
      .join("\n");
    expect(all).not.toContain(COMPLETE_ENV.SUITEFLEET_SANDBOX_PASSWORD);
    expect(all).not.toContain(COMPLETE_ENV.SUITEFLEET_SANDBOX_CLIENT_ID);
  });
});

describe("resolveSuiteFleetCredentials — customerId parsing", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("rejects a non-numeric customerId", async () => {
    const env = { ...COMPLETE_ENV, SUITEFLEET_SANDBOX_CUSTOMER_ID: "not-a-number" };
    await expect(resolveSuiteFleetCredentials(TENANT_A, env)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/positive integer/),
    });
  });

  it("rejects a negative customerId", async () => {
    const env = { ...COMPLETE_ENV, SUITEFLEET_SANDBOX_CUSTOMER_ID: "-5" };
    await expect(resolveSuiteFleetCredentials(TENANT_A, env)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/positive integer/),
    });
  });

  it("rejects a zero customerId", async () => {
    const env = { ...COMPLETE_ENV, SUITEFLEET_SANDBOX_CUSTOMER_ID: "0" };
    await expect(resolveSuiteFleetCredentials(TENANT_A, env)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/positive integer/),
    });
  });

  it("accepts a valid positive integer string", async () => {
    const env = { ...COMPLETE_ENV, SUITEFLEET_SANDBOX_CUSTOMER_ID: "42" };
    const creds = await resolveSuiteFleetCredentials(TENANT_A, env);
    expect(creds.customerId).toBe(42);
  });
});

describe("resolveSuiteFleetCredentials — async signature contract", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns a Promise even though Day-4 reads are synchronous", () => {
    const result = resolveSuiteFleetCredentials(TENANT_A, COMPLETE_ENV);
    expect(result).toBeInstanceOf(Promise);
  });
});

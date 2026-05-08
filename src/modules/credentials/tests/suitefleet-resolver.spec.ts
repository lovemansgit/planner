// SuiteFleet credential resolver — A1 swap unit tests.
//
// Plan §3.1 — rewrite of pre-A1 env-injection-seam tests. Region creds
// (username / password / clientId) stay env-backed and exercised via
// process.env mutation. Per-merchant customerId reads from DB via
// `withServiceRole`; mocked here per the suitefleet-webhook-resolver.spec.ts
// pattern.
//
// Critical case flip from pre-A1: "returns identical credentials for
// different tenant ids" (Day-4 single-secret behaviour) is INVERTED to
// "returns DIFFERENT credentials for different tenant ids." This is the
// load-bearing diagnostic that A1's swap landed correctly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialError } from "../../../shared/errors";
import type { Uuid } from "../../../shared/types";

const mocks = vi.hoisted(() => ({
  withServiceRole: vi.fn(),
}));

vi.mock("../../../shared/db", () => ({
  withServiceRole: mocks.withServiceRole,
}));

import { resolveSuiteFleetCredentials } from "../suitefleet-resolver";

const TENANT_MPL: Uuid = "8bfc84b0-c139-4f43-b966-5a12eaa7a302";
const TENANT_DNR: Uuid = "00000000-0000-0000-0000-000000000002";
const TENANT_FBU: Uuid = "00000000-0000-0000-0000-000000000003";

const REGION_ENV: Readonly<Record<string, string>> = {
  SUITEFLEET_SANDBOX_USERNAME: "planner@transcorp-intl.com",
  SUITEFLEET_SANDBOX_PASSWORD: "sandbox-secret-string",
  SUITEFLEET_SANDBOX_CLIENT_ID: "transcorpsb",
};

function stubRow(customerCode: string | null) {
  const fakeTx = {
    execute: vi.fn(async () => [{ suitefleet_customer_code: customerCode }]),
  };
  mocks.withServiceRole.mockImplementation(async (_reason, fn) => fn(fakeTx));
  return fakeTx;
}

function stubMissingRow() {
  const fakeTx = { execute: vi.fn(async () => []) };
  mocks.withServiceRole.mockImplementation(async (_reason, fn) => fn(fakeTx));
  return fakeTx;
}

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    SUITEFLEET_SANDBOX_USERNAME: process.env.SUITEFLEET_SANDBOX_USERNAME,
    SUITEFLEET_SANDBOX_PASSWORD: process.env.SUITEFLEET_SANDBOX_PASSWORD,
    SUITEFLEET_SANDBOX_CLIENT_ID: process.env.SUITEFLEET_SANDBOX_CLIENT_ID,
  };
  Object.assign(process.env, REGION_ENV);
  mocks.withServiceRole.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe("resolveSuiteFleetCredentials — happy path", () => {
  it("returns the four-field SuiteFleet credential shape", async () => {
    stubRow("588");
    const creds = await resolveSuiteFleetCredentials(TENANT_MPL);
    expect(creds.username).toBe(REGION_ENV.SUITEFLEET_SANDBOX_USERNAME);
    expect(creds.password).toBe(REGION_ENV.SUITEFLEET_SANDBOX_PASSWORD);
    expect(creds.clientId).toBe(REGION_ENV.SUITEFLEET_SANDBOX_CLIENT_ID);
    expect(creds.customerId).toBe(588);
  });

  it("parses customerId as a number, not a string", async () => {
    stubRow("588");
    const creds = await resolveSuiteFleetCredentials(TENANT_MPL);
    expect(typeof creds.customerId).toBe("number");
  });

  it("returns DIFFERENT customerId values for different tenant ids (per-tenant routing)", async () => {
    // INVERTED from Day-4 single-secret behaviour. Plan §3.1 critical
    // case flip: the resolver MUST return a DISTINCT customerId per
    // tenant — this is the load-bearing diagnostic that A1's swap
    // landed correctly.
    const codes = ["588", "586", "578"];
    let callIndex = 0;
    mocks.withServiceRole.mockImplementation(async (_reason, fn) => {
      const code = codes[callIndex++];
      const fakeTx = {
        execute: vi.fn(async () => [{ suitefleet_customer_code: code }]),
      };
      return fn(fakeTx);
    });
    const credsMPL = await resolveSuiteFleetCredentials(TENANT_MPL);
    const credsDNR = await resolveSuiteFleetCredentials(TENANT_DNR);
    const credsFBU = await resolveSuiteFleetCredentials(TENANT_FBU);
    expect(credsMPL.customerId).toBe(588);
    expect(credsDNR.customerId).toBe(586);
    expect(credsFBU.customerId).toBe(578);
    // Region creds shared across tenants in the same region
    expect(credsMPL.clientId).toBe(credsDNR.clientId);
    expect(credsDNR.clientId).toBe(credsFBU.clientId);
    expect(credsMPL.username).toBe(credsDNR.username);
  });

  it("never logs the password or username", async () => {
    stubRow("588");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await resolveSuiteFleetCredentials(TENANT_MPL);
    const all = [...logSpy.mock.calls, ...errSpy.mock.calls]
      .map((c) => String(c[0]))
      .join("\n");
    expect(all).not.toContain(REGION_ENV.SUITEFLEET_SANDBOX_PASSWORD);
    expect(all).not.toContain(REGION_ENV.SUITEFLEET_SANDBOX_USERNAME);
  });

  it("logs the tenant_id for forensic traceability", async () => {
    stubRow("588");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await resolveSuiteFleetCredentials(TENANT_MPL);
    const all = [...logSpy.mock.calls, ...errSpy.mock.calls]
      .map((c) => String(c[0]))
      .join("\n");
    expect(all).toContain(TENANT_MPL);
  });
});

describe("resolveSuiteFleetCredentials — missing region env vars", () => {
  it("throws CredentialError when SUITEFLEET_SANDBOX_USERNAME is missing", async () => {
    delete process.env.SUITEFLEET_SANDBOX_USERNAME;
    await expect(resolveSuiteFleetCredentials(TENANT_MPL)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/SUITEFLEET_SANDBOX_USERNAME/),
    });
  });

  it("throws CredentialError when SUITEFLEET_SANDBOX_PASSWORD is missing", async () => {
    delete process.env.SUITEFLEET_SANDBOX_PASSWORD;
    await expect(resolveSuiteFleetCredentials(TENANT_MPL)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/SUITEFLEET_SANDBOX_PASSWORD/),
    });
  });

  it("throws CredentialError when SUITEFLEET_SANDBOX_CLIENT_ID is missing", async () => {
    delete process.env.SUITEFLEET_SANDBOX_CLIENT_ID;
    await expect(resolveSuiteFleetCredentials(TENANT_MPL)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/SUITEFLEET_SANDBOX_CLIENT_ID/),
    });
  });

  it("names every missing region env var when several are blank", async () => {
    delete process.env.SUITEFLEET_SANDBOX_USERNAME;
    delete process.env.SUITEFLEET_SANDBOX_PASSWORD;
    delete process.env.SUITEFLEET_SANDBOX_CLIENT_ID;
    let captured: unknown = null;
    try {
      await resolveSuiteFleetCredentials(TENANT_MPL);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(CredentialError);
    const msg = (captured as Error).message;
    expect(msg).toContain("SUITEFLEET_SANDBOX_USERNAME");
    expect(msg).toContain("SUITEFLEET_SANDBOX_PASSWORD");
    expect(msg).toContain("SUITEFLEET_SANDBOX_CLIENT_ID");
  });
});

describe("resolveSuiteFleetCredentials — DB-backed customerId", () => {
  it("throws CredentialError when tenant row not found", async () => {
    stubMissingRow();
    await expect(resolveSuiteFleetCredentials(TENANT_MPL)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/tenant row not found/),
    });
  });

  it("throws CredentialError when suitefleet_customer_code is NULL", async () => {
    stubRow(null);
    await expect(resolveSuiteFleetCredentials(TENANT_MPL)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/missing or empty/),
    });
  });

  it("throws CredentialError when suitefleet_customer_code is empty string", async () => {
    stubRow("");
    await expect(resolveSuiteFleetCredentials(TENANT_MPL)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/missing or empty/),
    });
  });

  it("throws CredentialError when suitefleet_customer_code is whitespace-only", async () => {
    stubRow("   ");
    await expect(resolveSuiteFleetCredentials(TENANT_MPL)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/missing or empty/),
    });
  });

  it("throws CredentialError when suitefleet_customer_code is non-numeric", async () => {
    stubRow("not-a-number");
    await expect(resolveSuiteFleetCredentials(TENANT_MPL)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/positive integer/),
    });
  });

  it("throws CredentialError when suitefleet_customer_code is alphanumeric (e.g. legacy E2E-RUN_ID format)", async () => {
    stubRow("E2E-12345");
    await expect(resolveSuiteFleetCredentials(TENANT_MPL)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/positive integer/),
    });
  });

  it("throws CredentialError when suitefleet_customer_code is zero", async () => {
    stubRow("0");
    await expect(resolveSuiteFleetCredentials(TENANT_MPL)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/positive integer/),
    });
  });

  it("throws CredentialError when suitefleet_customer_code is negative", async () => {
    stubRow("-5");
    await expect(resolveSuiteFleetCredentials(TENANT_MPL)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/positive integer/),
    });
  });

  it("rejects suitefleet_customer_code with a leading zero (canonical form required)", async () => {
    // Defense against silent zero-stripping: "0588" parses to 588 via
    // parseInt but that's lossy. Reject so onboarding writes the
    // canonical form.
    stubRow("0588");
    await expect(resolveSuiteFleetCredentials(TENANT_MPL)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/positive integer/),
    });
  });
});

describe("resolveSuiteFleetCredentials — async signature contract", () => {
  it("returns a Promise (matches Day-5+ AWS Secrets Manager swap signature)", () => {
    stubRow("588");
    const result = resolveSuiteFleetCredentials(TENANT_MPL);
    expect(result).toBeInstanceOf(Promise);
  });
});

// SuiteFleet webhook verifier — D8-8 unit tests.
//
// Covers: header-name correctness (`clientid` / `clientsecret`,
// no dashes, case-insensitive lookup), three-state result (Tier 1,
// Tier 2 success, Tier 2 mismatch), bcrypt-compare swap from the Day-4
// timingSafeEqual primitive, dummy-hash fallback timing-parity for
// missing inputs.

import { describe, expect, it, vi } from "vitest";

import type { SuiteFleetWebhookCredentials } from "../../../../credentials";

import type { HeadersLike } from "../../../types";

import { verifySuiteFleetWebhook } from "../webhook-verifier";

const EXPECTED: SuiteFleetWebhookCredentials = {
  clientId: "transcorp-planner-sandbox",
  // Real bcrypt of "deadbeefdeadbeefdeadbeefdeadbeef" at cost 4 (fast for tests).
  // The actual production hash uses cost 10; tests inject bcryptCompare to
  // bypass real bcrypt cost.
  clientSecretHash: "$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456",
};

const PLAINTEXT_SECRET = "deadbeefdeadbeefdeadbeefdeadbeef";

function makeHeaders(values: Record<string, string | null>): HeadersLike {
  return {
    get(name: string): string | null {
      const target = name.toLowerCase();
      for (const [key, value] of Object.entries(values)) {
        if (key.toLowerCase() === target) return value;
      }
      return null;
    },
  };
}

describe("verifySuiteFleetWebhook — Tier 1 (no creds row)", () => {
  it("returns ok=true with authTier=tier_1_only when expected is null", async () => {
    const headers = makeHeaders({});
    const result = await verifySuiteFleetWebhook(headers, null);
    expect(result).toEqual({ ok: true, authTier: "tier_1_only" });
  });

  it("does NOT call the bcrypt compare when expected is null", async () => {
    const bcryptSpy = vi.fn<(p: string, h: string) => Promise<boolean>>(async () => true);
    const stringSpy = vi.fn<(a: string, b: string) => boolean>(() => true);
    await verifySuiteFleetWebhook(makeHeaders({}), null, stringSpy, bcryptSpy);
    expect(bcryptSpy).not.toHaveBeenCalled();
    expect(stringSpy).not.toHaveBeenCalled();
  });

  it("ignores any present credential headers when expected is null", async () => {
    const headers = makeHeaders({ clientid: "anything", clientsecret: "anything" });
    const result = await verifySuiteFleetWebhook(headers, null);
    expect(result).toEqual({ ok: true, authTier: "tier_1_only" });
  });
});

describe("verifySuiteFleetWebhook — Tier 2 happy path (creds match)", () => {
  it("returns ok=true with authTier=tier_2_passed when both headers match", async () => {
    const headers = makeHeaders({ clientid: EXPECTED.clientId, clientsecret: PLAINTEXT_SECRET });
    const result = await verifySuiteFleetWebhook(
      headers,
      EXPECTED,
      () => true,
      async () => true,
    );
    expect(result).toEqual({ ok: true, authTier: "tier_2_passed" });
  });

  it("matches headers case-insensitively (Headers.get contract)", async () => {
    const headers = makeHeaders({ ClientId: EXPECTED.clientId, ClientSecret: PLAINTEXT_SECRET });
    const result = await verifySuiteFleetWebhook(
      headers,
      EXPECTED,
      () => true,
      async () => true,
    );
    expect(result.ok).toBe(true);
  });

  it("matches headers in all-caps (defensive case test)", async () => {
    const headers = makeHeaders({ CLIENTID: EXPECTED.clientId, CLIENTSECRET: PLAINTEXT_SECRET });
    const result = await verifySuiteFleetWebhook(
      headers,
      EXPECTED,
      () => true,
      async () => true,
    );
    expect(result.ok).toBe(true);
  });

  it("does NOT match the dashed Day-4 header names (correctness regression marker)", async () => {
    // Day-4 scaffold read X-Client-Id / X-Client-Secret. Day-7 capture
    // showed SF actually sends clientid / clientsecret (no dashes). The
    // verifier reads the no-dash names; a Day-4-style header set has no
    // matching keys and the verifier reports missing.
    const headers = makeHeaders({
      "X-Client-Id": EXPECTED.clientId,
      "X-Client-Secret": PLAINTEXT_SECRET,
    });
    const result = await verifySuiteFleetWebhook(
      headers,
      EXPECTED,
      () => true,
      async () => true,
    );
    expect(result).toEqual({ ok: false, reason: "missing_client_id" });
  });
});

describe("verifySuiteFleetWebhook — Tier 2 missing headers", () => {
  it("returns missing_client_id when clientid is absent", async () => {
    const headers = makeHeaders({ clientsecret: PLAINTEXT_SECRET });
    const result = await verifySuiteFleetWebhook(
      headers,
      EXPECTED,
      () => false,
      async () => true,
    );
    expect(result).toEqual({ ok: false, reason: "missing_client_id" });
  });

  it("returns missing_client_id when clientid is empty string", async () => {
    const headers = makeHeaders({ clientid: "", clientsecret: PLAINTEXT_SECRET });
    const result = await verifySuiteFleetWebhook(
      headers,
      EXPECTED,
      () => false,
      async () => true,
    );
    expect(result).toEqual({ ok: false, reason: "missing_client_id" });
  });

  it("returns missing_client_secret when clientsecret is absent", async () => {
    const headers = makeHeaders({ clientid: EXPECTED.clientId });
    const result = await verifySuiteFleetWebhook(
      headers,
      EXPECTED,
      () => true,
      async () => false,
    );
    expect(result).toEqual({ ok: false, reason: "missing_client_secret" });
  });

  it("returns missing_client_secret when clientsecret is empty string", async () => {
    const headers = makeHeaders({ clientid: EXPECTED.clientId, clientsecret: "" });
    const result = await verifySuiteFleetWebhook(
      headers,
      EXPECTED,
      () => true,
      async () => false,
    );
    expect(result).toEqual({ ok: false, reason: "missing_client_secret" });
  });

  it("checks client_id presence before client_secret presence", async () => {
    const headers = makeHeaders({});
    const result = await verifySuiteFleetWebhook(
      headers,
      EXPECTED,
      () => false,
      async () => false,
    );
    expect(result).toEqual({ ok: false, reason: "missing_client_id" });
  });
});

describe("verifySuiteFleetWebhook — Tier 2 value mismatch", () => {
  it("returns client_id_mismatch when clientid differs", async () => {
    const headers = makeHeaders({ clientid: "wrong-id", clientsecret: PLAINTEXT_SECRET });
    const result = await verifySuiteFleetWebhook(
      headers,
      EXPECTED,
      () => false,
      async () => true,
    );
    expect(result).toEqual({ ok: false, reason: "client_id_mismatch" });
  });

  it("returns client_secret_mismatch when clientsecret differs", async () => {
    const headers = makeHeaders({ clientid: EXPECTED.clientId, clientsecret: "wrong-secret" });
    const result = await verifySuiteFleetWebhook(
      headers,
      EXPECTED,
      () => true,
      async () => false,
    );
    expect(result).toEqual({ ok: false, reason: "client_secret_mismatch" });
  });

  it("reports client_id_mismatch first when both are wrong", async () => {
    const headers = makeHeaders({ clientid: "wrong-id", clientsecret: "wrong-secret" });
    const result = await verifySuiteFleetWebhook(
      headers,
      EXPECTED,
      () => false,
      async () => false,
    );
    expect(result).toEqual({ ok: false, reason: "client_id_mismatch" });
  });
});

describe("verifySuiteFleetWebhook — timing-parity property (D8-8 update)", () => {
  it("runs both compares regardless of which header is missing", async () => {
    const stringSpy = vi.fn<(a: string, b: string) => boolean>(() => false);
    const bcryptSpy = vi.fn<(p: string, h: string) => Promise<boolean>>(async () => false);

    // Missing only clientid — clientsecret present
    await verifySuiteFleetWebhook(
      makeHeaders({ clientsecret: PLAINTEXT_SECRET }),
      EXPECTED,
      stringSpy,
      bcryptSpy,
    );
    expect(stringSpy).toHaveBeenCalledTimes(1);
    expect(bcryptSpy).toHaveBeenCalledTimes(1);

    stringSpy.mockClear();
    bcryptSpy.mockClear();

    // Missing only clientsecret — clientid present
    await verifySuiteFleetWebhook(
      makeHeaders({ clientid: EXPECTED.clientId }),
      EXPECTED,
      stringSpy,
      bcryptSpy,
    );
    expect(stringSpy).toHaveBeenCalledTimes(1);
    expect(bcryptSpy).toHaveBeenCalledTimes(1);

    stringSpy.mockClear();
    bcryptSpy.mockClear();

    // Both headers missing
    await verifySuiteFleetWebhook(makeHeaders({}), EXPECTED, stringSpy, bcryptSpy);
    expect(stringSpy).toHaveBeenCalledTimes(1);
    expect(bcryptSpy).toHaveBeenCalledTimes(1);
  });

  it("compares clientId against same-length null-byte fallback when missing", async () => {
    const stringSpy = vi.fn<(a: string, b: string) => boolean>(() => false);
    const bcryptSpy = vi.fn<(p: string, h: string) => Promise<boolean>>(async () => false);

    await verifySuiteFleetWebhook(
      makeHeaders({ clientsecret: PLAINTEXT_SECRET }),
      EXPECTED,
      stringSpy,
      bcryptSpy,
    );

    const firstCall = stringSpy.mock.calls[0];
    expect(firstCall[0]).toHaveLength(EXPECTED.clientId.length);
    expect(firstCall[0]).not.toBe(EXPECTED.clientId);
    expect(firstCall[1]).toBe(EXPECTED.clientId);
  });

  it("runs bcrypt against a fixed dummy 60-char hash when clientsecret is missing", async () => {
    const stringSpy = vi.fn<(a: string, b: string) => boolean>(() => true);
    const bcryptSpy = vi.fn<(p: string, h: string) => Promise<boolean>>(async () => false);

    await verifySuiteFleetWebhook(
      makeHeaders({ clientid: EXPECTED.clientId }),
      EXPECTED,
      stringSpy,
      bcryptSpy,
    );

    const bcryptCall = bcryptSpy.mock.calls[0];
    expect(bcryptCall[0]).toBe("");
    expect(bcryptCall[1]).not.toBe(EXPECTED.clientSecretHash);
    // Dummy hash is a real bcrypt 60-char hash — same shape, different content.
    expect(bcryptCall[1]).toMatch(/^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/);
  });

  it("runs bcrypt against the real stored hash when clientsecret is present (any value)", async () => {
    const stringSpy = vi.fn<(a: string, b: string) => boolean>(() => true);
    const bcryptSpy = vi.fn<(p: string, h: string) => Promise<boolean>>(async () => false);

    await verifySuiteFleetWebhook(
      makeHeaders({ clientid: EXPECTED.clientId, clientsecret: "anything" }),
      EXPECTED,
      stringSpy,
      bcryptSpy,
    );

    const bcryptCall = bcryptSpy.mock.calls[0];
    expect(bcryptCall[0]).toBe("anything");
    expect(bcryptCall[1]).toBe(EXPECTED.clientSecretHash);
  });
});

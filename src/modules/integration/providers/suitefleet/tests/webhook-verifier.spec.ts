// SuiteFleet webhook verifier — Day 4 / S-4 unit tests.
//
// Header presence + value comparison branches. The constant-time
// property of the comparison itself is structural (we use
// `crypto.timingSafeEqual`) and not asserted via wall-clock benchmark
// — those tests are flaky and the standard library guarantees the
// timing property of the primitive.

import { describe, expect, it, vi } from "vitest";

import type { SuiteFleetWebhookCredentials } from "../../../../credentials";

import type { HeadersLike } from "../../../types";

import { verifySuiteFleetWebhook } from "../webhook-verifier";

const EXPECTED: SuiteFleetWebhookCredentials = {
  clientId: "transcorp-planner-sandbox",
  clientSecret: "deadbeefdeadbeefdeadbeefdeadbeef",
};

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

describe("verifySuiteFleetWebhook — happy path", () => {
  it("returns ok=true when both headers match expected values", () => {
    const headers = makeHeaders({
      "X-Client-Id": EXPECTED.clientId,
      "X-Client-Secret": EXPECTED.clientSecret,
    });
    const result = verifySuiteFleetWebhook(headers, EXPECTED);
    expect(result).toEqual({ ok: true });
  });

  it("matches headers case-insensitively (web Headers interface contract)", () => {
    const headers = makeHeaders({
      "x-client-id": EXPECTED.clientId,
      "x-client-secret": EXPECTED.clientSecret,
    });
    expect(verifySuiteFleetWebhook(headers, EXPECTED).ok).toBe(true);
  });
});

describe("verifySuiteFleetWebhook — missing headers", () => {
  it("returns missing_client_id when X-Client-Id is absent", () => {
    const headers = makeHeaders({
      "X-Client-Secret": EXPECTED.clientSecret,
    });
    expect(verifySuiteFleetWebhook(headers, EXPECTED)).toEqual({
      ok: false,
      reason: "missing_client_id",
    });
  });

  it("returns missing_client_id when X-Client-Id is empty string", () => {
    const headers = makeHeaders({
      "X-Client-Id": "",
      "X-Client-Secret": EXPECTED.clientSecret,
    });
    expect(verifySuiteFleetWebhook(headers, EXPECTED)).toEqual({
      ok: false,
      reason: "missing_client_id",
    });
  });

  it("returns missing_client_secret when X-Client-Secret is absent", () => {
    const headers = makeHeaders({
      "X-Client-Id": EXPECTED.clientId,
    });
    expect(verifySuiteFleetWebhook(headers, EXPECTED)).toEqual({
      ok: false,
      reason: "missing_client_secret",
    });
  });

  it("returns missing_client_secret when X-Client-Secret is empty string", () => {
    const headers = makeHeaders({
      "X-Client-Id": EXPECTED.clientId,
      "X-Client-Secret": "",
    });
    expect(verifySuiteFleetWebhook(headers, EXPECTED)).toEqual({
      ok: false,
      reason: "missing_client_secret",
    });
  });

  it("checks client_id presence before client_secret presence", () => {
    const headers = makeHeaders({});
    // Missing both → reports the first missing in the response chain
    expect(verifySuiteFleetWebhook(headers, EXPECTED)).toEqual({
      ok: false,
      reason: "missing_client_id",
    });
  });
});

describe("verifySuiteFleetWebhook — value mismatch", () => {
  it("returns client_id_mismatch when X-Client-Id differs (same length)", () => {
    const headers = makeHeaders({
      "X-Client-Id": "x".repeat(EXPECTED.clientId.length),
      "X-Client-Secret": EXPECTED.clientSecret,
    });
    expect(verifySuiteFleetWebhook(headers, EXPECTED)).toEqual({
      ok: false,
      reason: "client_id_mismatch",
    });
  });

  it("returns client_id_mismatch when X-Client-Id differs (different length)", () => {
    const headers = makeHeaders({
      "X-Client-Id": "x",
      "X-Client-Secret": EXPECTED.clientSecret,
    });
    expect(verifySuiteFleetWebhook(headers, EXPECTED)).toEqual({
      ok: false,
      reason: "client_id_mismatch",
    });
  });

  it("returns client_secret_mismatch when X-Client-Secret differs (same length)", () => {
    const headers = makeHeaders({
      "X-Client-Id": EXPECTED.clientId,
      "X-Client-Secret": "x".repeat(EXPECTED.clientSecret.length),
    });
    expect(verifySuiteFleetWebhook(headers, EXPECTED)).toEqual({
      ok: false,
      reason: "client_secret_mismatch",
    });
  });

  it("returns client_secret_mismatch when X-Client-Secret differs (different length)", () => {
    const headers = makeHeaders({
      "X-Client-Id": EXPECTED.clientId,
      "X-Client-Secret": "x",
    });
    expect(verifySuiteFleetWebhook(headers, EXPECTED)).toEqual({
      ok: false,
      reason: "client_secret_mismatch",
    });
  });

  it("reports client_id mismatch first when both are wrong", () => {
    const headers = makeHeaders({
      "X-Client-Id": "wrong-id",
      "X-Client-Secret": "wrong-secret",
    });
    expect(verifySuiteFleetWebhook(headers, EXPECTED)).toEqual({
      ok: false,
      reason: "client_id_mismatch",
    });
  });
});

describe("verifySuiteFleetWebhook — timing-parity property", () => {
  it("runs both string comparisons regardless of which header is missing", () => {
    const compareSpy = vi.fn<(a: string, b: string) => boolean>(() => false);

    // Missing only X-Client-Id — secret present
    verifySuiteFleetWebhook(
      makeHeaders({ "X-Client-Secret": EXPECTED.clientSecret }),
      EXPECTED,
      compareSpy,
    );
    expect(compareSpy).toHaveBeenCalledTimes(2);

    compareSpy.mockClear();

    // Missing only X-Client-Secret — id present
    verifySuiteFleetWebhook(
      makeHeaders({ "X-Client-Id": EXPECTED.clientId }),
      EXPECTED,
      compareSpy,
    );
    expect(compareSpy).toHaveBeenCalledTimes(2);

    compareSpy.mockClear();

    // Both headers missing
    verifySuiteFleetWebhook(makeHeaders({}), EXPECTED, compareSpy);
    expect(compareSpy).toHaveBeenCalledTimes(2);

    compareSpy.mockClear();

    // Both headers present, both wrong
    verifySuiteFleetWebhook(
      makeHeaders({ "X-Client-Id": "wrong", "X-Client-Secret": "wrong" }),
      EXPECTED,
      compareSpy,
    );
    expect(compareSpy).toHaveBeenCalledTimes(2);
  });

  it("compares against same-length fallback when a header is missing", () => {
    const compareSpy = vi.fn<(a: string, b: string) => boolean>(() => false);

    verifySuiteFleetWebhook(
      makeHeaders({ "X-Client-Secret": EXPECTED.clientSecret }),
      EXPECTED,
      compareSpy,
    );

    // First call: clientId compare. Input is the same-length null-byte
    // fallback, second arg is the expected clientId.
    const firstCall = compareSpy.mock.calls[0];
    expect(firstCall[0]).toHaveLength(EXPECTED.clientId.length);
    expect(firstCall[1]).toBe(EXPECTED.clientId);
    expect(firstCall[0]).not.toBe(EXPECTED.clientId);
  });
});

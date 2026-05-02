// SuiteFleet label-client unit tests — Day 8 / D8-6.
//
// LOAD-BEARING ASSERTIONS:
//   1. URL shape — `https://shipment-label.suitefleet.com/generate-label?
//      taskId=<csv>&type=indv-small&tz_offset=4&token=<token>&clientId=<id>`.
//      Bearer token + clientId in QUERY (per SF endpoint contract);
//      the token-in-query security rule is enforced at the route
//      layer (server-side fetch), the URL itself is constructed
//      here.
//   2. Token DOES land in the URL; clientId DOES land in the URL.
//      A test that asserts token absence would be wrong — the SF
//      endpoint REQUIRES it. The security rule is "this URL must
//      not reach the operator", not "no URL ever has the token".
//   3. tz_offset=4 is hardcoded (Asia/Dubai UTC+4 year-round).
//   4. type=indv-small is hardcoded (only format in pilot).
//   5. Bulk: comma-separated taskId list lands in one URL.
//   6. Returns a Buffer; status 401/5xx → CredentialError; other
//      4xx → ValidationError.
//
// Note: this client uses GET (not POST), so we don't test
// request-body shape. URL construction is the contract.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialError, ValidationError } from "../../../../../shared/errors";

import {
  buildSuiteFleetLabelUrl,
  createSuiteFleetLabelClient,
} from "../label-client";

import type { AuthenticatedSession } from "../../../types";

const SAMPLE_SESSION: AuthenticatedSession = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  token: "eyJ.access.token-VALUE",
  renewalToken: "eyJ.refresh.token",
  tokenExpiresAt: "2026-05-02T13:00:00.000Z",
  renewalTokenExpiresAt: "2026-11-02T12:00:00.000Z",
};

const TASK_ID_A = "11111111-1111-1111-1111-111111111111";
const TASK_ID_B = "22222222-2222-2222-2222-222222222222";

function pdfResponse(bytes = "STUB-PDF", status = 200): Response {
  return new Response(bytes, {
    status,
    headers: { "content-type": "application/pdf" },
  });
}

function plainResponse(text: string, status: number): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain" } });
}

function makeClient(
  fetchMock: ReturnType<typeof vi.fn>,
  options: { baseUrl?: string } = {},
) {
  return createSuiteFleetLabelClient({
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    clientId: "transcorpsb",
    baseUrl: options.baseUrl ?? "https://shipment-label.suitefleet.com",
  });
}

describe("buildSuiteFleetLabelUrl — URL shape (pure function, no I/O)", () => {
  it("builds the canonical URL with all four query params", () => {
    const url = buildSuiteFleetLabelUrl({
      baseUrl: "https://shipment-label.suitefleet.com",
      taskIds: [TASK_ID_A],
      token: "eyJ.access.token",
      clientId: "transcorpsb",
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://shipment-label.suitefleet.com");
    expect(parsed.pathname).toBe("/generate-label");
    expect(parsed.searchParams.get("taskId")).toBe(TASK_ID_A);
    expect(parsed.searchParams.get("type")).toBe("indv-small");
    expect(parsed.searchParams.get("tz_offset")).toBe("4");
    expect(parsed.searchParams.get("token")).toBe("eyJ.access.token");
    expect(parsed.searchParams.get("clientId")).toBe("transcorpsb");
  });

  it("comma-separates multiple task IDs (bulk semantics — one round-trip, multi-page PDF)", () => {
    const url = buildSuiteFleetLabelUrl({
      baseUrl: "https://shipment-label.suitefleet.com",
      taskIds: [TASK_ID_A, TASK_ID_B],
      token: "t",
      clientId: "c",
    });
    expect(new URL(url).searchParams.get("taskId")).toBe(`${TASK_ID_A},${TASK_ID_B}`);
  });

  it("strips trailing slashes from the base URL (parity with task-client)", () => {
    const url = buildSuiteFleetLabelUrl({
      baseUrl: "https://shipment-label.suitefleet.com/",
      taskIds: [TASK_ID_A],
      token: "t",
      clientId: "c",
    });
    expect(new URL(url).pathname).toBe("/generate-label");
  });

  it("URL-encodes the token (defensive — bearer tokens contain '.' and base64 chars)", () => {
    const url = buildSuiteFleetLabelUrl({
      baseUrl: "https://shipment-label.suitefleet.com",
      taskIds: [TASK_ID_A],
      token: "weird/token+with=special&chars",
      clientId: "c",
    });
    // URLSearchParams encodes per application/x-www-form-urlencoded
    // (uses + for space; %2F for /; %2B for +; etc.). The decoded
    // value MUST round-trip cleanly back to the original.
    const parsed = new URL(url);
    expect(parsed.searchParams.get("token")).toBe("weird/token+with=special&chars");
    // Smoke check: the raw URL contains the encoded forms (so the
    // URL itself is wire-safe).
    expect(url).toContain("token=");
    expect(url).toMatch(/token=weird.*?special.*?chars/);
  });
});

describe("createSuiteFleetLabelClient.printLabels — request shape + response handling", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("GETs the canonical SF URL and returns the response body as a Buffer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(pdfResponse("MULTI-PAGE-PDF-BYTES"));
    const buffer = await makeClient(fetchMock).printLabels({
      session: SAMPLE_SESSION,
      taskIds: [TASK_ID_A, TASK_ID_B],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchArgs = fetchMock.mock.calls[0];
    if (!fetchArgs) throw new Error("fetch not called");
    const [url, init] = fetchArgs;
    const parsed = new URL(url as string);
    expect(parsed.origin).toBe("https://shipment-label.suitefleet.com");
    expect(parsed.pathname).toBe("/generate-label");
    expect(parsed.searchParams.get("taskId")).toBe(`${TASK_ID_A},${TASK_ID_B}`);
    expect(parsed.searchParams.get("token")).toBe(SAMPLE_SESSION.token);
    expect(parsed.searchParams.get("clientId")).toBe("transcorpsb");
    expect(parsed.searchParams.get("type")).toBe("indv-small");
    expect(parsed.searchParams.get("tz_offset")).toBe("4");
    // GET — no body, no Content-Type concern
    expect((init as RequestInit | undefined)?.method).toBe("GET");

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.toString("utf8")).toBe("MULTI-PAGE-PDF-BYTES");
  });

  it("throws ValidationError on empty taskIds (defensive — service layer also gates)", async () => {
    const fetchMock = vi.fn();
    await expect(
      makeClient(fetchMock).printLabels({ session: SAMPLE_SESSION, taskIds: [] }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws CredentialError on 401 without retry (single-attempt policy)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("unauthorized", 401));
    await expect(
      makeClient(fetchMock).printLabels({ session: SAMPLE_SESSION, taskIds: [TASK_ID_A] }),
    ).rejects.toBeInstanceOf(CredentialError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws CredentialError on 5xx without retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("oops", 503));
    await expect(
      makeClient(fetchMock).printLabels({ session: SAMPLE_SESSION, taskIds: [TASK_ID_A] }),
    ).rejects.toBeInstanceOf(CredentialError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws ValidationError on 4xx (e.g. 400 — bad taskId)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("bad request", 400));
    await expect(
      makeClient(fetchMock).printLabels({ session: SAMPLE_SESSION, taskIds: [TASK_ID_A] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws CredentialError on network error without retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("ECONNRESET"));
    await expect(
      makeClient(fetchMock).printLabels({ session: SAMPLE_SESSION, taskIds: [TASK_ID_A] }),
    ).rejects.toBeInstanceOf(CredentialError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

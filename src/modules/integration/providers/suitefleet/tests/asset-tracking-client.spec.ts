// SuiteFleet asset-tracking client unit tests — Day 6 / B-1.
//
// Pins:
//   - Spring Data wrapper parsing (the empirical fixture from
//     1 May 2026 probe — the only verifiably-shaped sample we have)
//   - URL construction with `?awbs=` (NOT `?taskId=` — corrected
//     per memory/followup_suitefleet_asset_tracking_api.md)
//   - Header shape (Bearer token + Clientid + Accept)
//   - HTTP error mapping (401 → CredentialError, 5xx → CredentialError,
//     other 4xx → ValidationError)
//   - Validation throws on shape surprises (missing content array,
//     unknown state, unknown type, missing required fields)
//   - Doc-derived inner-record fixture parses cleanly into the
//     internal AssetTrackingPackage shape
//   - totalPages > 1 logs a warning and returns first-page only
//
// What is NOT pinned:
//   - Live network behaviour (covered in tests/sandbox/)
//   - Pagination wiring (B-2 follow-up; this commit only warns and
//     returns first page)

import { describe, expect, it, vi } from "vitest";

import { CredentialError, ValidationError } from "@/shared/errors";
import type { AuthenticatedSession } from "@/modules/integration/types";

import {
  createSuiteFleetAssetTrackingClient,
  parseAssetTrackingPage,
} from "../asset-tracking-client";

const SESSION: AuthenticatedSession = {
  tenantId: "00000000-0000-0000-0000-00000000000a",
  token: "tok-abc",
  renewalToken: "rnw-xyz",
  tokenExpiresAt: "2026-05-02T00:00:00.000Z",
  renewalTokenExpiresAt: "2026-11-01T00:00:00.000Z",
};

const CLIENT_ID = "transcorpsb";
const BASE_URL = "https://api.suitefleet.test";

/**
 * The empirical empty-content wrapper captured 1 May 2026 against
 * task 59113 (AWB MPS-98410409, status DELIVERED). Pinned verbatim:
 * any divergence in field names / types breaks the test. When the
 * first NON-EMPTY response surfaces, this fixture grows to include
 * a populated-content variant alongside.
 */
const EMPIRICAL_EMPTY_WRAPPER = {
  content: [],
  last: true,
  totalElements: 0,
  totalPages: 0,
  first: true,
  number: 0,
  numberOfElements: 0,
  size: 50,
  empty: true,
};

/**
 * Doc-derived populated record. NOT empirically captured — sandbox
 * merchant 588 has no asset-tracking records on any existing task.
 * The shape mirrors the SF doc §6.2 example. When the first real
 * record lands, replace this fixture with the empirical sample.
 */
const DOC_POPULATED_WRAPPER = {
  content: [
    {
      id: 7001,
      taskId: 59113,
      trackingId: "MPS-98410409-1",
      type: "BAGS",
      state: "EN_ROUTE",
      photos: null,
      notes: "leaving warehouse",
      supplementaryQuantity: 1,
      containerId: null,
      collectedBy: { id: 12, name: "Courier A" },
      enrouteBy: { id: 12, name: "Courier A" },
      receivedBy: null,
      returnedBy: null,
    },
    {
      id: 7002,
      taskId: 59113,
      trackingId: "MPS-98410409-2",
      type: "BAGS",
      state: "COLLECTED",
      photos: null,
      notes: null,
      supplementaryQuantity: null,
      containerId: null,
      collectedBy: { id: 12, name: "Courier A" },
      enrouteBy: null,
      receivedBy: null,
      returnedBy: null,
    },
  ],
  last: true,
  totalElements: 2,
  totalPages: 1,
  first: true,
  number: 0,
  numberOfElements: 2,
  size: 50,
  empty: false,
};

function makeFetch(response: Response): typeof globalThis.fetch {
  return vi.fn(async () => response) as unknown as typeof globalThis.fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SuiteFleetAssetTrackingClient — empirical empty wrapper", () => {
  it("parses the empty-content Spring Data wrapper into []", async () => {
    const fetch = makeFetch(jsonResponse(EMPIRICAL_EMPTY_WRAPPER));
    const client = createSuiteFleetAssetTrackingClient({
      fetch,
      clientId: CLIENT_ID,
      baseUrl: BASE_URL,
    });
    const result = await client.fetchByAwb({ session: SESSION, awb: "MPS-98410409" });
    expect(result).toEqual([]);
  });

  it("constructs the URL with ?awbs=<AWB> (not ?taskId=)", async () => {
    const fetchMock = vi.fn(
      async () => jsonResponse(EMPIRICAL_EMPTY_WRAPPER),
    ) as unknown as typeof globalThis.fetch;
    const client = createSuiteFleetAssetTrackingClient({
      fetch: fetchMock,
      clientId: CLIENT_ID,
      baseUrl: BASE_URL,
    });
    await client.fetchByAwb({ session: SESSION, awb: "MPS-98410409" });
    const call = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0];
    expect(call[0]).toBe(`${BASE_URL}/api/task-asset-tracking?awbs=MPS-98410409`);
  });

  it("sends Authorization Bearer + Clientid + Accept headers", async () => {
    const fetchMock = vi.fn(
      async () => jsonResponse(EMPIRICAL_EMPTY_WRAPPER),
    ) as unknown as typeof globalThis.fetch;
    const client = createSuiteFleetAssetTrackingClient({
      fetch: fetchMock,
      clientId: CLIENT_ID,
      baseUrl: BASE_URL,
    });
    await client.fetchByAwb({ session: SESSION, awb: "MPS-98410409" });
    const init = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0][1];
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer tok-abc",
      Clientid: CLIENT_ID,
      Accept: "application/json",
    });
  });
});

describe("SuiteFleetAssetTrackingClient — doc-derived populated fixture", () => {
  it("parses a multi-package response into AssetTrackingPackage[] (one per package)", async () => {
    const fetch = makeFetch(jsonResponse(DOC_POPULATED_WRAPPER));
    const client = createSuiteFleetAssetTrackingClient({
      fetch,
      clientId: CLIENT_ID,
      baseUrl: BASE_URL,
    });
    const result = await client.fetchByAwb({ session: SESSION, awb: "MPS-98410409" });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      externalRecordId: 7001,
      taskIdExternal: 59113,
      trackingId: "MPS-98410409-1",
      awb: "MPS-98410409",
      type: "BAGS",
      state: "EN_ROUTE",
    });
    expect(result[1]).toMatchObject({
      externalRecordId: 7002,
      trackingId: "MPS-98410409-2",
      awb: "MPS-98410409",
      state: "COLLECTED",
    });
  });

  it("derives awb by stripping the trailing -<index> from trackingId", () => {
    const result = parseAssetTrackingPage(DOC_POPULATED_WRAPPER, "FALLBACK");
    expect(result[0].awb).toBe("MPS-98410409");
    expect(result[1].awb).toBe("MPS-98410409");
  });
});

describe("SuiteFleetAssetTrackingClient — error mapping", () => {
  it("maps 401 to CredentialError", async () => {
    const fetch = makeFetch(jsonResponse({ error: "unauth" }, 401));
    const client = createSuiteFleetAssetTrackingClient({
      fetch,
      clientId: CLIENT_ID,
      baseUrl: BASE_URL,
    });
    await expect(
      client.fetchByAwb({ session: SESSION, awb: "MPS-X" }),
    ).rejects.toBeInstanceOf(CredentialError);
  });

  it("maps 5xx to CredentialError (treated as transient upstream)", async () => {
    const fetch = makeFetch(jsonResponse({}, 503));
    const client = createSuiteFleetAssetTrackingClient({
      fetch,
      clientId: CLIENT_ID,
      baseUrl: BASE_URL,
    });
    await expect(
      client.fetchByAwb({ session: SESSION, awb: "MPS-X" }),
    ).rejects.toBeInstanceOf(CredentialError);
  });

  it("maps non-401 4xx to ValidationError", async () => {
    const fetch = makeFetch(jsonResponse({ error: "bad" }, 400));
    const client = createSuiteFleetAssetTrackingClient({
      fetch,
      clientId: CLIENT_ID,
      baseUrl: BASE_URL,
    });
    await expect(
      client.fetchByAwb({ session: SESSION, awb: "MPS-X" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rethrows network errors as CredentialError", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof globalThis.fetch;
    const client = createSuiteFleetAssetTrackingClient({
      fetch: fetchMock,
      clientId: CLIENT_ID,
      baseUrl: BASE_URL,
    });
    await expect(
      client.fetchByAwb({ session: SESSION, awb: "MPS-X" }),
    ).rejects.toBeInstanceOf(CredentialError);
  });
});

describe("SuiteFleetAssetTrackingClient — shape validation throws on surprises", () => {
  it("throws ValidationError when content key is missing", () => {
    expect(() =>
      parseAssetTrackingPage({ totalPages: 0, totalElements: 0 }, "X"),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError when content is not an array", () => {
    expect(() => parseAssetTrackingPage({ content: "nope" }, "X")).toThrow(
      ValidationError,
    );
  });

  it("throws ValidationError on an unknown state value", () => {
    const body = {
      content: [
        {
          id: 1,
          taskId: 1,
          trackingId: "X-1",
          type: "BAGS",
          state: "MYSTERY_STATE",
        },
      ],
    };
    expect(() => parseAssetTrackingPage(body, "X")).toThrow(/unknown state/i);
  });

  it("throws ValidationError on an unknown type value", () => {
    const body = {
      content: [
        {
          id: 1,
          taskId: 1,
          trackingId: "X-1",
          type: "GLITTER",
          state: "COLLECTED",
        },
      ],
    };
    expect(() => parseAssetTrackingPage(body, "X")).toThrow(/unknown type/i);
  });

  it("throws ValidationError when id / taskId / trackingId missing or wrong type", () => {
    const baseRow = { id: 1, taskId: 1, trackingId: "X-1", type: "BAGS", state: "COLLECTED" };
    expect(() =>
      parseAssetTrackingPage({ content: [{ ...baseRow, id: undefined }] }, "X"),
    ).toThrow(ValidationError);
    expect(() =>
      parseAssetTrackingPage({ content: [{ ...baseRow, taskId: "59113" }] }, "X"),
    ).toThrow(ValidationError);
    expect(() =>
      parseAssetTrackingPage({ content: [{ ...baseRow, trackingId: "" }] }, "X"),
    ).toThrow(ValidationError);
  });
});

describe("SuiteFleetAssetTrackingClient — pagination warning", () => {
  it("logs a warning when totalPages > 1 but still returns the first-page records", async () => {
    const paged = { ...DOC_POPULATED_WRAPPER, totalPages: 3, totalElements: 102, last: false };
    const fetch = makeFetch(jsonResponse(paged));
    const client = createSuiteFleetAssetTrackingClient({
      fetch,
      clientId: CLIENT_ID,
      baseUrl: BASE_URL,
    });
    const result = await client.fetchByAwb({ session: SESSION, awb: "MPS-98410409" });
    // Behaviour pinned: still returns the first-page content even when
    // pagination is incomplete. Pagination wiring is a B-2 follow-up.
    expect(result).toHaveLength(2);
  });
});

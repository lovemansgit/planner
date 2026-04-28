// SuiteFleet auth client unit tests — Day 4 / S-2.
//
// Mocked fetch only; no live sandbox calls (those land in S-9). The
// goals here are: wire-shape correctness (URL params, headers, method),
// retry/backoff semantics, error mapping, logging hygiene, timestamp
// parsing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialError } from "@/shared/errors";

import { createSuiteFleetAuthClient } from "../auth-client";

const VALID_RESPONSE = {
  accessToken: "eyJ.access.token",
  refreshToken: "eyJ.refresh.token",
  accessTokenExpiration: "2026-04-30T08:58:15.295614",
  refreshTokenExpiration: "2026-10-26T08:58:15.295618",
  email: "planner@transcorp-intl.com",
  role: { name: "CUSTOMER_ADMIN", permissions: [] },
};

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function plainResponse(text: string, status: number): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain" } });
}

const SAMPLE_CREDENTIALS = {
  username: "planner@transcorp-intl.com",
  password: "p@ss+word with spaces",
  clientId: "transcorpsb",
};

const FIXED_NOW = new Date("2026-04-29T09:00:00.000Z");

function makeClient(
  fetchMock: ReturnType<typeof vi.fn>,
  options: { sleep?: (ms: number) => Promise<void>; baseUrl?: string } = {},
) {
  return createSuiteFleetAuthClient({
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    clock: () => FIXED_NOW,
    sleep: options.sleep ?? (async () => {}),
    baseUrl: options.baseUrl ?? "https://api.suitefleet.com",
  });
}

describe("SuiteFleet auth client — login wire shape", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("POSTs with credentials in the query string, not the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VALID_RESPONSE));
    await makeClient(fetchMock).login(SAMPLE_CREDENTIALS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(typeof url === "string" ? url : (url as URL).toString()).toMatch(
      /^https:\/\/api\.suitefleet\.com\/api\/auth\/authenticate\?/,
    );
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
  });

  it("URL-encodes username and password into query parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VALID_RESPONSE));
    await makeClient(fetchMock).login(SAMPLE_CREDENTIALS);

    const callUrl = String(fetchMock.mock.calls[0][0]);
    const parsed = new URL(callUrl);
    expect(parsed.searchParams.get("username")).toBe(SAMPLE_CREDENTIALS.username);
    expect(parsed.searchParams.get("password")).toBe(SAMPLE_CREDENTIALS.password);
    expect(callUrl).toContain("password=p%40ss%2Bword+with+spaces");
  });

  it("sends Clientid header with capital C", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VALID_RESPONSE));
    await makeClient(fetchMock).login(SAMPLE_CREDENTIALS);

    const init = fetchMock.mock.calls[0][1];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Clientid).toBe("transcorpsb");
    expect(headers).not.toHaveProperty("clientId");
    expect(headers).not.toHaveProperty("client-id");
  });

  it("returns parsed token set with UTC-interpreted expirations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VALID_RESPONSE));
    const tokens = await makeClient(fetchMock).login(SAMPLE_CREDENTIALS);

    expect(tokens.accessToken).toBe(VALID_RESPONSE.accessToken);
    expect(tokens.refreshToken).toBe(VALID_RESPONSE.refreshToken);
    expect(tokens.accessTokenExpiresAt.toISOString()).toBe("2026-04-30T08:58:15.295Z");
    expect(tokens.refreshTokenExpiresAt.toISOString()).toBe("2026-10-26T08:58:15.295Z");
  });
});

describe("SuiteFleet auth client — refresh wire shape", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("GETs the refresh endpoint with Cookie + Clientid headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VALID_RESPONSE));
    await makeClient(fetchMock).refresh({
      clientId: "transcorpsb",
      refreshToken: "eyJ.previous.refresh",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.suitefleet.com/api/auth/refresh");
    expect(init?.method).toBe("GET");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Clientid).toBe("transcorpsb");
    expect(headers.Cookie).toBe("refreshToken=eyJ.previous.refresh");
  });

  it("rejects with CredentialError on 401 without retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("unauthorized", 401));
    await expect(
      makeClient(fetchMock).refresh({
        clientId: "transcorpsb",
        refreshToken: "stale.token",
      }),
    ).rejects.toBeInstanceOf(CredentialError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("SuiteFleet auth client — retry policy", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("retries on 5xx with the configured delay sequence and eventually throws", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("oops", 503));
    const sleepCalls: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleepCalls.push(ms);
    });
    const client = makeClient(fetchMock, { sleep });

    await expect(client.login(SAMPLE_CREDENTIALS)).rejects.toBeInstanceOf(CredentialError);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleepCalls).toEqual([250, 500, 1000]);
  });

  it("retries on network error and succeeds on second attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(VALID_RESPONSE));
    const client = makeClient(fetchMock);

    const tokens = await client.login(SAMPLE_CREDENTIALS);
    expect(tokens.accessToken).toBe(VALID_RESPONSE.accessToken);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 4xx and throws CredentialError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("bad request", 400));
    const sleep = vi.fn(async () => {});
    const client = makeClient(fetchMock, { sleep });

    await expect(client.login(SAMPLE_CREDENTIALS)).rejects.toBeInstanceOf(CredentialError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rejects with CredentialError on 401 with credentials-invalid message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("nope", 401));
    const client = makeClient(fetchMock);

    await expect(client.login(SAMPLE_CREDENTIALS)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/credentials invalid/),
    });
  });

  it("preserves the underlying network error as cause on exhaustion", async () => {
    const networkError = new TypeError("ECONNRESET");
    const fetchMock = vi.fn().mockRejectedValue(networkError);
    const client = makeClient(fetchMock);

    let captured: unknown = null;
    try {
      await client.login(SAMPLE_CREDENTIALS);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(CredentialError);
    expect((captured as Error).cause).toBe(networkError);
  });
});

describe("SuiteFleet auth client — response validation", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("rejects when the response body is not valid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("not-json", 200));
    await expect(makeClient(fetchMock).login(SAMPLE_CREDENTIALS)).rejects.toBeInstanceOf(
      CredentialError,
    );
  });

  it("rejects when required fields are missing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ accessToken: "x" }));
    await expect(makeClient(fetchMock).login(SAMPLE_CREDENTIALS)).rejects.toBeInstanceOf(
      CredentialError,
    );
  });

  it("rejects when accessTokenExpiration is unparseable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ...VALID_RESPONSE, accessTokenExpiration: "not-a-date" }),
    );
    await expect(makeClient(fetchMock).login(SAMPLE_CREDENTIALS)).rejects.toBeInstanceOf(
      CredentialError,
    );
  });

  it("rejects when access token is already expired (clock skew defence)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ...VALID_RESPONSE,
        accessTokenExpiration: "2026-04-29T08:00:00.000000",
      }),
    );
    await expect(makeClient(fetchMock).login(SAMPLE_CREDENTIALS)).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/expiration is in the past/),
    });
  });
});

describe("SuiteFleet auth client — logging hygiene", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  function allLogged(): string {
    const all: string[] = [];
    for (const call of consoleLogSpy.mock.calls) all.push(String(call[0]));
    for (const call of consoleErrorSpy.mock.calls) all.push(String(call[0]));
    return all.join("\n");
  }

  it("never logs the password, username, or any token on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VALID_RESPONSE));
    await makeClient(fetchMock).login(SAMPLE_CREDENTIALS);

    const combined = allLogged();
    expect(combined).not.toContain(SAMPLE_CREDENTIALS.password);
    expect(combined).not.toContain(SAMPLE_CREDENTIALS.username);
    expect(combined).not.toContain(VALID_RESPONSE.accessToken);
    expect(combined).not.toContain(VALID_RESPONSE.refreshToken);
  });

  it("never logs the password or username on 5xx retry exhaustion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("oops", 503));
    const client = makeClient(fetchMock, { sleep: async () => {} });

    await expect(client.login(SAMPLE_CREDENTIALS)).rejects.toBeInstanceOf(CredentialError);

    const combined = allLogged();
    expect(combined).not.toContain(SAMPLE_CREDENTIALS.password);
    expect(combined).not.toContain(SAMPLE_CREDENTIALS.username);
  });

  it("never logs the refresh token during a refresh call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VALID_RESPONSE));
    await makeClient(fetchMock).refresh({
      clientId: "transcorpsb",
      refreshToken: "eyJ.unique.refresh.marker",
    });

    const combined = allLogged();
    expect(combined).not.toContain("eyJ.unique.refresh.marker");
    expect(combined).not.toContain(VALID_RESPONSE.accessToken);
    expect(combined).not.toContain(VALID_RESPONSE.refreshToken);
  });
});

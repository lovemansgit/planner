// SuiteFleet webhook route handler — Day 4 / S-4 unit test.
//
// Specifically covers the Day-4 single-tenant sentinel: the route
// handler passes a hardcoded zero-UUID to the credential resolver
// because the URL is flat (no [tenantId] dynamic param yet). The
// `TODO(Day-5)` marker in route.ts pins the swap; this test pins
// the current behaviour so the swap is observable.
//
// vi.hoisted is required because vi.mock factories run before the
// import statements in the file body — a top-level `const` initialiser
// would still be `undefined` at mock-factory-execution time.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSuiteFleetWebhookCredentials: vi.fn(),
  verifySuiteFleetWebhook: vi.fn(),
}));

// `server-only` is a Next.js virtual module that throws on client
// import to enforce server-side-only code paths. In a vitest node
// environment it isn't resolvable, so we stub it to an empty module.
vi.mock("server-only", () => ({}));

vi.mock("@/modules/credentials", () => ({
  resolveSuiteFleetWebhookCredentials: mocks.resolveSuiteFleetWebhookCredentials,
}));

vi.mock("@/modules/integration", () => ({
  verifySuiteFleetWebhook: mocks.verifySuiteFleetWebhook,
}));

import { POST } from "@/app/api/webhooks/suitefleet/route";

const SAMPLE_CREDS = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
};

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/webhooks/suitefleet", {
    method: "POST",
    headers,
    body: JSON.stringify([{ event: "test" }]),
  });
}

describe("webhook route — Day-4 single-tenant sentinel", () => {
  beforeEach(() => {
    mocks.resolveSuiteFleetWebhookCredentials.mockReset();
    mocks.resolveSuiteFleetWebhookCredentials.mockResolvedValue(SAMPLE_CREDS);
    mocks.verifySuiteFleetWebhook.mockReset();
    mocks.verifySuiteFleetWebhook.mockReturnValue({ ok: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls the webhook credential resolver with the zero-UUID Day-4 sentinel", async () => {
    await POST(makeRequest({
      "X-Client-Id": SAMPLE_CREDS.clientId,
      "X-Client-Secret": SAMPLE_CREDS.clientSecret,
    }));

    expect(mocks.resolveSuiteFleetWebhookCredentials).toHaveBeenCalledTimes(1);
    expect(mocks.resolveSuiteFleetWebhookCredentials).toHaveBeenCalledWith(ZERO_UUID);
  });

  it("passes the same sentinel even when verification fails (sentinel is route-fixed, not auth-conditional)", async () => {
    mocks.verifySuiteFleetWebhook.mockReturnValue({
      ok: false,
      reason: "client_id_mismatch",
    });

    const response = await POST(makeRequest({
      "X-Client-Id": "wrong",
      "X-Client-Secret": "wrong",
    }));

    expect(response.status).toBe(401);
    expect(mocks.resolveSuiteFleetWebhookCredentials).toHaveBeenCalledWith(ZERO_UUID);
  });
});

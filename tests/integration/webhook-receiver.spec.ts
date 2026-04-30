// SuiteFleet webhook receiver — Day 6 / W-1 integration test.
//
// Pins the dynamic-route migration's status-code contract:
//
//   - valid tenantId + valid creds  → 200
//   - invalid tenantId in URL       → 400 (Zod parse failure → ValidationError)
//   - missing creds (CredentialError throw) → 500 (bare, not 502)
//
// "Integration" by vitest project tag — this lives in tests/integration/
// because the route handler imports server-only Next.js code paths and
// the shared error helper, which are heavier than a pure unit. The
// adapter is stubbed via vi.mock at the get-adapter module per the
// brief: "tests inject a different adapter via DI in their setup."
//
// vi.hoisted is required because vi.mock factories run before the
// import statements in the file body — a top-level `const` initialiser
// would still be `undefined` at mock-factory-execution time.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialError } from "@/shared/errors";
import type { Uuid } from "@/shared/types";

const mocks = vi.hoisted(() => ({
  verifyWebhookRequest: vi.fn(),
}));

// `server-only` is a Next.js virtual module that throws on client
// import to enforce server-side-only code paths. In a vitest node
// environment it isn't resolvable, so we stub it to an empty module.
vi.mock("server-only", () => ({}));

vi.mock("@/modules/integration/providers/suitefleet/get-adapter", () => ({
  getSuiteFleetAdapter: () => ({
    // Only verifyWebhookRequest is exercised by the route handler.
    // Other adapter methods are unused on this code path; stubs would
    // be dead code.
    verifyWebhookRequest: mocks.verifyWebhookRequest,
  }),
}));

import { POST } from "@/app/api/webhooks/suitefleet/[tenantId]/route";

// Real v4 UUID — Zod 4's `.uuid()` enforces version-digit-4.
const VALID_TENANT_ID: Uuid = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/webhooks/suitefleet/${VALID_TENANT_ID}`, {
    method: "POST",
    headers,
    body: JSON.stringify([{ event: "test" }]),
  });
}

function makeContext(tenantId: string): { params: Promise<{ tenantId: string }> } {
  return { params: Promise.resolve({ tenantId }) };
}

describe("webhook receiver — W-1 dynamic per-tenant route", () => {
  beforeEach(() => {
    mocks.verifyWebhookRequest.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns 200 when adapter.verifyWebhookRequest reports ok", async () => {
    mocks.verifyWebhookRequest.mockResolvedValue({ ok: true });

    const response = await POST(makeRequest(), makeContext(VALID_TENANT_ID));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(mocks.verifyWebhookRequest).toHaveBeenCalledTimes(1);
    expect(mocks.verifyWebhookRequest).toHaveBeenCalledWith(
      VALID_TENANT_ID,
      expect.any(Headers),
      null
    );
  });

  it("returns 400 with ValidationError envelope when tenantId in URL is not a uuid", async () => {
    const response = await POST(makeRequest(), makeContext("not-a-uuid"));

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe("VALIDATION");
    expect(mocks.verifyWebhookRequest).not.toHaveBeenCalled();
  });

  it("returns 500 when adapter throws CredentialError (missing webhook creds)", async () => {
    mocks.verifyWebhookRequest.mockRejectedValue(
      new CredentialError("SuiteFleet webhook secrets missing from environment")
    );

    const response = await POST(makeRequest(), makeContext(VALID_TENANT_ID));

    expect(response.status).toBe(500);
    expect(mocks.verifyWebhookRequest).toHaveBeenCalledTimes(1);
  });
});

// SuiteFleet webhook receiver — Day 6 / W-1 integration test.
//
// Pins the dynamic-route migration's status-code contract AND the
// "body-not-read-until-verified" DOS-surface guarantee:
//
//   - valid tenantId + valid creds            → 200
//   - invalid tenantId in URL                 → 400 (ValidationError envelope)
//   - missing creds (CredentialError throw)   → 500 (bare, not 502)
//   - verification mismatch (ok:false reason) → 401 + body NOT consumed
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

  it("returns 401 and does NOT read request body when verification reports mismatch", async () => {
    mocks.verifyWebhookRequest.mockResolvedValue({
      ok: false,
      reason: "client_id_mismatch",
    });

    // Spy on the request body read. The route MUST NOT call req.text()
    // (or any other body-consuming method) before verification succeeds —
    // this is the DOS-surface guarantee documented at the route header.
    const req = makeRequest({ "X-Client-Id": "wrong", "X-Client-Secret": "wrong" });
    const textSpy = vi.spyOn(req, "text");
    const jsonSpy = vi.spyOn(req, "json");
    const arrayBufferSpy = vi.spyOn(req, "arrayBuffer");

    const response = await POST(req, makeContext(VALID_TENANT_ID));

    expect(response.status).toBe(401);
    expect(mocks.verifyWebhookRequest).toHaveBeenCalledTimes(1);
    expect(textSpy).not.toHaveBeenCalled();
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });
});

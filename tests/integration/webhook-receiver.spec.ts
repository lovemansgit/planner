// SuiteFleet webhook receiver integration tests (D8-8 hardening).
//
// Pins the new verification chain at the route layer:
//   1. UUID well-formedness     → 400 (ValidationError envelope)
//   2. Tenant accept-webhooks   → 401 (silent — no body read)
//   3. Body JSON parse          → 400
//   4. Body shape (array)       → 400
//   5. Verify creds:
//      - Tier 1 (no creds row)        → 200 + log auth_tier=tier_1_only
//      - Tier 2 success               → 200 + log auth_tier=tier_2_passed
//      - Tier 2 mismatch              → 401 + audit emit
//   8. Return 200 on success
//
// Mocks at module boundaries:
//   - getSuiteFleetAdapter (verifyWebhookRequest + parseWebhookEvents)
//   - tenantAcceptsWebhooks (gate)
//   - audit.emit (Tier-2 mismatch path)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Uuid } from "@/shared/types";

const mocks = vi.hoisted(() => ({
  verifyWebhookRequest: vi.fn(),
  parseWebhookEvents: vi.fn(),
  tenantAcceptsWebhooks: vi.fn(),
  auditEmit: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/modules/integration/providers/suitefleet/get-adapter", () => ({
  getSuiteFleetAdapter: () => ({
    verifyWebhookRequest: mocks.verifyWebhookRequest,
    parseWebhookEvents: mocks.parseWebhookEvents,
  }),
}));

vi.mock("@/modules/identity", () => ({
  tenantAcceptsWebhooks: mocks.tenantAcceptsWebhooks,
}));

vi.mock("@/modules/audit", () => ({
  emit: mocks.auditEmit,
}));

import { POST } from "@/app/api/webhooks/suitefleet/[tenantId]/route";

const VALID_TENANT_ID: Uuid = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

const VALID_BODY = JSON.stringify([
  {
    id: 58957,
    awb: "TBC-55891430",
    action: "TASK_STATUS_UPDATED_TO_DELIVERED",
  },
]);

function makeRequest(
  body: string | null = VALID_BODY,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost/api/webhooks/suitefleet/${VALID_TENANT_ID}`, {
    method: "POST",
    headers,
    body,
  });
}

function makeContext(tenantId: string): { params: Promise<{ tenantId: string }> } {
  return { params: Promise.resolve({ tenantId }) };
}

describe("webhook receiver — Step 1: UUID well-formedness", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns 400 with ValidationError envelope when tenantId in URL is not a uuid", async () => {
    const response = await POST(makeRequest(), makeContext("not-a-uuid"));

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe("VALIDATION");
    expect(mocks.tenantAcceptsWebhooks).not.toHaveBeenCalled();
    expect(mocks.verifyWebhookRequest).not.toHaveBeenCalled();
  });
});

describe("webhook receiver — Step 2: tenant accept-webhooks gate", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns 401 silently and does NOT read body when tenant doesn't accept webhooks", async () => {
    mocks.tenantAcceptsWebhooks.mockResolvedValue(false);

    const req = makeRequest();
    const textSpy = vi.spyOn(req, "text");
    const jsonSpy = vi.spyOn(req, "json");

    const response = await POST(req, makeContext(VALID_TENANT_ID));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(textSpy).not.toHaveBeenCalled();
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mocks.verifyWebhookRequest).not.toHaveBeenCalled();
    expect(mocks.auditEmit).not.toHaveBeenCalled();
  });

  it("returns 500 on tenant lookup error (non-2xx Sentry-captured)", async () => {
    mocks.tenantAcceptsWebhooks.mockRejectedValue(new Error("DB connection refused"));

    const response = await POST(makeRequest(), makeContext(VALID_TENANT_ID));

    expect(response.status).toBe(500);
    expect(mocks.verifyWebhookRequest).not.toHaveBeenCalled();
  });
});

describe("webhook receiver — Steps 3+4: body parse + shape", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.tenantAcceptsWebhooks.mockResolvedValue(true);
    mocks.parseWebhookEvents.mockReturnValue([]);
    mocks.verifyWebhookRequest.mockResolvedValue({ ok: true, authTier: "tier_1_only" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns 400 ValidationError when body is not valid JSON", async () => {
    const response = await POST(makeRequest("not json{"), makeContext(VALID_TENANT_ID));

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error?: { code?: string; message?: string } };
    expect(json.error?.code).toBe("VALIDATION");
    expect(json.error?.message).toMatch(/not valid JSON/);
    expect(mocks.verifyWebhookRequest).not.toHaveBeenCalled();
  });

  it("returns 400 ValidationError when body is not a JSON array", async () => {
    const response = await POST(
      makeRequest(JSON.stringify({ not: "an array" })),
      makeContext(VALID_TENANT_ID),
    );

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error?: { code?: string; message?: string } };
    expect(json.error?.code).toBe("VALIDATION");
    expect(json.error?.message).toMatch(/JSON array/);
  });

  it("returns 200 for an empty array (vacuously valid batch)", async () => {
    const response = await POST(makeRequest(JSON.stringify([])), makeContext(VALID_TENANT_ID));

    expect(response.status).toBe(200);
    expect(mocks.parseWebhookEvents).toHaveBeenCalledWith([]);
  });
});

describe("webhook receiver — Step 5: verify creds (Tier 1 / Tier 2 / mismatch)", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.tenantAcceptsWebhooks.mockResolvedValue(true);
    mocks.parseWebhookEvents.mockReturnValue([]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns 200 with Tier-1 path when verifier emits authTier=tier_1_only (no creds row)", async () => {
    mocks.verifyWebhookRequest.mockResolvedValue({ ok: true, authTier: "tier_1_only" });

    const response = await POST(makeRequest(), makeContext(VALID_TENANT_ID));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(mocks.auditEmit).not.toHaveBeenCalled();
  });

  it("returns 200 with Tier-2 path when verifier emits authTier=tier_2_passed", async () => {
    mocks.verifyWebhookRequest.mockResolvedValue({ ok: true, authTier: "tier_2_passed" });

    const response = await POST(
      makeRequest(VALID_BODY, { clientid: "ci", clientsecret: "cs" }),
      makeContext(VALID_TENANT_ID),
    );

    expect(response.status).toBe(200);
    expect(mocks.auditEmit).not.toHaveBeenCalled();
  });

  it("returns 401 + emits webhook.auth_failed audit on Tier-2 mismatch", async () => {
    mocks.verifyWebhookRequest.mockResolvedValue({
      ok: false,
      reason: "client_secret_mismatch",
    });
    mocks.auditEmit.mockResolvedValue(undefined);

    const response = await POST(
      makeRequest(VALID_BODY, { clientid: "ci", clientsecret: "wrong" }),
      makeContext(VALID_TENANT_ID),
    );

    expect(response.status).toBe(401);
    expect(mocks.auditEmit).toHaveBeenCalledTimes(1);
    const audit = mocks.auditEmit.mock.calls[0][0];
    expect(audit.eventType).toBe("webhook.auth_failed");
    expect(audit.actorKind).toBe("system");
    expect(audit.actorId).toBe("system:webhook_receiver");
    expect(audit.tenantId).toBe(VALID_TENANT_ID);
    expect(audit.metadata.failure).toBe("creds_mismatch");
    expect(audit.metadata.tenant_id).toBe(VALID_TENANT_ID);
    expect(audit.metadata.header_keys_present).toEqual(["clientid", "clientsecret"]);
  });

  it("returns 401 with header_keys_present=[] when no credential headers were sent on a Tier-2 mismatch", async () => {
    mocks.verifyWebhookRequest.mockResolvedValue({ ok: false, reason: "missing_client_id" });
    mocks.auditEmit.mockResolvedValue(undefined);

    const response = await POST(makeRequest(VALID_BODY, {}), makeContext(VALID_TENANT_ID));

    expect(response.status).toBe(401);
    expect(mocks.auditEmit).toHaveBeenCalledTimes(1);
    const audit = mocks.auditEmit.mock.calls[0][0];
    expect(audit.metadata.header_keys_present).toEqual([]);
  });

  it("returns 401 even when audit.emit throws (audit failures are non-blocking)", async () => {
    mocks.verifyWebhookRequest.mockResolvedValue({ ok: false, reason: "client_id_mismatch" });
    mocks.auditEmit.mockRejectedValue(new Error("audit pipeline down"));

    const response = await POST(
      makeRequest(VALID_BODY, { clientid: "wrong", clientsecret: "cs" }),
      makeContext(VALID_TENANT_ID),
    );

    expect(response.status).toBe(401);
  });

  it("returns 500 when verifier itself throws", async () => {
    mocks.verifyWebhookRequest.mockRejectedValue(new Error("bcrypt module crashed"));

    const response = await POST(makeRequest(), makeContext(VALID_TENANT_ID));

    expect(response.status).toBe(500);
  });
});

describe("webhook receiver — verification chain ordering", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("step 2 runs before step 3 (body NOT read when tenant gate fails)", async () => {
    mocks.tenantAcceptsWebhooks.mockResolvedValue(false);
    const req = makeRequest();
    const textSpy = vi.spyOn(req, "text");

    await POST(req, makeContext(VALID_TENANT_ID));

    expect(mocks.tenantAcceptsWebhooks).toHaveBeenCalledTimes(1);
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("step 3 runs before step 5 (body parse failure short-circuits before verifier)", async () => {
    mocks.tenantAcceptsWebhooks.mockResolvedValue(true);

    const response = await POST(makeRequest("not json"), makeContext(VALID_TENANT_ID));

    expect(response.status).toBe(400);
    expect(mocks.tenantAcceptsWebhooks).toHaveBeenCalledTimes(1);
    expect(mocks.verifyWebhookRequest).not.toHaveBeenCalled();
  });

  it("UUID validation (step 1) runs before tenant lookup (step 2)", async () => {
    const response = await POST(makeRequest(), makeContext("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(mocks.tenantAcceptsWebhooks).not.toHaveBeenCalled();
  });
});

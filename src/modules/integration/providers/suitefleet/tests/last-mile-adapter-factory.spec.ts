// SuiteFleet LastMileAdapter assembly factory unit tests — T-8.
//
// Mocks the underlying primitives so the factory's wiring can be
// verified without real network / DB / credential I/O. The contract
// here is "calls flow through the right primitive with the right
// args"; the primitives' behaviour is tested in their own specs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth-client", () => ({
  createSuiteFleetAuthClient: vi.fn(),
}));

vi.mock("../token-cache", () => ({
  createSuiteFleetTokenCache: vi.fn(),
}));

vi.mock("../task-client", () => ({
  createSuiteFleetTaskClient: vi.fn(),
}));

vi.mock("../webhook-verifier", () => ({
  verifySuiteFleetWebhook: vi.fn(),
}));

vi.mock("../webhook-parser", () => ({
  parseSuiteFleetWebhookEvents: vi.fn(),
}));

vi.mock("../status-mapper", () => ({
  mapSuiteFleetStatusToInternal: vi.fn(),
}));

import { createSuiteFleetAuthClient } from "../auth-client";
import { mapSuiteFleetStatusToInternal } from "../status-mapper";
import { createSuiteFleetTaskClient } from "../task-client";
import { createSuiteFleetTokenCache } from "../token-cache";
import { parseSuiteFleetWebhookEvents } from "../webhook-parser";
import { verifySuiteFleetWebhook } from "../webhook-verifier";

import { createSuiteFleetLastMileAdapter } from "../last-mile-adapter-factory";

import type {
  SuiteFleetCredentials,
  SuiteFleetWebhookCredentials,
} from "@/modules/credentials";
import type { SuiteFleetAuthClient } from "../auth-client";
import type { SuiteFleetTaskClient } from "../task-client";
import type { SuiteFleetTokenCache } from "../token-cache";
import type {
  AuthenticatedSession,
  HeadersLike,
  TaskCreateRequest,
  TaskCreateResult,
  WebhookEvent,
  WebhookVerificationResult,
} from "../../../types";

const mockCreateAuthClient = vi.mocked(createSuiteFleetAuthClient);
const mockCreateTokenCache = vi.mocked(createSuiteFleetTokenCache);
const mockCreateTaskClient = vi.mocked(createSuiteFleetTaskClient);
const mockVerifyWebhook = vi.mocked(verifySuiteFleetWebhook);
const mockParseWebhook = vi.mocked(parseSuiteFleetWebhookEvents);
const mockMapStatus = vi.mocked(mapSuiteFleetStatusToInternal);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const FIXED_NOW = new Date("2026-04-30T10:00:00.000Z");

const SAMPLE_SESSION: AuthenticatedSession = {
  tenantId: TENANT_ID,
  token: "session-token",
  renewalToken: "renewal-token",
  tokenExpiresAt: "2026-04-30T11:00:00.000Z",
  renewalTokenExpiresAt: "2026-04-30T22:00:00.000Z",
};

const SAMPLE_CREDENTIALS: SuiteFleetCredentials = {
  username: "u",
  password: "p",
  clientId: "client-588",
  customerId: 588,
};

const SAMPLE_WEBHOOK_CREDENTIALS: SuiteFleetWebhookCredentials = {
  clientId: "wh-client",
  clientSecret: "wh-secret",
};

const SAMPLE_TASK: TaskCreateRequest = {
  tenantId: TENANT_ID,
  customerOrderNumber: "ORDER-001",
  kind: "DELIVERY",
  consignee: {
    name: "Aroma",
    contactPhone: "+971501234567",
    address: {
      addressLine1: "Bldg 12",
      city: "Dubai",
      countryCode: "AE",
      latitude: 25.0,
      longitude: 55.0,
    },
  },
  shipFrom: {
    addressLine1: "Hub 1",
    city: "Dubai",
    countryCode: "AE",
    latitude: 25.1,
    longitude: 55.1,
  },
  window: {
    date: "2026-05-01",
    startTime: "14:00:00",
    endTime: "16:00:00",
  },
  paymentMethod: "PrePaid",
  itemQuantity: 1,
};

const SAMPLE_TASK_RESULT: TaskCreateResult = {
  externalId: "ext-1",
  trackingNumber: "TRK-1",
  status: "CREATED",
  createdAt: FIXED_NOW.toISOString(),
};

let resolveCredentials: ReturnType<typeof vi.fn>;
let resolveWebhookCredentials: ReturnType<typeof vi.fn>;
let getSession: ReturnType<typeof vi.fn>;
let invalidate: ReturnType<typeof vi.fn>;
let createTaskOnClient: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCreateAuthClient.mockReset();
  mockCreateTokenCache.mockReset();
  mockCreateTaskClient.mockReset();
  mockVerifyWebhook.mockReset();
  mockParseWebhook.mockReset();
  mockMapStatus.mockReset();

  resolveCredentials = vi.fn().mockResolvedValue(SAMPLE_CREDENTIALS);
  resolveWebhookCredentials = vi.fn().mockResolvedValue(SAMPLE_WEBHOOK_CREDENTIALS);
  getSession = vi.fn().mockResolvedValue(SAMPLE_SESSION);
  invalidate = vi.fn();
  createTaskOnClient = vi.fn().mockResolvedValue(SAMPLE_TASK_RESULT);

  // Cast through `unknown` because vi.fn() returns Mock<Procedure>
  // which doesn't structurally match the strict interfaces. The casts
  // are scoped to test setup; the mocks themselves carry no runtime
  // typing.
  mockCreateAuthClient.mockReturnValue({
    login: vi.fn(),
    refresh: vi.fn(),
  } as unknown as SuiteFleetAuthClient);
  mockCreateTokenCache.mockReturnValue({
    getSession,
    invalidate,
  } as unknown as SuiteFleetTokenCache);
  mockCreateTaskClient.mockReturnValue({
    createTask: createTaskOnClient,
  } as unknown as SuiteFleetTaskClient);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function buildAdapter() {
  return createSuiteFleetLastMileAdapter({
    fetch: globalThis.fetch,
    clock: () => FIXED_NOW,
    resolveCredentials: resolveCredentials as unknown as (
      tenantId: string,
    ) => Promise<SuiteFleetCredentials>,
    resolveWebhookCredentials: resolveWebhookCredentials as unknown as (
      tenantId: string,
    ) => Promise<SuiteFleetWebhookCredentials>,
  });
}

describe("createSuiteFleetLastMileAdapter — construction", () => {
  it("builds an auth client and a token cache at construction time", () => {
    buildAdapter();
    expect(mockCreateAuthClient).toHaveBeenCalledOnce();
    expect(mockCreateTokenCache).toHaveBeenCalledOnce();
    // Token cache deps include the resolveCredentials we passed in.
    const cacheDeps = mockCreateTokenCache.mock.calls[0][0];
    expect(cacheDeps.resolveCredentials).toBe(resolveCredentials);
  });

  it("does NOT build a task client at construction (per-call construction)", () => {
    buildAdapter();
    expect(mockCreateTaskClient).not.toHaveBeenCalled();
  });

  it("falls back to the canonical resolvers when none are passed", () => {
    // Sanity test: default resolvers wire through. We're not asserting
    // identity (the real resolvers are imported), just that
    // construction doesn't throw with omitted overrides.
    const adapter = createSuiteFleetLastMileAdapter({
      fetch: globalThis.fetch,
      clock: () => FIXED_NOW,
    });
    expect(adapter).toBeDefined();
  });
});

describe("authenticate", () => {
  it("delegates to tokenCache.getSession", async () => {
    const adapter = buildAdapter();
    const session = await adapter.authenticate(TENANT_ID);
    expect(getSession).toHaveBeenCalledWith(TENANT_ID);
    expect(session).toBe(SAMPLE_SESSION);
  });
});

describe("refreshSession", () => {
  it("invalidates then re-fetches the session for the same tenant", async () => {
    const adapter = buildAdapter();
    await adapter.refreshSession(SAMPLE_SESSION);
    expect(invalidate).toHaveBeenCalledWith(TENANT_ID);
    expect(getSession).toHaveBeenCalledWith(TENANT_ID);
    // Order: invalidate first, then getSession.
    const invalidateOrder = invalidate.mock.invocationCallOrder[0];
    const getSessionOrder = getSession.mock.invocationCallOrder[0];
    expect(invalidateOrder).toBeLessThan(getSessionOrder);
  });
});

describe("createTask", () => {
  it("resolves credentials per-call and constructs a task client with the resolved clientId", async () => {
    const adapter = buildAdapter();
    await adapter.createTask(SAMPLE_SESSION, SAMPLE_TASK);

    expect(resolveCredentials).toHaveBeenCalledWith(TENANT_ID);
    expect(mockCreateTaskClient).toHaveBeenCalledOnce();
    const taskClientDeps = mockCreateTaskClient.mock.calls[0][0];
    expect(taskClientDeps.clientId).toBe("client-588");
  });

  it("invokes the task client with session, customerId, and request", async () => {
    const adapter = buildAdapter();
    const result = await adapter.createTask(SAMPLE_SESSION, SAMPLE_TASK);

    expect(createTaskOnClient).toHaveBeenCalledOnce();
    const callArgs = createTaskOnClient.mock.calls[0][0];
    expect(callArgs.session).toBe(SAMPLE_SESSION);
    expect(callArgs.customerId).toBe(588);
    expect(callArgs.request).toBe(SAMPLE_TASK);
    expect(result).toBe(SAMPLE_TASK_RESULT);
  });

  it("constructs a fresh task client per call (no cross-call cache)", async () => {
    const adapter = buildAdapter();
    await adapter.createTask(SAMPLE_SESSION, SAMPLE_TASK);
    await adapter.createTask(SAMPLE_SESSION, SAMPLE_TASK);
    expect(mockCreateTaskClient).toHaveBeenCalledTimes(2);
  });
});

describe("verifyWebhookRequest", () => {
  it("resolves webhook credentials for the supplied tenantId and delegates to verifySuiteFleetWebhook", async () => {
    const expectedResult: WebhookVerificationResult = { ok: true };
    mockVerifyWebhook.mockReturnValue(expectedResult);

    const adapter = buildAdapter();
    const headers: HeadersLike = { get: () => null };
    const result = await adapter.verifyWebhookRequest(TENANT_ID, headers, {});

    expect(resolveWebhookCredentials).toHaveBeenCalledWith(TENANT_ID);
    expect(mockVerifyWebhook).toHaveBeenCalledWith(headers, SAMPLE_WEBHOOK_CREDENTIALS);
    expect(result).toBe(expectedResult);
  });

  it("propagates a verifier failure result without massaging it", async () => {
    const failure: WebhookVerificationResult = {
      ok: false,
      reason: "missing_client_id",
    };
    mockVerifyWebhook.mockReturnValue(failure);

    const adapter = buildAdapter();
    const result = await adapter.verifyWebhookRequest(
      TENANT_ID,
      { get: () => null },
      {},
    );
    expect(result).toEqual(failure);
  });
});

describe("parseWebhookEvents and mapStatusToInternal", () => {
  it("delegates parseWebhookEvents to parseSuiteFleetWebhookEvents (empty result passes through)", () => {
    const events: readonly WebhookEvent[] = [];
    mockParseWebhook.mockReturnValue(events);

    const adapter = buildAdapter();
    const result = adapter.parseWebhookEvents("body");
    expect(mockParseWebhook).toHaveBeenCalledWith("body");
    expect(result).toEqual([]);
  });

  it("composes the parser output with mapStatusToInternal — populates internalStatus on lifecycle events", () => {
    // Parser returns an event with no internalStatus (its design).
    // Adapter composes by reading event.raw.action, calling the
    // mapper, and merging the result.
    const parserOutput: readonly WebhookEvent[] = [
      {
        kind: "TASK_STATUS_CHANGED",
        externalTaskId: "59000",
        occurredAt: "2026-04-29T10:00:00.000Z",
        idempotencyKey: "abc",
        raw: { action: "TASK_HAS_BEEN_ORDERED", taskId: "59000" },
      },
    ];
    mockParseWebhook.mockReturnValue(parserOutput);
    mockMapStatus.mockReturnValue("CREATED");

    const adapter = buildAdapter();
    const result = adapter.parseWebhookEvents([]);

    expect(mockMapStatus).toHaveBeenCalledWith("TASK_HAS_BEEN_ORDERED");
    expect(result).toHaveLength(1);
    expect(result[0].internalStatus).toBe("CREATED");
    // Other event fields preserved unchanged.
    expect(result[0].externalTaskId).toBe("59000");
    expect(result[0].kind).toBe("TASK_STATUS_CHANGED");
  });

  it("leaves internalStatus undefined when the mapper returns null (non-lifecycle action)", () => {
    // TASK_HAS_BEEN_UPDATED is an edit, not a status change. The
    // mapper returns null for it. Per the LastMileAdapter contract,
    // null means "do not populate internalStatus" — the event flows
    // through unchanged.
    const parserOutput: readonly WebhookEvent[] = [
      {
        kind: "TASK_STATUS_CHANGED",
        externalTaskId: "59000",
        occurredAt: "2026-04-29T10:00:00.000Z",
        idempotencyKey: "abc",
        raw: { action: "TASK_HAS_BEEN_UPDATED", taskId: "59000" },
      },
    ];
    mockParseWebhook.mockReturnValue(parserOutput);
    mockMapStatus.mockReturnValue(null);

    const adapter = buildAdapter();
    const result = adapter.parseWebhookEvents([]);

    expect(result).toHaveLength(1);
    expect(result[0].internalStatus).toBeUndefined();
  });

  it("skips composition when event.raw doesn't carry a string action (defensive)", () => {
    // A future parser change or a malformed raw shape shouldn't
    // crash the composition. The event passes through unchanged.
    const parserOutput: readonly WebhookEvent[] = [
      {
        kind: "TASK_OTHER",
        externalTaskId: "x",
        occurredAt: "2026-04-29T10:00:00.000Z",
        idempotencyKey: "k",
        raw: { taskId: "x" }, // no `action` field
      },
    ];
    mockParseWebhook.mockReturnValue(parserOutput);

    const adapter = buildAdapter();
    const result = adapter.parseWebhookEvents([]);

    expect(mockMapStatus).not.toHaveBeenCalled();
    expect(result[0].internalStatus).toBeUndefined();
  });

  it("delegates mapStatusToInternal to mapSuiteFleetStatusToInternal", () => {
    mockMapStatus.mockReturnValue("CREATED");

    const adapter = buildAdapter();
    const result = adapter.mapStatusToInternal("TASK_HAS_BEEN_ORDERED");
    expect(mockMapStatus).toHaveBeenCalledWith("TASK_HAS_BEEN_ORDERED");
    expect(result).toBe("CREATED");
  });
});

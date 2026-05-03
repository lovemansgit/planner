// Asset-tracking service unit tests — Day 6 / B-2 (closing commit).
//
// Mocks the shared db helper, the audit emit, the repository, and
// the SF adapter singleton so we exercise permission, tenant scope,
// cache-freshness branching, refresh path, orphan handling, and
// audit-emit shape without real Postgres or real network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withTenant: vi.fn(),
}));

vi.mock("../../audit", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", () => ({
  findCacheByAwb: vi.fn(),
  findTaskAwb: vi.fn(),
  findTaskIdByExternalId: vi.fn(),
  upsertCacheRow: vi.fn(),
}));

vi.mock("@/modules/integration/providers/suitefleet/get-adapter", () => ({
  getSuiteFleetAdapter: vi.fn(),
}));

import { withTenant } from "../../../shared/db";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { emit } from "../../audit";

import { getSuiteFleetAdapter } from "@/modules/integration/providers/suitefleet/get-adapter";
import type {
  AssetTrackingPackage,
  AuthenticatedSession,
  LastMileAdapter,
} from "@/modules/integration";

import {
  findCacheByAwb,
  findTaskAwb,
  findTaskIdByExternalId,
  upsertCacheRow,
} from "../repository";
import { getAssetTrackingForTask } from "../service";
import type { AssetTrackingCacheRow } from "../types";

const mockWithTenant = vi.mocked(withTenant);
const mockEmit = vi.mocked(emit);
const mockFindCacheByAwb = vi.mocked(findCacheByAwb);
const mockFindTaskAwb = vi.mocked(findTaskAwb);
const mockFindTaskIdByExternalId = vi.mocked(findTaskIdByExternalId);
const mockUpsertCacheRow = vi.mocked(upsertCacheRow);
const mockGetSuiteFleetAdapter = vi.mocked(getSuiteFleetAdapter);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID_OTHER = "22222222-2222-4222-8222-222222222222";
const AWB = "MPL-12345678";

function ctx(perms: readonly Permission[], tenantId: string | null = TENANT_ID): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ACTOR_USER_ID,
      tenantId: tenantId ?? "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId,
    requestId: "test-request",
    path: "/api/tasks/x/asset-tracking",
  };
}

function rowFixture(overrides: Partial<AssetTrackingCacheRow> = {}): AssetTrackingCacheRow {
  const now = new Date().toISOString();
  return {
    id: "33333333-3333-4333-8333-333333333333",
    taskId: TASK_ID,
    taskIdExternal: 59113,
    externalRecordId: 70001,
    trackingId: "MPL-12345678-1",
    awb: AWB,
    type: "BAGS",
    state: "COLLECTED",
    photos: null,
    notes: null,
    supplementaryQuantity: null,
    containerId: null,
    collectedBy: null,
    enrouteBy: null,
    receivedBy: null,
    returnedBy: null,
    tenantId: TENANT_ID,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function pkgFixture(overrides: Partial<AssetTrackingPackage> = {}): AssetTrackingPackage {
  return {
    externalRecordId: 70001,
    taskIdExternal: 59113,
    trackingId: "MPL-12345678-1",
    awb: AWB,
    type: "BAGS",
    state: "EN_ROUTE",
    photos: null,
    notes: null,
    supplementaryQuantity: null,
    containerId: null,
    collectedBy: null,
    enrouteBy: null,
    receivedBy: null,
    returnedBy: null,
    ...overrides,
  };
}

const SAMPLE_SESSION: AuthenticatedSession = {
  tenantId: TENANT_ID,
  token: "tok",
  renewalToken: "rnw",
  tokenExpiresAt: "2026-05-02T00:00:00.000Z",
  renewalTokenExpiresAt: "2026-11-01T00:00:00.000Z",
};

function makeAdapter(records: readonly AssetTrackingPackage[]): LastMileAdapter {
  return {
    async authenticate() {
      return SAMPLE_SESSION;
    },
    async refreshSession(s) {
      return s;
    },
    async createTask() {
      throw new Error("not used");
    },
    async getTaskByAwb() {
      throw new Error("not used");
    },
    async printLabels() {
      throw new Error("not used");
    },
    async fetchAssetTrackingByAwb() {
      return records;
    },
    async verifyWebhookRequest() {
      return { ok: true, authTier: "tier_1_only" };
    },
    parseWebhookEvents() {
      return [];
    },
    mapStatusToInternal() {
      return null;
    },
  };
}

beforeEach(() => {
  mockWithTenant.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockFindCacheByAwb.mockReset();
  mockFindTaskAwb.mockReset();
  mockFindTaskIdByExternalId.mockReset();
  mockUpsertCacheRow.mockReset();
  mockGetSuiteFleetAdapter.mockReset();
  // withTenant runs its callback against an opaque tx stub.
  mockWithTenant.mockImplementation(async (_t, fn) => fn({} as never));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// Permission + tenant guards
// -----------------------------------------------------------------------------

describe("getAssetTrackingForTask — guards", () => {
  it("throws ForbiddenError when actor lacks asset_tracking:read", async () => {
    await expect(getAssetTrackingForTask(ctx([]), TASK_ID)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockFindTaskAwb).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(
      getAssetTrackingForTask(ctx(["asset_tracking:read"], null), TASK_ID),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockFindTaskAwb).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Task → AWB lookup branches
// -----------------------------------------------------------------------------

describe("getAssetTrackingForTask — task lookup", () => {
  it("throws NotFoundError when the task does not exist", async () => {
    mockFindTaskAwb.mockResolvedValue({ kind: "not_found" });
    await expect(
      getAssetTrackingForTask(ctx(["asset_tracking:read"]), TASK_ID),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockFindCacheByAwb).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("returns [] when the task exists but has no AWB yet (not pushed to SF)", async () => {
    mockFindTaskAwb.mockResolvedValue({ kind: "no_awb" });
    const result = await getAssetTrackingForTask(ctx(["asset_tracking:read"]), TASK_ID);
    expect(result).toEqual([]);
    expect(mockFindCacheByAwb).not.toHaveBeenCalled();
    expect(mockGetSuiteFleetAdapter).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Cache-fresh: returns cache, no SF call, no audit
// -----------------------------------------------------------------------------

describe("getAssetTrackingForTask — cache hit (fresh)", () => {
  it("returns cached rows without calling SF or emitting audit events", async () => {
    mockFindTaskAwb.mockResolvedValue({ kind: "ok", awb: AWB });
    const fresh = rowFixture({ lastSyncedAt: new Date().toISOString() });
    mockFindCacheByAwb.mockResolvedValue([fresh]);

    const result = await getAssetTrackingForTask(ctx(["asset_tracking:read"]), TASK_ID);

    expect(result).toEqual([fresh]);
    expect(mockGetSuiteFleetAdapter).not.toHaveBeenCalled();
    expect(mockUpsertCacheRow).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("filters cached rows to those whose taskId matches the request (split-shipment AWB)", async () => {
    mockFindTaskAwb.mockResolvedValue({ kind: "ok", awb: AWB });
    const mine = rowFixture({ taskId: TASK_ID, trackingId: "MPL-12345678-1" });
    const theirs = rowFixture({ taskId: TASK_ID_OTHER, trackingId: "MPL-12345678-2" });
    mockFindCacheByAwb.mockResolvedValue([mine, theirs]);

    const result = await getAssetTrackingForTask(ctx(["asset_tracking:read"]), TASK_ID);

    expect(result).toEqual([mine]);
  });
});

// -----------------------------------------------------------------------------
// Cache-stale and cache-miss → refresh from SF
// -----------------------------------------------------------------------------

describe("getAssetTrackingForTask — cache miss / stale → refresh", () => {
  it("calls SF on empty cache, upserts each record, emits refreshed + state_changed (new rows)", async () => {
    mockFindTaskAwb.mockResolvedValue({ kind: "ok", awb: AWB });
    // Sequence of cache reads: first empty, then post-refresh has 1 row.
    mockFindCacheByAwb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([rowFixture({ state: "EN_ROUTE", lastSyncedAt: new Date().toISOString() })]);
    mockFindTaskIdByExternalId.mockResolvedValue(TASK_ID);
    const newPkg = pkgFixture({ state: "EN_ROUTE" });
    mockGetSuiteFleetAdapter.mockReturnValue(makeAdapter([newPkg]));
    mockUpsertCacheRow.mockResolvedValue(rowFixture({ state: "EN_ROUTE" }));

    const result = await getAssetTrackingForTask(ctx(["asset_tracking:read"]), TASK_ID);

    expect(result).toHaveLength(1);
    expect(result[0].state).toBe("EN_ROUTE");

    expect(mockUpsertCacheRow).toHaveBeenCalledOnce();

    // Two events: refreshed + state_changed (new row counts as a state change).
    expect(mockEmit).toHaveBeenCalledTimes(2);
    const events = mockEmit.mock.calls.map((c) => c[0]);
    const refreshed = events.find((e) => e.eventType === "asset_tracking.refreshed");
    expect(refreshed).toBeDefined();
    expect(refreshed?.metadata).toEqual({
      awb: AWB,
      previous_synced_at: null,
      record_count: 1,
    });
    const stateChanged = events.find((e) => e.eventType === "asset_tracking.state_changed");
    expect(stateChanged).toBeDefined();
    expect(stateChanged?.metadata).toMatchObject({
      tracking_id: "MPL-12345678-1",
      task_id_external: 59113,
      previous_state: null,
      new_state: "EN_ROUTE",
      trigger_source: "read_through",
    });
  });

  it("does NOT emit state_changed when the SF state matches cached state (refresh-only)", async () => {
    mockFindTaskAwb.mockResolvedValue({ kind: "ok", awb: AWB });
    const stale = rowFixture({
      state: "COLLECTED",
      lastSyncedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    mockFindCacheByAwb
      .mockResolvedValueOnce([stale])
      .mockResolvedValueOnce([rowFixture({ state: "COLLECTED" })]);
    mockFindTaskIdByExternalId.mockResolvedValue(TASK_ID);
    mockGetSuiteFleetAdapter.mockReturnValue(makeAdapter([pkgFixture({ state: "COLLECTED" })]));
    mockUpsertCacheRow.mockResolvedValue(rowFixture({ state: "COLLECTED" }));

    await getAssetTrackingForTask(ctx(["asset_tracking:read"]), TASK_ID);

    const events = mockEmit.mock.calls.map((c) => c[0]);
    expect(events.some((e) => e.eventType === "asset_tracking.refreshed")).toBe(true);
    expect(events.some((e) => e.eventType === "asset_tracking.state_changed")).toBe(false);
  });

  it("emits state_changed with the prior cached state when SF returns a transition", async () => {
    mockFindTaskAwb.mockResolvedValue({ kind: "ok", awb: AWB });
    const stalePrev = rowFixture({
      state: "COLLECTED",
      lastSyncedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    mockFindCacheByAwb
      .mockResolvedValueOnce([stalePrev])
      .mockResolvedValueOnce([rowFixture({ state: "RECEIVED" })]);
    mockFindTaskIdByExternalId.mockResolvedValue(TASK_ID);
    mockGetSuiteFleetAdapter.mockReturnValue(makeAdapter([pkgFixture({ state: "RECEIVED" })]));
    mockUpsertCacheRow.mockResolvedValue(rowFixture({ state: "RECEIVED" }));

    await getAssetTrackingForTask(ctx(["asset_tracking:read"]), TASK_ID);

    const stateChanged = mockEmit.mock.calls
      .map((c) => c[0])
      .find((e) => e.eventType === "asset_tracking.state_changed");
    expect(stateChanged?.metadata).toMatchObject({
      previous_state: "COLLECTED",
      new_state: "RECEIVED",
      trigger_source: "read_through",
    });
  });

  it("treats cache as stale when ANY row's lastSyncedAt is older than 5 minutes", async () => {
    mockFindTaskAwb.mockResolvedValue({ kind: "ok", awb: AWB });
    const fresh = rowFixture({ trackingId: "MPL-12345678-1", lastSyncedAt: new Date().toISOString() });
    const stale = rowFixture({
      trackingId: "MPL-12345678-2",
      lastSyncedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    });
    mockFindCacheByAwb
      .mockResolvedValueOnce([fresh, stale])
      .mockResolvedValueOnce([fresh, stale]);
    mockFindTaskIdByExternalId.mockResolvedValue(TASK_ID);
    mockGetSuiteFleetAdapter.mockReturnValue(makeAdapter([]));

    await getAssetTrackingForTask(ctx(["asset_tracking:read"]), TASK_ID);

    // Refresh fired even though one row is fresh — any-stale is enough.
    expect(mockGetSuiteFleetAdapter).toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Orphan handling
// -----------------------------------------------------------------------------

describe("getAssetTrackingForTask — orphan handling", () => {
  it("emits asset_tracking.orphan_dropped (system actor) and skips the upsert when SF taskId does not resolve", async () => {
    mockFindTaskAwb.mockResolvedValue({ kind: "ok", awb: AWB });
    mockFindCacheByAwb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    // First record resolves; second is an orphan.
    mockFindTaskIdByExternalId
      .mockResolvedValueOnce(TASK_ID)
      .mockResolvedValueOnce(null);
    mockGetSuiteFleetAdapter.mockReturnValue(
      makeAdapter([
        pkgFixture({ trackingId: "MPL-12345678-1", taskIdExternal: 59113, state: "EN_ROUTE" }),
        pkgFixture({ trackingId: "MPL-99999999-1", awb: "MPL-99999999", taskIdExternal: 99999, state: "COLLECTED" }),
      ]),
    );
    mockUpsertCacheRow.mockResolvedValue(rowFixture());

    await getAssetTrackingForTask(ctx(["asset_tracking:read"]), TASK_ID);

    // Only one upsert (the orphan was skipped).
    expect(mockUpsertCacheRow).toHaveBeenCalledOnce();

    const events = mockEmit.mock.calls.map((c) => c[0]);
    const orphan = events.find((e) => e.eventType === "asset_tracking.orphan_dropped");
    expect(orphan).toBeDefined();
    expect(orphan?.actorKind).toBe("system");
    expect(orphan?.actorId).toBe("asset_tracking_ingestion");
    expect(orphan?.metadata).toEqual({
      tracking_id: "MPL-99999999-1",
      task_id_external: 99999,
      awb: "MPL-99999999",
    });
  });
});

// -----------------------------------------------------------------------------
// Refresh on totally empty SF response
// -----------------------------------------------------------------------------

describe("getAssetTrackingForTask — empty SF response", () => {
  it("emits refreshed with record_count: 0 and returns [] when SF reports no records", async () => {
    mockFindTaskAwb.mockResolvedValue({ kind: "ok", awb: AWB });
    mockFindCacheByAwb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockGetSuiteFleetAdapter.mockReturnValue(makeAdapter([]));

    const result = await getAssetTrackingForTask(ctx(["asset_tracking:read"]), TASK_ID);

    expect(result).toEqual([]);
    expect(mockUpsertCacheRow).not.toHaveBeenCalled();
    const refreshed = mockEmit.mock.calls
      .map((c) => c[0])
      .find((e) => e.eventType === "asset_tracking.refreshed");
    expect(refreshed?.metadata).toMatchObject({
      awb: AWB,
      previous_synced_at: null,
      record_count: 0,
    });
  });
});

// F4 — Unit tests for the per-merchant asset-tracking gate toggle:
// setMerchantAssetTracking (permission gate RED-first, not-found,
// idempotent no-op, merchant.updated audit emit) + the focused read
// getMerchantAssetTrackingEnabled.
//
// THE DARK SWITCH (migration 0034 / Love's staged posture 7b): this
// flag gates all bag-tracking surfaces and stays false per tenant until
// explicitly flipped. These tests NEVER touch a real tenant — the
// repository + db layers are mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withServiceRole: vi.fn(),
}));

vi.mock("../../audit", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", () => ({
  selectAssetTrackingFlag: vi.fn(),
  updateAssetTrackingFlag: vi.fn(),
}));

import { withServiceRole } from "../../../shared/db";
import { ForbiddenError, NotFoundError } from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { emit } from "../../audit";

import {
  selectAssetTrackingFlag,
  updateAssetTrackingFlag,
} from "../repository";
import {
  getMerchantAssetTrackingEnabled,
  setMerchantAssetTracking,
} from "../service";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockSelectFlag = vi.mocked(selectAssetTrackingFlag);
const mockUpdateFlag = vi.mocked(updateAssetTrackingFlag);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";

function ctx(perms: readonly Permission[]): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ACTOR_USER_ID,
      tenantId: "00000000-0000-0000-0000-0000000000ff",
      permissions: new Set(perms),
    },
    tenantId: "00000000-0000-0000-0000-0000000000ff",
    requestId: "test-request",
    path: "/admin/merchants",
  };
}

// withServiceRole(reason, fn) → just runs fn with a stub tx (the
// repository fns it calls are themselves mocked, so the tx is unused).
function passthroughServiceRole() {
  mockWithServiceRole.mockImplementation(async (_reason, fn) =>
    fn({ execute: vi.fn() } as never),
  );
}

beforeEach(() => {
  mockWithServiceRole.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockSelectFlag.mockReset();
  mockUpdateFlag.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("setMerchantAssetTracking — permission gate", () => {
  it("throws ForbiddenError when the actor lacks merchant:update", async () => {
    await expect(
      setMerchantAssetTracking(ctx([]), { tenantId: TENANT_ID, enabled: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithServiceRole).not.toHaveBeenCalled();
    expect(mockUpdateFlag).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("setMerchantAssetTracking — not found", () => {
  it("throws NotFoundError when the tenant row is missing", async () => {
    passthroughServiceRole();
    mockSelectFlag.mockResolvedValueOnce(null);
    await expect(
      setMerchantAssetTracking(ctx(["merchant:update"]), {
        tenantId: TENANT_ID,
        enabled: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockUpdateFlag).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("setMerchantAssetTracking — flip enables the gate", () => {
  it("UPDATEs false→true and emits merchant.updated with the diff", async () => {
    passthroughServiceRole();
    mockSelectFlag.mockResolvedValueOnce(false);
    mockUpdateFlag.mockResolvedValueOnce(true);

    const result = await setMerchantAssetTracking(ctx(["merchant:update"]), {
      tenantId: TENANT_ID,
      enabled: true,
    });

    expect(result).toEqual({ tenantId: TENANT_ID, enabled: true, changed: true });
    expect(mockUpdateFlag).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      true,
    );
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "merchant.updated",
        resourceId: TENANT_ID,
        metadata: expect.objectContaining({
          tenant_id: TENANT_ID,
          changes: {
            task_asset_tracking_enabled: { before: false, after: true },
          },
        }),
      }),
    );
  });
});

describe("setMerchantAssetTracking — flip disables the gate", () => {
  it("UPDATEs true→false and emits the diff", async () => {
    passthroughServiceRole();
    mockSelectFlag.mockResolvedValueOnce(true);
    mockUpdateFlag.mockResolvedValueOnce(true);

    const result = await setMerchantAssetTracking(ctx(["merchant:update"]), {
      tenantId: TENANT_ID,
      enabled: false,
    });

    expect(result).toEqual({ tenantId: TENANT_ID, enabled: false, changed: true });
    expect(mockUpdateFlag).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      false,
    );
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          changes: {
            task_asset_tracking_enabled: { before: true, after: false },
          },
        }),
      }),
    );
  });
});

describe("setMerchantAssetTracking — idempotent no-op", () => {
  it("does NOT UPDATE or emit when the flag is already at the requested value", async () => {
    passthroughServiceRole();
    mockSelectFlag.mockResolvedValueOnce(true);

    const result = await setMerchantAssetTracking(ctx(["merchant:update"]), {
      tenantId: TENANT_ID,
      enabled: true,
    });

    expect(result).toEqual({ tenantId: TENANT_ID, enabled: true, changed: false });
    expect(mockUpdateFlag).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("getMerchantAssetTrackingEnabled — read", () => {
  it("throws ForbiddenError when the actor lacks merchant:read_all", async () => {
    await expect(
      getMerchantAssetTrackingEnabled(ctx([]), TENANT_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithServiceRole).not.toHaveBeenCalled();
  });

  it("returns the current flag value", async () => {
    passthroughServiceRole();
    mockSelectFlag.mockResolvedValueOnce(true);
    const value = await getMerchantAssetTrackingEnabled(
      ctx(["merchant:read_all"]),
      TENANT_ID,
    );
    expect(value).toBe(true);
  });
});

// getCapturedPodPhotoForAdmin — cross-tenant captured-POD read for the
// Transcorp-admin proxy (Day-56, plan #532 §Phase-4 / A3). Mocks @/shared/db
// (withServiceRole) and the repository so the gate + cross-tenant read are
// exercised without Postgres or storage. Uses the REAL requirePermission.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/db", () => ({
  withServiceRole: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock("../repository", () => ({
  readTaskPodState: vi.fn(),
  readTaskPodStateCrossTenant: vi.fn(),
  recordPodCaptures: vi.fn(),
  sumCapturedPodBytes: vi.fn(),
}));

vi.mock("@/shared/logger", () => ({
  logger: { with: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}));

vi.mock("@/shared/sentry-capture", () => ({ captureException: vi.fn() }));

import { withServiceRole } from "@/shared/db";
import { ForbiddenError } from "@/shared/errors";
import type { RequestContext } from "@/shared/tenant-context";

import { readTaskPodStateCrossTenant } from "../repository";
import { getCapturedPodPhotoForAdmin } from "../service";
import type { PodObjectStore } from "../types";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockReadState = vi.mocked(readTaskPodStateCrossTenant);

const TASK_ID = "11111111-2222-3333-4444-555555555555";

function adminCtx(perms: readonly string[], tenantId: string | null = null): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: "00000000-0000-0000-0000-0000000000aa",
      tenantId: tenantId ?? "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId,
    requestId: "test-admin-pod",
    path: "/api/admin/tasks/x/pod/0",
  } as unknown as RequestContext;
}

function fakeStore(bytes: ArrayBuffer | null): PodObjectStore {
  return {
    get: vi.fn().mockResolvedValue(
      bytes === null ? null : { bytes, contentType: "image/jpeg" },
    ),
  } as unknown as PodObjectStore;
}

beforeEach(() => {
  mockWithServiceRole.mockReset();
  mockReadState.mockReset();
  // withServiceRole runs its callback with a stub tx.
  mockWithServiceRole.mockImplementation(async (_reason, fn) => fn({} as never));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCapturedPodPhotoForAdmin — gate + cross-tenant captured read", () => {
  it("denies an actor without task:read_all (even with task:read)", async () => {
    await expect(
      getCapturedPodPhotoForAdmin(adminCtx([]), TASK_ID as never, 0, { store: fakeStore(null) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      getCapturedPodPhotoForAdmin(adminCtx(["task:read"]), TASK_ID as never, 0, {
        store: fakeStore(null),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithServiceRole).not.toHaveBeenCalled();
  });

  it("returns null when no capture entry exists at the index (route falls back to vendor URL)", async () => {
    mockReadState.mockResolvedValueOnce({ id: TASK_ID, pod_photos: null, pod_photo_captures: null });
    const result = await getCapturedPodPhotoForAdmin(
      adminCtx(["task:read_all"]),
      TASK_ID as never,
      0,
      { store: fakeStore(null) },
    );
    expect(result).toBeNull();
  });

  it("returns the captured bytes cross-tenant (task:read_all, withServiceRole, no tenant scope)", async () => {
    const bytes = new TextEncoder().encode("jpeg-bytes").buffer;
    mockReadState.mockResolvedValueOnce({
      id: TASK_ID,
      pod_photos: ["https://s3.example/a.jpg"],
      pod_photo_captures: [{ path: "tenantX/task/a.jpg", content_type: "image/jpeg" }] as never,
    });
    const result = await getCapturedPodPhotoForAdmin(
      adminCtx(["task:read_all"], null),
      TASK_ID as never,
      0,
      { store: fakeStore(bytes) },
    );
    expect(result).not.toBeNull();
    expect(result?.contentType).toBe("image/jpeg");
    expect(mockWithServiceRole).toHaveBeenCalledOnce();
    expect(mockReadState).toHaveBeenCalledWith(expect.anything(), TASK_ID);
  });

  it("returns null on storage drift (entry recorded but object missing)", async () => {
    mockReadState.mockResolvedValueOnce({
      id: TASK_ID,
      pod_photos: ["https://s3.example/a.jpg"],
      pod_photo_captures: [{ path: "tenantX/task/a.jpg", content_type: "image/jpeg" }] as never,
    });
    const result = await getCapturedPodPhotoForAdmin(
      adminCtx(["task:read_all"]),
      TASK_ID as never,
      0,
      { store: fakeStore(null) },
    );
    expect(result).toBeNull();
  });
});

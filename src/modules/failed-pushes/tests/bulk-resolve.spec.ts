// Service-layer unit tests for bulkResolveFailedPushes — Day-33 PR-D
// (Plan #317 §3.7 CLEANUP-1, §6 OQ-4 (a)+(b) at SHA f0ef560).
//
// Mocks ../../shared/db (withServiceRole), ../audit (emit), and
// ../repository (bulkMarkUnresolvedAsResolved). Pins:
//   - permission gating (failed_pushes:resolve)
//   - validation: empty input, oversize batch, empty/oversize notes, no tenant
//   - dedup of submitted IDs before SQL round-trip
//   - resolved_by sourcing: userId for user actor, null for system actor
//   - notFoundIds = submitted - resolved (partial-success accounting)
//   - audit emit MUST match the event-types.ts metadata registration shape
//     (load-bearing per §A registered-metadata-wins). Audit emits even
//     on 0-resolved (operator intent is the auditable event, not just
//     side-effects).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withServiceRole: vi.fn(),
}));

vi.mock("../../audit", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", () => ({
  bulkMarkUnresolvedAsResolved: vi.fn(),
}));

import { withServiceRole } from "../../../shared/db";
import { ForbiddenError, ValidationError } from "../../../shared/errors";
import type { Actor, RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { emit } from "../../audit";

import { bulkMarkUnresolvedAsResolved } from "../repository";
import { bulkResolveFailedPushes } from "../service";
import type { FailedPush } from "../types";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockBulkMark = vi.mocked(bulkMarkUnresolvedAsResolved);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";

const FP_ID_1 = "11111111-1111-1111-1111-111111111111";
const FP_ID_2 = "22222222-2222-2222-2222-222222222222";
const FP_ID_3 = "33333333-3333-3333-3333-333333333333";
const FIXED_NOW = "2026-05-22T10:00:00.000Z";

function userCtx(perms: readonly Permission[]): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ACTOR_USER_ID,
      tenantId: TENANT_ID,
      permissions: new Set(perms),
    } satisfies Actor,
    tenantId: TENANT_ID,
    requestId: "test-request",
    path: "/api/failed-pushes/bulk-resolve",
  };
}

function userCtxNoTenant(perms: readonly Permission[]): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ACTOR_USER_ID,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: "test-request",
    path: "/api/failed-pushes/bulk-resolve",
  };
}

function cliSystemCtx(perms: readonly Permission[]): RequestContext {
  return {
    actor: {
      kind: "system",
      system: "cli:resolve_failed_pushes",
      tenantId: TENANT_ID,
      permissions: new Set(perms),
    } satisfies Actor,
    tenantId: TENANT_ID,
    requestId: "cli-request",
    path: "/cli/resolve-failed-pushes",
  };
}

function failedPushFixture(id: string): FailedPush {
  return {
    id,
    tenantId: TENANT_ID,
    taskId: "task-fixture-id",
    attemptCount: 1,
    taskPayload: {},
    failureReason: "server_5xx",
    failureDetail: null,
    httpStatus: 502,
    firstFailedAt: FIXED_NOW,
    lastAttemptedAt: FIXED_NOW,
    resolvedAt: FIXED_NOW,
    resolvedBy: ACTOR_USER_ID,
    resolutionNotes: "test resolution",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

beforeEach(() => {
  mockWithServiceRole.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockBulkMark.mockReset();
  // Default: withServiceRole invokes the supplied fn with a stub tx.
  mockWithServiceRole.mockImplementation(async (_reason, fn) => fn({} as never));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bulkResolveFailedPushes — permission gating", () => {
  it("rejects user actor without failed_pushes:resolve (ForbiddenError)", async () => {
    await expect(
      bulkResolveFailedPushes(userCtx(["failed_pushes:retry"]), {
        failedPushIds: [FP_ID_1],
        resolutionNotes: "any reason",
        source: "admin_ui",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockBulkMark).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("accepts user actor with failed_pushes:resolve", async () => {
    mockBulkMark.mockResolvedValue([failedPushFixture(FP_ID_1)]);
    await expect(
      bulkResolveFailedPushes(userCtx(["failed_pushes:resolve"]), {
        failedPushIds: [FP_ID_1],
        resolutionNotes: "reason",
        source: "admin_ui",
      }),
    ).resolves.toBeDefined();
    expect(mockBulkMark).toHaveBeenCalledTimes(1);
  });
});

describe("bulkResolveFailedPushes — validation", () => {
  it("throws ValidationError on empty failedPushIds", async () => {
    await expect(
      bulkResolveFailedPushes(userCtx(["failed_pushes:resolve"]), {
        failedPushIds: [],
        resolutionNotes: "any",
        source: "admin_ui",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when batch > 200 ids", async () => {
    const ids = Array.from({ length: 201 }, (_, i) =>
      `${(i + 1).toString().padStart(8, "0")}-0000-0000-0000-000000000000`,
    );
    await expect(
      bulkResolveFailedPushes(userCtx(["failed_pushes:resolve"]), {
        failedPushIds: ids,
        resolutionNotes: "any",
        source: "admin_ui",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError on empty resolutionNotes (after trim)", async () => {
    await expect(
      bulkResolveFailedPushes(userCtx(["failed_pushes:resolve"]), {
        failedPushIds: [FP_ID_1],
        resolutionNotes: "   ",
        source: "admin_ui",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when resolutionNotes > 500 chars (post-trim)", async () => {
    await expect(
      bulkResolveFailedPushes(userCtx(["failed_pushes:resolve"]), {
        failedPushIds: [FP_ID_1],
        resolutionNotes: "x".repeat(501),
        source: "admin_ui",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when tenantId is null", async () => {
    await expect(
      bulkResolveFailedPushes(userCtxNoTenant(["failed_pushes:resolve"]), {
        failedPushIds: [FP_ID_1],
        resolutionNotes: "any",
        source: "admin_ui",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("bulkResolveFailedPushes — dedup + resolved_by sourcing", () => {
  it("deduplicates submitted IDs before SQL round-trip", async () => {
    mockBulkMark.mockResolvedValue([failedPushFixture(FP_ID_1), failedPushFixture(FP_ID_2)]);
    await bulkResolveFailedPushes(userCtx(["failed_pushes:resolve"]), {
      failedPushIds: [FP_ID_1, FP_ID_2, FP_ID_1, FP_ID_2, FP_ID_1],
      resolutionNotes: "reason",
      source: "admin_ui",
    });
    const [, , idsArg] = mockBulkMark.mock.calls[0];
    expect(idsArg).toEqual([FP_ID_1, FP_ID_2]);
  });

  it("passes userId as resolved_by for user actor", async () => {
    mockBulkMark.mockResolvedValue([failedPushFixture(FP_ID_1)]);
    await bulkResolveFailedPushes(userCtx(["failed_pushes:resolve"]), {
      failedPushIds: [FP_ID_1],
      resolutionNotes: "reason",
      source: "admin_ui",
    });
    const [, , , resolvedByArg] = mockBulkMark.mock.calls[0];
    expect(resolvedByArg).toBe(ACTOR_USER_ID);
  });

  it("passes null as resolved_by for system actor (CLI path)", async () => {
    mockBulkMark.mockResolvedValue([failedPushFixture(FP_ID_1)]);
    await bulkResolveFailedPushes(cliSystemCtx(["failed_pushes:resolve"]), {
      failedPushIds: [FP_ID_1],
      resolutionNotes: "reason",
      source: "cli",
    });
    const [, , , resolvedByArg] = mockBulkMark.mock.calls[0];
    expect(resolvedByArg).toBeNull();
  });

  it("trims resolutionNotes before persisting", async () => {
    mockBulkMark.mockResolvedValue([failedPushFixture(FP_ID_1)]);
    await bulkResolveFailedPushes(userCtx(["failed_pushes:resolve"]), {
      failedPushIds: [FP_ID_1],
      resolutionNotes: "   trimmed reason   ",
      source: "admin_ui",
    });
    const [, , , , notesArg] = mockBulkMark.mock.calls[0];
    expect(notesArg).toBe("trimmed reason");
  });
});

describe("bulkResolveFailedPushes — partial-success accounting (notFoundIds)", () => {
  it("returns notFoundIds = submitted minus resolved", async () => {
    // Submitted 3; repo returns 1 → 2 are not-found.
    mockBulkMark.mockResolvedValue([failedPushFixture(FP_ID_1)]);
    const res = await bulkResolveFailedPushes(userCtx(["failed_pushes:resolve"]), {
      failedPushIds: [FP_ID_1, FP_ID_2, FP_ID_3],
      resolutionNotes: "reason",
      source: "admin_ui",
    });
    expect(res.resolved.map((r) => r.id)).toEqual([FP_ID_1]);
    expect(new Set(res.notFoundIds)).toEqual(new Set([FP_ID_2, FP_ID_3]));
  });

  it("returns empty notFoundIds when all resolved", async () => {
    mockBulkMark.mockResolvedValue([
      failedPushFixture(FP_ID_1),
      failedPushFixture(FP_ID_2),
    ]);
    const res = await bulkResolveFailedPushes(userCtx(["failed_pushes:resolve"]), {
      failedPushIds: [FP_ID_1, FP_ID_2],
      resolutionNotes: "reason",
      source: "admin_ui",
    });
    expect(res.notFoundIds).toEqual([]);
  });
});

describe("bulkResolveFailedPushes — audit emit shape (LOAD-BEARING)", () => {
  // These tests pin the audit emit metadata shape to the event-types.ts
  // registration. The §A registered-metadata-wins rule means the
  // registration IS the contract; this test enforces the runtime emit
  // matches that contract verbatim. Drift here = audit-log query
  // breakage downstream.

  it("emits failed_push.bulk_resolved with all 5 registered metadata fields", async () => {
    mockBulkMark.mockResolvedValue([failedPushFixture(FP_ID_1), failedPushFixture(FP_ID_2)]);
    await bulkResolveFailedPushes(userCtx(["failed_pushes:resolve"]), {
      failedPushIds: [FP_ID_1, FP_ID_2, FP_ID_3],
      resolutionNotes: "ops decision: accept-leak past-dated",
      source: "admin_ui",
    });
    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("failed_push.bulk_resolved");
    expect(emitArg.actorKind).toBe("user");
    expect(emitArg.tenantId).toBe(TENANT_ID);
    expect(emitArg.resourceType).toBe("failed_push");
    expect(emitArg.resourceId).toBeUndefined();
    // All 5 fields per event-types.ts metadataNotes:
    //   failed_push_ids[], count, resolution_notes, source, not_found_count
    expect(emitArg.metadata).toEqual({
      failed_push_ids: [FP_ID_1, FP_ID_2],
      count: 2,
      resolution_notes: "ops decision: accept-leak past-dated",
      source: "admin_ui",
      not_found_count: 1,
    });
  });

  it("emits with source='cli' and actor system identity for CLI path", async () => {
    mockBulkMark.mockResolvedValue([failedPushFixture(FP_ID_1)]);
    await bulkResolveFailedPushes(cliSystemCtx(["failed_pushes:resolve"]), {
      failedPushIds: [FP_ID_1],
      resolutionNotes: "ops backlog drain",
      source: "cli",
    });
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.actorKind).toBe("system");
    expect(emitArg.actorId).toBe("cli:resolve_failed_pushes");
    expect(emitArg.metadata).toMatchObject({
      source: "cli",
      count: 1,
      not_found_count: 0,
    });
  });

  it("audit emit fires even when 0 rows resolved (operator intent IS the auditable event)", async () => {
    mockBulkMark.mockResolvedValue([]);
    await bulkResolveFailedPushes(userCtx(["failed_pushes:resolve"]), {
      failedPushIds: [FP_ID_1, FP_ID_2],
      resolutionNotes: "all stale, but still my intent",
      source: "admin_ui",
    });
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit.mock.calls[0][0].metadata).toMatchObject({
      failed_push_ids: [],
      count: 0,
      not_found_count: 2,
    });
  });
});

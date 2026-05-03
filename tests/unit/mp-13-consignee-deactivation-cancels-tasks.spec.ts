// tests/unit/mp-13-consignee-deactivation-cancels-tasks.spec.ts
//
// Day 7 / C-7. MP-13 named test — rule coverage marker for CI.
//
// MP-13 RULE (per plan-resolutions.docx §3 Day 7 row):
//   "When a consignee is deactivated, all pending tasks for that
//    consignee transition to CANCELLED."
//
// PARTIAL IMPLEMENTATION STATUS (2 May 2026):
// =============================================================================
// The schema does NOT support full MP-13 today. Two structural reasons:
//
//   1. consignees has no `deactivated_at` column. There is no
//      "deactivation" concept distinct from hard-delete in the current
//      data model.
//
//   2. tasks → consignees FK is ON DELETE RESTRICT (per 0006_task.sql).
//      A consignee with active tasks cannot be hard-deleted. Even after
//      transitioning all pending tasks to internal_status='CANCELED',
//      the cancelled task rows still REFERENCE the consignee row, so
//      RESTRICT still blocks the parent delete. The cascade-cancel
//      pattern requires either:
//        (a) a `deactivated_at` soft-delete column on consignees
//            (preferred — preserves task history under a status flag)
//        (b) FK changed to ON DELETE CASCADE (loses task history)
//        (c) FK changed to ON DELETE SET NULL (requires
//            tasks.consignee_id to become nullable — invariant change)
//
// What this test pins TODAY:
//   • Path 1 — consignee with NO active tasks: hard-delete succeeds and
//     emits `consignee.deleted`. This is the existing
//     C-3/Day-3 deletion contract.
//   • Path 2 — consignee WITH active tasks: hard-delete throws (the FK
//     RESTRICT propagates as a raw DB error). The MP-13 rule is NOT
//     yet enforced; no cascade-cancel; no audit trail of cancelled
//     tasks. Documented honestly so CI shows the gap.
//
// Resolution path:
//   See `memory/followup_mp_13_cascade_cancel.md` for the design
//   options + Day-8/9 implementation scope. When that PR lands, this
//   test file gets updated to assert the cascade-cancel behavior:
//   tasks transitioning to CANCELED, per-task `task.updated` emits,
//   subscription stays untouched, consignee transitions to soft-deleted.
//
// Why a named test file rather than fold into consignees/service.spec.ts:
//   The brief specifies named test files for MP-13 + MP-14 so CI output
//   shows rule coverage by name (per plan-resolutions.docx §3 Day 7).
//   A reviewer can grep for "MP-13" in CI logs and see whether the rule
//   is covered, partially covered, or uncovered without parsing test
//   names from a generic service spec.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/shared/db", () => ({
  withTenant: vi.fn(),
  withServiceRole: vi.fn(),
}));

vi.mock("../../src/modules/audit", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/modules/audit")>("../../src/modules/audit");
  return {
    ...actual,
    emit: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../src/modules/consignees/repository", () => ({
  insertConsignee: vi.fn(),
  bulkInsertConsignees: vi.fn(),
  findConsigneeById: vi.fn(),
  listConsigneesByTenant: vi.fn(),
  updateConsignee: vi.fn(),
  deleteConsignee: vi.fn(),
}));

vi.mock("../../src/shared/logger", () => {
  const child = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { logger: { ...child, with: () => child } };
});

vi.mock("../../src/shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

import { withTenant } from "../../src/shared/db";
import { NotFoundError } from "../../src/shared/errors";
import { emit } from "../../src/modules/audit";
import {
  deleteConsignee as deleteConsigneeRow,
  findConsigneeById,
} from "../../src/modules/consignees/repository";
import { deleteConsignee } from "../../src/modules/consignees/service";
import type { Permission } from "../../src/shared/types";
import type { Actor, RequestContext } from "../../src/shared/tenant-context";

const mockWithTenant = vi.mocked(withTenant);
const mockEmit = vi.mocked(emit);
const mockFindById = vi.mocked(findConsigneeById);
const mockDeleteRow = vi.mocked(deleteConsigneeRow);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const CONSIGNEE_ID = "11111111-1111-1111-1111-111111111111";

function ctx(perms: readonly Permission[]): RequestContext {
  const actor: Actor = {
    kind: "user",
    userId: ACTOR_USER_ID,
    tenantId: TENANT_ID,
    permissions: new Set(perms),
  };
  return {
    actor,
    tenantId: TENANT_ID,
    requestId: "mp-13-test-request",
    path: "/api/consignees",
  };
}

function consigneeFixture() {
  return {
    id: CONSIGNEE_ID,
    tenantId: TENANT_ID,
    name: "MP-13 Fixture",
    phone: "+971500000000",
    email: null,
    addressLine: "Test Address",
    emirateOrRegion: "Dubai",
    district: "Test District",
    deliveryNotes: null,
    externalRef: null,
    notesInternal: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
}

describe("MP-13 — consignee deactivation cancels pushed tasks (PARTIALLY IMPLEMENTED)", () => {
  beforeEach(() => {
    mockWithTenant.mockImplementation(async (_tenantId, fn) => {
      // Stub tx — repository functions are themselves mocked, so the
      // tx parameter is unused.
      return fn({} as never);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Path 1 — clean delete (consignee has no active tasks)", () => {
    it("deletes the consignee and emits consignee.deleted with consignee_id metadata", async () => {
      mockFindById.mockResolvedValue(consigneeFixture());
      mockDeleteRow.mockResolvedValue(true);

      await deleteConsignee(ctx(["consignee:delete"]), CONSIGNEE_ID);

      expect(mockDeleteRow).toHaveBeenCalledOnce();
      expect(mockEmit).toHaveBeenCalledOnce();
      const emitArg = mockEmit.mock.calls[0][0];
      expect(emitArg.eventType).toBe("consignee.deleted");
      expect(emitArg.resourceId).toBe(CONSIGNEE_ID);
      expect(emitArg.metadata).toEqual({ consignee_id: CONSIGNEE_ID });
    });
  });

  describe("Path 2 — GAP: consignee has active tasks (FK RESTRICT fires)", () => {
    // Documents the missing cascade-cancel behavior. This test asserts
    // CURRENT BEHAVIOR — it will need to be updated when the cascade-
    // cancel implementation lands per
    // memory/followup_mp_13_cascade_cancel.md.

    it("propagates the FK violation as a thrown error (rule NOT YET enforced)", async () => {
      mockFindById.mockResolvedValue(consigneeFixture());
      // Simulate the FK RESTRICT — the repository's tx.execute(DELETE …)
      // would receive SQLSTATE 23503 from Postgres; the mocked
      // repository raises a generic Error to stand in.
      mockDeleteRow.mockImplementation(async () => {
        const err = new Error(
          'update or delete on table "consignees" violates foreign key constraint "tasks_consignee_id_fkey" on table "tasks"',
        );
        // Attach the SQLSTATE code postgres-js exposes as `code` on its
        // error objects — service-layer code that ever wants to detect
        // this case (a future cascade-cancel implementation) can branch
        // on the code rather than parse the message.
        (err as Error & { code?: string }).code = "23503";
        throw err;
      });

      await expect(
        deleteConsignee(ctx(["consignee:delete"]), CONSIGNEE_ID),
      ).rejects.toThrow(/foreign key constraint/);

      // Audit must NOT fire on the failure path — `consignee.deleted`
      // would be a ghost event for an action that didn't commit.
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("does not yet attempt to cancel pending tasks before deletion (gap)", async () => {
      // The MP-13 rule's full implementation would: pre-fetch pending
      // tasks for this consignee, transition each to CANCELED via
      // task.update, emit per-task task.updated events, then delete
      // the consignee (which still requires schema work — see memo).
      // None of that wiring exists today. This test asserts the
      // observable absence: no per-task audit event, no task module
      // imports referenced, no cancel-tasks helper called.
      mockFindById.mockResolvedValue(consigneeFixture());
      mockDeleteRow.mockResolvedValue(true);

      await deleteConsignee(ctx(["consignee:delete"]), CONSIGNEE_ID);

      // Only the consignee.deleted emit fires — no task.updated emits.
      const eventTypes = mockEmit.mock.calls.map((call) => call[0].eventType);
      expect(eventTypes).toEqual(["consignee.deleted"]);
    });
  });

  describe("Pre-conditions on the path that DOES work today", () => {
    it("throws NotFoundError when the consignee does not exist (and does NOT audit)", async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        deleteConsignee(ctx(["consignee:delete"]), CONSIGNEE_ID),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(mockDeleteRow).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});

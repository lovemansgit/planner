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
//   • Path 2 — MP-13 RULED BEHAVIOR (Day-54 R-E, brief v1.26): the
//     CHURNED transition is a hard stop — subscriptions end, never-
//     pushed tasks cancel locally, pushed tasks (incl. driver-bound)
//     get vendor recalls via the cancel fan-out; the churn_cascade
//     audit event carries the counts. Non-churn transitions cascade
//     nothing.
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
  findConsigneeForCrmUpdate: vi.fn(),
  updateConsigneeCrmState: vi.fn(),
  insertConsigneeCrmEvent: vi.fn(),
}));

// R-E churn cascade dependencies (plan day-54-session-c-re-churn-cascade §1).
vi.mock("../../src/modules/tasks", () => ({
  cancelConsigneeTasksForChurn: vi.fn(),
}));
vi.mock("../../src/modules/subscriptions", () => ({
  endAllSubscriptionsForConsignee: vi.fn(),
}));
vi.mock("../../src/modules/task-outbound-queue", () => ({
  enqueueBulkCancelTasks: vi.fn(),
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
  findConsigneeForCrmUpdate,
  insertConsigneeCrmEvent,
  updateConsigneeCrmState,
} from "../../src/modules/consignees/repository";
import { changeConsigneeCrmState, deleteConsignee } from "../../src/modules/consignees/service";
import { cancelConsigneeTasksForChurn } from "../../src/modules/tasks";
import { endAllSubscriptionsForConsignee } from "../../src/modules/subscriptions";
import { enqueueBulkCancelTasks } from "../../src/modules/task-outbound-queue";
import type { Permission } from "../../src/shared/types";
import type { Actor, RequestContext } from "../../src/shared/tenant-context";

const mockWithTenant = vi.mocked(withTenant);
const mockEmit = vi.mocked(emit);
const mockFindById = vi.mocked(findConsigneeById);
const mockDeleteRow = vi.mocked(deleteConsigneeRow);
const mockFindForCrm = vi.mocked(findConsigneeForCrmUpdate);
const mockUpdateCrm = vi.mocked(updateConsigneeCrmState);
const mockInsertCrmEvent = vi.mocked(insertConsigneeCrmEvent);
const mockCancelChurn = vi.mocked(cancelConsigneeTasksForChurn);
const mockEndAllSubs = vi.mocked(endAllSubscriptionsForConsignee);
const mockEnqueueBulk = vi.mocked(enqueueBulkCancelTasks);

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
    crmState: "ACTIVE" as const,
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

  describe("Path 2 — MP-13 ruled behavior (v1.26): CHURNED is a hard stop", () => {
    // Rewritten per Love's Day-54 R-E ruling (was: pins the FK-RESTRICT
    // gap on hard-delete). Churn now cascades: every subscription ends,
    // never-pushed tasks cancel locally, pushed tasks (INCLUDING
    // driver-bound — the single sanctioned R-A-freeze bypass) get
    // vendor recalls; local status flips only on vendor confirmation.
    function stubCrmHappy() {
      mockWithTenant.mockImplementation(async (_t, fn) => fn({} as never));
      mockFindForCrm.mockResolvedValue(consigneeFixture() as never);
      mockUpdateCrm.mockResolvedValue(consigneeFixture() as never);
      mockInsertCrmEvent.mockResolvedValue({ id: "crm-evt-1" } as never);
    }

    it("CHURNED transition cascades: subs ended, unpushed canceled locally, pushed recalled, churn_cascade emitted", async () => {
      stubCrmHappy();
      mockEndAllSubs.mockResolvedValue(2);
      mockCancelChurn.mockResolvedValue({
        canceledLocalCount: 1,
        recalls: [
          { id: "t-pushed-1", external_tracking_number: "AWB-CHURN-1" },
          { id: "t-assigned-1", external_tracking_number: "AWB-CHURN-2" },
        ],
      } as never);
      mockEnqueueBulk.mockResolvedValue({ enqueuedCount: 2, failedChunks: 0, totalCount: 2 } as never);

      const result = await changeConsigneeCrmState(
        ctx(["consignee:change_crm_state"] as never),
        CONSIGNEE_ID as never,
        { toState: "CHURNED", reason: "customer churned — stop everything" },
      );

      expect(result.status).toBe("updated");
      expect(mockEndAllSubs).toHaveBeenCalledTimes(1);
      expect(mockCancelChurn).toHaveBeenCalledTimes(1);

      // Fan-out got exactly the recall AWBs.
      expect(mockEnqueueBulk).toHaveBeenCalledTimes(1);
      const payloads = mockEnqueueBulk.mock.calls[0][0] as readonly { awb: string }[];
      expect(payloads.map((pl) => pl.awb)).toEqual(["AWB-CHURN-1", "AWB-CHURN-2"]);

      // churn_cascade audit with honest counts.
      const cascadeEmits = mockEmit.mock.calls.filter(
        (c) => (c[0] as { eventType: string }).eventType === "consignee.churn_cascade",
      );
      expect(cascadeEmits).toHaveLength(1);
      expect((cascadeEmits[0][0] as { metadata: Record<string, unknown> }).metadata).toMatchObject({
        consignee_id: CONSIGNEE_ID,
        subscriptions_ended: 2,
        tasks_canceled_local: 1,
        recalls_attempted: 2,
      });
    });

    it("non-churn transitions cascade NOTHING (guard)", async () => {
      stubCrmHappy();

      const result = await changeConsigneeCrmState(
        ctx(["consignee:change_crm_state"] as never),
        CONSIGNEE_ID as never,
        { toState: "ON_HOLD", reason: "short hold" },
      );

      expect(result.status).toBe("updated");
      expect(mockEndAllSubs).not.toHaveBeenCalled();
      expect(mockCancelChurn).not.toHaveBeenCalled();
      expect(mockEnqueueBulk).not.toHaveBeenCalled();
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

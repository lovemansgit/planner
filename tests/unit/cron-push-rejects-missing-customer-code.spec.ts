// tests/unit/cron-push-rejects-missing-customer-code.spec.ts
//
// Day 8 / D8-4a — fail-closed guard 2 (per-tenant).
//
// RULE: When `tenants.suitefleet_customer_code IS NULL` (or empty
// string), the cron's per-tenant push pass MUST:
//   1. NOT call the SF adapter's createTask method (zero invocations
//      across the entire tenant batch).
//   2. Emit exactly ONE `tenant.push_skipped` audit event with
//      `metadata.reason='missing_customer_code'` and
//      `metadata.skipped_task_count: <N>` where N is the count of
//      unpushed tasks for the tenant.
//   3. Return outcome `{ kind: 'tenant_skipped', ... }`.
//
// Single event per tenant per pass — NOT one per task — because the
// cause is a tenant-level config gap, not per-task failure. Surfaces
// operationally as one alert per tenant per pass instead of N alerts.
//
// Why a named test file rather than fold into a generic service spec:
// the brief's PR #74 watch-item registration explicitly asked for a
// named regression marker so CI output shows the rule by name. A
// reviewer can grep for "cron-push-rejects-missing-customer-code" in
// CI logs and see the rule is covered without parsing test names
// from a generic service spec.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/shared/db", () => ({
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

vi.mock("../../src/modules/failed-pushes", () => ({
  recordFailedPushAttempt: vi.fn(),
}));

vi.mock("../../src/modules/tasks/repository", () => ({
  listUnpushedTasksByTenant: vi.fn(),
  markTaskPushed: vi.fn(),
}));

vi.mock("../../src/shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

import { withServiceRole } from "../../src/shared/db";
import { emit } from "../../src/modules/audit";
import { recordFailedPushAttempt } from "../../src/modules/failed-pushes";
import { pushTasksForTenant } from "../../src/modules/task-push";
import {
  listUnpushedTasksByTenant,
  markTaskPushed,
} from "../../src/modules/tasks/repository";
import type { LastMileAdapter } from "../../src/modules/integration";
import type { Actor, RequestContext } from "../../src/shared/tenant-context";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockRecord = vi.mocked(recordFailedPushAttempt);
const mockListUnpushed = vi.mocked(listUnpushedTasksByTenant);
const mockMarkPushed = vi.mocked(markTaskPushed);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const REQUEST_ID = "test-request-mc";

function systemCtx(): RequestContext {
  const actor: Actor = {
    kind: "system",
    system: "cron:generate_tasks",
    tenantId: TENANT_ID,
    permissions: new Set(),
  };
  return {
    actor,
    tenantId: TENANT_ID,
    requestId: REQUEST_ID,
    path: "/api/cron/generate-tasks",
  };
}

/**
 * Stub adapter — every method tracked. The point of these tests is
 * to assert ZERO calls to createTask.
 */
function stubAdapter(): LastMileAdapter & {
  createTask: ReturnType<typeof vi.fn>;
} {
  return {
    authenticate: vi.fn(async () => {
      throw new Error("authenticate must NOT be called when guard fires");
    }),
    refreshSession: vi.fn(),
    createTask: vi.fn(async () => {
      throw new Error("createTask must NOT be called when missing_customer_code guard fires");
    }),
    fetchAssetTrackingByAwb: vi.fn(),
    verifyWebhookRequest: vi.fn(),
    parseWebhookEvents: vi.fn(),
    mapStatusToInternal: vi.fn(),
  } as never;
}

describe("D8-4a guard 2 — missing_customer_code (per-tenant fail-closed)", () => {
  beforeEach(() => {
    mockWithServiceRole.mockReset();
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);
    mockRecord.mockReset();
    mockListUnpushed.mockReset();
    mockMarkPushed.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("emits tenant.push_skipped with skipped_task_count and returns tenant_skipped when customer_code is null", async () => {
    // Two withServiceRole calls in this path:
    //   1. load_config — returns row with suitefleet_customer_code: null
    //   2. count_unpushed — returns 5
    let serviceRoleCall = 0;
    mockWithServiceRole.mockImplementation(async (_label, fn) => {
      serviceRoleCall += 1;
      const tx = {
        execute: vi.fn(async () => {
          if (serviceRoleCall === 1) {
            // load_config
            return [{ suitefleet_customer_code: null }];
          }
          if (serviceRoleCall === 2) {
            // count_unpushed
            return [{ n: 5 }];
          }
          throw new Error(`unexpected withServiceRole call #${serviceRoleCall}`);
        }),
      };
      return fn(tx as never);
    });

    const adapter = stubAdapter();
    const outcome = await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    // Outcome shape
    expect(outcome).toEqual({
      kind: "tenant_skipped",
      tenantId: TENANT_ID,
      reason: "missing_customer_code",
      skippedTaskCount: 5,
    });

    // ZERO adapter calls — this is the load-bearing assertion
    expect(adapter.authenticate).not.toHaveBeenCalled();
    expect(adapter.createTask).not.toHaveBeenCalled();

    // No DLQ writes / no list-unpushed call (the guard short-circuits
    // before either)
    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockListUnpushed).not.toHaveBeenCalled();
    expect(mockMarkPushed).not.toHaveBeenCalled();

    // Exactly ONE tenant.push_skipped event with the canonical
    // metadata shape
    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("tenant.push_skipped");
    expect(emitArg.tenantId).toBe(TENANT_ID);
    expect(emitArg.resourceType).toBe("tenant");
    expect(emitArg.resourceId).toBe(TENANT_ID);
    expect(emitArg.metadata).toEqual({
      tenant_id: TENANT_ID,
      reason: "missing_customer_code",
      skipped_task_count: 5,
    });
  });

  it("treats empty-string customer_code as missing (defensive trim guard)", async () => {
    // Defence-in-depth: code that strips trailing whitespace might
    // produce '' from a value that was loaded as ' ' or a stray
    // backfill SQL that ran `SET suitefleet_customer_code = ''`.
    // The guard must catch this.
    let serviceRoleCall = 0;
    mockWithServiceRole.mockImplementation(async (_label, fn) => {
      serviceRoleCall += 1;
      const tx = {
        execute: vi.fn(async () => {
          if (serviceRoleCall === 1) return [{ suitefleet_customer_code: "  " }];
          if (serviceRoleCall === 2) return [{ n: 3 }];
          throw new Error(`unexpected withServiceRole call #${serviceRoleCall}`);
        }),
      };
      return fn(tx as never);
    });

    const adapter = stubAdapter();
    const outcome = await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    expect(outcome.kind).toBe("tenant_skipped");
    expect(adapter.createTask).not.toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.metadata).toEqual({
      tenant_id: TENANT_ID,
      reason: "missing_customer_code",
      skipped_task_count: 3,
    });
  });

  it("emits tenant.push_skipped with skipped_task_count: 0 when there are no unpushed tasks AND customer_code is missing", async () => {
    // Edge case: tenant has no unpushed tasks AND no customer_code.
    // The guard still fires (config gap is real) but the event
    // metadata reflects zero tasks. Operationally interesting: an
    // operator sees the alert and knows to backfill the code BEFORE
    // any tasks are generated for this tenant.
    let serviceRoleCall = 0;
    mockWithServiceRole.mockImplementation(async (_label, fn) => {
      serviceRoleCall += 1;
      const tx = {
        execute: vi.fn(async () => {
          if (serviceRoleCall === 1) return [{ suitefleet_customer_code: null }];
          if (serviceRoleCall === 2) return [{ n: 0 }];
          throw new Error(`unexpected withServiceRole call #${serviceRoleCall}`);
        }),
      };
      return fn(tx as never);
    });

    const adapter = stubAdapter();
    const outcome = await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    expect(outcome.kind).toBe("tenant_skipped");
    if (outcome.kind === "tenant_skipped") {
      expect(outcome.skippedTaskCount).toBe(0);
    }
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });
});

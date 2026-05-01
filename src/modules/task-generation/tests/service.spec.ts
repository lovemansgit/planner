// Unit tests for task-generation service input validation and the
// pure date helper. Heavier service-behaviour tests (window/idempotency/cap)
// live in tests/integration/task-generation.spec.ts.
//
// Mocks ../../shared/db, ../audit, and ../repository so the validation
// guards can be exercised without real Postgres. Same posture as
// src/modules/tasks/tests/service.spec.ts.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withTenant: vi.fn(),
  withServiceRole: vi.fn(),
}));

vi.mock("../../audit", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", () => ({
  insertRunOrGetExisting: vi.fn(),
  finaliseRun: vi.fn(),
  findRunById: vi.fn(),
  countMatchingSubscriptions: vi.fn(),
  bulkInsertTasksForSubscriptions: vi.fn(),
}));

vi.mock("../../../shared/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    with: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      with: vi.fn(),
    }),
  },
}));

import { generateTasksForWindow } from "../service";
import { nextCalendarDateInDubai } from "../dubai-date";
import { ForbiddenError, ValidationError } from "../../../shared/errors";
import type { Actor, RequestContext } from "../../../shared/tenant-context";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function userCtx(): RequestContext {
  const actor: Actor = {
    kind: "user",
    userId: "00000000-0000-0000-0000-000000000001",
    tenantId: TENANT_ID,
    permissions: new Set(),
  };
  return { actor, tenantId: TENANT_ID, requestId: "test-req", path: "/api/x" };
}

function systemCtx(): RequestContext {
  const actor: Actor = {
    kind: "system",
    system: "cron:generate_tasks",
    tenantId: TENANT_ID,
    permissions: new Set(),
  };
  return { actor, tenantId: TENANT_ID, requestId: "test-req", path: "/cron/x" };
}

describe("generateTasksForWindow — input validation (no DB)", () => {
  it("rejects user actors with ForbiddenError", async () => {
    await expect(
      generateTasksForWindow(userCtx(), {
        tenantId: TENANT_ID,
        windowStart: "2026-05-03T12:00:00Z",
        windowEnd: "2026-05-03T13:00:00Z",
        targetDate: "2026-05-04",
        capThreshold: 7000,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects malformed targetDate with ValidationError", async () => {
    await expect(
      generateTasksForWindow(systemCtx(), {
        tenantId: TENANT_ID,
        windowStart: "2026-05-03T12:00:00Z",
        windowEnd: "2026-05-03T13:00:00Z",
        targetDate: "2026/05/04", // wrong format
        capThreshold: 7000,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects non-positive capThreshold with ValidationError", async () => {
    await expect(
      generateTasksForWindow(systemCtx(), {
        tenantId: TENANT_ID,
        windowStart: "2026-05-03T12:00:00Z",
        windowEnd: "2026-05-03T13:00:00Z",
        targetDate: "2026-05-04",
        capThreshold: 0,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("nextCalendarDateInDubai — pure date math", () => {
  it("12:00 UTC on 2026-05-02 (= 16:00 Dubai) → next-day target 2026-05-03", () => {
    expect(nextCalendarDateInDubai(new Date("2026-05-02T12:00:00Z"))).toBe("2026-05-03");
  });

  it("23:59 UTC on 2026-05-02 (= 03:59 Dubai on 2026-05-03) → next-day 2026-05-04", () => {
    expect(nextCalendarDateInDubai(new Date("2026-05-02T23:59:00Z"))).toBe("2026-05-04");
  });

  it("rolls month boundary: 19:59 UTC on 2026-05-31 (= 23:59 Dubai on 2026-05-31) → 2026-06-01", () => {
    expect(nextCalendarDateInDubai(new Date("2026-05-31T19:59:00Z"))).toBe("2026-06-01");
  });

  it("rolls year boundary: 19:59 UTC on 2026-12-31 → 2027-01-01", () => {
    expect(nextCalendarDateInDubai(new Date("2026-12-31T19:59:00Z"))).toBe("2027-01-01");
  });

  it("handles leap year February correctly (2024-02-28 → 2024-02-29)", () => {
    expect(nextCalendarDateInDubai(new Date("2024-02-28T12:00:00Z"))).toBe("2024-02-29");
  });
});

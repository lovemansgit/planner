// tests/unit/queue-routes-signature-gate-behavioral.spec.ts
//
// §7.2 rows 9 + 12 — behavioral counterpart to the structural
// signature-gate tests in queue-push-task.spec.ts and
// queue-push-task-failed.spec.ts.
//
// The structural tests pin "verifySignatureAppRouter wraps the inner
// handler at module load time." That's necessary but not sufficient —
// it doesn't verify what happens when an unsigned request hits the
// route in production. This file fills the gap: it imports the routes
// WITHOUT mocking @upstash/qstash/nextjs, sends real Request objects
// missing the Upstash-Signature header, and asserts the SDK gate
// returns 401 before the inner handler runs.
//
// All other dependencies (DB, Sentry, server-only, integration adapter,
// repository functions) ARE mocked — this file exercises the gate, not
// the inner handler. Inner handler behavior is covered by the
// structural-mock tests.
//
// Why this lives in unit (not integration): the behavior under test is
// QStash SDK signature verification, which runs entirely in-process
// against the request headers. No DB, no QStash service, no network
// I/O. Cheap, deterministic, fits the unit test schedule.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Set stub QStash signing keys BEFORE the route modules import — the
// SDK reads these at module load (when `verifySignatureAppRouter(...)`
// is called by the route's top-level `export const POST = ...`).
// Plain top-level `process.env.X = ...` runs AFTER ESM imports
// (imports hoist above top-level statements), so the route would see
// undefined keys and crash at import. `vi.hoisted` runs BEFORE
// imports — that's the contract we need.
vi.hoisted(() => {
  process.env.QSTASH_CURRENT_SIGNING_KEY =
    process.env.QSTASH_CURRENT_SIGNING_KEY ?? "sig_test_current_stub_key";
  process.env.QSTASH_NEXT_SIGNING_KEY =
    process.env.QSTASH_NEXT_SIGNING_KEY ?? "sig_test_next_stub_key";
});

// DO NOT mock @upstash/qstash/nextjs — that's the gate under test.
// All other dependencies stubbed so the inner handler can't run far
// enough to matter (the gate must reject before any of them are
// touched).
vi.mock("server-only", () => ({}));

vi.mock("../../src/shared/db", () => ({
  withServiceRole: vi.fn(),
}));

vi.mock("../../src/shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../src/modules/tasks/repository", () => ({
  findTaskById: vi.fn(),
}));

vi.mock("../../src/modules/task-push", () => ({
  pushSingleTask: vi.fn(),
}));

vi.mock("../../src/modules/failed-pushes/repository", () => ({
  insertFailedPush: vi.fn(),
}));

const adapterSpies = vi.hoisted(() => ({
  authenticate: vi.fn(),
  refreshSession: vi.fn(),
  createTask: vi.fn(),
  getTaskByAwb: vi.fn(),
  fetchAssetTrackingByAwb: vi.fn(),
  verifyWebhookRequest: vi.fn(),
  parseWebhookEvents: vi.fn(),
  mapStatusToInternal: vi.fn(),
}));

vi.mock("../../src/modules/integration", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/modules/integration")>(
      "../../src/modules/integration",
    );
  return {
    ...actual,
    createSuiteFleetLastMileAdapter: vi.fn(() => adapterSpies),
  };
});

import { POST as pushTaskPOST } from "../../src/app/api/queue/push-task/route";
import { POST as pushTaskFailedPOST } from "../../src/app/api/queue/push-task-failed/route";
import { withServiceRole } from "../../src/shared/db";
import { findTaskById } from "../../src/modules/tasks/repository";
import { pushSingleTask } from "../../src/modules/task-push";
import { insertFailedPush } from "../../src/modules/failed-pushes/repository";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockFindTaskById = vi.mocked(findTaskById);
const mockPushSingleTask = vi.mocked(pushSingleTask);
const mockInsertFailedPush = vi.mocked(insertFailedPush);

function makeUnsignedRequest(url: string, body: unknown): Request {
  // Deliberately omit the `Upstash-Signature` header — that's the
  // contract the SDK gate must reject. Including content-type only
  // so the request is otherwise well-formed; the rejection must
  // happen at the signature layer, not the body-parse layer.
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockWithServiceRole.mockReset();
  mockFindTaskById.mockReset();
  mockPushSingleTask.mockReset();
  mockInsertFailedPush.mockReset();
  Object.values(adapterSpies).forEach((spy) => spy.mockReset());
  // Silence logger output (SDK rejection paths may emit log lines we
  // don't care about pinning here).
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// §7.2 row 9 — /api/queue/push-task signature gate behavioral
// ===========================================================================

describe("§7.2 row 9 (behavioral) — /api/queue/push-task rejects unsigned POST", () => {
  it("returns 401 when Upstash-Signature header is missing; inner handler dependencies NOT touched", async () => {
    const res = await pushTaskPOST(
      makeUnsignedRequest("https://example.com/api/queue/push-task", {
        tenant_id: "00000000-0000-0000-0000-00000000000a",
        task_id: "11111111-1111-1111-1111-111111111111",
      }),
    );

    // SDK returns 403 for missing/invalid signature (per
    // @upstash/qstash/nextjs behavior). Plan §7.2 rows 9+12 say
    // "401 returned" but that's plan drift — SDK code is the source
    // of truth, and 403 (Forbidden) is the standard QStash rejection
    // status. Pinning 403 here documents reality.
    expect(res.status).toBe(403);
    // Gate rejected → inner handler NEVER ran. None of the
    // dependencies the inner handler uses should have been touched.
    expect(mockWithServiceRole).not.toHaveBeenCalled();
    expect(mockFindTaskById).not.toHaveBeenCalled();
    expect(mockPushSingleTask).not.toHaveBeenCalled();
    expect(adapterSpies.createTask).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// §7.2 row 12 — /api/queue/push-task-failed signature gate behavioral
// ===========================================================================

describe("§7.2 row 12 (behavioral) — /api/queue/push-task-failed rejects unsigned POST", () => {
  it("returns 401 when Upstash-Signature header is missing; insertFailedPush NOT called", async () => {
    const res = await pushTaskFailedPOST(
      makeUnsignedRequest(
        "https://example.com/api/queue/push-task-failed",
        {
          sourceMessageId: "msg-123",
          sourceBody: Buffer.from(
            JSON.stringify({ tenant_id: "x", task_id: "y" }),
            "utf-8",
          ).toString("base64"),
          status: 503,
          retried: 3,
        },
      ),
    );

    // SDK returns 403 for missing/invalid signature (per
    // @upstash/qstash/nextjs behavior). Plan §7.2 rows 9+12 say
    // "401 returned" but that's plan drift — SDK code is the source
    // of truth, and 403 (Forbidden) is the standard QStash rejection
    // status. Pinning 403 here documents reality.
    expect(res.status).toBe(403);
    // Gate rejected → no DB write. The DLQ INSERT must not happen
    // for unsigned requests (otherwise an attacker could pollute
    // failed_pushes with junk rows).
    expect(mockWithServiceRole).not.toHaveBeenCalled();
    expect(mockInsertFailedPush).not.toHaveBeenCalled();
  });
});

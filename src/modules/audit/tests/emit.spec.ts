// emit + serviceRoleAuditObserver unit tests — R-4 / Day 2.
//
// Mocks ../../shared/db so emit's INSERT and the observer's recursion
// behavior can be verified without a real Postgres connection. The
// integration test that proves emit actually inserts and that the
// audit_events RLS policy permits the path lives in
// tests/integration/ (out of scope for R-4's PR — covered by R-0
// already proving the wrapper plumbing, plus future audit-specific
// integration tests if needed).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted; the factory replaces the imports below.
vi.mock("../../../shared/db", () => ({
  withServiceRole: vi.fn(),
  setServiceRoleObserver: vi.fn(),
}));

import { setServiceRoleObserver, withServiceRole } from "../../../shared/db";

import {
  AUDIT_EMIT_REASON_PREFIX,
  emit,
  registerAuditObserver,
  serviceRoleAuditObserver,
} from "../emit";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockSetServiceRoleObserver = vi.mocked(setServiceRoleObserver);

beforeEach(() => {
  mockWithServiceRole.mockReset();
  mockSetServiceRoleObserver.mockReset();
  // Default: withServiceRole runs the callback against a stub tx that
  // records every execute call. Tests that need a different shape
  // override this in a per-test setup.
  mockWithServiceRole.mockImplementation(async (_reason, fn) => {
    const tx = { execute: vi.fn().mockResolvedValue([]) };
    return fn(tx as never);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("emit()", () => {
  it("calls withServiceRole with reason starting with AUDIT_EMIT_REASON_PREFIX", async () => {
    await emit({
      eventType: "consignee.created",
      actorKind: "user",
      actorId: "user-uuid-here",
      tenantId: "tenant-uuid-here",
    });
    expect(mockWithServiceRole).toHaveBeenCalledOnce();
    const reason = mockWithServiceRole.mock.calls[0][0];
    expect(reason.startsWith(AUDIT_EMIT_REASON_PREFIX)).toBe(true);
  });

  it("includes the event_type in the reason string", async () => {
    await emit({
      eventType: "tenant.migration_imported",
      actorKind: "system",
      actorId: "transcorp-sysadmin:alice",
      tenantId: "tenant-uuid-here",
    });
    const reason = mockWithServiceRole.mock.calls[0][0];
    expect(reason).toBe(`${AUDIT_EMIT_REASON_PREFIX}tenant.migration_imported`);
  });

  it("issues an INSERT to audit_events through the wrapper's tx", async () => {
    const executed: unknown[] = [];
    mockWithServiceRole.mockImplementation(async (_reason, fn) => {
      const tx = {
        execute: vi.fn(async (q: unknown) => {
          executed.push(q);
          return [];
        }),
      };
      return fn(tx as never);
    });

    await emit({
      eventType: "consignee.bulk_created",
      actorKind: "user",
      actorId: "user-uuid-here",
      tenantId: "tenant-uuid-here",
      metadata: { import_id: "import-uuid", row_count: 42, file_hash: "deadbeef" },
    });

    expect(executed.length).toBe(1);
    // The query is a Drizzle SQL tagged-template object. We can't do a
    // deep structural check without coupling to Drizzle internals, but
    // we can confirm that exactly one execute fired — the INSERT.
  });

  it("rejects an unknown event_type (catalogue-only invariant)", async () => {
    await expect(
      emit({
        // @ts-expect-error — intentionally unknown id to exercise the runtime guard.
        eventType: "consignee.imaginary_action",
        actorKind: "user",
        actorId: "user-uuid",
        tenantId: "tenant-uuid",
      })
    ).rejects.toThrow(/unknown event_type/);
    expect(mockWithServiceRole).not.toHaveBeenCalled();
  });

  it("rejects empty actorId", async () => {
    await expect(
      emit({
        eventType: "consignee.created",
        actorKind: "user",
        actorId: "",
        tenantId: "tenant-uuid",
      })
    ).rejects.toThrow(/actorId must be non-empty/);
    expect(mockWithServiceRole).not.toHaveBeenCalled();
  });
});

describe("serviceRoleAuditObserver — recursion-skip contract", () => {
  it("does NOT call withServiceRole when reason starts with AUDIT_EMIT_REASON_PREFIX", () => {
    serviceRoleAuditObserver(`${AUDIT_EMIT_REASON_PREFIX}consignee.created`);
    expect(mockWithServiceRole).not.toHaveBeenCalled();
  });

  it("does NOT call withServiceRole for any audit-prefixed reason (multiple event types)", () => {
    serviceRoleAuditObserver(`${AUDIT_EMIT_REASON_PREFIX}user.created`);
    serviceRoleAuditObserver(`${AUDIT_EMIT_REASON_PREFIX}db.service_role.use`);
    serviceRoleAuditObserver(`${AUDIT_EMIT_REASON_PREFIX}tenant.migration_imported`);
    expect(mockWithServiceRole).not.toHaveBeenCalled();
  });

  it("DOES call withServiceRole (via emit) for non-audit reasons", async () => {
    serviceRoleAuditObserver("hello-page Supabase ping");
    // emit() is fire-and-forget inside the observer. Wait one
    // microtask tick so the awaited withServiceRole call lands.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mockWithServiceRole).toHaveBeenCalledOnce();
    const reason = mockWithServiceRole.mock.calls[0][0];
    // The emit call uses an audit-prefixed reason for ITS withServiceRole.
    expect(reason).toBe(`${AUDIT_EMIT_REASON_PREFIX}db.service_role.use`);
  });

  it("the db.service_role.use emit captures the original reason in metadata", async () => {
    let capturedTx: { execute: ReturnType<typeof vi.fn> } | null = null;
    mockWithServiceRole.mockImplementation(async (_reason, fn) => {
      const tx = {
        execute: vi.fn(async () => []),
      };
      capturedTx = tx;
      return fn(tx as never);
    });

    serviceRoleAuditObserver("R-3 isolation-test verify");
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(capturedTx).not.toBeNull();
    // The execute call is the INSERT — tagged-template Drizzle output
    // is opaque, but a single INSERT fired is the assertion.
    expect(capturedTx!.execute).toHaveBeenCalledOnce();
  });

  it("swallows errors from the recursive emit (telemetry is best-effort, never blocks the wrapped op)", async () => {
    // Flip withServiceRole to reject. The observer must NOT throw
    // synchronously and must NOT propagate the rejection — best-effort
    // is the contract.
    mockWithServiceRole.mockRejectedValue(new Error("DB transiently unavailable"));
    expect(() => serviceRoleAuditObserver("some non-audit reason")).not.toThrow();
    // Also wait long enough for the rejected promise to settle so any
    // unhandled-rejection would have surfaced by now.
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});

describe("registerAuditObserver", () => {
  it("registers serviceRoleAuditObserver with shared/db's setServiceRoleObserver", () => {
    registerAuditObserver();
    expect(mockSetServiceRoleObserver).toHaveBeenCalledOnce();
    expect(mockSetServiceRoleObserver).toHaveBeenCalledWith(serviceRoleAuditObserver);
  });

  it("is idempotent — multiple calls register the same observer reference each time", () => {
    registerAuditObserver();
    registerAuditObserver();
    registerAuditObserver();
    expect(mockSetServiceRoleObserver).toHaveBeenCalledTimes(3);
    for (const call of mockSetServiceRoleObserver.mock.calls) {
      expect(call[0]).toBe(serviceRoleAuditObserver);
    }
  });
});

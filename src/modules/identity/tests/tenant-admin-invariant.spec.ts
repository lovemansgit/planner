// C-21 invariant — tenant-admin-invariant unit tests.
//
// Mocks the tx parameter; verifies the function's COUNT-and-compare
// behavior in isolation. The integration story — that the SQL is
// actually correct against a real schema with real role_assignments
// + roles rows — belongs in tests/integration/. Out of scope for
// this PR per the brief's Day-2 scope.

import { describe, expect, it, vi } from "vitest";

import { ConflictError } from "../../../shared/errors";

import { assertCanRemoveAssignments } from "../tenant-admin-invariant";

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ASSIGNMENT_1 = "11111111-1111-1111-1111-111111111111";
const ASSIGNMENT_2 = "22222222-2222-2222-2222-222222222222";

interface MockExecuteCall {
  total: number; // tenant-wide tenant-admin count
  removingAdmins: number; // how many of the removingAssignmentIds are tenant-admin
}

/**
 * Build a tx stub whose `execute` returns the two count rows in the
 * order the invariant function calls them: total first, then
 * removingAdmins.
 */
function txStub(counts: MockExecuteCall) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce([{ n: counts.total }])
    .mockResolvedValueOnce([{ n: counts.removingAdmins }]);
  return { execute } as never;
}

describe("assertCanRemoveAssignments — C-21 invariant", () => {
  it("is a no-op when removingAssignmentIds is empty", async () => {
    const tx = { execute: vi.fn() } as never;
    await expect(assertCanRemoveAssignments(tx, TENANT_ID, [])).resolves.toBeUndefined();
    expect((tx as { execute: ReturnType<typeof vi.fn> }).execute).not.toHaveBeenCalled();
  });

  it("is a no-op when none of the removing assignments are tenant-admin", async () => {
    // Total tenant has 2 admins, but the assignment we're removing is not one of them.
    const tx = txStub({ total: 2, removingAdmins: 0 });
    await expect(
      assertCanRemoveAssignments(tx, TENANT_ID, [ASSIGNMENT_1])
    ).resolves.toBeUndefined();
  });

  it("is a no-op when removing one admin but another remains", async () => {
    const tx = txStub({ total: 2, removingAdmins: 1 });
    await expect(
      assertCanRemoveAssignments(tx, TENANT_ID, [ASSIGNMENT_1])
    ).resolves.toBeUndefined();
  });

  it("throws ConflictError when removing the only admin (total=1, removing=1)", async () => {
    const tx = txStub({ total: 1, removingAdmins: 1 });
    await expect(assertCanRemoveAssignments(tx, TENANT_ID, [ASSIGNMENT_1])).rejects.toBeInstanceOf(
      ConflictError
    );
  });

  it("throws ConflictError when removing all admins at once (total=2, removing=2)", async () => {
    const tx = txStub({ total: 2, removingAdmins: 2 });
    await expect(
      assertCanRemoveAssignments(tx, TENANT_ID, [ASSIGNMENT_1, ASSIGNMENT_2])
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("does not throw when removing 2 admins of 3 (one remains)", async () => {
    const tx = txStub({ total: 3, removingAdmins: 2 });
    await expect(
      assertCanRemoveAssignments(tx, TENANT_ID, [ASSIGNMENT_1, ASSIGNMENT_2])
    ).resolves.toBeUndefined();
  });

  it("attaches the CONFLICT error code on the thrown ConflictError", async () => {
    const tx = txStub({ total: 1, removingAdmins: 1 });
    try {
      await assertCanRemoveAssignments(tx, TENANT_ID, [ASSIGNMENT_1]);
      expect.fail("expected ConflictError");
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      expect((e as ConflictError).code).toBe("CONFLICT");
      expect((e as Error).message).toMatch(/last Tenant Admin/);
      expect((e as Error).message).toMatch(/C-21/);
    }
  });

  it("only consults the database when removingAssignmentIds is non-empty", async () => {
    const execute = vi.fn();
    await assertCanRemoveAssignments({ execute } as never, TENANT_ID, []);
    expect(execute).not.toHaveBeenCalled();

    // Sanity: with a non-empty list, execute IS called (twice).
    const tx = txStub({ total: 2, removingAdmins: 0 });
    await assertCanRemoveAssignments(tx, TENANT_ID, [ASSIGNMENT_1]);
    expect((tx as { execute: ReturnType<typeof vi.fn> }).execute).toHaveBeenCalledTimes(2);
  });
});

// requirePermission unit tests — R-2 / Day 2.

import { describe, expect, it } from "vitest";

import { ForbiddenError } from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";
import { requirePermission } from "../require-permission";
import { ROLES } from "../roles";

const SOME_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const SOME_USER_ID = "00000000-0000-0000-0000-000000000002";

function userCtx(perms: readonly Permission[]): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: SOME_USER_ID,
      tenantId: SOME_TENANT_ID,
      permissions: new Set(perms),
    },
    tenantId: SOME_TENANT_ID,
    requestId: "test-request",
    path: "/test",
  };
}

function systemCtx(perms: readonly Permission[]): RequestContext {
  return {
    actor: {
      kind: "system",
      system: "cron:generate_tasks",
      tenantId: null,
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: "test-cron",
    path: "/internal/cron/generate-tasks",
  };
}

describe("requirePermission", () => {
  it("returns void when the actor holds the required permission", () => {
    const ctx = userCtx(["consignee:read"]);
    expect(() => requirePermission(ctx, "consignee:read")).not.toThrow();
  });

  it("returns void when the actor holds the permission alongside others", () => {
    const ctx = userCtx(["consignee:read", "consignee:update", "subscription:read"]);
    expect(() => requirePermission(ctx, "consignee:update")).not.toThrow();
  });

  it("throws ForbiddenError when the actor's permission set is empty", () => {
    const ctx = userCtx([]);
    expect(() => requirePermission(ctx, "consignee:read")).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when the actor holds other but not the required permission", () => {
    const ctx = userCtx(["consignee:read", "subscription:read"]);
    expect(() => requirePermission(ctx, "consignee:delete")).toThrow(ForbiddenError);
  });

  it("attaches the FORBIDDEN error code on the thrown ForbiddenError", () => {
    const ctx = userCtx([]);
    try {
      requirePermission(ctx, "consignee:read");
      expect.fail("expected ForbiddenError");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).code).toBe("FORBIDDEN");
    }
  });

  it("includes the requested permission id in the error message", () => {
    const ctx = userCtx([]);
    try {
      requirePermission(ctx, "tenant:migration_import");
      expect.fail("expected ForbiddenError");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as Error).message).toContain("tenant:migration_import");
    }
  });

  it("includes the actor kind in the error message (user)", () => {
    const ctx = userCtx([]);
    try {
      requirePermission(ctx, "consignee:read");
      expect.fail("expected ForbiddenError");
    } catch (e) {
      expect((e as Error).message).toContain("actor=user");
    }
  });

  it("includes the actor kind in the error message (system)", () => {
    const ctx = systemCtx([]);
    try {
      requirePermission(ctx, "consignee:read");
      expect.fail("expected ForbiddenError");
    } catch (e) {
      expect((e as Error).message).toContain("actor=system");
    }
  });

  it("does NOT include the actor's user id, tenant id, or full permission set in the error message", () => {
    const ctx = userCtx(["something:secret"] as Permission[]);
    try {
      requirePermission(ctx, "consignee:read");
      expect.fail("expected ForbiddenError");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(SOME_USER_ID);
      expect(msg).not.toContain(SOME_TENANT_ID);
      expect(msg).not.toContain("something:secret");
    }
  });

  it("works with system actors when they hold the required permission", () => {
    const ctx = systemCtx(["task:read", "task:update"]);
    expect(() => requirePermission(ctx, "task:read")).not.toThrow();
  });
});

describe("requirePermission integrated with the role catalogue", () => {
  // These tests pin the integration between R-1 (catalogue + roles) and
  // R-2 (the helper). They guard against drift — if a role's permission
  // set silently changes, these will catch it.

  it("permits a Tenant Admin to do consignee:bulk_create (Day-2 brief §6)", () => {
    const ctx = userCtx(Array.from(ROLES["tenant-admin"].permissions));
    expect(() => requirePermission(ctx, "consignee:bulk_create")).not.toThrow();
  });

  it("denies a Tenant Admin tenant:migration_import (R-1 systemOnly invariant)", () => {
    const ctx = userCtx(Array.from(ROLES["tenant-admin"].permissions));
    expect(() => requirePermission(ctx, "tenant:migration_import")).toThrow(ForbiddenError);
  });

  it("permits an Ops Manager to do subscription:bulk_create", () => {
    const ctx = userCtx(Array.from(ROLES["ops-manager"].permissions));
    expect(() => requirePermission(ctx, "subscription:bulk_create")).not.toThrow();
  });

  it("denies an Ops Manager tenant:migration_gate_set", () => {
    const ctx = userCtx(Array.from(ROLES["ops-manager"].permissions));
    expect(() => requirePermission(ctx, "tenant:migration_gate_set")).toThrow(ForbiddenError);
  });

  it("denies a CS Agent any of the four bulk-import permissions", () => {
    const ctx = userCtx(Array.from(ROLES["cs-agent"].permissions));
    expect(() => requirePermission(ctx, "consignee:bulk_create")).toThrow(ForbiddenError);
    expect(() => requirePermission(ctx, "subscription:bulk_create")).toThrow(ForbiddenError);
    expect(() => requirePermission(ctx, "tenant:migration_import")).toThrow(ForbiddenError);
    expect(() => requirePermission(ctx, "tenant:migration_gate_set")).toThrow(ForbiddenError);
  });

  it("permits a Transcorp Systems Team actor to do tenant:migration_gate_set but NOT migration_import", () => {
    const ctx = systemCtx(Array.from(ROLES["transcorp-systems"].permissions));
    expect(() => requirePermission(ctx, "tenant:migration_gate_set")).not.toThrow();
    expect(() => requirePermission(ctx, "tenant:migration_import")).toThrow(ForbiddenError);
  });

  it("permits a Transcorp Sysadmin to do every catalogued permission", () => {
    const perms = Array.from(ROLES["transcorp-sysadmin"].permissions);
    const ctx = systemCtx(perms);
    for (const perm of perms) {
      expect(() => requirePermission(ctx, perm)).not.toThrow();
    }
  });
});

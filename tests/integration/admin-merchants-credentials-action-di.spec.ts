// tests/integration/admin-merchants-credentials-action-di.spec.ts
// =============================================================================
// Day-26 T3 Sub-PR 3 — LOAD-BEARING DI-wiring spec for the credentials
// Server Action.
//
// This is the carry-forward watch-item from Sub-PR 2 (per the Day-26 PM
// handoff memo). storeSuitefleetCredentials takes `invalidateSession`
// as a DI parameter; Sub-PR 3's storeCredentialsAction is the closure
// point that MUST pass the REAL LastMileAdapter.invalidateSession from
// getSuiteFleetAdapter(). Otherwise rotation silently fails to drop
// the in-memory token cache.
//
// Cases pinned:
//   1. initial-set path — storeCredentialsAction calls invalidateSession
//      on the real adapter (mocked here to a spy) with the tenant id
//   2. rotation path — second call invokes adapter.invalidateSession
//      again (ratified OQ-5 — both paths invalidate)
//   3. validation path — empty credential fields surface as field errors
//      and the action returns BEFORE calling the adapter (no spurious
//      invalidateSession call on a parse-fail)
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Mock getSuiteFleetAdapter BEFORE importing the action module so the
// action's static import binding resolves to the mock.
const mockInvalidateSession = vi.fn();
vi.mock("../../src/modules/integration/providers/suitefleet/get-adapter", () => ({
  getSuiteFleetAdapter: () => ({
    invalidateSession: mockInvalidateSession,
    // Other LastMileAdapter methods aren't called by the credentials
    // action; left undefined so any accidental cross-coupling lights
    // up as TypeError at runtime.
  }),
}));

// next/cache revalidatePath is a no-op outside the request context; the
// action calls it on success but vitest renders it harmless. We do not
// mock it — let the real call no-op the spec server-side.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// buildRequestContext is the bottleneck for ctx — we replace it with a
// fixture that returns a sysadmin actor so the action's service call
// passes its requirePermission gate.
vi.mock("../../src/shared/request-context", () => ({
  buildRequestContext: vi.fn(async (path: string, requestId: string) => ({
    actor: {
      kind: "user",
      userId: SYSADMIN_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set(["merchant:update", "region:manage"]),
    },
    tenantId: null,
    requestId,
    path,
  })),
}));

import { storeCredentialsAction } from "../../src/app/(admin)/admin/merchants/[id]/credentials/_actions";
import { createRegion } from "../../src/modules/credentials";
import { withServiceRole } from "../../src/shared/db";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const ALPHA_TAG =
  (randomUUID() + randomUUID()).replace(/[^a-f]/g, "").slice(0, 8) || "tagfb";
const TENANT_ID = randomUUID();
const SLUG = `acd-${RUN_ID}`;
const REGION_CLIENT_ID = `acd${ALPHA_TAG}`;

const SYSADMIN_ACTOR = randomUUID();

function sysadminCtxForSeed(label: string): RequestContext {
  const perms: Permission[] = ["region:manage", "merchant:update"];
  return {
    actor: {
      kind: "user",
      userId: SYSADMIN_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-${label}`,
    path: "/admin/merchants/x/credentials",
  };
}

let regionId: Uuid;

describe("storeCredentialsAction — invalidateSession DI wiring (Day-26 T3 Sub-PR 3)", () => {
  beforeAll(async () => {
    const r = await createRegion(sysadminCtxForSeed("seed-region"), {
      clientId: REGION_CLIENT_ID,
      displayName: "ACD OAuth Region",
      authMethod: "oauth",
    });
    regionId = r.regionId;

    await withServiceRole("acd test: tenant seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status, suitefleet_region_id)
        VALUES (${TENANT_ID}, ${SLUG}, 'ACD Tenant', 'active', ${regionId})
      `);
    });
  });

  afterAll(async () => {
    try {
      await withServiceRole("acd teardown — tenants", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id = ${TENANT_ID}`);
      });
    } catch {
      /* audit RULE; ignore */
    }
    try {
      await withServiceRole("acd teardown — regions", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM suitefleet_regions WHERE id = ${regionId}`);
      });
    } catch {
      /* FK RESTRICT; ignore */
    }
  });

  it("initial-set path — action calls adapter.invalidateSession with the tenantId", async () => {
    mockInvalidateSession.mockClear();
    const formData = new FormData();
    formData.set("credential_1", "username-fixture");
    formData.set("credential_2", "password-fixture");

    const result = await storeCredentialsAction(TENANT_ID, { kind: "idle" }, formData);
    expect(result.kind).toBe("stored");
    if (result.kind === "stored") {
      expect(result.classifier).toBe("initial-set");
    }

    // LOAD-BEARING: the action wired the REAL adapter's invalidateSession.
    expect(mockInvalidateSession).toHaveBeenCalledTimes(1);
    expect(mockInvalidateSession).toHaveBeenCalledWith(TENANT_ID);
  });

  it("rotation path — second call also invokes adapter.invalidateSession (ratified OQ-5)", async () => {
    mockInvalidateSession.mockClear();
    const formData = new FormData();
    formData.set("credential_1", "new-username-fixture");
    formData.set("credential_2", "new-password-fixture");

    const result = await storeCredentialsAction(TENANT_ID, { kind: "idle" }, formData);
    expect(result.kind).toBe("stored");
    if (result.kind === "stored") {
      expect(result.classifier).toBe("rotation");
    }
    expect(mockInvalidateSession).toHaveBeenCalledTimes(1);
    expect(mockInvalidateSession).toHaveBeenCalledWith(TENANT_ID);
  });

  it("validation path — empty fields short-circuit BEFORE adapter is touched", async () => {
    mockInvalidateSession.mockClear();
    const formData = new FormData();
    formData.set("credential_1", "");
    formData.set("credential_2", "");

    const result = await storeCredentialsAction(TENANT_ID, { kind: "idle" }, formData);
    expect(result.kind).toBe("validation");
    expect(mockInvalidateSession).not.toHaveBeenCalled();
  });
});

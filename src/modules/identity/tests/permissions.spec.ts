// Catalogue invariants — R-1 / Day 2.
//
// These tests are the catalogue's structural guard. Adding a permission or a
// role goes through these — id fields must match map keys, role permission
// sets must be subsets of the catalogue, systemOnly perms must not leak into
// tenant-facing roles, and the brief's bulk-import expectations must hold.

import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSION_IDS,
  API_KEY_FORBIDDEN_PERMISSIONS,
  PERMISSIONS,
  SYSTEM_ONLY_PERMISSIONS,
  isKnownPermission,
  type PermissionId,
} from "../permissions";
import { ALL_ROLE_SLUGS, ROLES, TENANT_ADMIN_ROLE_SLUG } from "../roles";

describe("permission catalogue", () => {
  it("freezes at module-import time", () => {
    expect(Object.isFrozen(PERMISSIONS)).toBe(true);
  });

  it("defines every entry's id to match its map key", () => {
    for (const id of ALL_PERMISSION_IDS) {
      expect(PERMISSIONS[id].id).toBe(id);
    }
  });

  it("derives every id from `${resource}:${action}` consistently", () => {
    for (const id of ALL_PERMISSION_IDS) {
      const def = PERMISSIONS[id];
      expect(`${def.resource}:${def.action}`).toBe(id);
    }
  });

  it("requires a non-empty description on every entry", () => {
    for (const id of ALL_PERMISSION_IDS) {
      const desc = PERMISSIONS[id].description.trim();
      expect(desc.length).toBeGreaterThan(0);
    }
  });

  it("recognizes its own ids via isKnownPermission and rejects unknowns", () => {
    for (const id of ALL_PERMISSION_IDS) {
      expect(isKnownPermission(id)).toBe(true);
    }
    expect(isKnownPermission("definitely:not_a_real_permission")).toBe(false);
    expect(isKnownPermission("")).toBe(false);
  });
});

describe("systemOnly permissions", () => {
  it("matches the entries flagged systemOnly: true in the catalogue", () => {
    const expected = new Set(ALL_PERMISSION_IDS.filter((id) => PERMISSIONS[id].systemOnly));
    expect(SYSTEM_ONLY_PERMISSIONS).toEqual(expected);
  });

  it("includes the two migration permissions called out in the Day-2 brief §6", () => {
    expect(SYSTEM_ONLY_PERMISSIONS.has("tenant:migration_import")).toBe(true);
    expect(SYSTEM_ONLY_PERMISSIONS.has("tenant:migration_gate_set")).toBe(true);
  });
});

describe("migration-gate permissions (Day 3 / C-6)", () => {
  it("registers all three migration-gate permissions in the catalogue", () => {
    expect(PERMISSIONS["tenant:migration_gate_set"]).toBeDefined();
    expect(PERMISSIONS["tenant:migration_gate_get"]).toBeDefined();
    expect(PERMISSIONS["tenant:migration_gate_check"]).toBeDefined();
  });

  it("flags only gate_set as systemOnly (gate_get and gate_check are tenant-readable)", () => {
    expect(PERMISSIONS["tenant:migration_gate_set"].systemOnly).toBe(true);
    expect(PERMISSIONS["tenant:migration_gate_get"].systemOnly).toBe(false);
    expect(PERMISSIONS["tenant:migration_gate_check"].systemOnly).toBe(false);
  });

  // Pinning the holder set so any drift in role membership for
  // gate_set surfaces immediately. This is also the contract that
  // migration-gate.ts's `isSysadminActor` proxy depends on: actors
  // that carry gate_set are exactly those in these two systemOnly
  // Transcorp roles. Both share the same internal-staff trust
  // boundary, so treating them identically for set_by visibility is
  // correct. If a future PR widens the holder set, this test breaks
  // and forces a conscious decision about the proxy.
  it("tenant:migration_gate_set is held by exactly the two systemOnly Transcorp roles", () => {
    const holders = ALL_ROLE_SLUGS.filter((slug) =>
      ROLES[slug].permissions.has("tenant:migration_gate_set")
    );
    expect(new Set(holders)).toEqual(new Set(["transcorp-systems", "transcorp-sysadmin"]));
  });
});

describe("API_KEY_FORBIDDEN_PERMISSIONS", () => {
  it("lists only known catalogue entries", () => {
    for (const id of API_KEY_FORBIDDEN_PERMISSIONS) {
      expect(isKnownPermission(id)).toBe(true);
    }
  });

  it("forbids every systemOnly permission for API keys", () => {
    for (const id of SYSTEM_ONLY_PERMISSIONS) {
      expect(API_KEY_FORBIDDEN_PERMISSIONS.has(id)).toBe(true);
    }
  });
});

describe("bulk-import permissions (Day-2 brief §6)", () => {
  const bulkImportIds: readonly PermissionId[] = [
    "consignee:bulk_create",
    "subscription:bulk_create",
    "tenant:migration_import",
    "tenant:migration_gate_set",
  ];

  it("includes all four entries in the catalogue", () => {
    for (const id of bulkImportIds) {
      expect(PERMISSIONS[id]).toBeDefined();
    }
  });

  it("flags the two migration entries as systemOnly and the two bulk-create entries as not", () => {
    expect(PERMISSIONS["tenant:migration_import"].systemOnly).toBe(true);
    expect(PERMISSIONS["tenant:migration_gate_set"].systemOnly).toBe(true);
    expect(PERMISSIONS["consignee:bulk_create"].systemOnly).toBe(false);
    expect(PERMISSIONS["subscription:bulk_create"].systemOnly).toBe(false);
  });
});

describe("role catalogue", () => {
  it("freezes at module-import time", () => {
    expect(Object.isFrozen(ROLES)).toBe(true);
  });

  it("defines every role's slug to match its map key", () => {
    for (const slug of ALL_ROLE_SLUGS) {
      expect(ROLES[slug].slug).toBe(slug);
    }
  });

  it("only references permissions that exist in the catalogue", () => {
    for (const slug of ALL_ROLE_SLUGS) {
      for (const perm of ROLES[slug].permissions) {
        expect(isKnownPermission(perm)).toBe(true);
      }
    }
  });

  it("never grants a systemOnly permission to a non-systemOnly role", () => {
    for (const slug of ALL_ROLE_SLUGS) {
      const role = ROLES[slug];
      if (role.systemOnly) continue;
      for (const perm of role.permissions) {
        expect(SYSTEM_ONLY_PERMISSIONS.has(perm)).toBe(false);
      }
    }
  });
});

describe("Tenant Admin (C-21 anchor)", () => {
  it("is registered under the slug C-21 will look up", () => {
    expect(ROLES[TENANT_ADMIN_ROLE_SLUG]).toBeDefined();
    expect(TENANT_ADMIN_ROLE_SLUG).toBe("tenant-admin");
  });

  it("is not systemOnly (it's a tenant-facing role)", () => {
    expect(ROLES[TENANT_ADMIN_ROLE_SLUG].systemOnly).toBe(false);
  });

  it("includes both bulk-create permissions per Day-2 brief §6", () => {
    const perms = ROLES[TENANT_ADMIN_ROLE_SLUG].permissions;
    expect(perms.has("consignee:bulk_create")).toBe(true);
    expect(perms.has("subscription:bulk_create")).toBe(true);
  });

  it("does NOT include either systemOnly migration permission", () => {
    const perms = ROLES[TENANT_ADMIN_ROLE_SLUG].permissions;
    expect(perms.has("tenant:migration_import")).toBe(false);
    expect(perms.has("tenant:migration_gate_set")).toBe(false);
  });

  it("includes migration_gate_get and migration_gate_check (Day 3 / C-6)", () => {
    const perms = ROLES[TENANT_ADMIN_ROLE_SLUG].permissions;
    expect(perms.has("tenant:migration_gate_get")).toBe(true);
    expect(perms.has("tenant:migration_gate_check")).toBe(true);
  });
});

describe("Ops Manager (Day-2 brief §6)", () => {
  it("holds the two bulk-create permissions", () => {
    const perms = ROLES["ops-manager"].permissions;
    expect(perms.has("consignee:bulk_create")).toBe(true);
    expect(perms.has("subscription:bulk_create")).toBe(true);
  });

  it("does NOT hold either migration permission", () => {
    const perms = ROLES["ops-manager"].permissions;
    expect(perms.has("tenant:migration_import")).toBe(false);
    expect(perms.has("tenant:migration_gate_set")).toBe(false);
  });
});

describe("CS Agent (Day-2 brief §6)", () => {
  it("does NOT hold any of the four bulk-import permissions", () => {
    const perms = ROLES["cs-agent"].permissions;
    expect(perms.has("consignee:bulk_create")).toBe(false);
    expect(perms.has("subscription:bulk_create")).toBe(false);
    expect(perms.has("tenant:migration_import")).toBe(false);
    expect(perms.has("tenant:migration_gate_set")).toBe(false);
  });
});

describe("Transcorp Systems Team (Day-2 brief §6)", () => {
  it("is systemOnly", () => {
    expect(ROLES["transcorp-systems"].systemOnly).toBe(true);
  });

  it("holds tenant.migration_gate_set but NOT tenant.migration_import (two-person rule)", () => {
    const perms = ROLES["transcorp-systems"].permissions;
    expect(perms.has("tenant:migration_gate_set")).toBe(true);
    expect(perms.has("tenant:migration_import")).toBe(false);
  });

  it("holds the two new gate read/check perms so the cut-over UI can render readiness (C-6)", () => {
    const perms = ROLES["transcorp-systems"].permissions;
    expect(perms.has("tenant:migration_gate_get")).toBe(true);
    expect(perms.has("tenant:migration_gate_check")).toBe(true);
  });
});

describe("Ops Manager — migration gate visibility (C-6)", () => {
  it("holds tenant:migration_gate_get and tenant:migration_gate_check", () => {
    const perms = ROLES["ops-manager"].permissions;
    expect(perms.has("tenant:migration_gate_get")).toBe(true);
    expect(perms.has("tenant:migration_gate_check")).toBe(true);
  });

  it("does NOT hold tenant:migration_gate_set (sysadmin-only stays sysadmin-only)", () => {
    expect(ROLES["ops-manager"].permissions.has("tenant:migration_gate_set")).toBe(false);
  });
});

describe("Transcorp Sysadmin (Day-2 brief §6)", () => {
  it("is systemOnly", () => {
    expect(ROLES["transcorp-sysadmin"].systemOnly).toBe(true);
  });

  it("holds every permission in the catalogue", () => {
    const perms = ROLES["transcorp-sysadmin"].permissions;
    for (const id of ALL_PERMISSION_IDS) {
      expect(perms.has(id)).toBe(true);
    }
  });
});

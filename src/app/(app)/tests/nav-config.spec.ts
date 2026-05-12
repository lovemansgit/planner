// Day 11 / P4 — nav-config unit tests.
//
// Covers permission-driven visibility for both NAV_ITEMS and
// LANDING_CARDS, plus the active-tab predicate and a drift guard
// that every nav-item permission resolves against the live catalogue.

import { describe, expect, it } from "vitest";

import { isKnownPermission } from "@/modules/identity/permissions";
import { ROLES } from "@/modules/identity/roles";
import type { Permission } from "@/shared/types";

import {
  ADMIN_NAV_ITEMS,
  LANDING_CARDS,
  NAV_ITEMS,
  isActiveNavPath,
  visibleAdminNavItems,
  visibleLandingCards,
  visibleNavItems,
} from "../nav-config";

const TENANT_ADMIN = ROLES["tenant-admin"].permissions;
const OPS_MANAGER = ROLES["ops-manager"].permissions;
const CS_AGENT = ROLES["cs-agent"].permissions;
const NONE = new Set<never>() as ReadonlySet<never>;

describe("visibleNavItems", () => {
  it("Tenant Admin sees all 5 items", () => {
    const visible = visibleNavItems(TENANT_ADMIN);
    expect(visible.map((i) => i.label)).toEqual([
      "Tasks",
      "Subscriptions",
      "Consignees",
      "Failed pushes",
      "Webhook config",
    ]);
  });

  it("Ops Manager sees 4 items (Failed pushes hidden)", () => {
    const visible = visibleNavItems(OPS_MANAGER);
    expect(visible.map((i) => i.label)).toEqual([
      "Tasks",
      "Subscriptions",
      "Consignees",
      "Webhook config",
    ]);
    expect(visible.some((i) => i.label === "Failed pushes")).toBe(false);
  });

  it("CS Agent sees 3 items (Failed pushes + Webhook config hidden)", () => {
    const visible = visibleNavItems(CS_AGENT);
    expect(visible.map((i) => i.label)).toEqual([
      "Tasks",
      "Subscriptions",
      "Consignees",
    ]);
    expect(visible.some((i) => i.label === "Failed pushes")).toBe(false);
    expect(visible.some((i) => i.label === "Webhook config")).toBe(false);
  });

  it("empty permission set hides every item", () => {
    expect(visibleNavItems(NONE)).toHaveLength(0);
  });
});

describe("isActiveNavPath", () => {
  const failedPushes = NAV_ITEMS.find((i) => i.label === "Failed pushes")!;
  const tasks = NAV_ITEMS.find((i) => i.label === "Tasks")!;

  it("matches the exact path", () => {
    expect(isActiveNavPath("/admin/failed-pushes", failedPushes)).toBe(true);
  });

  it("matches a subpath", () => {
    expect(isActiveNavPath("/admin/failed-pushes/some-detail-id", failedPushes)).toBe(true);
  });

  it("does not match a sibling path with a shared prefix", () => {
    expect(isActiveNavPath("/admin/failed-pushes-archive", failedPushes)).toBe(false);
  });

  it("does not match an unrelated path", () => {
    expect(isActiveNavPath("/subscriptions", tasks)).toBe(false);
  });
});

describe("visibleLandingCards", () => {
  // Day-22 §3.3.9 — completed brief 5-card workflow shortcut surface.
  // Order is Onboard → Subscriber base → Today's deliveries →
  // Today's tasks → Failed pushes (primary workflows top, monitoring
  // surfaces bottom).

  it("Tenant Admin sees all 5 cards", () => {
    expect(visibleLandingCards(TENANT_ADMIN).map((c) => c.label)).toEqual([
      "Onboard new consignee",
      "Subscriber base",
      "Today's deliveries",
      "Today's tasks",
      "Failed pushes",
    ]);
  });

  it("Ops Manager sees 4 cards (Failed pushes hidden)", () => {
    expect(visibleLandingCards(OPS_MANAGER).map((c) => c.label)).toEqual([
      "Onboard new consignee",
      "Subscriber base",
      "Today's deliveries",
      "Today's tasks",
    ]);
  });

  it("CS Agent sees 3 cards (Onboard + Failed pushes hidden)", () => {
    // CS Agent holds consignee:read + task:read but NOT consignee:create
    // or subscription:create — Onboard card hides via extraPermissions.
    expect(visibleLandingCards(CS_AGENT).map((c) => c.label)).toEqual([
      "Subscriber base",
      "Today's deliveries",
      "Today's tasks",
    ]);
  });

  it("hides the Onboard card when consignee:create is held but subscription:create is missing", () => {
    // Defensive guard for the extraPermissions ALL-required semantics.
    const partial = new Set<Permission>(["consignee:create", "consignee:read", "task:read"]);
    const labels = visibleLandingCards(partial).map((c) => c.label);
    expect(labels).not.toContain("Onboard new consignee");
    // The card with the primary perm but missing extra perm must hide.
  });

  it("shows the Onboard card when both consignee:create + subscription:create are held", () => {
    const full = new Set<Permission>([
      "consignee:create",
      "subscription:create",
      "consignee:read",
      "task:read",
    ]);
    expect(visibleLandingCards(full).map((c) => c.label)).toContain("Onboard new consignee");
  });

  it("empty permission set yields no cards", () => {
    expect(visibleLandingCards(NONE)).toHaveLength(0);
  });
});

describe("visibleAdminNavItems", () => {
  // Day 18 / C1 — Transcorp-staff cross-tenant admin nav.
  // merchant:read_all is systemOnly + carried only by transcorp-sysadmin.
  // Day 19 / Phase 1.5 — added Tasks / Consignees / Subscriptions
  // backed by task:read_all / consignee:read_all / subscription:read_all
  // (all systemOnly; only transcorp-sysadmin carries them).
  const TRANSCORP_SYSADMIN = ROLES["transcorp-sysadmin"].permissions;

  it("transcorp-sysadmin sees all 4 admin nav items", () => {
    expect(visibleAdminNavItems(TRANSCORP_SYSADMIN).map((i) => i.label)).toEqual([
      "Merchants",
      "Tasks",
      "Consignees",
      "Subscriptions",
    ]);
  });

  it("Tenant Admin sees no admin nav items", () => {
    expect(visibleAdminNavItems(TENANT_ADMIN)).toHaveLength(0);
  });

  it("Ops Manager and CS Agent see no admin nav items", () => {
    expect(visibleAdminNavItems(OPS_MANAGER)).toHaveLength(0);
    expect(visibleAdminNavItems(CS_AGENT)).toHaveLength(0);
  });

  it("empty permission set hides every admin nav item", () => {
    expect(visibleAdminNavItems(NONE)).toHaveLength(0);
  });
});

describe("catalogue drift guard", () => {
  it("every NAV_ITEM permission is a known PermissionId", () => {
    for (const item of NAV_ITEMS) {
      expect(isKnownPermission(item.permission)).toBe(true);
    }
  });

  it("every ADMIN_NAV_ITEM permission is a known PermissionId", () => {
    for (const item of ADMIN_NAV_ITEMS) {
      expect(isKnownPermission(item.permission)).toBe(true);
    }
  });

  it("every LANDING_CARD permission is a known PermissionId", () => {
    for (const card of LANDING_CARDS) {
      expect(isKnownPermission(card.permission)).toBe(true);
      for (const extra of card.extraPermissions ?? []) {
        expect(isKnownPermission(extra)).toBe(true);
      }
    }
  });
});

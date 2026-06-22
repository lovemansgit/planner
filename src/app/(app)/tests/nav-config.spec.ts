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
  groupNavItems,
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
  it("Tenant Admin sees all 6 items", () => {
    const visible = visibleNavItems(TENANT_ADMIN);
    expect(visible.map((i) => i.label)).toEqual([
      "Calendar",
      "Tasks",
      "Subscriptions",
      "Consignees",
      "Failed pushes",
      "Webhook config",
    ]);
  });

  it("Ops Manager sees 5 items (Failed pushes hidden)", () => {
    const visible = visibleNavItems(OPS_MANAGER);
    expect(visible.map((i) => i.label)).toEqual([
      "Calendar",
      "Tasks",
      "Subscriptions",
      "Consignees",
      "Webhook config",
    ]);
    expect(visible.some((i) => i.label === "Failed pushes")).toBe(false);
  });

  it("CS Agent sees 4 items (Failed pushes + Webhook config hidden)", () => {
    const visible = visibleNavItems(CS_AGENT);
    expect(visible.map((i) => i.label)).toEqual([
      "Calendar",
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
  // Order is Onboard → All consignees → Today's deliveries →
  // Today's tasks → Failed pushes (primary workflows top, monitoring
  // surfaces bottom).

  it("Tenant Admin sees all 5 cards", () => {
    expect(visibleLandingCards(TENANT_ADMIN).map((c) => c.label)).toEqual([
      "Onboard new consignee",
      "All consignees",
      "Today's deliveries",
      "Today's tasks",
      "Failed pushes",
    ]);
  });

  it("Ops Manager sees 4 cards (Failed pushes hidden)", () => {
    expect(visibleLandingCards(OPS_MANAGER).map((c) => c.label)).toEqual([
      "Onboard new consignee",
      "All consignees",
      "Today's deliveries",
      "Today's tasks",
    ]);
  });

  it("CS Agent sees 3 cards (Onboard + Failed pushes hidden)", () => {
    // CS Agent holds consignee:read + task:read but NOT consignee:create
    // or subscription:create — Onboard card hides via extraPermissions.
    expect(visibleLandingCards(CS_AGENT).map((c) => c.label)).toEqual([
      "All consignees",
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

  it("transcorp-sysadmin sees all 8 admin nav items (Overview first; Reports pair tails per Day-54 P2)", () => {
    expect(visibleAdminNavItems(TRANSCORP_SYSADMIN).map((i) => i.label)).toEqual([
      "Overview",
      "Merchants",
      "Tasks",
      "Consignees",
      "Subscriptions",
      "Users",
      "Asset Tracking",
      "Inventory",
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

  it("Overview entry points to /admin/calendar (not tenant /calendar)", () => {
    // Day-24 regression pin: dry-run surfaced that this entry routed to
    // /calendar (tenant shell), dropping Transcorp staff into the tenant
    // nav. It must stay on /admin/calendar so the (admin)/ layout renders.
    // (Label renamed 'Calendar'→'Overview' Day-53 per Love's audit ruling —
    // the route is unchanged; it renders the operations overview, not a calendar.)
    const overview = ADMIN_NAV_ITEMS.find((i) => i.label === "Overview");
    expect(overview).toBeDefined();
    expect(overview?.path).toBe("/admin/calendar");
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

// -----------------------------------------------------------------------------
// Day-54 P2 — bag-tracking dark switch on the nav (posture 7b)
// -----------------------------------------------------------------------------

describe("Inventory nav item — dark-switch gating (Day-54 P2)", () => {
  const INVENTORY_PERMS = new Set<Permission>(["asset_tracking:read"]);

  it("hides Inventory when the tenant flag is off, even with the permission", () => {
    const items = visibleNavItems(INVENTORY_PERMS, { assetTrackingEnabled: false });
    expect(items.find((i) => i.path === "/reports/inventory")).toBeUndefined();
  });

  it("hides Inventory when no flag option is passed at all (default dark)", () => {
    const items = visibleNavItems(INVENTORY_PERMS);
    expect(items.find((i) => i.path === "/reports/inventory")).toBeUndefined();
  });

  it("shows Inventory only with BOTH the permission AND the flag", () => {
    const lit = visibleNavItems(INVENTORY_PERMS, { assetTrackingEnabled: true });
    expect(lit.find((i) => i.path === "/reports/inventory")?.label).toBe("Inventory");

    const noPerm = visibleNavItems(new Set<Permission>(["task:read"]), {
      assetTrackingEnabled: true,
    });
    expect(noPerm.find((i) => i.path === "/reports/inventory")).toBeUndefined();
  });

  it("admin nav carries the two report entries behind asset_tracking:read_all", () => {
    const reportItems = ADMIN_NAV_ITEMS.filter(
      (i) => i.path === "/admin/asset-tracking" || i.path === "/admin/inventory",
    );
    expect(reportItems).toHaveLength(2);
    for (const item of reportItems) {
      expect(item.permission).toBe("asset_tracking:read_all");
    }
  });
});

// -----------------------------------------------------------------------------
// Day-54 walk F2 — Reports dropdown grouping (overflow repair)
// -----------------------------------------------------------------------------

describe("groupNavItems", () => {
  const TRANSCORP_SYSADMIN = ROLES["transcorp-sysadmin"].permissions;

  it("folds the two admin report items into one Reports group at the first member's slot", () => {
    const entries = groupNavItems(visibleAdminNavItems(TRANSCORP_SYSADMIN));
    expect(
      entries.map((e) => (e.kind === "item" ? e.item.label : `group:${e.label}`)),
    ).toEqual([
      "Overview",
      "Merchants",
      "Tasks",
      "Consignees",
      "Subscriptions",
      "Users",
      "group:Reports",
    ]);
    const reports = entries.find((e) => e.kind === "group");
    expect(reports?.kind === "group" && reports.items.map((i) => i.label)).toEqual([
      "Asset Tracking",
      "Inventory",
    ]);
  });

  it("grouping is presentation-only: permission filtering still drops group members", () => {
    // An actor without asset_tracking:read_all gets no Reports group at all.
    const entries = groupNavItems(visibleAdminNavItems(NONE));
    expect(entries).toHaveLength(0);
  });

  it("ungrouped items pass through as flat entries", () => {
    const entries = groupNavItems(visibleNavItems(TENANT_ADMIN));
    expect(entries.every((e) => e.kind === "item")).toBe(true);
  });
});

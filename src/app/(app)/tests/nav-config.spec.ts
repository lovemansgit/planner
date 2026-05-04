// Day 11 / P4 — nav-config unit tests.
//
// Covers permission-driven visibility for both NAV_ITEMS and
// LANDING_CARDS, plus the active-tab predicate and a drift guard
// that every nav-item permission resolves against the live catalogue.

import { describe, expect, it } from "vitest";

import { isKnownPermission } from "@/modules/identity/permissions";
import { ROLES } from "@/modules/identity/roles";

import {
  LANDING_CARDS,
  NAV_ITEMS,
  isActiveNavPath,
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
  it("Tenant Admin sees both cards", () => {
    expect(visibleLandingCards(TENANT_ADMIN).map((c) => c.label)).toEqual([
      "Today's tasks",
      "Failed pushes",
    ]);
  });

  it("Ops Manager hides the Failed pushes card", () => {
    expect(visibleLandingCards(OPS_MANAGER).map((c) => c.label)).toEqual(["Today's tasks"]);
  });

  it("CS Agent hides the Failed pushes card", () => {
    expect(visibleLandingCards(CS_AGENT).map((c) => c.label)).toEqual(["Today's tasks"]);
  });

  it("empty permission set yields no cards", () => {
    expect(visibleLandingCards(NONE)).toHaveLength(0);
  });
});

describe("catalogue drift guard", () => {
  it("every NAV_ITEM permission is a known PermissionId", () => {
    for (const item of NAV_ITEMS) {
      expect(isKnownPermission(item.permission)).toBe(true);
    }
  });

  it("every LANDING_CARD permission is a known PermissionId", () => {
    for (const card of LANDING_CARDS) {
      expect(isKnownPermission(card.permission)).toBe(true);
    }
  });
});

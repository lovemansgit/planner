// Day 11 / P4 — declarative nav config + visibility helper.
//
// Single source of truth mapping nav-item label → required permission.
// Nav rendering filters this list against the operator's resolved
// permission set; the source of truth is the permission membership,
// never the role name (custom roles post-pilot will slot in transparently).
//
// Adding a nav item is one entry here; the visibility table in
// memory/plans/p4_operator_nav_plan.md §2 regenerates from this config
// + the role catalogue. Removing one is one delete; the
// `nav-config.spec.ts` invariant tests catch any drift between the
// declared permission and the catalogue.

import type { PermissionId } from "@/modules/identity/permissions";
import type { Permission } from "@/shared/types";

export interface NavItem {
  readonly label: string;
  readonly path: string;
  readonly permission: PermissionId;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Tasks", path: "/tasks", permission: "task:read" },
  { label: "Subscriptions", path: "/subscriptions", permission: "subscription:read" },
  { label: "Consignees", path: "/consignees", permission: "consignee:read" },
  { label: "Failed pushes", path: "/admin/failed-pushes", permission: "failed_pushes:retry" },
  { label: "Webhook config", path: "/admin/webhook-config", permission: "webhook_config:read" },
] as const;

/**
 * Filter nav items by an operator's resolved permission set. Pure
 * function so it stays trivially testable without a DOM environment.
 */
export function visibleNavItems(
  permissions: ReadonlySet<Permission>,
): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => permissions.has(item.permission));
}

/**
 * Active-tab predicate. Treats sub-paths as belonging to the parent —
 * `/admin/failed-pushes/some-detail-id` highlights the "Failed pushes"
 * nav item. The exact-match-or-prefix-with-`/` discipline avoids
 * accidentally matching `/admin/failed-pushes-archive` against
 * `/admin/failed-pushes`.
 */
export function isActiveNavPath(currentPath: string, item: NavItem): boolean {
  if (currentPath === item.path) return true;
  return currentPath.startsWith(item.path + "/");
}

/**
 * Landing-page card spec. Mirrors the workflow-shortcut design from
 * the P4 plan §3 — two card destinations gated independently.
 */
export interface LandingCard {
  readonly label: string;
  readonly path: string;
  readonly description: string;
  readonly permission: PermissionId;
}

export const LANDING_CARDS: readonly LandingCard[] = [
  {
    label: "Today's tasks",
    path: "/tasks",
    description: "Review and progress today's deliveries.",
    permission: "task:read",
  },
  {
    label: "Failed pushes",
    path: "/admin/failed-pushes",
    description: "Retry tasks that hit the dead-letter queue.",
    permission: "failed_pushes:retry",
  },
] as const;

export function visibleLandingCards(
  permissions: ReadonlySet<Permission>,
): readonly LandingCard[] {
  return LANDING_CARDS.filter((card) => permissions.has(card.permission));
}

// -----------------------------------------------------------------------------
// Day 18 / C1 — Transcorp-staff admin nav (parallel to NAV_ITEMS).
//
// Lives alongside the operator NAV_ITEMS rather than merged into it
// because the (admin)/ route group has its own shell — the brief
// (§3.2.2) frames Transcorp-staff cross-tenant admin as a distinct
// surface from tenant-scoped operator UI. Mirroring this split in
// nav-config keeps each layout's nav source-of-truth declarative
// without leaking admin items into the operator menu (which would be
// the case if we merged into NAV_ITEMS gated only by permission).
//
// Each entry's permission gate is the systemOnly merchant:* family
// (registered at permissions.ts:526-560); only `transcorp-sysadmin`
// resolves to the merchant:read_all permission needed to render the
// Merchants nav item. Tenant operators never see this nav.
// -----------------------------------------------------------------------------

export const ADMIN_NAV_ITEMS: readonly NavItem[] = [
  { label: "Merchants", path: "/admin/merchants", permission: "merchant:read_all" },
] as const;

/**
 * Filter admin nav items by an actor's resolved permission set.
 * Mirrors visibleNavItems' shape so the (admin)/ layout consumes
 * the same {label, path, active} contract via TopNav-style rendering.
 */
export function visibleAdminNavItems(
  permissions: ReadonlySet<Permission>,
): readonly NavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => permissions.has(item.permission));
}

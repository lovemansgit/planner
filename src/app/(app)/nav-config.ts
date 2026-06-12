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
  /**
   * Day-54 P2 — bag-tracking dark switch (posture 7b). Items flagged
   * true render ONLY when the tenant's task_asset_tracking_enabled
   * flag is on — permission alone is not enough; the feature stays
   * invisible per tenant until Love flips it by sentence.
   */
  readonly requiresAssetTracking?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Calendar", path: "/calendar", permission: "task:read" },
  { label: "Tasks", path: "/tasks", permission: "task:read" },
  { label: "Subscriptions", path: "/subscriptions", permission: "subscription:read" },
  { label: "Consignees", path: "/consignees", permission: "consignee:read" },
  // Day-54 P2 — Reports group, first entry (plan #502 Q1 accepted:
  // future reports slot in alongside). Dark-switch-gated.
  {
    label: "Inventory",
    path: "/reports/inventory",
    permission: "asset_tracking:read",
    requiresAssetTracking: true,
  },
  { label: "Failed pushes", path: "/admin/failed-pushes", permission: "failed_pushes:retry" },
  { label: "Webhook config", path: "/admin/webhook-config", permission: "webhook_config:read" },
] as const;

/**
 * Filter nav items by an operator's resolved permission set. Pure
 * function so it stays trivially testable without a DOM environment.
 */
export function visibleNavItems(
  permissions: ReadonlySet<Permission>,
  opts: { readonly assetTrackingEnabled?: boolean } = {},
): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (!permissions.has(item.permission)) return false;
    if (item.requiresAssetTracking && !opts.assetTrackingEnabled) return false;
    return true;
  });
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
 * the P4 plan §3.
 *
 * `permission` is the primary gate. `extraPermissions` (added Day-22
 * §3.3.9 completion) lists additional perms an operator must ALSO
 * hold — used for the Onboard card, whose underlying wizard creates
 * both consignee + subscription rows and so demands both create
 * permissions to be operationally meaningful.
 */
export interface LandingCard {
  readonly label: string;
  readonly path: string;
  readonly description: string;
  readonly permission: PermissionId;
  readonly extraPermissions?: ReadonlyArray<PermissionId>;
}

export const LANDING_CARDS: readonly LandingCard[] = [
  {
    label: "Onboard new consignee",
    path: "/consignees/new",
    description: "Start a new merchant subscriber with one wizard.",
    permission: "consignee:create",
    extraPermissions: ["subscription:create"],
  },
  {
    label: "Subscriber base",
    path: "/consignees",
    description: "Search and manage all consignees.",
    permission: "consignee:read",
  },
  {
    // Day-23 /calendar route lands tomorrow per brief §3.3.4. Card
    // structure landed today; route follows.
    label: "Today's deliveries",
    path: "/calendar",
    description: "Consolidated operations view across all consignees.",
    permission: "task:read",
  },
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
  return LANDING_CARDS.filter((card) => {
    if (!permissions.has(card.permission)) return false;
    if (card.extraPermissions) {
      for (const extra of card.extraPermissions) {
        if (!permissions.has(extra)) return false;
      }
    }
    return true;
  });
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
  // "Overview" (the fleet dashboard) lives on a dedicated /admin/calendar
  // route so the Transcorp variant renders under the (admin)/ shell +
  // AdminTopNav. The tenant /calendar route keeps the tenant variant +
  // tenant nav shell. Previously this entry pointed to /calendar which
  // dropped Transcorp staff into the tenant nav (Day-24 dry-run bug, fixed
  // PR #257). Day-24 PM reorder puts it first to match the tenant
  // NAV_ITEMS ordering — the home view, lists are drill-downs.
  //
  // Label renamed "Calendar" → "Overview" on Day-53 (Love's audit ruling):
  // there is no admin calendar surface — /admin/calendar renders the fleet
  // overview dashboard (page <h1> "Fleet overview"), so "Calendar" mislabelled
  // it. Admin persona ONLY; the tenant NAV_ITEMS "Calendar" entry (→ /calendar)
  // is unchanged. Rename is label-only — the route stays /admin/calendar.
  { label: "Overview", path: "/admin/calendar", permission: "task:read_all" },
  { label: "Merchants", path: "/admin/merchants", permission: "merchant:read_all" },
  { label: "Tasks", path: "/admin/tasks", permission: "task:read_all" },
  { label: "Consignees", path: "/admin/consignees", permission: "consignee:read_all" },
  { label: "Subscriptions", path: "/admin/subscriptions", permission: "subscription:read_all" },
  // Users entry (Day-24) — Transcorp-staff surface for creating
  // tenant-admins / ops-managers / sysadmins. Gated on
  // `merchant:read_all` because user creation across tenants is a
  // Transcorp-only operation; tenant-admins manage their own users
  // via Phase 1.5 (deferred per memory/followup_team_management_ui.md).
  { label: "Users", path: "/admin/users", permission: "merchant:read_all" },
  // Day-54 P2 — Reports group (plan #502). Cross-tenant report
  // surfaces; gated on the systemOnly read_all perm. NOT dark-switch
  // gated at nav level — the report itself scopes to enabled tenants
  // (an all-dark fleet renders the empty state).
  { label: "Asset Tracking", path: "/admin/asset-tracking", permission: "asset_tracking:read_all" },
  { label: "Inventory", path: "/admin/inventory", permission: "asset_tracking:read_all" },
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

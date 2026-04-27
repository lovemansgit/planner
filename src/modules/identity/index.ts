// identity module — plan §3.3 / §7 RBAC.
//
// Day-2 exports: the frozen permission catalogue (R-1), the built-in
// role definitions, and the requirePermission helper (R-2). The C-21
// invariant lands in a subsequent commit.

export {
  PERMISSIONS,
  ALL_PERMISSION_IDS,
  SYSTEM_ONLY_PERMISSIONS,
  API_KEY_FORBIDDEN_PERMISSIONS,
  isKnownPermission,
  type PermissionDef,
  type PermissionId,
} from "./permissions";

export {
  ROLES,
  ALL_ROLE_SLUGS,
  TENANT_ADMIN_ROLE_SLUG,
  type RoleDef,
  type BuiltInRoleSlug,
} from "./roles";

export { requirePermission } from "./require-permission";

// identity module — plan §3.3 / §7 RBAC.
//
// Day-2 exports: the frozen permission catalogue (R-1) and the built-in
// role definitions. requirePermission middleware (R-2) and the C-21
// invariant land in subsequent commits.

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

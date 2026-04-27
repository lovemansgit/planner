// identity module — plan §3.3 / §7 RBAC.
//
// Day-2 exports complete: permission catalogue + roles (R-1),
// requirePermission helper (R-2), and the C-21 invariant +
// service-layer operations that enforce it.

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

export { assertCanRemoveAssignments } from "./tenant-admin-invariant";

export { deleteRoleAssignment, deleteUser } from "./service";

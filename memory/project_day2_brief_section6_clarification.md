---
name: Day-2 brief §6 — Tenant Admin does NOT get systemOnly migration perms
description: The Day-2 brief's §6 role-assignment matrix said "Tenant Admin: all four" but the reasoning paragraph said Tenant Admin must NOT self-trigger migration_import. Resolved: reasoning paragraph wins. Catalogue gives Tenant Admin only the 2 non-systemOnly bulk-import perms.
type: project
originSessionId: 745ed780-25c9-41f2-a58d-a5c1bbf8d5df
---
The Day-2 morning brief §6 contained an internal contradiction about Tenant Admin's permission set:

- **Matrix line:** "Tenant Admin: all four" (referring to the four bulk-import permissions: `consignee:bulk_create`, `subscription:bulk_create`, `tenant:migration_import`, `tenant:migration_gate_set`).
- **Reasoning paragraph:** "We do not want a Tenant Admin self-triggering a migration import without that cleanup, because it produces duplicate tasks. The gate is enforced at the permission layer first, then UI, then service."

Both can't be true. The matrix line says Tenant Admin gets `tenant:migration_import`; the reasoning paragraph says the permission layer is the first line of defense against exactly that.

**Resolution (R-1 PR #15, 27 April 2026, Love's call):** The reasoning paragraph wins. Tenant Admin holds only the two non-systemOnly bulk-import perms (`consignee:bulk_create`, `subscription:bulk_create`) and **does NOT hold** `tenant:migration_import` or `tenant:migration_gate_set`. The matrix line was sloppy language meaning "all four bulk-import perms that aren't systemOnly."

**Why:** The whole point of `systemOnly` is to make tenant-side privilege escalation structurally impossible — not just UI-hidden. Granting a systemOnly perm to a tenant-facing role defeats the entire mechanism. Defense-in-depth says the permission grant is the right layer for prevention.

**How to apply:** When a future brief says "Role X: all N" referring to a permission set that mixes tenant-scoped and systemOnly perms, **assume the role only gets the tenant-scoped subset** unless the brief explicitly says "yes, including systemOnly perms — we're treating systemOnly as a UI hint, not a grant boundary." If in doubt, ask before implementing — this exact ambiguity already cost a PR-comment round-trip on R-1. Locked in code: `src/modules/identity/roles.ts` — `tenant-admin` uses `TENANT_SCOPED` (every non-systemOnly perm). The catalogue invariant test `systemOnlyPermissionsAreNotInTenantRoles` enforces this statically; it'll fail on any future PR that tries to grant a systemOnly perm to a non-systemOnly role.

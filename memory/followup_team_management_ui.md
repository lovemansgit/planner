# Followup · Team Management UI for inviting internal users

**Original status:** Post-MVP. Captured from `aqib.a` review of
`subscription-planner-onboarding_v1.1` page 4.
**Owner:** Tenant-management UI workstream, post-pilot.
**Original decision:** Agreed scope, deferred to post-pilot.

**Day-24 update (2026-05-12):** Substantive partial ship via PRs #259
+ #260. This memo split into "what landed Day-24" + "what's still
deferred to Phase 1.5 / post-pilot" (see §What landed + §Still
deferred below).

## Source comment

> "Along with email invite, we should also give them frontend module so that
> merchants can add internal users as well."

## Gap (original)

The onboarding doc describes the invite *email* (Flow B § Invite email) but
does not describe the *Team Management* screen where the Tenant Admin
actually triggers an invite. Without that screen, no one can invite anyone
through the UI — the email is the output of an action that has no input
surface defined.

## What landed Day-24

Substantive partial of the original scope shipped via Session A's
late-PM bundle:

- **PR #259 — `/admin/users` list + `/admin/users/new` create flow.**
  Transcorp-sysadmin surface (cross-tenant view + create). Service
  layer: `createUser` (Supabase Auth admin SDK) +
  `createRoleAssignment` (mirror `users` table + `role_assignments`).
  Schema additions: `users` mirror table tracking `disabled_at` + a
  `tenant_id` for the admin's home tenant. Cross-tenant escalation
  gate: an admin can only create a user in their own tenant unless
  they carry `merchant:read_all` (transcorp-sysadmin only). Surfaced
  + remediated a schema-drift bug class (Day-24 EOD §E instance #2):
  `role_assignments.assigned_at` doesn't exist — the column is
  `created_at`. Fix landed in-PR with integration spec.
- **PR #260 — `/admin/users` disable + enable.** Paired login-block
  / restore on the same `/admin/users` list page. Service layer:
  `disableUser` / `enableUser` wrapping
  `supabase.auth.admin.updateUserById` with `ban_duration='876000h'`
  (disable, per SDK longest-practical example) and `'none'` (enable).
  Mirror table `disabled_at` field flipped synchronously with the
  auth.users ban toggle. Idempotent transitioned-flag computation.
  Self-disable blocked (operator can't lock themselves out mid-
  session). `listAllUsers` extended with `disabled` column + status
  pill rendered on the list.

**Surface delivered:**
- List of existing users in the tenant (now: across tenants for
  transcorp-sysadmin; tenant-scoped for tenant admins) — name, email,
  role, status (active / disabled), created date
- Create-user form: email + name + tenant (transcorp-sysadmin only) +
  role picker
- Disable-user action with self-disable guard
- Enable-user action (re-enable after disable)
- Cross-tenant escalation gate so non-sysadmin can't create / disable
  cross-tenant

## Still deferred to Phase 1.5 / post-pilot

These remain unscoped post-Day-24. Pickup window: Phase 1.5
(May-15→May-18 between internal CAIO + external prospect demos) OR
post-pilot, whichever the merchant-ops team prioritises after pilot
data.

- **Delete-user UI.** Day-24 ships disable (soft, preserves audit
  trail) but not hard-delete. Hard-delete cascades through
  `role_assignments` + auth.users; soft-delete (disable) is the
  preferred operator action because it preserves the audit trail
  (per existing convention). Add hard-delete only if the merchant-
  ops team confirms a use case that disable can't solve.
- **Bulk operations.** Bulk disable / enable / role-change. No
  bulk-action surface today. Phase 1.5 if pilot operators surface
  the use case.
- **Email invites (the original "invite email" flow).** Day-24
  ships `createUser` which provisions the auth row directly + the
  sysadmin sets the password. Email-based invite-link flow (send a
  one-time link to the new user's email so they set their own
  password) deferred. Sequencing: post-pilot once SF SMTP /
  transactional-email layer is wired.
- **Edit-user.** Name / email / contact info edit. No edit surface
  today. Phase 1.5.
- **Role-change action on existing users** (Tenant Admin → Ops Manager
  etc., or vice versa). Today, role is set at create-time and not
  mutable via UI. Phase 1.5.
- **Tenant team management.** Tenant-admin-facing surface that lets a
  tenant admin manage their OWN tenant's team (vs. the transcorp-
  sysadmin cross-tenant `/admin/users`). The Day-24 work is the
  cross-tenant sysadmin surface; the per-tenant admin surface still
  needs design (likely lives at `/team` or `/settings/team` under
  the tenant `(app)/` shell, with `team:manage` permission gate).
  Phase 1.5.
- **Resend / revoke pending-invite actions.** Predicated on the email
  invite flow above; can't ship until that lands. Post-pilot.

## Carry-forward note

When the team-management surface gets its next sprint (Phase 1.5
or post-pilot), the foundation is in place:
- Auth layer is wired (Supabase Auth via PR #117 Day-11 + downstream)
- Cross-tenant escalation gate already exists (PR #259) — reuse the
  pattern for any new mutator action
- `users` mirror table + `disabled_at` field already exist (PR #259) —
  add columns instead of new tables when extending
- Integration-spec discipline applies (Day-23 §F + Day-24 §E #2)
- Service-layer pattern is `service.ts` calling repo helpers; never
  inline SQL in routes

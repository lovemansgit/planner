# Followup · Team Management UI for inviting internal users

**Status:** Post-MVP. Captured from `aqib.a` review of `subscription-planner-onboarding_v1.1` page 4.
**Owner:** Tenant-management UI workstream, post-pilot.
**Decision:** Agreed scope, deferred to post-pilot.

## Source comment

> "Along with email invite, we should also give them frontend module so that
> merchants can add internal users as well."

## Gap

The onboarding doc describes the invite *email* (Flow B § Invite email) but
does not describe the *Team Management* screen where the Tenant Admin
actually triggers an invite. Without that screen, no one can invite anyone
through the UI — the email is the output of an action that has no input
surface defined.

## Scope when it lands

- Team Management screen reachable from the main nav for Tenant Admin only
- List of existing users in the tenant (name, email, role, status, last seen)
- Invite-user form: email + role picker (Ops Manager / CS Agent / second Tenant Admin)
- Pending-invite list with resend-invite and revoke-invite actions
- Role-change action on existing users (Tenant Admin → Ops Manager etc.)
- Deactivate-user action (soft delete, preserves audit trail per existing convention)

## Why post-MVP

- Pilot has three merchants, each with a small known team; invitations can be
  performed by the Transcorp systems team manually during onboarding for the
  pilot duration.
- The bulk of the auth + RBAC plumbing (R-1 through R-4 from Day 2) already
  exists. The UI is genuinely additive — about 2 days of frontend work plus
  one new endpoint cluster.
- MVP buffer is the binding constraint, not capability.

## Carry-forward note

When the auth-wiring sprint runs (Day 5+ memory note
`followup_server_component_error_handling.md` flags this as the forcing
function), the Team Management UI should be on the same sprint or the one
immediately after — same context, same module, same set of permissions to
test against.

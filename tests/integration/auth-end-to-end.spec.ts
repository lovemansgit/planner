// Day 10 / P2 — auth wiring end-to-end integration tests.
//
// Pins the SQL resolution path of buildRequestContext (the layer below
// the @supabase/ssr cookie shim, where the auth user-id is exchanged
// for { tenantId, permissions } via the public.users mirror joined
// against role_assignments + roles).
//
// Cookie handling across the three Next.js 16 contexts (RSC / Route
// Handler / Server Action — watch-list addition #1) is pinned at the
// unit layer (src/shared/tests/request-context.spec.ts "RSC swallow"
// case) and verified live in Vercel Preview after merge. Replicating
// the three-context contract under integration would require booting
// the Next.js runtime against a real Supabase Auth (GoTrue) instance,
// which is out of scope for the postgres-only CI service container.
//
// What this file pins:
//   1. SQL resolution: auth user-id → tenant + permission union
//   2. disabled_at gating: a disabled mirror row resolves to null
//   3. Multi-role union: user with two roles gets both permission sets
//   4. Cross-tenant isolation: a user's resolution does not leak grants
//      from a different tenant on a shared role row
//   5. No mirror row: returns null (caller maps to UnauthorizedError)
//   6. Day-16 §10.5 — `tenants.status = 'active'` filter: users on
//      provisioning / suspended / inactive tenants resolve to null
//      (caller maps to UnauthorizedError → 401 / login redirect).
//      The deactivateMerchant flow's session-revocation property
//      depends on this gate: flipping a tenant to 'inactive' must
//      invalidate every member's session on next request.

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// `request-context.ts` carries `import "server-only"` to fail loud if a
// browser bundle ever imports it. The vanilla Node test runtime can't
// resolve the package; mock it to a no-op (precedent: webhook-receiver
// integration test).
vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import { resolveUserContext } from "../../src/shared/request-context";

const RUN_ID = randomUUID().slice(0, 8);

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SLUG_A = `auth-test-${RUN_ID}-a`;
const SLUG_B = `auth-test-${RUN_ID}-b`;

// Day-16 §10.5 — 4-state tenants.status matrix tenants. Each carries one
// member with a tenant-admin role assignment so the only material
// difference vs TENANT_A's resolving path is the tenants.status value.
const TENANT_PROVISIONING = randomUUID();
const TENANT_SUSPENDED = randomUUID();
const TENANT_INACTIVE = randomUUID();
const SLUG_PROVISIONING = `auth-test-${RUN_ID}-prov`;
const SLUG_SUSPENDED = `auth-test-${RUN_ID}-susp`;
const SLUG_INACTIVE = `auth-test-${RUN_ID}-inac`;

const USER_ADMIN = randomUUID();
const USER_AGENT = randomUUID();
const USER_DISABLED = randomUUID();
const USER_NO_MIRROR = randomUUID();
const USER_MULTI = randomUUID();
const USER_TENANT_B = randomUUID();
const USER_PROVISIONING = randomUUID();
const USER_SUSPENDED = randomUUID();
const USER_INACTIVE = randomUUID();

describe("Day-10 P2 — buildRequestContext / resolveUserContext (integration)", () => {
  beforeAll(async () => {
    await withServiceRole("auth-end-to-end integration setup", async (tx) => {
      // Tenants. Day-16 §10.5 — explicit status set on every test tenant.
      // TENANT_A + TENANT_B are 'active' so the existing resolution
      // tests pass post-§10.5; the three new tenants exercise the
      // non-active branches that must resolve to null.
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_A},            ${SLUG_A},            'Auth Test Tenant A',            'active'),
          (${TENANT_B},            ${SLUG_B},            'Auth Test Tenant B',            'active'),
          (${TENANT_PROVISIONING}, ${SLUG_PROVISIONING}, 'Auth Test Tenant Provisioning', 'provisioning'),
          (${TENANT_SUSPENDED},    ${SLUG_SUSPENDED},    'Auth Test Tenant Suspended',    'suspended'),
          (${TENANT_INACTIVE},     ${SLUG_INACTIVE},     'Auth Test Tenant Inactive',     'inactive')
      `);

      // Built-in role rows. These are normally seeded once globally
      // (tenant_id IS NULL); the onboard-merchant CLI ensures at least
      // 'tenant-admin' exists. The integration container is fresh per
      // workflow so we ensure all needed slugs here. Use ON CONFLICT
      // so reruns within a single container don't fail.
      await tx.execute(sqlTag`
        INSERT INTO roles (tenant_id, name, slug, description) VALUES
          (NULL, 'Tenant Admin', 'tenant-admin', 'auth-test seed'),
          (NULL, 'Ops Manager', 'ops-manager', 'auth-test seed'),
          (NULL, 'CS Agent', 'cs-agent', 'auth-test seed')
        ON CONFLICT (tenant_id, slug) DO NOTHING
      `);

      // Auth.users (stubbed by tests/integration/setup/auth-stub.sql in
      // CI; in production this is GoTrue's table).
      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email) VALUES
          (${USER_ADMIN},        ${"admin-" + RUN_ID + "@auth-test.example"}),
          (${USER_AGENT},        ${"agent-" + RUN_ID + "@auth-test.example"}),
          (${USER_DISABLED},     ${"disabled-" + RUN_ID + "@auth-test.example"}),
          (${USER_NO_MIRROR},    ${"orphan-" + RUN_ID + "@auth-test.example"}),
          (${USER_MULTI},        ${"multi-" + RUN_ID + "@auth-test.example"}),
          (${USER_TENANT_B},     ${"tenant-b-" + RUN_ID + "@auth-test.example"}),
          (${USER_PROVISIONING}, ${"prov-" + RUN_ID + "@auth-test.example"}),
          (${USER_SUSPENDED},    ${"susp-" + RUN_ID + "@auth-test.example"}),
          (${USER_INACTIVE},     ${"inac-" + RUN_ID + "@auth-test.example"})
      `);

      // public.users mirrors. USER_NO_MIRROR has auth.users only — no mirror row.
      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email) VALUES
          (${USER_ADMIN},        ${TENANT_A},            ${"admin-" + RUN_ID + "@auth-test.example"}),
          (${USER_AGENT},        ${TENANT_A},            ${"agent-" + RUN_ID + "@auth-test.example"}),
          (${USER_MULTI},        ${TENANT_A},            ${"multi-" + RUN_ID + "@auth-test.example"}),
          (${USER_TENANT_B},     ${TENANT_B},            ${"tenant-b-" + RUN_ID + "@auth-test.example"}),
          (${USER_PROVISIONING}, ${TENANT_PROVISIONING}, ${"prov-" + RUN_ID + "@auth-test.example"}),
          (${USER_SUSPENDED},    ${TENANT_SUSPENDED},    ${"susp-" + RUN_ID + "@auth-test.example"}),
          (${USER_INACTIVE},     ${TENANT_INACTIVE},     ${"inac-" + RUN_ID + "@auth-test.example"})
      `);

      // USER_DISABLED gets a mirror row WITH disabled_at set.
      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email, disabled_at) VALUES
          (${USER_DISABLED}, ${TENANT_A}, ${"disabled-" + RUN_ID + "@auth-test.example"}, now())
      `);

      // Role assignments
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_ADMIN}, r.id, ${TENANT_A} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_AGENT}, r.id, ${TENANT_A} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'cs-agent'
      `);
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_DISABLED}, r.id, ${TENANT_A} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);
      // USER_MULTI carries cs-agent + ops-manager.
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_MULTI}, r.id, ${TENANT_A} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug IN ('cs-agent', 'ops-manager')
      `);
      // USER_TENANT_B carries tenant-admin scoped to TENANT_B.
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_TENANT_B}, r.id, ${TENANT_B} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);
      // Day-16 §10.5 4-state matrix users — each carries tenant-admin
      // scoped to their respective non-active tenant. The only
      // differentiator from USER_ADMIN is the tenants.status value;
      // resolveUserContext must return null for all three because
      // the JOIN tenants + status='active' filter excludes their row.
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_PROVISIONING}, r.id, ${TENANT_PROVISIONING} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_SUSPENDED}, r.id, ${TENANT_SUSPENDED} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_INACTIVE}, r.id, ${TENANT_INACTIVE} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);
    });
  });

  // No afterAll cleanup. CI fresh-container precedent — see the head
  // note in tests/integration/admin-webhook-config.spec.ts.

  it("resolves a single-role tenant-admin to that tenant + the full TENANT_SCOPED permission set", async () => {
    const resolved = await resolveUserContext(USER_ADMIN);
    expect(resolved).not.toBeNull();
    expect(resolved?.tenantId).toBe(TENANT_A);
    expect(resolved?.permissions.has("consignee:bulk_create")).toBe(true);
    expect(resolved?.permissions.has("user:create")).toBe(true);
    expect(resolved?.permissions.has("webhook_config:read")).toBe(true);
    // systemOnly perms must NEVER be in a tenant-admin's set.
    expect(resolved?.permissions.has("tenant:migration_import")).toBe(false);
    expect(resolved?.permissions.has("tenant:migration_gate_set")).toBe(false);
  });

  it("resolves a CS Agent to the cs-agent permission slice (read-mostly)", async () => {
    const resolved = await resolveUserContext(USER_AGENT);
    expect(resolved).not.toBeNull();
    expect(resolved?.permissions.has("consignee:read")).toBe(true);
    expect(resolved?.permissions.has("task:print_labels")).toBe(true);
    // cs-agent does NOT include subscription:bulk_create or
    // failed_pushes:retry per roles.ts.
    expect(resolved?.permissions.has("subscription:bulk_create")).toBe(false);
    expect(resolved?.permissions.has("failed_pushes:retry")).toBe(false);
  });

  it("returns null for a user with disabled_at set (gates the auth path closed)", async () => {
    const resolved = await resolveUserContext(USER_DISABLED);
    expect(resolved).toBeNull();
  });

  it("returns null for an auth.users row with no public.users mirror", async () => {
    const resolved = await resolveUserContext(USER_NO_MIRROR);
    expect(resolved).toBeNull();
  });

  it("unions permissions across multiple role assignments", async () => {
    const resolved = await resolveUserContext(USER_MULTI);
    expect(resolved).not.toBeNull();
    // From cs-agent
    expect(resolved?.permissions.has("consignee:read")).toBe(true);
    expect(resolved?.permissions.has("task:print_labels")).toBe(true);
    // From ops-manager (and not in cs-agent's hand-rolled set)
    expect(resolved?.permissions.has("subscription:bulk_create")).toBe(true);
    expect(resolved?.permissions.has("consignee:bulk_create")).toBe(true);
  });

  it("scopes to the user's own tenant — cross-tenant role leak guard", async () => {
    // USER_ADMIN is in TENANT_A; USER_TENANT_B is in TENANT_B. Each
    // resolution should return the user's own tenant only — no
    // accidental tenant-id swap from the role row (which has
    // tenant_id IS NULL — global) onto the role_assignments row's
    // tenant_id (which is the actual scope key).
    const a = await resolveUserContext(USER_ADMIN);
    const b = await resolveUserContext(USER_TENANT_B);
    expect(a?.tenantId).toBe(TENANT_A);
    expect(b?.tenantId).toBe(TENANT_B);
    expect(a?.tenantId).not.toBe(b?.tenantId);
  });

  // Day-16 §10.5 — 4-state tenants.status matrix.
  //
  // The three negative cases below pin the JOIN tenants + status='active'
  // filter at the real-DB layer. Each user carries a fully provisioned
  // mirror row + role assignment; the only thing keeping them from
  // resolving is the tenants.status value. This is the load-bearing
  // verification that deactivateMerchant's session-revocation property
  // holds (the session itself isn't deleted; the next request through
  // resolveUserContext returns null and the caller maps it to 401).

  it("returns null for a user on a 'provisioning' tenant (§10.5)", async () => {
    const resolved = await resolveUserContext(USER_PROVISIONING);
    expect(resolved).toBeNull();
  });

  it("returns null for a user on a 'suspended' tenant (§10.5)", async () => {
    const resolved = await resolveUserContext(USER_SUSPENDED);
    expect(resolved).toBeNull();
  });

  it("returns null for a user on an 'inactive' tenant (§10.5 — deactivateMerchant cutover)", async () => {
    const resolved = await resolveUserContext(USER_INACTIVE);
    expect(resolved).toBeNull();
  });
});

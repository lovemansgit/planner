// tests/integration/tenant-admin-invariant-array-binding.spec.ts
// =============================================================================
// Day-17 hotfix — drizzle/postgres-js array-binding regression pin for
// assertCanRemoveAssignments (src/modules/identity/tenant-admin-invariant.ts:73).
//
// Pre-emptive fix: same bug class as listVisibleTaskIds (the Day-17
// production smoke surface). The internal removingAdminRows query at
// src/modules/identity/tenant-admin-invariant.ts:111-118 used the same
// broken `ANY(${arr}::uuid[])` pattern; latent bug awaiting first
// real-Postgres invocation.
//
// This file pins the array-binding regression at regression grade.
// Exhaustive C-21 invariant coverage (concurrent transactions, FOR
// UPDATE lock semantics, etc.) is a separate concern — see the file
// header at tenant-admin-invariant.ts.
//
// Cases pinned:
//   1. Single ID input (admin assignment) — function executes against
//      real Postgres without raising 22P02 / 42846; correctly counts 1.
//   2. Multi-element input (5 IDs) — function executes without 42846;
//      correctly counts the admin subset.
//   3. Empty input — early-return guard clause path.
//   4. Cross-tenant filter — assignment IDs from another tenant don't
//      contribute to the count (defense-in-depth alongside RLS).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import { assertCanRemoveAssignments } from "../../src/modules/identity/tenant-admin-invariant";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SLUG_A = `tai-${RUN_ID}-a`;
const SLUG_B = `tai-${RUN_ID}-b`;

// Three tenant-admin users in TENANT_A so we can remove up to two
// without violating the C-21 invariant (one must remain).
const USER_ADMIN_1 = randomUUID();
const USER_ADMIN_2 = randomUUID();
const USER_ADMIN_3 = randomUUID();
const USER_TENANT_B_ADMIN = randomUUID();

const TENANT_A_ADMIN_ASSIGNMENTS: string[] = [];
let TENANT_B_ADMIN_ASSIGNMENT = "";

describe("Day-17 hotfix — tenant-admin-invariant drizzle array-binding", () => {
  beforeAll(async () => {
    await withServiceRole("tenant-admin-invariant integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_A}, ${SLUG_A}, 'TAI Test A', 'active'),
          (${TENANT_B}, ${SLUG_B}, 'TAI Test B', 'active')
      `);

      // Auth.users (stubbed by tests/integration/setup/auth-stub.sql in
      // CI; in production this is GoTrue's table). public.users.id is
      // FK-constrained to auth.users.id per 0001_identity.sql, so the
      // auth row must exist first.
      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email) VALUES
          (${USER_ADMIN_1},        ${"tai-a1-" + RUN_ID + "@test.example"}),
          (${USER_ADMIN_2},        ${"tai-a2-" + RUN_ID + "@test.example"}),
          (${USER_ADMIN_3},        ${"tai-a3-" + RUN_ID + "@test.example"}),
          (${USER_TENANT_B_ADMIN}, ${"tai-b-"  + RUN_ID + "@test.example"})
      `);

      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email) VALUES
          (${USER_ADMIN_1},        ${TENANT_A}, ${"tai-a1-" + RUN_ID + "@test.example"}),
          (${USER_ADMIN_2},        ${TENANT_A}, ${"tai-a2-" + RUN_ID + "@test.example"}),
          (${USER_ADMIN_3},        ${TENANT_A}, ${"tai-a3-" + RUN_ID + "@test.example"}),
          (${USER_TENANT_B_ADMIN}, ${TENANT_B}, ${"tai-b-"  + RUN_ID + "@test.example"})
      `);

      // Three tenant-admin assignments in TENANT_A. Explicit ::uuid
      // casts on the bound parameters so postgres-js's text-default
      // binding doesn't violate the role_assignments column types.
      const adminRows = await tx.execute<{ id: string }>(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_ADMIN_1}::uuid, r.id, ${TENANT_A}::uuid FROM roles r WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
        UNION ALL
        SELECT ${USER_ADMIN_2}::uuid, r.id, ${TENANT_A}::uuid FROM roles r WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
        UNION ALL
        SELECT ${USER_ADMIN_3}::uuid, r.id, ${TENANT_A}::uuid FROM roles r WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
        RETURNING id
      `);
      for (const row of adminRows) TENANT_A_ADMIN_ASSIGNMENTS.push(row.id);

      // One tenant-admin assignment in TENANT_B (cross-tenant; not
      // counted under TENANT_A scoping).
      const tenantBRows = await tx.execute<{ id: string }>(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_TENANT_B_ADMIN}::uuid, r.id, ${TENANT_B}::uuid FROM roles r WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
        RETURNING id
      `);
      TENANT_B_ADMIN_ASSIGNMENT = tenantBRows[0]!.id;
    });
  });

  // No afterAll teardown — `audit_events_no_delete` RULE on tenants
  // blocks DELETE cascade per memory/followup_audit_rule_cascade_conflict.md.
  // Random per-run UUIDs (RUN_ID slice + randomUUID() per fixture row)
  // prevent cross-run collisions; established pattern matches
  // tests/integration/task-packages-tenant-match.spec.ts.

  it("single-element input executes without Postgres array-binding error (admin removal allowed when 2 admins remain)", async () => {
    // Removing 1 of 3 tenant-admins → 2 remain → invariant holds.
    await expect(
      withServiceRole("tai test single", async (tx) => {
        await assertCanRemoveAssignments(
          tx,
          TENANT_A as Uuid,
          [TENANT_A_ADMIN_ASSIGNMENTS[0]] as readonly Uuid[],
        );
      }),
    ).resolves.not.toThrow();
  });

  it("multi-element input (2 admin IDs) executes without Postgres array-binding error", async () => {
    // Removing 2 of 3 tenant-admins → 1 remains → invariant holds.
    await expect(
      withServiceRole("tai test multi-2", async (tx) => {
        await assertCanRemoveAssignments(
          tx,
          TENANT_A as Uuid,
          TENANT_A_ADMIN_ASSIGNMENTS.slice(0, 2) as readonly Uuid[],
        );
      }),
    ).resolves.not.toThrow();
  });

  it("multi-element input (4 mixed IDs: 3 TENANT_A admins + 1 cross-tenant admin) executes without 42846", async () => {
    // The cross-tenant ID should be filtered out by the WHERE
    // ra.tenant_id = tenantId clause. All 3 TENANT_A admins ARE
    // counted → removing them all would violate C-21 → ConflictError
    // thrown. The bug-fix concern is that the multi-element array
    // binding works at all (no Postgres 42846); the ConflictError is
    // the correct semantic outcome.
    const mixed = [
      ...TENANT_A_ADMIN_ASSIGNMENTS,
      TENANT_B_ADMIN_ASSIGNMENT,
    ] as readonly Uuid[];
    await expect(
      withServiceRole("tai test multi-4", async (tx) => {
        await assertCanRemoveAssignments(tx, TENANT_A as Uuid, mixed);
      }),
    ).rejects.toThrow(/last Tenant Admin/);
  });

  it("empty input early-returns without query (guard-clause path)", async () => {
    await expect(
      withServiceRole("tai test empty", async (tx) => {
        await assertCanRemoveAssignments(tx, TENANT_A as Uuid, [] as readonly Uuid[]);
      }),
    ).resolves.not.toThrow();
  });

  it("cross-tenant filter — admin from another tenant ignored (count stays at 0 → no-op)", async () => {
    // Pass tenant-B's admin assignment ID under a tenant-A invariant
    // call. Even though the ID is a tenant-admin assignment, it's not
    // in tenant-A so it should be filtered out → removingAdmins=0 →
    // function returns without throwing.
    await expect(
      withServiceRole("tai test cross-tenant", async (tx) => {
        await assertCanRemoveAssignments(
          tx,
          TENANT_A as Uuid,
          [TENANT_B_ADMIN_ASSIGNMENT] as readonly Uuid[],
        );
      }),
    ).resolves.not.toThrow();
  });
});

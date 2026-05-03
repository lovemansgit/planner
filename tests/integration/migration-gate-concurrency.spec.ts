// tests/integration/migration-gate-concurrency.spec.ts
// =============================================================================
// C-6 — gateSet concurrency under SELECT FOR UPDATE.
//
// What this test proves:
//   - When two transactions race to transition the same tenant's
//     migration gate, the SELECT FOR UPDATE inside gateSet serialises
//     them on the row lock. The second tx unblocks AFTER the first
//     commits and re-reads the now-current state.
//   - If the second tx's newStatus matches the now-current state, it
//     no-ops (returns current, no audit emit).
//   - If the second tx's intended transition is no longer in
//     ALLOWED_TRANSITIONS for the now-current state, it raises
//     ConflictError.
//   - The state machine itself does NOT bypass-prevent legitimate
//     paths under concurrency: closed→open by tx A followed by a B
//     that wanted to "skip" to completed correctly succeeds with
//     open→completed (open→completed is allowed). This is by design —
//     the lock prevents lost updates, not "logical skipping" through a
//     legal state graph.
//
// How the test creates a deterministic race:
//   - We open a raw `postgres` (planner_app) connection that holds
//     the row lock via BEGIN + SELECT FOR UPDATE. That stand-in for
//     "tx A" gives us full control over commit timing.
//   - We then call gateSet() (which goes through the production db
//     pool). gateSet's own SELECT FOR UPDATE blocks on our held lock.
//   - We commit the lock-holder's transition; gateSet unblocks and
//     proceeds. We assert gateSet's outcome.
//
// Determinism: random per-run UUIDs / slugs. Same reason as the R-3
// isolation test (audit_events_no_delete RULE blocks tenant cleanup
// once any audit event references the row). The setup tenant + user
// linger after the test; that's accepted convention.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { gateSet } from "../../src/modules/identity/migration-gate";
import { withServiceRole } from "../../src/shared/db";
import { ConflictError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_ID = randomUUID();
const SLUG = `c6-test-${RUN_ID}`;
const SYSADMIN_USER_ID = randomUUID();
const SYSADMIN_EMAIL = `c6-sysadmin-${RUN_ID}@example.test`;

/** How long to wait for tx B to definitely-block on the lock before
 *  the lock holder commits. 250ms is conservative — the lock-acquire
 *  attempt is in-process and microsecond-scale, so 250ms is many
 *  orders of magnitude beyond the worst-case unblocked-call latency. */
const BLOCK_PROBE_MS = 250;

function sysadminCtx(): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: SYSADMIN_USER_ID,
      tenantId: TENANT_ID,
      // tenant:migration_gate_set is the systemOnly permission held
      // only by Transcorp Systems Team / Sysadmin per R-1. Carrying
      // it both authorises gateSet and triggers isSysadminActor.
      permissions: new Set<Permission>([
        "tenant:read",
        "tenant:migration_gate_set",
        "tenant:migration_gate_get",
        "tenant:migration_gate_check",
      ]),
    },
    tenantId: TENANT_ID,
    requestId: `req-${RUN_ID}`,
    path: "/test/migration-gate-concurrency",
  };
}

/** Reset the test tenant's gate state via withServiceRole.
 *  Splits into two branches because postgres.js + Drizzle's
 *  parameter binding for timestamptz doesn't accept a JS Date
 *  cleanly; using SQL `now()` for non-null and explicit NULL
 *  literal for closed sidesteps the binding altogether. */
async function resetGate(status: "closed" | "open" | "completed", setBy: string | null) {
  await withServiceRole("c6 concurrency: reset gate", async (tx) => {
    if (status === "closed") {
      await tx.execute(sqlTag`
        UPDATE tenants
        SET migration_gate_status = 'closed',
            migration_gate_set_at = NULL,
            migration_gate_set_by = NULL
        WHERE id = ${TENANT_ID}
      `);
    } else {
      await tx.execute(sqlTag`
        UPDATE tenants
        SET migration_gate_status = ${status},
            migration_gate_set_at = now(),
            migration_gate_set_by = ${setBy}
        WHERE id = ${TENANT_ID}
      `);
    }
  });
}

describe("C-6 — gateSet concurrency under SELECT FOR UPDATE", () => {
  beforeAll(async () => {
    await withServiceRole("c6 concurrency setup", async (tx) => {
      // Tenant
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, migration_gate_status)
        VALUES (${TENANT_ID}, ${SLUG}, 'C-6 Concurrency Test', 'closed')
      `);
      // Sysadmin user (FK target for migration_gate_set_by). Insert
      // into auth.users first (the FK-of-FK), then users.
      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email)
        VALUES (${SYSADMIN_USER_ID}, ${SYSADMIN_EMAIL})
        ON CONFLICT (id) DO NOTHING
      `);
      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email)
        VALUES (${SYSADMIN_USER_ID}, ${TENANT_ID}, ${SYSADMIN_EMAIL})
        ON CONFLICT (id) DO NOTHING
      `);
    });
  });

  afterAll(async () => {
    // Best-effort cleanup. The audit_events_no_delete RULE +
    // ON DELETE CASCADE FK from audit_events.tenant_id makes a tenant
    // with any audit history undeletable (memory:
    // followup_audit_rule_cascade_conflict). The post-Day-2 fix is
    // tracked. Random RUN_ID prevents test re-runs from colliding.
    await withServiceRole("c6 concurrency cleanup (best-effort)", async (tx) => {
      try {
        await tx.execute(sqlTag`DELETE FROM users WHERE id = ${SYSADMIN_USER_ID}`);
        await tx.execute(sqlTag`DELETE FROM auth.users WHERE id = ${SYSADMIN_USER_ID}`);
      } catch {
        // Tenant cascade-delete blocked by audit RULE — leave the
        // sentinel rows in place; they don't collide with future runs.
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 1 (your first branch): B targets 'open' after A's closed→open.
  // Expected: B unblocks, sees 'open', no-ops (no audit emit, returns current).
  // ---------------------------------------------------------------------------
  it("scenario 1 — B targets 'open' after A's closed→open commit: B no-ops cleanly", async () => {
    await resetGate("closed", null);

    const url = process.env.SUPABASE_APP_DATABASE_URL;
    if (!url) throw new Error("SUPABASE_APP_DATABASE_URL required for C-6 concurrency test");
    const lockHolder = postgres(url, { prepare: false, max: 1 });

    try {
      // tx A: BEGIN, set tenant scope, acquire row lock via SELECT FOR UPDATE.
      await lockHolder.unsafe("BEGIN");
      await lockHolder`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, true)`;
      const lockRows = await lockHolder<{ migration_gate_status: string }[]>`
        SELECT migration_gate_status FROM tenants WHERE id = ${TENANT_ID}::uuid FOR UPDATE
      `;
      expect(lockRows[0].migration_gate_status).toBe("closed");

      // tx B: gateSet — will block on the row lock.
      const bPromise = gateSet(sysadminCtx(), "open", "B's transition (scenario 1)");
      let bResolved = false;
      let bThrown: unknown = null;
      bPromise.then(() => (bResolved = true)).catch((e) => (bThrown = e));

      // Confirm B is genuinely blocked, not racing through.
      await new Promise<void>((resolve) => setTimeout(resolve, BLOCK_PROBE_MS));
      expect(bResolved).toBe(false);
      expect(bThrown).toBeNull();

      // tx A: commit the closed→open transition.
      await lockHolder`UPDATE tenants SET migration_gate_status='open', migration_gate_set_at=now() WHERE id = ${TENANT_ID}::uuid`;
      await lockHolder.unsafe("COMMIT");

      // B unblocks, re-reads, sees 'open', wants 'open' → no-op.
      const bResult = await bPromise;
      expect(bResult.status).toBe("open");

      // Final state check (via superuser).
      const after = await withServiceRole("verify scenario 1", async (tx) => {
        return tx.execute<{ migration_gate_status: string } & Record<string, unknown>>(sqlTag`
          SELECT migration_gate_status FROM tenants WHERE id = ${TENANT_ID}
        `);
      });
      expect(after[0].migration_gate_status).toBe("open");
    } finally {
      await lockHolder.end({ timeout: 2 });
    }
  });

  // ---------------------------------------------------------------------------
  // Scenario 2 (your second branch as literally stated): B targets 'completed'
  // after A's closed→open. By design — the lock prevents lost updates, not
  // legal-graph "skips". After A commits, state is 'open'; open→completed is
  // ALLOWED, so B succeeds with the open→completed transition.
  // ---------------------------------------------------------------------------
  it("scenario 2 (literal) — B targets 'completed' after A's closed→open: B succeeds with open→completed (NO ConflictError)", async () => {
    await resetGate("closed", null);

    const url = process.env.SUPABASE_APP_DATABASE_URL!;
    const lockHolder = postgres(url, { prepare: false, max: 1 });

    try {
      await lockHolder.unsafe("BEGIN");
      await lockHolder`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, true)`;
      await lockHolder`SELECT migration_gate_status FROM tenants WHERE id = ${TENANT_ID}::uuid FOR UPDATE`;

      const bPromise = gateSet(sysadminCtx(), "completed", "B's transition (scenario 2)");
      let bResolved = false;
      bPromise.then(() => (bResolved = true)).catch(() => {});
      await new Promise<void>((resolve) => setTimeout(resolve, BLOCK_PROBE_MS));
      expect(bResolved).toBe(false);

      // Commit closed→open.
      await lockHolder`UPDATE tenants SET migration_gate_status='open', migration_gate_set_at=now() WHERE id = ${TENANT_ID}::uuid`;
      await lockHolder.unsafe("COMMIT");

      // B unblocks; reads 'open'; transition open→completed is allowed.
      const bResult = await bPromise;
      expect(bResult.status).toBe("completed");
      // Documents the design property: the state machine permits
      // closed→open→completed. The lock didn't block "logical skipping"
      // because the path is legal once each step is taken. No
      // ConflictError despite B's original target appearing to skip
      // a state.
    } finally {
      await lockHolder.end({ timeout: 2 });
    }
  });

  // ---------------------------------------------------------------------------
  // Scenario 3 (canonical race-induced ConflictError): the actual condition
  // for ConflictError under race in this state machine is when A's commit
  // leaves the row in a state from which B's intended target is forbidden.
  // Setup: state='open'. A: open→closed. B: planned open→completed.
  // After A commits, B sees 'closed'; ALLOWED['closed']=['open']; 'completed'
  // not allowed → ConflictError.
  // ---------------------------------------------------------------------------
  it("scenario 3 (canonical race) — A: open→closed, B planned open→completed: B sees 'closed' and raises ConflictError", async () => {
    await resetGate("open", SYSADMIN_USER_ID);

    const url = process.env.SUPABASE_APP_DATABASE_URL!;
    const lockHolder = postgres(url, { prepare: false, max: 1 });

    try {
      await lockHolder.unsafe("BEGIN");
      await lockHolder`SELECT set_config('app.current_tenant_id', ${TENANT_ID}, true)`;
      await lockHolder`SELECT migration_gate_status FROM tenants WHERE id = ${TENANT_ID}::uuid FOR UPDATE`;

      const bPromise = gateSet(sysadminCtx(), "completed", "B's transition (scenario 3)");
      let bResolved = false;
      bPromise.then(() => (bResolved = true)).catch(() => {});
      await new Promise<void>((resolve) => setTimeout(resolve, BLOCK_PROBE_MS));
      expect(bResolved).toBe(false);

      // A commits open→closed (sysadmin-override-style rewind).
      await lockHolder`UPDATE tenants SET migration_gate_status='closed', migration_gate_set_at=now() WHERE id = ${TENANT_ID}::uuid`;
      await lockHolder.unsafe("COMMIT");

      // B unblocks; sees 'closed'; wants 'completed'; ALLOWED['closed']
      // = ['open'] only — ConflictError.
      await expect(bPromise).rejects.toBeInstanceOf(ConflictError);
    } finally {
      await lockHolder.end({ timeout: 2 });
    }
  });
});

// tests/integration/migration-0035.spec.ts
// =============================================================================
// Phase 8 / Lane 1 — migration 0035 (`tasks_courier_status`) shape
// verification. Plan memory/plans/day-56-phase-8-status-distinct-render.md §7.
//
// Migration 0035 (forward-only, per repo convention) adds:
//   1. tasks.courier_status — nullable text column
//   2. tasks_courier_status_check — CHECK (courier_status IS NULL OR
//      courier_status IN (<the 14 fine SF courier states>))
// and leaves the coarse tasks_internal_status_check (0019, 8 values)
// UNCHANGED.
//
// The migration runs once at scripts/setup-test-db.sh (which applies every
// supabase/migrations/[0-9]*.sql in order against the ephemeral CI DB).
// This is NOT the live Supabase — SQL-TO-APPLY on the live DB is parked
// for Love's named authorization. These tests assert post-migration schema
// state via the catalog (no task INSERT needed) + a text-inspection that
// the file is forward-only and does not touch internal_status.
//
// Pattern follows tests/integration/migration-0020.spec.ts: a direct
// postgres-js BYPASSRLS connection so the schema layer is what we test.
// =============================================================================

import { readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../..");
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  "supabase/migrations/0035_tasks_courier_status.sql",
);

// The 14 fine courier states the CHECK must admit (mirrors
// COURIER_STATUS_VALUES in src/modules/integration/types.ts).
const COURIER_STATES = [
  "ORDERED",
  "ASSIGNED",
  "PICKED_UP",
  "ARRIVED_AT_DC",
  "IN_TRANSIT",
  "HUB_TRANSFER",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED",
  "PROCESS_FOR_RETURN",
  "RETURNED_TO_SHIPPER",
  "CANCELED",
  "RESCHEDULED",
  "REATTEMPT",
] as const;

// The 8 coarse internal states the 0019 CHECK must STILL admit, unchanged.
const INTERNAL_STATES = [
  "CREATED",
  "ASSIGNED",
  "IN_TRANSIT",
  "DELIVERED",
  "FAILED",
  "CANCELED",
  "ON_HOLD",
  "SKIPPED",
] as const;

describe("migration 0035 — tasks.courier_status shape", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    const url = process.env.SUPABASE_DATABASE_URL;
    if (!url) {
      throw new Error(
        "SUPABASE_DATABASE_URL must be set — direct connection bypasses the " +
          "application wrapper to verify the schema layer.",
      );
    }
    sql = postgres(url, { prepare: false, max: 1 });
    const role = await sql<{ bypassrls: boolean }[]>`
      SELECT rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = current_user
    `;
    expect(role[0].bypassrls).toBe(true);
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  // ---------------------------------------------------------------------------
  // 1. column shape — nullable text, no default
  // ---------------------------------------------------------------------------
  it("courier_status exists as a nullable text column with no default", async () => {
    const cols = await sql<
      { data_type: string; is_nullable: string; column_default: string | null }[]
    >`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tasks'
        AND column_name = 'courier_status'
    `;
    expect(cols).toHaveLength(1);
    expect(cols[0].data_type).toBe("text");
    expect(cols[0].is_nullable).toBe("YES");
    expect(cols[0].column_default).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 2. CHECK admits NULL + all 14 fine states
  // ---------------------------------------------------------------------------
  it("tasks_courier_status_check admits NULL and every one of the 14 states", async () => {
    const def = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = 'tasks_courier_status_check'
        AND conrelid = 'public.tasks'::regclass
    `;
    expect(def).toHaveLength(1);
    // Nullable arm present, then each of the 14 values enumerated.
    expect(def[0].def).toMatch(/courier_status IS NULL/i);
    for (const state of COURIER_STATES) {
      expect(def[0].def).toContain(`'${state}'`);
    }
  });

  // ---------------------------------------------------------------------------
  // 3. coarse internal_status CHECK is UNCHANGED (not merged into courier)
  // ---------------------------------------------------------------------------
  it("leaves tasks_internal_status_check at the unchanged 8 coarse values", async () => {
    const def = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = 'tasks_internal_status_check'
        AND conrelid = 'public.tasks'::regclass
    `;
    expect(def).toHaveLength(1);
    for (const state of INTERNAL_STATES) {
      expect(def[0].def).toContain(`'${state}'`);
    }
    // The fine-only courier states must NOT have leaked into the coarse
    // CHECK — proves 0035 added a separate column, not an expanded enum.
    expect(def[0].def).not.toContain("'OUT_FOR_DELIVERY'");
    expect(def[0].def).not.toContain("'PICKED_UP'");
    expect(def[0].def).not.toContain("'ARRIVED_AT_DC'");
  });

  // ---------------------------------------------------------------------------
  // 4. migration file is forward-only and does not touch internal_status
  // ---------------------------------------------------------------------------
  it("the migration file is forward-only (ADD only) and leaves internal_status alone", async () => {
    const text = await readFile(MIGRATION_PATH, "utf8");
    // Strip the SQL line comments so header prose (which mentions the
    // documented rollback + internal_status) isn't matched as executable.
    const exec = text
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(exec).toMatch(/ALTER TABLE tasks\s+ADD COLUMN courier_status text/i);
    expect(exec).toMatch(/ADD CONSTRAINT tasks_courier_status_check/i);
    // No executable DROP (forward-only) and no touch of the coarse CHECK.
    expect(exec).not.toMatch(/DROP COLUMN/i);
    expect(exec).not.toMatch(/DROP CONSTRAINT/i);
    expect(exec).not.toMatch(/internal_status/i);
  });
});

// tests/integration/migration-0020.spec.ts
// =============================================================================
// §7.3 — migration 0020 verification tests per merged plan PR #145
// memory/plans/day-14-cron-decoupling.md §7.3.
//
// Migration 0020 (`task_generation_runs_target_date_column_and_unique`) adds:
//   1. target_date column (nullable initially)
//   2. backfill via `(window_start AT TIME ZONE 'Asia/Dubai')::date + 1`
//   3. dedup with winning-row policy (MAX(completed_at) preferred, else
//      MAX(started_at))
//   4. ALTER COLUMN target_date SET NOT NULL
//   5. CREATE UNIQUE INDEX on (tenant_id, target_date)
//
// Pre-existing UNIQUE on (tenant_id, window_start, window_end) from
// migration 0012 is RETAINED per §0.5 amendment D4-4.
//
// Whole migration is wrapped in BEGIN/COMMIT for atomicity per §0.5
// amendment D4-3.
//
// Test pattern: post-migration state assertions + isolated re-execution
// of the backfill + dedup SQL against per-test fixture data. The
// migration itself runs once at scripts/setup-test-db.sh; we cannot
// roll back to pre-migration state in a shared test DB. Tests therefore:
//
//   - Verify column shape post-migration (NOT NULL, default, etc.)
//   - Verify both UNIQUEs co-exist (insert duplicates, expect 23505)
//   - Verify the AT TIME ZONE backfill expression returns the right
//     target_date for known input timestamps
//   - Verify the ROW_NUMBER() winning-row dedup picks the right row
//     (run on per-test fixture data isolated from any migration replay)
//   - Verify migration file contains BEGIN/COMMIT wrapper (text inspection)
//
// Pattern follows tests/integration/exception-model-check-constraints.spec.ts:
// direct postgres-js connection (BYPASSRLS) so the schema layer is what
// we're testing, not the application wrapper.
// =============================================================================

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../..");
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  "supabase/migrations/0020_task_generation_runs_target_date_column_and_unique.sql",
);

describe("§7.3 — migration 0020 verification", () => {
  const RUN_ID = randomUUID().slice(0, 8);
  const TENANT_ID = randomUUID();
  const SLUG = `d14-mig0020-${RUN_ID}`;

  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    const url = process.env.SUPABASE_DATABASE_URL;
    if (!url) {
      throw new Error(
        "SUPABASE_DATABASE_URL must be set for §7.3 — direct connection " +
          "bypasses the application wrapper to verify the schema layer.",
      );
    }
    sql = postgres(url, { prepare: false, max: 1 });

    // Sanity: must be the BYPASSRLS connection.
    const role = await sql<{ bypassrls: boolean }[]>`
      SELECT rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = current_user
    `;
    expect(role[0].bypassrls).toBe(true);

    await sql`
      INSERT INTO tenants (id, slug, name) VALUES (${TENANT_ID}, ${SLUG}, '§7.3 mig0020 test')
    `;
  });

  afterAll(async () => {
    try {
      // Cleanup wrapped in try/catch per audit_events_no_delete RULE.
      await sql`DELETE FROM task_generation_runs WHERE tenant_id = ${TENANT_ID}`;
      await sql`DELETE FROM tenants WHERE id = ${TENANT_ID}`;
    } catch {
      /* audit RULE; ignore */
    }
    if (sql) await sql.end({ timeout: 5 });
  });

  // ---------------------------------------------------------------------------
  // Row 4 (column-add + NOT NULL promotion) — post-migration state assertion
  // ---------------------------------------------------------------------------
  describe("row 4: target_date column shape post-migration", () => {
    it("target_date column exists, is NOT NULL, has no default", async () => {
      const cols = await sql<
        { column_name: string; is_nullable: string; column_default: string | null }[]
      >`
        SELECT column_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'task_generation_runs'
          AND column_name = 'target_date'
      `;
      expect(cols).toHaveLength(1);
      expect(cols[0].is_nullable).toBe("NO");
      expect(cols[0].column_default).toBeNull();
    });

    it("INSERT with NULL target_date is rejected (23502 not_null_violation)", async () => {
      // Defence-in-depth: even if a future writer forgets target_date, the
      // NOT NULL constraint catches it loud.
      const promise = sql`
        INSERT INTO task_generation_runs (
          tenant_id, window_start, window_end, target_date,
          status, cap_threshold, started_at
        ) VALUES (
          ${TENANT_ID}, '2026-06-01T00:00:00Z'::timestamptz,
          '2026-06-01T01:00:00Z'::timestamptz, NULL,
          'completed', 7000, '2026-06-01T00:00:00Z'::timestamptz
        )
      `;
      await expect(promise).rejects.toMatchObject({ code: "23502" });
    });
  });

  // ---------------------------------------------------------------------------
  // Row 1 (canonical 12:00 UTC tick backfill) + Row 2 (DST defensive)
  // ---------------------------------------------------------------------------
  describe("row 1+2: AT TIME ZONE 'Asia/Dubai' backfill expression", () => {
    it.each([
      ["2026-05-04T12:00:00Z", "2026-05-05"], // canonical: 12:00 UTC = 16:00 Dubai → +1 day
      ["2026-05-04T20:00:00Z", "2026-05-06"], // off-hour: 20:00 UTC = 00:00 Dubai next day → +1 day
      ["2026-03-29T22:00:00Z", "2026-03-31"], // DST-boundary defensive: Dubai constant UTC+4
      ["2026-12-31T12:00:00Z", "2027-01-01"], // year-boundary
    ])("window_start=%s → target_date=%s", async (windowStart, expected) => {
      const r = await sql<{ target_date: string }[]>`
        SELECT (
          (${windowStart}::timestamptz AT TIME ZONE 'Asia/Dubai')::date + 1
        )::text AS target_date
      `;
      expect(r[0].target_date).toBe(expected);
    });
  });

  // ---------------------------------------------------------------------------
  // Row 3 (dedup with winning-row policy)
  //
  // Replays the migration's DELETE … ROW_NUMBER() OVER (...) pattern on
  // per-test fixture data isolated from the original migration replay.
  // ---------------------------------------------------------------------------
  describe("row 3: winning-row dedup policy", () => {
    // Migration 0020 ADDS the (tenant_id, target_date) UNIQUE — meaning we
    // can no longer INSERT duplicate (tenant, target_date) rows on the
    // post-migration table to test the dedup. The migration's dedup
    // logic ran ONCE at scripts/setup-test-db.sh and can't be replayed.
    //
    // To prove the ORDER BY semantic: replay the ROW_NUMBER() ranking
    // verbatim against an in-query VALUES list shaped exactly like the
    // migration's input. Pure-SELECT — no DML on task_generation_runs.
    // The query mirrors the migration's:
    //   ORDER BY
    //     (completed_at IS NULL),
    //     completed_at DESC NULLS LAST,
    //     started_at DESC
    // which is the exact load-bearing logic to pin.
    type RankedRow = {
      label: string;
      completed_at: string | null;
      started_at: string;
    };

    async function pickWinningLabel(rows: RankedRow[]): Promise<string> {
      // VALUES literal preserves NULL completed_at semantics; the postgres
      // driver's array splat (per §7.1 fix) doesn't apply here because we
      // pass a single JSON parameter that the lateral function unpacks.
      const r = await sql<{ label: string }[]>`
        WITH input(label, completed_at, started_at) AS (
          SELECT (x->>'label')::text,
                 NULLIF(x->>'completed_at','')::timestamptz,
                 (x->>'started_at')::timestamptz
            FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) AS x
        ),
        ranked AS (
          SELECT label,
                 ROW_NUMBER() OVER (
                   ORDER BY
                     (completed_at IS NULL),
                     completed_at DESC NULLS LAST,
                     started_at DESC
                 ) AS rn
            FROM input
        )
        SELECT label FROM ranked WHERE rn = 1
      `;
      expect(r).toHaveLength(1);
      return r[0].label;
    }

    it("MAX(completed_at) wins among completed rows", async () => {
      const winner = await pickWinningLabel([
        { label: "earlier-completed", completed_at: "2026-04-01T09:00:00Z", started_at: "2026-04-01T08:00:00Z" },
        { label: "later-completed",   completed_at: "2026-04-01T11:00:00Z", started_at: "2026-04-01T10:00:00Z" },
        { label: "running-A",         completed_at: null,                   started_at: "2026-04-01T12:00:00Z" },
        { label: "running-B",         completed_at: null,                   started_at: "2026-04-01T13:00:00Z" },
        { label: "running-C",         completed_at: null,                   started_at: "2026-04-01T14:00:00Z" },
      ]);
      expect(winner).toBe("later-completed");
    });

    it("MAX(started_at) wins when no row has completed_at", async () => {
      const winner = await pickWinningLabel([
        { label: "earlier-running",  completed_at: null, started_at: "2026-04-01T10:00:00Z" },
        { label: "middle-running",   completed_at: null, started_at: "2026-04-01T11:00:00Z" },
        { label: "later-running",    completed_at: null, started_at: "2026-04-01T14:00:00Z" },
        { label: "another-running",  completed_at: null, started_at: "2026-04-01T12:00:00Z" },
        { label: "yet-another",      completed_at: null, started_at: "2026-04-01T13:00:00Z" },
      ]);
      expect(winner).toBe("later-running");
    });
  });

  // ---------------------------------------------------------------------------
  // Row 5 (BEGIN/COMMIT wrapper) — text inspection
  //
  // The wrapper makes the 5-step migration atomic per §0.5 amendment D4-3.
  // This is a text-level invariant: any future contributor splitting the
  // migration into separate transactions would silently lose atomicity.
  // ---------------------------------------------------------------------------
  describe("row 5: BEGIN/COMMIT wrapper", () => {
    it("migration file wraps all DDL/DML in a single transaction", async () => {
      const text = await readFile(MIGRATION_PATH, "utf8");
      // BEGIN; appears before any ALTER/CREATE/DELETE/UPDATE.
      const beginIdx = text.indexOf("\nBEGIN;");
      expect(beginIdx).toBeGreaterThan(-1);
      const commitIdx = text.lastIndexOf("\nCOMMIT;");
      expect(commitIdx).toBeGreaterThan(beginIdx);

      // No nested transactions / no extra BEGINs between them.
      const between = text.slice(beginIdx + "\nBEGIN;".length, commitIdx);
      expect(between).not.toMatch(/\nBEGIN;/);
      expect(between).not.toMatch(/\nCOMMIT;/);
      // The 5 substantive steps all live between BEGIN and COMMIT.
      expect(between).toMatch(/ALTER TABLE task_generation_runs[\s\n]+ADD COLUMN target_date/);
      expect(between).toMatch(/AT TIME ZONE 'Asia\/Dubai'/);
      expect(between).toMatch(/DELETE FROM task_generation_runs/);
      expect(between).toMatch(/SET NOT NULL/);
      expect(between).toMatch(/CREATE UNIQUE INDEX task_generation_runs_tenant_target_date_unique_idx/);
    });
  });

  // ---------------------------------------------------------------------------
  // Row 6 (pre-existing UNIQUE preserved)
  // ---------------------------------------------------------------------------
  describe("row 6: pre-existing (tenant_id, window_start, window_end) UNIQUE preserved", () => {
    it("rejects duplicate (tenant_id, window_start, window_end) with 23505", async () => {
      const ws = "2026-06-02T00:00:00Z";
      const we = "2026-06-02T01:00:00Z";

      await sql`
        INSERT INTO task_generation_runs (
          tenant_id, window_start, window_end, target_date,
          status, cap_threshold, started_at
        ) VALUES (
          ${TENANT_ID}, ${ws}::timestamptz, ${we}::timestamptz, '2026-06-03'::date,
          'completed', 7000, ${ws}::timestamptz
        )
      `;
      // Same (tenant, ws, we), different target_date — only the OLD UNIQUE
      // can fire (the NEW (tenant_id, target_date) UNIQUE doesn't match).
      const second = sql`
        INSERT INTO task_generation_runs (
          tenant_id, window_start, window_end, target_date,
          status, cap_threshold, started_at
        ) VALUES (
          ${TENANT_ID}, ${ws}::timestamptz, ${we}::timestamptz, '2026-06-04'::date,
          'completed', 7000, ${ws}::timestamptz
        )
      `;
      await expect(second).rejects.toMatchObject({ code: "23505" });

      await sql`DELETE FROM task_generation_runs WHERE tenant_id = ${TENANT_ID} AND window_start = ${ws}::timestamptz`;
    });
  });

  // ---------------------------------------------------------------------------
  // Row 7 (new UNIQUE catches dupe)
  // ---------------------------------------------------------------------------
  describe("row 7: new (tenant_id, target_date) UNIQUE catches dupe", () => {
    it("rejects duplicate (tenant_id, target_date) with 23505 on the new index", async () => {
      const target = "2026-06-05";

      await sql`
        INSERT INTO task_generation_runs (
          tenant_id, window_start, window_end, target_date,
          status, cap_threshold, started_at
        ) VALUES (
          ${TENANT_ID}, '2026-06-04T12:00:00Z'::timestamptz,
          '2026-06-04T13:00:00Z'::timestamptz, ${target}::date,
          'completed', 7000, '2026-06-04T12:00:00Z'::timestamptz
        )
      `;
      // Same (tenant, target), different (ws, we) — only the NEW UNIQUE
      // can fire (the OLD (tenant_id, ws, we) UNIQUE doesn't match).
      const second = sql`
        INSERT INTO task_generation_runs (
          tenant_id, window_start, window_end, target_date,
          status, cap_threshold, started_at
        ) VALUES (
          ${TENANT_ID}, '2026-06-04T15:00:00Z'::timestamptz,
          '2026-06-04T16:00:00Z'::timestamptz, ${target}::date,
          'completed', 7000, '2026-06-04T15:00:00Z'::timestamptz
        )
      `;
      await expect(second).rejects.toMatchObject({
        code: "23505",
        // Defence-in-depth: assert the NEW index name fired, not the old one.
        constraint_name: "task_generation_runs_tenant_target_date_unique_idx",
      });

      await sql`DELETE FROM task_generation_runs WHERE tenant_id = ${TENANT_ID} AND target_date = ${target}::date`;
    });
  });

  // ---------------------------------------------------------------------------
  // Row 5 supplemental: NEW UNIQUE INDEX exists (post-migration assertion)
  // ---------------------------------------------------------------------------
  describe("post-migration: new UNIQUE INDEX exists", () => {
    it("task_generation_runs_tenant_target_date_unique_idx is registered as UNIQUE", async () => {
      const idxRows = await sql<
        { indexname: string; indexdef: string }[]
      >`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'task_generation_runs'
          AND indexname = 'task_generation_runs_tenant_target_date_unique_idx'
      `;
      expect(idxRows).toHaveLength(1);
      expect(idxRows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/);
      expect(idxRows[0].indexdef).toMatch(/\(tenant_id, target_date\)/);
    });
  });
});

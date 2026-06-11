// tests/integration/migration-0022-tasks-webhook-extracted-columns.spec.ts
// =============================================================================
// Day-18 / A2 — Migration 0022 standalone smoke test.
//
// Per plan §9.4: asserts all 10 ADD COLUMN statements landed on `tasks`
// with the expected types and nullability. Per the §4.5 ruling, all
// 10 columns are nullable with NULL default; existing tasks rows have
// NULL across all 10 columns (no backfill needed).
//
// Read against information_schema.columns in the live test DB.
// =============================================================================

import { sql as sqlTag } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";

interface ColumnInfo {
  readonly column_name: string;
  readonly data_type: string;
  readonly is_nullable: string;
  readonly column_default: string | null;
}

const EXPECTED_COLUMNS: readonly { name: string; type: string }[] = [
  { name: "pod_photos", type: "jsonb" },
  { name: "recipient_name", type: "text" },
  { name: "signature", type: "text" },
  { name: "consignee_rating", type: "smallint" },
  { name: "consignee_comment", type: "text" },
  { name: "driver_comment", type: "text" },
  { name: "number_of_attempts", type: "smallint" },
  { name: "failure_reason_comment", type: "text" },
  { name: "completion_latitude", type: "numeric" },
  { name: "completion_longitude", type: "numeric" },
];

describe("Day-18 / A2 — Migration 0022 (tasks webhook-extracted columns)", () => {
  it("all 10 columns exist on tasks with expected types, nullable, no default", async () => {
    const rows = (await withServiceRole("verify migration 0022 columns", async (tx) =>
      tx.execute(sqlTag`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tasks'
          AND column_name IN (
            'pod_photos',
            'recipient_name',
            'signature',
            'consignee_rating',
            'consignee_comment',
            'driver_comment',
            'number_of_attempts',
            'failure_reason_comment',
            'completion_latitude',
            'completion_longitude'
          )
        ORDER BY column_name
      `),
    )) as unknown as readonly ColumnInfo[];

    expect(rows).toHaveLength(10);

    for (const expected of EXPECTED_COLUMNS) {
      const row = rows.find((r) => r.column_name === expected.name);
      expect(row, `missing column ${expected.name}`).toBeDefined();
      if (!row) continue;
      expect(row.data_type).toBe(expected.type);
      expect(row.is_nullable).toBe("YES");
      expect(row.column_default).toBeNull();
    }
  });
});

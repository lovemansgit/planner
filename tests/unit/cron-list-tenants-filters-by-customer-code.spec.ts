// tests/unit/cron-list-tenants-filters-by-customer-code.spec.ts
//
// Day 8 / β — cron tenant-enumeration filter.
//
// RULE: `listCronEligibleTenantIds` MUST issue a SELECT against
// `tenants` with the WHERE filter
// `suitefleet_customer_code IS NOT NULL AND suitefleet_customer_code <> ''`.
// Without this filter, the cron walks every tenant in the database —
// including the 339 stale test tenants — and the second cron trigger
// (2 May 2026, captured in
// memory/followup_suitefleet_bulk_push_empirical.md) hit the Vercel
// Pro 300s timeout doing exactly that.
//
// Test strategy: drizzle's `sql\`...\`` template literal returns a
// SQL object whose `queryChunks` array carries the static text and
// parameter placeholders. We mock `withServiceRole` to capture the
// SQL passed to `tx.execute`, flatten the queryChunks into a string,
// and assert the WHERE filter substring is present.
//
// This is unit-level only (no real Postgres). The truth-test for
// the filter behaviour against a populated database is the
// production cron itself — first 12:00 UTC pass post-merge enumerates
// only tenants with customer_code set; ops verifies via the response
// payload's `tenant_count` field.
//
// Why a named test file: same precedent as the D8-4a / D8-4b guard
// tests — CI grep finds the rule by name.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/shared/db", () => ({
  withServiceRole: vi.fn(),
}));

import { withServiceRole } from "../../src/shared/db";
import { listCronEligibleTenantIds } from "../../src/app/api/cron/generate-tasks/list-cron-eligible-tenants";

const mockWithServiceRole = vi.mocked(withServiceRole);

/**
 * Flatten drizzle's queryChunks into a single string. queryChunks
 * is an array of either StringChunk objects (with `.value: string[]`
 * holding the static SQL fragments) or parameter placeholders. For
 * this test the SQL is purely static (no parameters), so every
 * chunk is a StringChunk and we just join the value arrays.
 */
function flattenSql(sql: unknown): string {
  type Chunk = { value?: readonly string[] };
  const chunks = (sql as { queryChunks?: readonly Chunk[] })?.queryChunks ?? [];
  return chunks
    .flatMap((c) => (Array.isArray(c.value) ? c.value : []))
    .join("");
}

describe("β — listCronEligibleTenantIds filters by suitefleet_customer_code", () => {
  let capturedSql: unknown;

  beforeEach(() => {
    capturedSql = null;
    mockWithServiceRole.mockReset();
    mockWithServiceRole.mockImplementation(async (_label, fn) => {
      const tx = {
        execute: vi.fn(async (sql: unknown) => {
          capturedSql = sql;
          return [];
        }),
      };
      return fn(tx as never);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("issues a SELECT against tenants with WHERE suitefleet_customer_code IS NOT NULL", async () => {
    await listCronEligibleTenantIds();
    const sqlText = flattenSql(capturedSql);
    expect(sqlText).toMatch(/SELECT\s+id\s+FROM\s+tenants/i);
    // Load-bearing assertion: NULL filter present. Without this the
    // cron enumerates tenants whose customer_code was never
    // backfilled and the per-tenant guard would skip them
    // — but at the cost of walking every stale row first.
    expect(sqlText).toMatch(/suitefleet_customer_code\s+IS\s+NOT\s+NULL/i);
  });

  it("includes the empty-string defensive filter (parallels per-tenant guard's trim/falsy check)", async () => {
    await listCronEligibleTenantIds();
    const sqlText = flattenSql(capturedSql);
    // Defence-in-depth: a value that the per-tenant
    // missing_customer_code guard would skip
    // (`config.suitefleetCustomerCode?.trim()` falsy) is also
    // excluded at enumeration. Keep the two paths consistent.
    expect(sqlText).toMatch(/suitefleet_customer_code\s*<>\s*''/);
  });

  it("includes the Day-18 status filter (only provisioning + active)", async () => {
    await listCronEligibleTenantIds();
    const sqlText = flattenSql(capturedSql);
    // Day-18 / PR #189 plan §6 + code-PR Checkpoint-1 scope addition.
    // The cron β SELECT must filter by status post-test-tenants-cleanup
    // so archived rows (and any future inactive/suspended) are
    // excluded from the cron walk regardless of customer_code state.
    // Some bg4g-* archived rows carry alphanumeric customer_codes
    // that A1's incoming numeric-only resolver would reject; the
    // status filter is the gate that prevents the post-archive DLQ
    // flood. See src/app/api/cron/generate-tasks/list-cron-eligible-tenants.ts
    // header for the full reasoning.
    expect(sqlText).toMatch(/status\s+IN\s*\(\s*'provisioning'\s*,\s*'active'\s*\)/i);
    // Belt-and-braces: archived must NOT appear in the IN list.
    expect(sqlText).not.toMatch(/status\s+IN\s*\([^)]*'archived'/i);
  });

  it("preserves ORDER BY created_at ASC (D8-4a α-fix posture stays load-bearing)", async () => {
    await listCronEligibleTenantIds();
    const sqlText = flattenSql(capturedSql);
    // The α-fix UPDATE on the sandbox tenant's created_at to
    // '2024-01-01' relies on this ORDER BY for predictable
    // single-tenant batches at the head of the loop. β must not
    // disturb the ordering.
    expect(sqlText).toMatch(/ORDER\s+BY\s+created_at\s+ASC/i);
  });

  it("returns the tenant id column from the executed query", async () => {
    // Stub the execute to return a known shape; the helper maps
    // rows to the `.id` field. Pin the mapping behaviour.
    mockWithServiceRole.mockReset();
    mockWithServiceRole.mockImplementation(async (_label, fn) => {
      const tx = {
        execute: vi.fn(async () => [
          { id: "00000000-0000-0000-0000-00000000000a" },
          { id: "00000000-0000-0000-0000-00000000000b" },
        ]),
      };
      return fn(tx as never);
    });

    const ids = await listCronEligibleTenantIds();
    expect(ids).toEqual([
      "00000000-0000-0000-0000-00000000000a",
      "00000000-0000-0000-0000-00000000000b",
    ]);
  });

  it("uses a named withServiceRole label for forensic traceability", async () => {
    await listCronEligibleTenantIds();
    expect(mockWithServiceRole).toHaveBeenCalledTimes(1);
    const label = mockWithServiceRole.mock.calls[0][0];
    expect(label).toBe("cron:generate_tasks list eligible tenants");
  });
});

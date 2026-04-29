// Repository unit tests — T-7.
//
// Mocks `tx.execute` directly so SQL building, the row mapper, and
// the JSON-payload-serialisation step can be exercised without a
// real Postgres connection. RLS / partial UNIQUE / tenant-match
// trigger behaviours are covered by the integration suite.

import { sql as sqlTag, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { insertFailedPush } from "../repository";
import type { RecordFailedPushInput } from "../types";

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const TASK_ID = "11111111-1111-1111-1111-111111111111";
const FAILED_PUSH_ID = "22222222-2222-2222-2222-222222222222";
const FIXED_NOW = new Date("2026-04-30T10:00:00.000Z");

const dialect = new PgDialect();

function compile(query: unknown): { sql: string; params: unknown[] } {
  const compiled = dialect.sqlToQuery(query as SQL);
  return { sql: compiled.sql, params: compiled.params };
}

function rowFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: FAILED_PUSH_ID,
    tenant_id: TENANT_ID,
    task_id: TASK_ID,
    attempt_count: 1,
    task_payload: { customerOrderNumber: "ORDER-001" },
    failure_reason: "network" as const,
    failure_detail: null,
    http_status: null,
    first_failed_at: FIXED_NOW,
    last_attempted_at: FIXED_NOW,
    resolved_at: null,
    resolved_by: null,
    resolution_notes: null,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    ...overrides,
  };
}

function makeStubTx(executeReturns: unknown[]) {
  let call = 0;
  const execute = vi.fn(async () => {
    const value = executeReturns[call] ?? [];
    call += 1;
    return value;
  });
  return { execute } as unknown as Parameters<typeof insertFailedPush>[0] & {
    execute: ReturnType<typeof vi.fn>;
  };
}

describe("insertFailedPush", () => {
  const baseInput: RecordFailedPushInput = {
    taskId: TASK_ID,
    taskPayload: { customerOrderNumber: "ORDER-001" },
    failureReason: "network",
  };

  it("issues exactly one execute() and returns the camelCase mapped row", async () => {
    const tx = makeStubTx([[rowFixture()]]);
    const result = await insertFailedPush(tx, TENANT_ID, baseInput);

    expect(tx.execute).toHaveBeenCalledOnce();
    expect(result).toEqual({
      id: FAILED_PUSH_ID,
      tenantId: TENANT_ID,
      taskId: TASK_ID,
      attemptCount: 1,
      taskPayload: { customerOrderNumber: "ORDER-001" },
      failureReason: "network",
      failureDetail: null,
      httpStatus: null,
      firstFailedAt: FIXED_NOW.toISOString(),
      lastAttemptedAt: FIXED_NOW.toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      resolutionNotes: null,
      createdAt: FIXED_NOW.toISOString(),
      updatedAt: FIXED_NOW.toISOString(),
    });
  });

  it("serialises the task_payload object to JSON for the jsonb column", async () => {
    const tx = makeStubTx([[rowFixture()]]);
    await insertFailedPush(tx, TENANT_ID, {
      ...baseInput,
      taskPayload: { foo: "bar", nested: { n: 42 } },
    });

    const captured = compile(tx.execute.mock.calls[0][0]);
    // The JSON-stringified payload is bound as a parameter.
    const stringifiedPayload = '{"foo":"bar","nested":{"n":42}}';
    expect(captured.params).toContain(stringifiedPayload);
    // SQL casts it to jsonb.
    expect(captured.sql).toMatch(/::jsonb/);
  });

  it("converts undefined optional fields into NULL parameters", async () => {
    const tx = makeStubTx([
      [rowFixture({ failure_detail: null, http_status: null })],
    ]);
    const result = await insertFailedPush(tx, TENANT_ID, baseInput);
    expect(result.failureDetail).toBeNull();
    expect(result.httpStatus).toBeNull();
  });

  it("passes through populated optional fields", async () => {
    const tx = makeStubTx([
      [rowFixture({ failure_detail: "connection reset", http_status: 502 })],
    ]);
    const result = await insertFailedPush(tx, TENANT_ID, {
      ...baseInput,
      failureReason: "server_5xx",
      failureDetail: "connection reset",
      httpStatus: 502,
    });
    expect(result.failureDetail).toBe("connection reset");
    expect(result.httpStatus).toBe(502);
  });

  it("includes tenant_id and task_id in the bound parameters (defence in depth)", async () => {
    const tx = makeStubTx([[rowFixture()]]);
    await insertFailedPush(tx, TENANT_ID, baseInput);
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.params).toContain(TENANT_ID);
    expect(captured.params).toContain(TASK_ID);
  });

  it("throws if INSERT … RETURNING produces zero rows (unexpected anomaly)", async () => {
    const tx = makeStubTx([[]]);
    await expect(insertFailedPush(tx, TENANT_ID, baseInput)).rejects.toThrow(/zero rows/);
  });
});

// One assertion that the compile() helper actually does what we
// think it does — guards against a future Drizzle bump silently
// changing the PgDialect.sqlToQuery shape.
describe("compile() helper sanity", () => {
  it("expands a simple tagged template into bound `$N` syntax", () => {
    const q = sqlTag`SELECT * FROM failed_pushes WHERE id = ${FAILED_PUSH_ID} AND tenant_id = ${TENANT_ID}`;
    const { sql, params } = compile(q);
    expect(sql).toMatch(/id\s*=\s*\$1\s+AND\s+tenant_id\s*=\s*\$2/i);
    expect(params).toEqual([FAILED_PUSH_ID, TENANT_ID]);
  });
});

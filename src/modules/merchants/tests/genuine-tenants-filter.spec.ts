// Item 1 (22 Jun 2026) — shared genuine-tenant SQL filter.
//
// `buildGenuineTenantsFilter(ref)` is the SINGLE SQL rendering of the
// genuine/test classification, reused by every cross-tenant admin
// surface (merchants list, consignees, subscriptions, users, tasks) so
// the rule can never diverge per-surface. It mirrors `isGenuineMerchant`
// exactly; the behavioural truth of the predicate is proven in
// genuine-merchants.spec.ts (pure JS, no DB). These tests assert the SQL
// surface — that every consumer composes the identical predicate over
// whatever tenant alias it joins to.
//
// No database: PgDialect compiles the captured tagged template into the
// bound `$N` form, exactly like repository.spec.ts.

import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIEW_STATUSES,
  GENUINE_MERCHANT_SLUGS,
  TEST_TENANT_SLUG_PATTERN,
  buildGenuineTenantsFilter,
} from "../genuine-merchants";

const dialect = new PgDialect();

function compile(query: unknown): { sql: string; params: unknown[] } {
  const compiled = dialect.sqlToQuery(query as SQL);
  return { sql: compiled.sql, params: compiled.params };
}

describe("buildGenuineTenantsFilter", () => {
  it("defaults to the bare `tenants` table when no alias is supplied", () => {
    const { sql } = compile(buildGenuineTenantsFilter());
    expect(sql).toMatch(/tenants\.slug\s+in\s*\(/i);
    expect(sql).toMatch(/tenants\.status\s+in\s*\(/i);
    expect(sql).toMatch(/tenants\.slug\s*!~\s*\$\d+/i);
  });

  it("qualifies every column with the supplied join alias", () => {
    const { sql } = compile(buildGenuineTenantsFilter("ten"));
    expect(sql).toMatch(/ten\.slug\s+in\s*\(/i);
    expect(sql).toMatch(/ten\.status\s+in\s*\(/i);
    expect(sql).toMatch(/ten\.slug\s*!~\s*\$\d+/i);
    // No un-qualified column leaks (would be ambiguous in a JOIN).
    expect(sql).not.toMatch(/[^.]\bslug\s+in/i);
  });

  it("emits a leading AND so it composes into a `WHERE 1 = 1` query", () => {
    const { sql } = compile(buildGenuineTenantsFilter("ten"));
    expect(sql.trimStart()).toMatch(/^AND\s*\(/i);
  });

  it("binds the full allowlist, the default-view statuses, and the test pattern as params", () => {
    const { params } = compile(buildGenuineTenantsFilter("t"));
    for (const slug of GENUINE_MERCHANT_SLUGS) {
      expect(params).toContain(slug);
    }
    for (const status of DEFAULT_VIEW_STATUSES) {
      expect(params).toContain(status);
    }
    expect(params).toContain(TEST_TENANT_SLUG_PATTERN);
    // archived is never in the default-view set.
    expect(params).not.toContain("archived");
  });

  it("is the allowlist-OR-(status AND not-test) shape — allowlist wins regardless of status", () => {
    const { sql } = compile(buildGenuineTenantsFilter("ten"));
    // slug IN (...) OR (status IN (...) AND slug !~ ...)
    expect(sql).toMatch(/ten\.slug\s+in\s*\([^)]*\)\s+or\s*\(\s*ten\.status\s+in/i);
  });
});

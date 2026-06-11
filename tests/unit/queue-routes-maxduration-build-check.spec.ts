// tests/unit/queue-routes-maxduration-build-check.spec.ts
//
// §7.2 row 1 (NEW, runtime-bug guard) per merged plan PR #145
// memory/plans/day-14-cron-decoupling.md §5.1 amendment 3 + §11.2 row 2.
//
// Vercel non-cron API routes default to 60s on Pro; the existing
// /api/cron/* routes get 300s by virtue of being cron-routes, but
// /api/queue/* are regular API routes and must opt in via
// `export const maxDuration = 300;` at the top of the route file.
// Without this declaration, the §1.1 per-message timeout envelope
// claim is FALSE — the handler dies at 60s mid-SF-call on slow
// responses.
//
// Unit tests can assert the export at module load time, but a unit
// test only proves the value exists in the module — it does NOT
// prove the literal source line will be visible to Vercel's build
// pipeline. The honest "does this declaration reach Vercel?" check
// is a build-time grep against the route source file. This spec
// reads the route files directly from disk and asserts the literal
// `export const maxDuration = 300;` string is present.
//
// If a future refactor replaces the literal with `export const
// maxDuration = MAX_DURATION_S` (constant indirection), this test
// fails — by design. The plan locks the literal form because it's
// what Vercel's static analysis reads.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ROUTES = [
  "src/app/api/queue/push-task/route.ts",
  "src/app/api/queue/push-task-failed/route.ts",
];

describe("§7.2 row 1 — maxDuration = 300 build-time grep (queue routes)", () => {
  it.each(ROUTES)("%s contains literal `export const maxDuration = 300;`", (rel) => {
    const source = readFileSync(path.join(REPO_ROOT, rel), "utf-8");
    expect(source).toContain("export const maxDuration = 300;");
  });
});

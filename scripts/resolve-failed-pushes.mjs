#!/usr/bin/env node
// scripts/resolve-failed-pushes.mjs
//
// Day-33 PR-D (Plan #317 §3.7 CLEANUP-1, §6 OQ-4 ruling (a)+(b) at SHA
// f0ef560). Operator CLI tool for bulk-resolving unresolved failed_pushes
// rows via JSON input. Companion to the /admin/failed-pushes Resolve-
// selected UI button — both write through the same DB pathway
// (failed_pushes.resolved_at + resolution_notes) and emit the same
// audit event type (failed_push.bulk_resolved); CLI invocations are
// discriminated by the `source: 'cli'` metadata field per the
// event-types.ts registration.
//
// Why a CLI in addition to the UI: per §6 OQ-4 ruling, both ship in
// PR-D. The UI is the right shape for multi-tenant ops triage (one
// tenant at a time, operator-scoped permission check). The CLI is the
// right shape for a one-off backlog drain (many rows across many
// tenants in one invocation, ops-manager-runs-the-script accountability
// via the synthetic 'cli:resolve_failed_pushes' system actor).
//
// DRY-RUN BY DEFAULT. Write mode requires --apply explicitly. The
// default-safe posture is non-negotiable: an accidental `node
// scripts/resolve-failed-pushes.mjs --input=foo.json` MUST NOT write.
// Mirror onboard-merchant.mjs's argument parser shape so this script
// fits the existing CLI conventions in this repo.
//
// Usage (from repo root):
//   # Dry-run (default — prints what would happen, writes nothing)
//   npm run resolve-failed-pushes -- --input=./bulk-resolve-input.json
//
//   # Write mode (requires explicit --apply)
//   npm run resolve-failed-pushes -- --input=./bulk-resolve-input.json --apply
//
// Input JSON format:
//   [
//     { "failed_push_id": "<uuid>", "reason": "<text, ≤500 chars>" },
//     { "failed_push_id": "<uuid>", "reason": "<text, ≤500 chars>" },
//     ...
//   ]
//
// Items are grouped by (tenant_id, reason) — each group becomes one
// bulk SQL UPDATE + one audit emit (mirroring the UI path's
// one-operation-one-event shape). Groups can span many tenants in one
// CLI invocation; the operator gets one summary per group.
//
// Env loading: mirrors onboard-merchant.mjs — auto-loads .env.local
// from cwd via dotenv. Required env: SUPABASE_DATABASE_URL (superuser
// pool, BYPASSRLS — same as the service.ts withServiceRole connection).

import { readFile } from "node:fs/promises";

import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local", quiet: true });

const ARG_PATTERN = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/;
const RESOLUTION_NOTES_MAX_LEN = 500;
const BULK_RESOLVE_MAX_BATCH = 200;
const CLI_ACTOR_ID = "cli:resolve_failed_pushes";

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = ARG_PATTERN.exec(arg);
    if (!m) {
      console.error(`Unrecognised argument: ${arg}`);
      process.exit(2);
    }
    // Bare flags (e.g. --apply) → true; --key=value → value
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function need(map, name, label) {
  const v = map[name];
  if (v === undefined || v === null || v === "") {
    console.error(`Missing required argument: --${name} (${label})`);
    process.exit(2);
  }
  return v;
}

function needEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(2);
  }
  return v;
}

function validateUuid(value, where) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error(`${where}: not a valid uuid: ${JSON.stringify(value)}`);
  }
  return value;
}

function validateReason(value, where) {
  if (typeof value !== "string") {
    throw new Error(`${where}: reason must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${where}: reason must be non-empty`);
  }
  if (trimmed.length > RESOLUTION_NOTES_MAX_LEN) {
    throw new Error(
      `${where}: reason must be ≤${RESOLUTION_NOTES_MAX_LEN} chars (got ${trimmed.length})`,
    );
  }
  return trimmed;
}

/**
 * Parse + validate the input JSON file. Returns a normalised array of
 * { failedPushId, reason } items. Exits with non-zero on any invalid
 * row — partial-input acceptance is anti-discipline (silent skips
 * during a bulk operation hide real input errors).
 */
async function loadInput(inputPath) {
  let raw;
  try {
    raw = await readFile(inputPath, "utf8");
  } catch (err) {
    console.error(`Failed to read input file ${inputPath}: ${err.message}`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`Input file ${inputPath} is not valid JSON: ${err.message}`);
    process.exit(2);
  }
  if (!Array.isArray(parsed)) {
    console.error(`Input file ${inputPath} must be a JSON array`);
    process.exit(2);
  }
  if (parsed.length === 0) {
    console.error(`Input file ${inputPath} is an empty array — nothing to do`);
    process.exit(2);
  }
  const items = [];
  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    if (typeof row !== "object" || row === null) {
      throw new Error(`item[${i}]: must be an object`);
    }
    const failedPushId = validateUuid(row.failed_push_id, `item[${i}].failed_push_id`);
    const reason = validateReason(row.reason, `item[${i}].reason`);
    items.push({ failedPushId, reason });
  }
  return items;
}

/**
 * Look up tenant_id for each failed_push_id. Items pointing at IDs that
 * don't exist (or are already resolved) are surfaced as not-found in
 * the summary; they are NOT silently dropped from the apply step
 * because the UPDATE itself uses `AND resolved_at IS NULL` and won't
 * touch them.
 */
async function resolveTenants(sql, items) {
  const ids = items.map((it) => it.failedPushId);
  const rows = await sql`
    SELECT id, tenant_id, resolved_at
    FROM failed_pushes
    WHERE id = ANY(${ids}::uuid[])
  `;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const enriched = [];
  for (const item of items) {
    const row = byId.get(item.failedPushId);
    enriched.push({
      ...item,
      tenantId: row?.tenant_id ?? null,
      isUnresolved: row !== undefined && row.resolved_at === null,
      isAlreadyResolved: row !== undefined && row.resolved_at !== null,
      isUnknown: row === undefined,
    });
  }
  return enriched;
}

/**
 * Group enriched items by (tenant_id, reason). Each group becomes one
 * SQL UPDATE + one audit emit — mirrors the UI path's
 * one-operation-one-event shape.
 */
function groupByTenantAndReason(enrichedItems) {
  /** @type {Map<string, { tenantId: string, reason: string, ids: string[] }>} */
  const groups = new Map();
  for (const it of enrichedItems) {
    if (!it.isUnresolved) continue; // already-resolved + unknown are surfaced separately
    const key = `${it.tenantId}::${it.reason}`;
    let g = groups.get(key);
    if (g === undefined) {
      g = { tenantId: it.tenantId, reason: it.reason, ids: [] };
      groups.set(key, g);
    }
    g.ids.push(it.failedPushId);
  }
  // Reject any group exceeding BULK_RESOLVE_MAX_BATCH — same ceiling
  // the service.ts enforces. Operator can re-split the input file.
  for (const g of groups.values()) {
    if (g.ids.length > BULK_RESOLVE_MAX_BATCH) {
      throw new Error(
        `Group (tenant=${g.tenantId.slice(0, 8)}..., reason="${g.reason.slice(0, 32)}...") has ${g.ids.length} ids; max ${BULK_RESOLVE_MAX_BATCH} per group. Re-split the input.`,
      );
    }
  }
  return Array.from(groups.values());
}

function printSummary({ groups, alreadyResolvedCount, unknownCount, isDryRun }) {
  console.log("");
  console.log(`=== Bulk-resolve ${isDryRun ? "DRY-RUN (no writes)" : "APPLY (writing)"} ===`);
  console.log(
    `Groups: ${groups.length} (one SQL UPDATE + one audit emit per group)`,
  );
  console.log(
    `Total rows to resolve: ${groups.reduce((acc, g) => acc + g.ids.length, 0)}`,
  );
  console.log(`Already-resolved (skip): ${alreadyResolvedCount}`);
  console.log(`Unknown ids (skip):      ${unknownCount}`);
  console.log("");
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    console.log(
      `[group ${i + 1}/${groups.length}] tenant=${g.tenantId.slice(0, 8)}... reason="${g.reason.slice(0, 60)}${g.reason.length > 60 ? "…" : ""}" ids=${g.ids.length}`,
    );
  }
  console.log("");
}

/**
 * Apply one group: UPDATE failed_pushes + INSERT audit_events. Both
 * statements run inside a single tx so a failed audit emit rolls back
 * the UPDATE — operator gets either both effects or neither, never
 * the resolved-without-audit-trail half-state.
 *
 * Service-layer canonical metadata shape per src/modules/audit/event-types.ts
 * "failed_push.bulk_resolved" registration at SHA d25e812+PR-D:
 *   failed_push_ids[], count, resolution_notes, source, not_found_count
 * Keep this shape in sync with the registration; reviewer's §3.6 #2
 * read pins the contract.
 */
async function applyOne(sql, group) {
  return await sql.begin(async (tx) => {
    const updated = await tx`
      UPDATE failed_pushes
      SET
        resolved_at      = now(),
        resolved_by      = NULL,
        resolution_notes = ${group.reason}
      WHERE id = ANY(${group.ids}::uuid[])
        AND tenant_id = ${group.tenantId}
        AND resolved_at IS NULL
      RETURNING id
    `;
    const resolvedIds = updated.map((r) => r.id);
    const resolvedSet = new Set(resolvedIds);
    const notFoundIds = group.ids.filter((id) => !resolvedSet.has(id));

    const metadata = {
      failed_push_ids: resolvedIds,
      count: resolvedIds.length,
      resolution_notes: group.reason,
      source: "cli",
      not_found_count: notFoundIds.length,
    };

    await tx`
      INSERT INTO audit_events (
        event_type, actor_kind, actor_id, tenant_id,
        resource_type, resource_id, metadata, request_id
      ) VALUES (
        'failed_push.bulk_resolved',
        'system',
        ${CLI_ACTOR_ID},
        ${group.tenantId},
        'failed_push',
        NULL,
        ${JSON.stringify(metadata)}::jsonb,
        ${CLI_ACTOR_ID + ":" + new Date().toISOString()}
      )
    `;
    return { resolvedCount: resolvedIds.length, notFoundCount: notFoundIds.length };
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath = need(args, "input", "path to JSON input file");
  const isApply = args.apply === true;
  const databaseUrl = needEnv("SUPABASE_DATABASE_URL");

  const items = await loadInput(inputPath);
  const sql = postgres(databaseUrl, { prepare: false, max: 2 });

  try {
    const enriched = await resolveTenants(sql, items);
    const groups = groupByTenantAndReason(enriched);
    const alreadyResolvedCount = enriched.filter((e) => e.isAlreadyResolved).length;
    const unknownCount = enriched.filter((e) => e.isUnknown).length;

    printSummary({ groups, alreadyResolvedCount, unknownCount, isDryRun: !isApply });

    if (!isApply) {
      console.log("[dry-run] Pass --apply to write. No DB changes made.");
      return;
    }

    let totalResolved = 0;
    let totalNotFound = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const res = await applyOne(sql, g);
      totalResolved += res.resolvedCount;
      totalNotFound += res.notFoundCount;
      console.log(
        `[apply ${i + 1}/${groups.length}] tenant=${g.tenantId.slice(0, 8)}... resolved=${res.resolvedCount}/${g.ids.length} not_found=${res.notFoundCount}`,
      );
    }
    console.log("");
    console.log(
      `[apply done] total resolved=${totalResolved}, total not-found-in-tx=${totalNotFound}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? err);
  process.exit(1);
});

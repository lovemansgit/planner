// Asset-tracking service — Day 6 / B-2 (closing commit).
//
// Read-through cache for SuiteFleet's `task-asset-tracking` records.
// User flow:
//
//   1. Operator opens a task in the UI.
//   2. UI calls GET /api/tasks/:id/asset-tracking.
//   3. Route invokes `getAssetTrackingForTask(ctx, taskId)`.
//   4. Service resolves the task's AWB, looks up cached rows.
//   5. If cache is fresh (every row's `last_synced_at` within the
//      5-minute TTL), returns cached rows.
//   6. Else, calls the LastMileAdapter's `fetchAssetTrackingByAwb`,
//      upserts each returned package into the cache (or drops with
//      `asset_tracking.orphan_dropped` audit event when the parent
//      task is missing locally), emits `asset_tracking.refreshed`
//      and per-package `asset_tracking.state_changed` events for any
//      transitions, then returns the freshly-cached rows.
//
// Per memory/decision_bag_tracking_mvp.md "Cardinality" note: a
// single AWB may carry packages belonging to multiple tasks (split
// shipment). The cache stores all of them; the service filters the
// response down to packages whose `taskId` matches the requested
// task.
//
// Webhook-driven invalidation is NOT wired in B-2. The TTL-based
// read-through is the load-bearing invalidation path for the closing
// commit; webhook-side cache writes are a post-B-2 follow-up
// (referenced in the memo as part of the long-term architecture but
// not required to ship the read-through surface). The audit-event
// catalogue's `trigger_source` metadata field anticipates the
// webhook path so the future commit doesn't reshape the events.
//
// Audit policy (per memo):
//   - Cache reads are NOT audited (R-4, anti-flood reasoning).
//   - `asset_tracking.refreshed` fires once per cache-miss → SF GET.
//     User-triggered, so actorKind/actorId mirror the requester.
//   - `asset_tracking.state_changed` fires once per package whose
//     state column moves to a new value. trigger_source is
//     "read_through" on this path; "webhook" reserved for the
//     future webhook-driven write path.
//   - `asset_tracking.orphan_dropped` fires once per SF record whose
//     taskId does not resolve to a Planner task. systemOnly: true;
//     the cache write is dropped (asset_tracking_cache.task_id is
//     NOT NULL — orphans are structurally non-storable). actorKind
//     overridden to "system" for this emit because the orphan-drop
//     is an ingestion-pathway concern, not a user action.

// Note: no `import "server-only"` here. The other module services
// (consignees / tasks / subscriptions) follow the same convention —
// they import from `withTenant` / `requirePermission` which are
// already server-side; the route layer carries `server-only` so a
// client-component accidental import would fail at build there. The
// service itself stays vitest-mockable without a cross-cutting
// transformer.

import { emit } from "../audit";
import { getSuiteFleetAdapter } from "@/modules/integration/providers/suitefleet/get-adapter";
import type { AssetTrackingPackage } from "@/modules/integration/types";
import { withTenant } from "@/shared/db";
import { NotFoundError, ValidationError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import type { Actor, RequestContext } from "@/shared/tenant-context";
import type { IsoTimestamp, Uuid } from "@/shared/types";

import { requirePermission } from "../identity";

import {
  findAwbsInMotion,
  findCacheByAwb,
  findTaskAwb,
  findTaskIdByExternalId,
  insertScanLogEntries,
  upsertCacheRow,
} from "./repository";
import { POLL_AWB_CAP } from "./types";
import type {
  AssetScanLogEntryInput,
  AssetScanSource,
  AssetTrackingCacheRow,
  AssetTrackingPollSummary,
} from "./types";

const log = logger.with({ component: "asset_tracking_service" });

/** 5-minute TTL per the design memo. */
const TTL_MS = 5 * 60 * 1000;

/**
 * Day-54 P1 — AWBs per batch GET on the 30-minute poll. 10 keeps the
 * query string short and the per-call blast radius small while the
 * batch separator's merged-content behaviour is still unproven on
 * real data (probe-verified ACCEPTED only).
 */
const POLL_CHUNK_SIZE = 10;

/** System actor id for poll-path audit emits. */
const POLL_ACTOR_ID = "asset_tracking_poll";

/**
 * System actor id used on the orphan-dropped emit. Distinguishable
 * from any real user / api-key id (matches the `audit` synthetic
 * actor style used by the service-role observer).
 */
const ORPHAN_DROP_ACTOR_ID = "asset_tracking_ingestion";

function actorIdFor(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.system;
}

function assertTenantScoped(
  ctx: RequestContext,
  forOperation: string,
): asserts ctx is RequestContext & { tenantId: Uuid } {
  if (!ctx.tenantId) {
    throw new ValidationError(`${forOperation} requires a tenant context`);
  }
}

/**
 * Read-through asset-tracking lookup for a task. Returns cached rows
 * scoped to `taskId` (a single AWB may carry packages from multiple
 * tasks; the response is filtered).
 *
 * Throws:
 *   - ForbiddenError    actor lacks `asset_tracking:read`.
 *   - ValidationError   no tenant context.
 *   - NotFoundError     task does not exist or is RLS-hidden.
 */
export async function getAssetTrackingForTask(
  ctx: RequestContext,
  taskId: Uuid,
): Promise<readonly AssetTrackingCacheRow[]> {
  requirePermission(ctx, "asset_tracking:read");
  assertTenantScoped(ctx, "asset_tracking:read");

  const tenantId = ctx.tenantId;

  // Resolve task → AWB. Three outcomes; each is an explicit branch.
  const lookup = await withTenant(tenantId, async (tx) =>
    findTaskAwb(tx, tenantId, taskId),
  );
  if (lookup.kind === "not_found") {
    throw new NotFoundError(`task not found: ${taskId}`);
  }
  if (lookup.kind === "no_awb") {
    // Task exists but hasn't been pushed to SF yet (no external
    // tracking number). Asset tracking is impossible until the SF
    // round-trip lands an AWB; return empty.
    return [];
  }
  const { awb } = lookup;

  // Cache lookup. Read every row on the AWB (across tasks) to make
  // the freshness decision against the AWB as a whole, then filter
  // the response to the requested task.
  const cacheRows = await withTenant(tenantId, async (tx) =>
    findCacheByAwb(tx, tenantId, awb),
  );

  if (cacheRows.length > 0 && isCacheFresh(cacheRows)) {
    return cacheRows.filter((row) => row.taskId === taskId);
  }

  // Cache miss or stale → refresh from SF, then re-read.
  const refreshed = await refreshFromSf(ctx, awb, cacheRows);
  return refreshed.filter((row) => row.taskId === taskId);
}

// -----------------------------------------------------------------------------
// Refresh path
// -----------------------------------------------------------------------------

async function refreshFromSf(
  ctx: RequestContext & { tenantId: Uuid },
  awb: string,
  existing: readonly AssetTrackingCacheRow[],
): Promise<readonly AssetTrackingCacheRow[]> {
  const tenantId = ctx.tenantId;
  const adapter = getSuiteFleetAdapter();

  const session = await adapter.authenticate(tenantId);
  const records = await adapter.fetchAssetTrackingByAwb(session, awb);

  // Build a lookup of existing rows for state-change detection.
  // Indexed by trackingId because that's the cache's unique key.
  const previousByTrackingId = new Map<string, AssetTrackingCacheRow>();
  for (const row of existing) {
    previousByTrackingId.set(row.trackingId, row);
  }
  // The `previous_synced_at` audit-metadata field uses the oldest
  // existing row's lastSyncedAt — represents how long this AWB has
  // gone without a fresh fetch. Null on first refresh.
  const previousSyncedAt =
    existing.length === 0
      ? null
      : existing.reduce<string>(
          (oldest, row) => (row.lastSyncedAt < oldest ? row.lastSyncedAt : oldest),
          existing[0].lastSyncedAt,
        );

  const { upsertedCount, stateChanges, orphans } = await ingestRecords(
    tenantId,
    records,
    previousByTrackingId,
    "read_through",
  );

  // Emit the refresh event regardless of whether any records came
  // back. Operators investigating cache miss-rate need to see "we
  // did a SF GET" even when SF returned zero records.
  await emit({
    eventType: "asset_tracking.refreshed",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "asset_tracking",
    metadata: {
      awb,
      previous_synced_at: previousSyncedAt,
      record_count: upsertedCount,
    },
    requestId: ctx.requestId,
  });

  for (const change of stateChanges) {
    await emit({
      eventType: "asset_tracking.state_changed",
      actorKind: ctx.actor.kind,
      actorId: actorIdFor(ctx.actor),
      tenantId,
      resourceType: "asset_tracking",
      metadata: {
        tracking_id: change.pkg.trackingId,
        task_id_external: change.pkg.taskIdExternal,
        previous_state: change.previous?.state ?? null,
        new_state: change.pkg.state,
        trigger_source: "read_through",
      },
      requestId: ctx.requestId,
    });
  }

  for (const pkg of orphans) {
    // System-actor emit per the orphan event's systemOnly: true flag.
    // The drop happens at an ingestion pathway that is system-driven
    // even when the request originated from a user.
    await emit({
      eventType: "asset_tracking.orphan_dropped",
      actorKind: "system",
      actorId: ORPHAN_DROP_ACTOR_ID,
      tenantId,
      resourceType: "asset_tracking",
      metadata: {
        tracking_id: pkg.trackingId,
        task_id_external: pkg.taskIdExternal,
        awb: pkg.awb,
      },
      requestId: ctx.requestId,
    });
  }

  // Re-read the cache for the post-refresh state. Reads after writes
  // in the same logical sequence — the write transactions have all
  // committed (each upsertCacheRow ran in its own withTenant).
  return withTenant(tenantId, async (tx) =>
    findCacheByAwb(tx, tenantId, awb),
  );
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * A cache is considered "fresh" if every row's `lastSyncedAt` falls
 * within the TTL window. Empty cache is NOT fresh (callers detect
 * the empty case before invoking this).
 */
function isCacheFresh(rows: readonly AssetTrackingCacheRow[]): boolean {
  const now = Date.now();
  for (const row of rows) {
    const synced = Date.parse(row.lastSyncedAt);
    if (Number.isNaN(synced) || now - synced > TTL_MS) return false;
  }
  return true;
}

// -----------------------------------------------------------------------------
// Shared ingest core (Day-54 P1)
// -----------------------------------------------------------------------------

interface IngestOutcome {
  readonly upsertedCount: number;
  readonly stateChanges: ReadonlyArray<{
    pkg: AssetTrackingPackage;
    previous: AssetTrackingCacheRow | undefined;
  }>;
  readonly orphans: readonly AssetTrackingPackage[];
}

/**
 * Map a state to the SF `*_by` block that accompanies it. SORTED has
 * no known wire counterpart yet (the original doc pre-dates the
 * vendor-confirmed fifth state) — null until the first real sample.
 */
function scannedByFor(pkg: AssetTrackingPackage): unknown | null {
  switch (pkg.state) {
    case "COLLECTED":
      return pkg.collectedBy;
    case "EN_ROUTE":
      return pkg.enrouteBy;
    case "RECEIVED":
      return pkg.receivedBy;
    case "RETURNED":
      return pkg.returnedBy;
    case "SORTED":
      return null;
  }
}

/**
 * Per-record ingest shared by the read-through refresh and the
 * 30-minute poll: resolve the parent task, upsert the cache row,
 * detect state transitions, and append one scan-log line per observed
 * transition (first sighting included).
 *
 * Scan-log timestamp policy (Love's ruling, verbatim "if no timestamp
 * then put actual timestamp of receiving the data"): SF does not ship
 * scan timestamps yet, so `vendorScannedAt` is written NULL and
 * `receivedAt` carries the observation time. The display layer
 * prefers vendorScannedAt when it exists — activation checklist in
 * memory/followup_vendor_scanned_at_activation.md.
 */
async function ingestRecords(
  tenantId: Uuid,
  records: readonly AssetTrackingPackage[],
  previousByTrackingId: ReadonlyMap<string, AssetTrackingCacheRow>,
  source: AssetScanSource,
): Promise<IngestOutcome> {
  let upsertedCount = 0;
  const stateChanges: Array<{
    pkg: AssetTrackingPackage;
    previous: AssetTrackingCacheRow | undefined;
  }> = [];
  const orphans: AssetTrackingPackage[] = [];
  const scanEntries: AssetScanLogEntryInput[] = [];

  for (const pkg of records) {
    const internalTaskId = await withTenant(tenantId, async (tx) =>
      findTaskIdByExternalId(tx, tenantId, pkg.taskIdExternal),
    );
    if (internalTaskId === null) {
      orphans.push(pkg);
      continue;
    }

    const previous = previousByTrackingId.get(pkg.trackingId);

    await withTenant(tenantId, async (tx) =>
      upsertCacheRow(tx, tenantId, internalTaskId, pkg),
    );
    upsertedCount += 1;

    if (previous === undefined || previous.state !== pkg.state) {
      stateChanges.push({ pkg, previous });
      scanEntries.push({
        taskId: internalTaskId,
        trackingId: pkg.trackingId,
        awb: pkg.awb,
        state: pkg.state,
        vendorScannedAt: null,
        receivedAt: new Date().toISOString() as IsoTimestamp,
        scannedBy: scannedByFor(pkg),
        source,
        sfPayload: pkg,
      });
    }
  }

  if (scanEntries.length > 0) {
    await withTenant(tenantId, async (tx) =>
      insertScanLogEntries(tx, tenantId, scanEntries),
    );
  }

  return { upsertedCount, stateChanges, orphans };
}

// -----------------------------------------------------------------------------
// 30-minute poll (Day-54 P1 — Love's cadence ruling)
// -----------------------------------------------------------------------------

/**
 * One tenant's poll tick: sweep AWBs plausibly in motion in bounded
 * batch GETs, ingest into cache + scan log, emit system-actor audit
 * events. Called by the QStash-scheduled /api/cron/asset-tracking-poll
 * route for each tenant whose `task_asset_tracking_enabled` flag is
 * on — NO user permission gate (system path; the route authenticates
 * the schedule, the flag gates the tenant).
 */
export async function runAssetTrackingPoll(
  tenantId: Uuid,
): Promise<AssetTrackingPollSummary> {
  const awbs = await withTenant(tenantId, async (tx) =>
    findAwbsInMotion(tx, tenantId),
  );

  if (awbs.length === 0) {
    return {
      tenantId,
      awbsPolled: 0,
      chunks: 0,
      recordCount: 0,
      stateChanges: 0,
      orphansDropped: 0,
    };
  }
  if (awbs.length >= POLL_AWB_CAP) {
    // No silent caps: the repository LIMITs at POLL_AWB_CAP; hitting
    // it means in-motion AWBs beyond the cap were NOT swept this tick.
    log.warn({
      operation: "asset_tracking_poll",
      tenant_id: tenantId,
      awb_count: awbs.length,
      message: `poll AWB cap (${POLL_AWB_CAP}) reached — oldest in-motion AWBs skipped this tick`,
    });
  }

  const adapter = getSuiteFleetAdapter();
  const session = await adapter.authenticate(tenantId);

  let chunks = 0;
  let recordCount = 0;
  let stateChangeCount = 0;
  let orphanCount = 0;

  for (let i = 0; i < awbs.length; i += POLL_CHUNK_SIZE) {
    const chunk = awbs.slice(i, i + POLL_CHUNK_SIZE);
    const records = await adapter.fetchAssetTrackingByAwbs(session, chunk);
    chunks += 1;

    const existing: AssetTrackingCacheRow[] = [];
    for (const awb of chunk) {
      const rows = await withTenant(tenantId, async (tx) =>
        findCacheByAwb(tx, tenantId, awb),
      );
      existing.push(...rows);
    }
    const previousByTrackingId = new Map<string, AssetTrackingCacheRow>();
    for (const row of existing) {
      previousByTrackingId.set(row.trackingId, row);
    }

    const outcome = await ingestRecords(tenantId, records, previousByTrackingId, "poll");
    recordCount += outcome.upsertedCount;
    stateChangeCount += outcome.stateChanges.length;
    orphanCount += outcome.orphans.length;

    // One refreshed event per batch GET. metadata.awbs (plural) is the
    // poll-path variant of the read-through's single-awb metadata —
    // same event type, trigger_source distinguishes the paths.
    await emit({
      eventType: "asset_tracking.refreshed",
      actorKind: "system",
      actorId: POLL_ACTOR_ID,
      tenantId,
      resourceType: "asset_tracking",
      metadata: {
        awbs: chunk,
        record_count: outcome.upsertedCount,
        trigger_source: "poll",
      },
    });

    for (const change of outcome.stateChanges) {
      await emit({
        eventType: "asset_tracking.state_changed",
        actorKind: "system",
        actorId: POLL_ACTOR_ID,
        tenantId,
        resourceType: "asset_tracking",
        metadata: {
          tracking_id: change.pkg.trackingId,
          task_id_external: change.pkg.taskIdExternal,
          previous_state: change.previous?.state ?? null,
          new_state: change.pkg.state,
          trigger_source: "poll",
        },
      });
    }

    for (const pkg of outcome.orphans) {
      await emit({
        eventType: "asset_tracking.orphan_dropped",
        actorKind: "system",
        actorId: ORPHAN_DROP_ACTOR_ID,
        tenantId,
        resourceType: "asset_tracking",
        metadata: {
          tracking_id: pkg.trackingId,
          task_id_external: pkg.taskIdExternal,
          awb: pkg.awb,
        },
      });
    }
  }

  return {
    tenantId,
    awbsPolled: awbs.length,
    chunks,
    recordCount,
    stateChanges: stateChangeCount,
    orphansDropped: orphanCount,
  };
}

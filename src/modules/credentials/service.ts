// Credentials module service layer — Day 26 / per-merchant SF credentials lane.
//
// Four cross-tenant operations:
//   - createRegion       — Transcorp-staff creates a new SuiteFleet region row
//   - updateRegion       — Transcorp-staff edits a region's client_id /
//                          display_name (auth_method is IMMUTABLE)
//   - deactivateRegion   — Transcorp-staff flips status active → inactive
//                          (operational kill-switch per brief §3.7)
//   - storeSuitefleetCredentials — Transcorp-staff sets/rotates a merchant's
//                          per-tenant Vault credentials
//
// All four run inside withServiceRole because the suitefleet_regions
// table is Transcorp-global (RLS deny-by-default, no policies; see
// migration 0024) and per-tenant credential writes update the cross-
// tenant tenants row from a Transcorp-staff caller context where no
// session tenant_id is bound.
//
// Permission gates per brief §3.6 + ratified OQs:
//   region:manage   — createRegion / updateRegion / deactivateRegion
//   merchant:update — storeSuitefleetCredentials (reuses existing
//                     merchant edit perm per OQ-1)
//
// Audit events emitted (registered at src/modules/audit/event-types.ts):
//   region.created      — { region_id, client_id, display_name, auth_method }
//   region.updated      — { region_id, changes: { <field>: { before, after } } }
//   region.deactivated  — { region_id }
//   credentials.set     — { tenant_id, classifier } ONLY
//                         (no plaintext, no Vault UUIDs, no auth_method)

import { sql as sqlTag } from "drizzle-orm";
import { z } from "zod";

import { emit } from "../audit";
import { withServiceRole } from "../../shared/db";
import { isUniqueViolation } from "../../shared/db-errors";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors";
import type { Actor, RequestContext } from "../../shared/tenant-context";
import type { Uuid } from "../../shared/types";

import { requirePermission } from "../identity";

import { createVaultSecret, updateVaultSecret } from "./vault-store";

// -----------------------------------------------------------------------------
// Region surface
// -----------------------------------------------------------------------------

export type RegionAuthMethod = "oauth" | "api_key";
export type RegionStatus = "active" | "inactive";

export interface Region {
  readonly id: Uuid;
  readonly clientId: string;
  readonly displayName: string;
  readonly status: RegionStatus;
  readonly authMethod: RegionAuthMethod;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateRegionInput {
  readonly clientId: string;
  readonly displayName: string;
  readonly authMethod: RegionAuthMethod;
}

export interface CreateRegionResult {
  readonly status: "created";
  readonly regionId: Uuid;
}

export interface UpdateRegionInput {
  readonly clientId?: string;
  readonly displayName?: string;
  // auth_method is INTENTIONALLY absent — IMMUTABLE post-create.
  // The Zod schema below rejects any auth_method field on the input
  // payload at parse time as defense-in-depth.
}

export interface UpdateRegionResult {
  readonly status: "updated";
  readonly regionId: Uuid;
  readonly changedFields: readonly string[];
}

export interface DeactivateRegionResult {
  readonly status: "deactivated";
  readonly regionId: Uuid;
  readonly previousStatus: "active";
  readonly newStatus: "inactive";
}

// -----------------------------------------------------------------------------
// Credentials surface
// -----------------------------------------------------------------------------

export interface StoreCredentialsInput {
  /**
   * Auth-method-agnostic credential pair. Semantic interpretation lives
   * in the parent region's auth_method (oauth → username/password;
   * api_key → apiKey/secretKey). The caller (UI in Sub-PR 3) labels
   * its form fields per the region; this service stores generic.
   */
  readonly credential1: string;
  readonly credential2: string;
}

export type CredentialsClassifier = "initial-set" | "rotation";

export interface StoreCredentialsResult {
  readonly status: "stored";
  readonly tenantId: Uuid;
  readonly classifier: CredentialsClassifier;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function actorIdFor(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.system;
}

const CLIENT_ID_RE = /^[a-z][a-z0-9]*$/;

const createRegionInputSchema = z
  .object({
    clientId: z.string().regex(CLIENT_ID_RE, {
      message: "client_id must match ^[a-z][a-z0-9]*$",
    }),
    displayName: z.string().trim().min(1, { message: "display_name is required" }),
    authMethod: z.enum(["oauth", "api_key"]),
  })
  .strict();

// `.strict()` rejects unknown keys at parse time — defense-in-depth
// against an api-key-included `auth_method` field reaching the service.
// The IMMUTABLE constraint is enforced both here and at the persistence
// layer (the SQL UPDATE simply does not touch the auth_method column).
const updateRegionInputSchema = z
  .object({
    clientId: z
      .string()
      .regex(CLIENT_ID_RE, { message: "client_id must match ^[a-z][a-z0-9]*$" })
      .optional(),
    displayName: z
      .string()
      .trim()
      .min(1, { message: "display_name is required" })
      .optional(),
  })
  .strict();

const storeCredentialsInputSchema = z
  .object({
    credential1: z.string().min(1, { message: "credential_1 is required" }),
    credential2: z.string().min(1, { message: "credential_2 is required" }),
  })
  .strict();

interface RegionRow {
  readonly id: string;
  readonly client_id: string;
  readonly display_name: string;
  readonly status: string;
  readonly auth_method: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRegionRow(row: RegionRow): Region {
  return {
    id: row.id as Uuid,
    clientId: row.client_id,
    displayName: row.display_name,
    status: row.status as RegionStatus,
    authMethod: row.auth_method as RegionAuthMethod,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// -----------------------------------------------------------------------------
// createRegion
// -----------------------------------------------------------------------------

/**
 * Insert a new suitefleet_regions row. Lands in `status='active'`.
 * `auth_method` is MANDATORY and IMMUTABLE per v1.15 amendment §2.1.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `region:manage`.
 *   - ValidationError   malformed input (Zod parse fail).
 *   - ConflictError     client_id already exists (UNIQUE collision).
 */
export async function createRegion(
  ctx: RequestContext,
  input: CreateRegionInput,
): Promise<CreateRegionResult> {
  requirePermission(ctx, "region:manage");

  const parsed = createRegionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "invalid input");
  }
  const { clientId, displayName, authMethod } = parsed.data;

  let created: Region;
  try {
    created = await withServiceRole(
      "transcorp_staff:create_region",
      async (tx) => {
        const rows = await tx.execute<RegionRow & Record<string, unknown>>(sqlTag`
          INSERT INTO suitefleet_regions (client_id, display_name, auth_method)
          VALUES (${clientId}, ${displayName}, ${authMethod})
          RETURNING *
        `);
        const result = rows as unknown as ReadonlyArray<RegionRow>;
        if (result.length === 0) {
          throw new Error("createRegion: INSERT ... RETURNING produced zero rows");
        }
        return mapRegionRow(result[0]);
      },
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`SuiteFleet region client_id already exists: ${clientId}`);
    }
    throw err;
  }

  await emit({
    eventType: "region.created",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId: null,
    resourceType: "region",
    resourceId: created.id,
    metadata: {
      region_id: created.id,
      client_id: created.clientId,
      display_name: created.displayName,
      auth_method: created.authMethod,
    },
    requestId: ctx.requestId,
  });

  return { status: "created", regionId: created.id };
}

// -----------------------------------------------------------------------------
// updateRegion
// -----------------------------------------------------------------------------

/**
 * Update an existing suitefleet_regions row's `client_id` and/or
 * `display_name`. auth_method is IMMUTABLE — the Zod schema rejects
 * any auth_method field on the input via `.strict()`. status changes
 * are NOT in scope here; deactivateRegion is the dedicated surface.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `region:manage`.
 *   - ValidationError   malformed input, unknown key (incl. auth_method),
 *                       no fields to update, or no-op diff.
 *   - NotFoundError     region id not found.
 *   - ConflictError     client_id collision (UNIQUE).
 */
export async function updateRegion(
  ctx: RequestContext,
  regionId: Uuid,
  input: UpdateRegionInput,
): Promise<UpdateRegionResult> {
  requirePermission(ctx, "region:manage");

  const parsed = updateRegionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "invalid input");
  }
  if (parsed.data.clientId === undefined && parsed.data.displayName === undefined) {
    throw new ValidationError("no fields to update");
  }

  let changedFields: readonly string[] = [];
  let changes: Record<string, { before: unknown; after: unknown }> = {};

  await withServiceRole(`transcorp_staff:update_region ${regionId}`, async (tx) => {
    const beforeRows = await tx.execute<RegionRow & Record<string, unknown>>(sqlTag`
      SELECT * FROM suitefleet_regions WHERE id = ${regionId} FOR UPDATE
    `);
    const before = (beforeRows as unknown as ReadonlyArray<RegionRow>)[0];
    if (before === undefined) {
      throw new NotFoundError(`SuiteFleet region not found: ${regionId}`);
    }

    const diff: Record<string, { before: unknown; after: unknown }> = {};
    const fields: string[] = [];
    if (parsed.data.clientId !== undefined && parsed.data.clientId !== before.client_id) {
      diff.client_id = { before: before.client_id, after: parsed.data.clientId };
      fields.push("client_id");
    }
    if (
      parsed.data.displayName !== undefined &&
      parsed.data.displayName !== before.display_name
    ) {
      diff.display_name = { before: before.display_name, after: parsed.data.displayName };
      fields.push("display_name");
    }
    if (fields.length === 0) {
      throw new ValidationError("no changes");
    }
    changedFields = fields;
    changes = diff;

    try {
      await tx.execute(sqlTag`
        UPDATE suitefleet_regions
        SET
          client_id    = COALESCE(${parsed.data.clientId ?? null}, client_id),
          display_name = COALESCE(${parsed.data.displayName ?? null}, display_name),
          updated_at   = now()
        WHERE id = ${regionId}
      `);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(
          `SuiteFleet region client_id already exists: ${parsed.data.clientId}`,
        );
      }
      throw err;
    }
  });

  await emit({
    eventType: "region.updated",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId: null,
    resourceType: "region",
    resourceId: regionId,
    metadata: { region_id: regionId, changes },
    requestId: ctx.requestId,
  });

  return { status: "updated", regionId, changedFields };
}

// -----------------------------------------------------------------------------
// deactivateRegion
// -----------------------------------------------------------------------------

/**
 * Flip status active → inactive. PLAN-STRICT — ONLY active → inactive.
 * Does NOT cascade to tenants pointing at the region (operational
 * kill-switch per brief §3.7 — the resolver fail-closes when the
 * referenced region is inactive). Re-activation is not in v1 scope.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `region:manage`.
 *   - NotFoundError     region id not found.
 *   - ConflictError     region.status is not 'active'.
 */
export async function deactivateRegion(
  ctx: RequestContext,
  regionId: Uuid,
): Promise<DeactivateRegionResult> {
  requirePermission(ctx, "region:manage");

  await withServiceRole(`transcorp_staff:deactivate_region ${regionId}`, async (tx) => {
    const beforeRows = await tx.execute<RegionRow & Record<string, unknown>>(sqlTag`
      SELECT * FROM suitefleet_regions WHERE id = ${regionId} FOR UPDATE
    `);
    const before = (beforeRows as unknown as ReadonlyArray<RegionRow>)[0];
    if (before === undefined) {
      throw new NotFoundError(`SuiteFleet region not found: ${regionId}`);
    }
    if (before.status !== "active") {
      throw new ConflictError(
        `SuiteFleet region must be 'active' to deactivate; current status is '${before.status}'`,
      );
    }
    await tx.execute(sqlTag`
      UPDATE suitefleet_regions
      SET status = 'inactive',
          updated_at = now()
      WHERE id = ${regionId}
    `);
  });

  await emit({
    eventType: "region.deactivated",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId: null,
    resourceType: "region",
    resourceId: regionId,
    metadata: { region_id: regionId },
    requestId: ctx.requestId,
  });

  return {
    status: "deactivated",
    regionId,
    previousStatus: "active",
    newStatus: "inactive",
  };
}

// -----------------------------------------------------------------------------
// storeSuitefleetCredentials
// -----------------------------------------------------------------------------

interface TenantVaultRow {
  readonly suitefleet_credential_1_vault_id: string | null;
  readonly suitefleet_credential_2_vault_id: string | null;
}

/**
 * Set or rotate a merchant tenant's per-tenant SuiteFleet credentials.
 *
 * Initial-set: both Vault UUIDs are NULL → createVaultSecret for both,
 * store the new UUIDs on the tenant row, emit classifier='initial-set'.
 *
 * Rotation: both Vault UUIDs present → updateVaultSecret on both
 * existing UUIDs (preserves the UUIDs themselves), emit
 * classifier='rotation'.
 *
 * Mixed-state (one UUID set, the other NULL) is rejected with
 * ConflictError — the schema invariant is "both populated or both
 * NULL"; an operational anomaly should surface rather than silently
 * pick a path.
 *
 * BOTH paths call `invalidateSession(tenantId)` on the LastMile
 * adapter per ratified OQ-5 — initial-set defensively in case a stale
 * negative-cache session from a prior failed push exists; rotation
 * because the prior credentials are about to be invalidated SF-side.
 *
 * The plaintext NEVER reaches the audit body, NEVER logs (Vault
 * primitives don't log values), and NEVER returns to the UI (the
 * service result echoes only the classifier).
 *
 * Throws:
 *   - ForbiddenError    actor lacks `merchant:update`.
 *   - ValidationError   malformed input (Zod parse fail).
 *   - NotFoundError     tenant id not found.
 *   - ConflictError     mixed-state vault columns (only one UUID set).
 */
export async function storeSuitefleetCredentials(
  ctx: RequestContext,
  tenantId: Uuid,
  input: StoreCredentialsInput,
  invalidateSession: (tenantId: Uuid) => void,
): Promise<StoreCredentialsResult> {
  requirePermission(ctx, "merchant:update");

  const parsed = storeCredentialsInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "invalid input");
  }

  // Read the tenant's current Vault UUIDs OUTSIDE any tx so Vault
  // mutations (which run in their own withServiceRole blocks) don't
  // sit inside a long-running outer tx. The race window between
  // read-state and write-decision is acceptable because:
  //   - The schema invariant is "both columns NULL or both populated";
  //     no concurrent operator can flip one column independently
  //     (storeSuitefleetCredentials is the only writer).
  //   - In practice the operator-driven flow is sequential.
  const stateRows = await withServiceRole(
    `transcorp_staff:read_tenant_vault_ids ${tenantId}`,
    async (tx) => {
      const rows = await tx.execute<TenantVaultRow & Record<string, unknown>>(sqlTag`
        SELECT
          suitefleet_credential_1_vault_id,
          suitefleet_credential_2_vault_id
        FROM tenants
        WHERE id = ${tenantId}
        LIMIT 1
      `);
      return rows as unknown as ReadonlyArray<TenantVaultRow>;
    },
  );
  if (stateRows.length === 0) {
    throw new NotFoundError(`tenant not found: ${tenantId}`);
  }
  const state = stateRows[0];
  const v1 = state.suitefleet_credential_1_vault_id;
  const v2 = state.suitefleet_credential_2_vault_id;

  const bothNull = v1 === null && v2 === null;
  const bothSet = v1 !== null && v2 !== null;

  let classifier: CredentialsClassifier;
  if (bothNull) {
    classifier = "initial-set";
    const newId1 = await createVaultSecret(parsed.data.credential1);
    const newId2 = await createVaultSecret(parsed.data.credential2);
    await withServiceRole(
      `transcorp_staff:bind_tenant_vault_ids ${tenantId}`,
      async (tx) => {
        await tx.execute(sqlTag`
          UPDATE tenants
          SET suitefleet_credential_1_vault_id = ${newId1}::uuid,
              suitefleet_credential_2_vault_id = ${newId2}::uuid,
              updated_at = now()
          WHERE id = ${tenantId}
        `);
      },
    );
  } else if (bothSet) {
    classifier = "rotation";
    await updateVaultSecret(v1, parsed.data.credential1);
    await updateVaultSecret(v2, parsed.data.credential2);
  } else {
    throw new ConflictError(
      `tenant ${tenantId} has mixed-state SuiteFleet credentials (one Vault UUID set, the other NULL) — investigate before retry`,
    );
  }

  invalidateSession(tenantId);

  await emit({
    eventType: "credentials.set",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId: null,
    resourceType: "credentials",
    resourceId: tenantId,
    metadata: { tenant_id: tenantId, classifier },
    requestId: ctx.requestId,
  });

  return { status: "stored", tenantId, classifier };
}

// =============================================================================
// Read-side surface — Day 26 / T3 Sub-PR 3 (admin UI)
// =============================================================================
//
// The /admin/regions list/[id]/new pages + the /admin/merchants/[id]/edit
// region picker + the merchant detail page's credentials badge all need
// read-side queries against `suitefleet_regions`. None of those reads
// mutate state or touch Vault plaintext.
//
// Permission posture: the four region-admin reads (listRegions /
// listRegionsWithUsage / findRegionById / findRegionByIdWithUsage) all
// gate on `region:manage`. The `findRegionForMerchant` read gates on
// `merchant:read_all` (the broadest legitimate need for a region-
// metadata read in a merchant-facing context — the merchant detail
// page consumes this to render the auth_method row, and the edit
// form's pre-fill consumes this to render the picker's current value).
// The `loadCredentialsPageState` read gates on `merchant:update`
// (it's the same gate that the action layer enforces).

export interface RegionWithUsage extends Region {
  /** Count of `tenants` rows pointing at this region. */
  readonly inUseCount: number;
}

export interface ListRegionsFilters {
  /** Only return regions in `status='active'` when true. Default: all. */
  readonly onlyActive?: boolean;
}

interface RegionUsageRow extends RegionRow {
  readonly in_use_count: number | string;
}

function mapUsageRow(row: RegionUsageRow): RegionWithUsage {
  return {
    ...mapRegionRow(row),
    inUseCount: typeof row.in_use_count === "string"
      ? Number.parseInt(row.in_use_count, 10)
      : row.in_use_count,
  };
}

/**
 * SELECT every region, ordered alphabetically by display_name ASC
 * (OQ-7 ratified static-sort). `onlyActive` filter trims to
 * `status='active'` — used by the edit-form region picker (operators
 * shouldn't be able to select an inactive region for a merchant).
 *
 * Gate: `region:manage`. transcorp-sysadmin (the only role carrying it
 * in v1) also has `merchant:update`, so the picker call from the edit
 * form's parent server component succeeds.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `region:manage`.
 */
export async function listRegions(
  ctx: RequestContext,
  filters: ListRegionsFilters = {},
): Promise<readonly Region[]> {
  requirePermission(ctx, "region:manage");

  const onlyActiveFragment = filters.onlyActive
    ? sqlTag`WHERE status = 'active'`
    : sqlTag``;

  return withServiceRole("transcorp_staff:list_regions", async (tx) => {
    const rows = await tx.execute<RegionRow & Record<string, unknown>>(sqlTag`
      SELECT *
      FROM suitefleet_regions
      ${onlyActiveFragment}
      ORDER BY display_name ASC
    `);
    return (rows as unknown as ReadonlyArray<RegionRow>).map(mapRegionRow);
  });
}

/**
 * SELECT every region with its in-use count (COUNT of tenants pointing
 * at the region). Ordered alphabetically by display_name ASC per
 * ratified OQ-7. Powers the /admin/regions list view.
 *
 * The LEFT JOIN ensures rows with zero tenants surface with
 * in_use_count = 0 rather than dropping out.
 *
 * Gate: `region:manage`.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `region:manage`.
 */
export async function listRegionsWithUsage(
  ctx: RequestContext,
): Promise<readonly RegionWithUsage[]> {
  requirePermission(ctx, "region:manage");

  return withServiceRole("transcorp_staff:list_regions_usage", async (tx) => {
    const rows = await tx.execute<RegionUsageRow & Record<string, unknown>>(sqlTag`
      SELECT
        r.*,
        COUNT(t.id) AS in_use_count
      FROM suitefleet_regions r
      LEFT JOIN tenants t ON t.suitefleet_region_id = r.id
      GROUP BY r.id
      ORDER BY r.display_name ASC
    `);
    return (rows as unknown as ReadonlyArray<RegionUsageRow>).map(mapUsageRow);
  });
}

/**
 * SELECT one region by id. Returns null when not found. Used by the
 * /admin/regions/[id] detail page in conjunction with the in-use count.
 *
 * Gate: `region:manage`.
 */
export async function findRegionByIdWithUsage(
  ctx: RequestContext,
  regionId: Uuid,
): Promise<RegionWithUsage | null> {
  requirePermission(ctx, "region:manage");

  return withServiceRole(
    `transcorp_staff:find_region_usage ${regionId}`,
    async (tx) => {
      const rows = await tx.execute<RegionUsageRow & Record<string, unknown>>(sqlTag`
        SELECT
          r.*,
          COUNT(t.id) AS in_use_count
        FROM suitefleet_regions r
        LEFT JOIN tenants t ON t.suitefleet_region_id = r.id
        WHERE r.id = ${regionId}
        GROUP BY r.id
      `);
      const result = rows as unknown as ReadonlyArray<RegionUsageRow>;
      return result[0] ? mapUsageRow(result[0]) : null;
    },
  );
}

/**
 * SELECT one region's display-only metadata by id. Distinct from
 * `findRegionByIdWithUsage` in two ways:
 *   1. Gate is `merchant:read_all` — the read fires from merchant-
 *      facing pages (detail + edit + credentials) that need region
 *      metadata for display, not for region-admin operations.
 *   2. No usage count — pure region row, no JOIN.
 *
 * Returns null when not found.
 */
export async function findRegionForMerchant(
  ctx: RequestContext,
  regionId: Uuid,
): Promise<Region | null> {
  requirePermission(ctx, "merchant:read_all");

  return withServiceRole(
    `transcorp_staff:find_region_for_merchant ${regionId}`,
    async (tx) => {
      const rows = await tx.execute<RegionRow & Record<string, unknown>>(sqlTag`
        SELECT * FROM suitefleet_regions WHERE id = ${regionId}
      `);
      const result = rows as unknown as ReadonlyArray<RegionRow>;
      return result[0] ? mapRegionRow(result[0]) : null;
    },
  );
}

export interface CredentialsPageState {
  /** Tenant id (echoed for caller convenience). */
  readonly tenantId: Uuid;
  /** Display name for the credentials page heading. */
  readonly merchantName: string;
  /** Region row the tenant's `suitefleet_region_id` points at. */
  readonly region: Region;
  /**
   * Whether both Vault UUIDs are present on the tenant row.
   * Drives the SET vs ROTATE submit-button label + modal copy.
   */
  readonly hasCredentials: boolean;
}

/**
 * Load the state needed to render `/admin/merchants/[id]/credentials`.
 * One SQL trip: JOINs tenants + suitefleet_regions; reads only what
 * the page renders (no Vault `decrypted_secret` — that would defeat
 * the write-only-by-design posture per brief §3.7 + plan §8.2).
 *
 * Gate: `merchant:update` (mirrors the storeSuitefleetCredentials
 * action gate so the page and the action enforce the same envelope).
 *
 * Throws:
 *   - ForbiddenError    actor lacks `merchant:update`.
 *   - NotFoundError     tenant id not found.
 */
export async function loadCredentialsPageState(
  ctx: RequestContext,
  tenantId: Uuid,
): Promise<CredentialsPageState> {
  requirePermission(ctx, "merchant:update");

  const row = await withServiceRole(
    `transcorp_staff:load_credentials_page_state ${tenantId}`,
    async (tx) => {
      type JoinedRow = {
        merchant_name: string;
        has_credential_1: boolean;
        has_credential_2: boolean;
        region_id: string;
        region_client_id: string;
        region_display_name: string;
        region_status: string;
        region_auth_method: string;
        region_created_at: Date | string;
        region_updated_at: Date | string;
      } & Record<string, unknown>;
      const rows = await tx.execute<JoinedRow>(sqlTag`
        SELECT
          t.name AS merchant_name,
          (t.suitefleet_credential_1_vault_id IS NOT NULL) AS has_credential_1,
          (t.suitefleet_credential_2_vault_id IS NOT NULL) AS has_credential_2,
          r.id           AS region_id,
          r.client_id    AS region_client_id,
          r.display_name AS region_display_name,
          r.status       AS region_status,
          r.auth_method  AS region_auth_method,
          r.created_at   AS region_created_at,
          r.updated_at   AS region_updated_at
        FROM tenants t
        JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
        WHERE t.id = ${tenantId}
        LIMIT 1
      `);
      const result = rows as unknown as ReadonlyArray<JoinedRow>;
      return result[0] ?? null;
    },
  );

  if (row === null) {
    throw new NotFoundError(`tenant not found: ${tenantId}`);
  }

  return {
    tenantId,
    merchantName: row.merchant_name,
    region: {
      id: row.region_id as Uuid,
      clientId: row.region_client_id,
      displayName: row.region_display_name,
      status: row.region_status as RegionStatus,
      authMethod: row.region_auth_method as RegionAuthMethod,
      createdAt: toIso(row.region_created_at),
      updatedAt: toIso(row.region_updated_at),
    },
    hasCredentials: row.has_credential_1 && row.has_credential_2,
  };
}

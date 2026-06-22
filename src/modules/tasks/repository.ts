// Task repository — Drizzle queries against `tasks` (0006) +
// `task_packages` (0007).
//
// "Repository" here is the data-access layer per Day-5 brief §6.1 T-2:
// "types + repository — Drizzle queries, no business logic." Every
// function takes a `tx: DbTx` (from the caller's `withTenant` /
// `withServiceRole` block), runs one or two statements, and maps rows
// to the camelCase domain shape. No permission checks, no audit emits,
// no validation beyond null-vs-undefined handling — those belong in
// the T-3 service layer.
//
// RLS is the primary defence. Every callsite runs inside a
// `withTenant(tenantId, …)` block, so the
// `app.current_tenant_id`-keyed RLS policy on `tasks` and
// `task_packages` filters reads, blocks cross-tenant updates/deletes,
// and rejects inserts whose `tenant_id` doesn't match the session
// value via WITH CHECK (defensive form — see 0001_identity.sql header).
//
// Defence in depth: every write path AND every list/lookup that takes
// a `tenantId` carries an explicit `AND tenant_id = ${tenantId}`
// predicate alongside RLS. Same value, same result, but the WHERE
// clause is self-describing in pg_stat / EXPLAIN. `findTaskById` is
// the lone exception — read by id has no blast radius beyond what RLS
// hides, and adding a parameter would complicate every caller.
//
// Schema-layer belt for task_packages: 0007's
// `task_packages_assert_tenant_match` trigger asserts
// `task_packages.tenant_id = parent tasks.tenant_id` on every INSERT
// or UPDATE. This repository feeds the trigger the same `tenantId`
// value for both rows so the trigger never fires in production. The
// trigger exists to catch the BYPASSRLS leak vector (a buggy
// withServiceRole caller); it is invisible to well-behaved callers.
//
// Multi-package inserts use a single multi-row INSERT … VALUES so the
// parent task INSERT and the children packages INSERT are two
// statements total regardless of package count. Pilot-scope tasks
// have a small number of packages (typically 1–3) so even N+1 inserts
// would be acceptable; the multi-row VALUES form is just simpler to
// audit in pg_stat.
//
// Reads return fully-hydrated tasks (parent + packages) using a
// correlated subquery + `json_agg` so a `findTaskById` is one
// round-trip and a `listTasksByTenant` is one round-trip total. The
// JSON aggregate is `ORDER BY position ASC` so the package array
// arrives sorted; the mapper does not re-sort.

import { sql as sqlTag, type SQL } from "drizzle-orm";

import type { CourierStatus } from "@/modules/integration";
import type { DbTx } from "@/shared/db";
import type { Uuid } from "@/shared/types";

import { buildGenuineTenantsFilter } from "../merchants/genuine-merchants";
import type { TenantStatus } from "../merchants/types";

import type {
  CreateTaskInput,
  CreateTaskPackageInput,
  Task,
  TaskCreationSource,
  TaskInternalStatus,
  TaskKind,
  TaskListRow,
  TaskOutboundSyncState,
  TaskPackage,
  TaskPackageStatus,
  UpdateTaskPatch,
} from "./types";

// -----------------------------------------------------------------------------
// Row shapes and mappers
// -----------------------------------------------------------------------------
// Drizzle's tx.execute<T> constrains T to Record<string, unknown>;
// the `& Record<string, unknown>` intersection satisfies that without
// polluting the caller-visible Task / TaskPackage shapes.
//
// timestamptz / date / time / numeric handling — postgres-js returns
// shapes that depend on connection configuration:
//   - timestamptz: Date instance OR ISO string (preview pooler
//     returns strings; CI Postgres returns Date instances).
//     Coerced via `toIso` which handles both.
//   - date: string ('YYYY-MM-DD').
//   - time: string ('HH:MM:SS' or 'HH:MM:SS.SSSSSS').
//   - numeric: string (precision-preserving).
// The Task / TaskPackage types reflect the wire shape directly: dates
// and times stay as strings; numerics stay as strings; timestamps
// arrive normalised to ISO.

type TaskRow = {
  id: string;
  tenant_id: string;
  consignee_id: string;
  subscription_id: string | null;
  created_via: TaskCreationSource;
  customer_order_number: string;
  reference_number: string | null;
  internal_status: TaskInternalStatus;
  /**
   * Phase 8 (migration 0035) — fine SuiteFleet courier status; nullable
   * text. Projected by `SELECT t.*`. Mapper narrows the string to
   * `CourierStatus | null` (unknown / NULL → null). The coarse
   * `internal_status` is unchanged.
   */
  courier_status: string | null;
  external_id: string | null;
  external_tracking_number: string | null;
  delivery_date: Date | string;
  delivery_start_time: string;
  delivery_end_time: string;
  delivery_type: string;
  task_kind: TaskKind;
  payment_method: string | null;
  cod_amount: string | null;
  declared_value: string | null;
  weight_kg: string | null;
  notes: string | null;
  signature_required: boolean;
  sms_notifications: boolean;
  deliver_to_customer_only: boolean;
  pushed_to_external_at: Date | string | null;
  address_id: string | null;
  pod_photos: unknown;
  /**
   * Day-29 §D(2) Phase-1 (plan-PR #302 §6.3): outbound sync lifecycle
   * marker. NOT NULL DEFAULT 'synced' per migration 0026; mapper
   * narrows the string to TaskOutboundSyncState.
   */
  outbound_sync_state: string;
  /**
   * Day-20 §3.3.3 calendar JOIN projection — populated only when the
   * caller's SELECT projects `addresses.label` via a LEFT JOIN. Most
   * read paths leave this absent (default null at the mapper).
   */
  address_label?: string | null;
  created_at: Date | string;
  updated_at: Date | string;
} & Record<string, unknown>;

type TaskRowWithPackages = TaskRow & {
  packages: readonly TaskPackageRowFromJson[];
};

type TaskPackageRow = {
  id: string;
  task_id: string;
  tenant_id: string;
  external_package_id: string | null;
  tracking_id: string | null;
  package_status: TaskPackageStatus;
  position: number;
  created_at: Date | string;
  updated_at: Date | string;
} & Record<string, unknown>;

/**
 * Shape of one element inside the JSON-aggregated `packages` column.
 * `json_agg(tp.*)` serialises every column as JSON; timestamps come
 * back as ISO strings (json_agg uses Postgres's default timestamptz
 * → JSON text representation, which is ISO 8601). The position field
 * arrives as a number (json_agg preserves Postgres integer typing).
 */
type TaskPackageRowFromJson = {
  id: string;
  task_id: string;
  tenant_id: string;
  external_package_id: string | null;
  tracking_id: string | null;
  package_status: TaskPackageStatus;
  position: number;
  created_at: string;
  updated_at: string;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function toDateString(value: Date | string): string {
  // Date columns may arrive as Date (with midnight UTC) or string. The
  // canonical wire shape is YYYY-MM-DD; toIsoString().slice(0, 10)
  // covers the Date case, and a string already in YYYY-MM-DD form
  // passes through unchanged.
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  // postgres-js may return a date as a longer string with time component
  // depending on driver configuration; defensively slice if needed.
  return value.length > 10 ? value.slice(0, 10) : value;
}

function mapPackageFromRow(row: TaskPackageRow): TaskPackage {
  return {
    id: row.id,
    taskId: row.task_id,
    tenantId: row.tenant_id,
    externalPackageId: row.external_package_id,
    trackingId: row.tracking_id,
    packageStatus: row.package_status,
    position: row.position,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapPackageFromJson(row: TaskPackageRowFromJson): TaskPackage {
  return {
    id: row.id,
    taskId: row.task_id,
    tenantId: row.tenant_id,
    externalPackageId: row.external_package_id,
    trackingId: row.tracking_id,
    packageStatus: row.package_status,
    position: row.position,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapTask(row: TaskRow, packages: readonly TaskPackage[]): Task {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    consigneeId: row.consignee_id,
    subscriptionId: row.subscription_id,
    createdVia: row.created_via,
    customerOrderNumber: row.customer_order_number,
    referenceNumber: row.reference_number,
    internalStatus: row.internal_status,
    courierStatus: mapCourierStatus(row.courier_status),
    externalId: row.external_id,
    externalTrackingNumber: row.external_tracking_number,
    deliveryDate: toDateString(row.delivery_date),
    deliveryStartTime: row.delivery_start_time,
    deliveryEndTime: row.delivery_end_time,
    deliveryType: row.delivery_type,
    taskKind: row.task_kind,
    paymentMethod: row.payment_method,
    codAmount: row.cod_amount,
    declaredValue: row.declared_value,
    weightKg: row.weight_kg,
    notes: row.notes,
    signatureRequired: row.signature_required,
    smsNotifications: row.sms_notifications,
    deliverToCustomerOnly: row.deliver_to_customer_only,
    pushedToExternalAt: toIsoOrNull(row.pushed_to_external_at),
    addressId: row.address_id,
    podPhotos: mapPodPhotos(row.pod_photos),
    addressLabel: mapAddressLabel(row.address_label),
    outboundSyncState: mapOutboundSyncState(row.outbound_sync_state),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    packages,
  };
}

/**
 * Day-20 §3.3.3 calendar — addresses.label is constrained to
 * ('home', 'office', 'other') by the 0014 migration's CHECK. Defensive
 * narrow at the mapper boundary: anything outside the allowlist
 * (including undefined when the caller didn't JOIN addresses) collapses
 * to null. Calendar consumers render null as no-indicator.
 */
function mapAddressLabel(value: unknown): "home" | "office" | "other" | null {
  if (value === "home" || value === "office" || value === "other") return value;
  return null;
}

/**
 * Day-29 §D(2) Phase-1 — narrow tasks.outbound_sync_state (string at
 * the wire) to the TaskOutboundSyncState union at the boundary.
 *
 * Defensive: unknown values collapse to 'pending' post-Day-33 PR-C —
 * 0028 changed the column DEFAULT from 'synced' to 'pending', so the
 * read-side fallback follows the new safest default. The only path to
 * an unknown value is schema drift (a future CHECK enum extension that
 * code-side hasn't picked up); 'pending' surfaces such rows as
 * needs-push-or-triage rather than as silently-synced.
 */
function mapOutboundSyncState(value: unknown): TaskOutboundSyncState {
  if (
    value === "pending" ||
    value === "synced" ||
    value === "pending_cancel" ||
    value === "pending_reschedule" ||
    value === "failed"
  ) {
    return value;
  }
  return "pending";
}

/**
 * The 14 fine courier states, typed against `CourierStatus` so a typo is
 * a compile error. Mirrors `COURIER_STATUS_VALUES` in
 * integration/types.ts (the mapper + migration's source of truth); kept
 * inline here — exactly like `mapOutboundSyncState`'s value list — so the
 * data layer takes `CourierStatus` type-only and never pulls the
 * integration barrel (and its provider/db module-load side effects) into
 * a plain row-mapper.
 */
const COURIER_STATUSES: ReadonlySet<CourierStatus> = new Set([
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
]);

/**
 * Phase 8 (brief §3.1.10, v1.31) — narrow the fine `tasks.courier_status`
 * column (string-or-NULL at the wire) to `CourierStatus | null` at the
 * boundary. Defensive, mirroring `mapOutboundSyncState`: NULL, undefined
 * (column absent from a non-`t.*` SELECT), or any value outside the 14
 * known states collapses to null — a pre-backfill row, a Planner-only
 * state with no SF courier detail, or a future CHECK extension code-side
 * hasn't picked up. Render falls back to the coarse `internalStatus` map
 * when this is null. The DB CHECK (migration 0035) is the primary guard;
 * this narrow is belt-and-braces against schema drift.
 */
function mapCourierStatus(value: unknown): CourierStatus | null {
  return typeof value === "string" && (COURIER_STATUSES as ReadonlySet<string>).has(value)
    ? (value as CourierStatus)
    : null;
}

/**
 * Coerce the jsonb `pod_photos` value to the read-side contract:
 *   NULL                       → null
 *   non-array                  → null (defensive; wire pollution)
 *   array of strings           → readonly string[]
 *   array with non-strings     → drop non-strings, keep strings
 *   array empty after filter   → null (treated as no POD, matching
 *                                  reviewer ruling that empty arrays
 *                                  surface as muted/no-trigger)
 *
 * postgres-js auto-parses jsonb columns, so the wire shape arrives as
 * either `null` or `unknown[]`. Filtering (not coercing) preserves the
 * Option (A) plain-string-array contract per A2 plan §4.4 — non-string
 * entries are dropped rather than stringified into broken <img> URLs.
 */
function mapPodPhotos(value: unknown): readonly string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const strings = value.filter((v): v is string => typeof v === "string");
  return strings.length === 0 ? null : strings;
}

function mapTaskWithPackages(row: TaskRowWithPackages): Task {
  const packages = (row.packages ?? []).map(mapPackageFromJson);
  return mapTask(row, packages);
}

/**
 * Day-53 R6-part-1 — the `/tasks` list-row wire shape. `TaskRowWithPackages`
 * plus the consignee-context columns the list SELECT projects (see
 * `listTasksByTenant`). `effective_*` are already COALESCE-resolved in SQL
 * (override address, else the consignee's own); the mapper just narrows.
 * Every column is nullable (LEFT JOINs + fall-through legacy rows).
 */
type TaskRowWithConsignee = TaskRowWithPackages & {
  consignee_name: string | null;
  consignee_phone: string | null;
  effective_address_line: string | null;
  effective_district: string | null;
  effective_emirate: string | null;
};

function mapTaskListRow(row: TaskRowWithConsignee): TaskListRow {
  return {
    ...mapTaskWithPackages(row),
    consigneeName: row.consignee_name ?? null,
    consigneePhone: row.consignee_phone ?? null,
    effectiveAddressLine: row.effective_address_line ?? null,
    effectiveDistrict: row.effective_district ?? null,
    effectiveEmirate: row.effective_emirate ?? null,
  };
}

// -----------------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------------

/**
 * INSERT one task and its packages atomically. The caller's
 * `withTenant` transaction provides the atomic boundary; if the
 * package INSERT fails (e.g., the tenant-match trigger fires), the
 * task INSERT rolls back too.
 *
 * Two statements total regardless of package count. Empty `packages`
 * skips the second statement and returns the task with `packages: []`.
 */
export async function insertTaskWithPackages(
  tx: DbTx,
  tenantId: Uuid,
  input: CreateTaskInput
): Promise<Task> {
  const taskRows = await tx.execute<TaskRow>(sqlTag`
    INSERT INTO tasks (
      tenant_id,
      consignee_id,
      subscription_id,
      address_id,
      created_via,
      customer_order_number,
      reference_number,
      internal_status,
      delivery_date,
      delivery_start_time,
      delivery_end_time,
      delivery_type,
      task_kind,
      payment_method,
      cod_amount,
      declared_value,
      weight_kg,
      notes,
      signature_required,
      sms_notifications,
      deliver_to_customer_only
    ) VALUES (
      ${tenantId},
      ${input.consigneeId},
      ${input.subscriptionId ?? null},
      ${input.addressId ?? null},
      ${input.createdVia ?? "subscription"},
      ${input.customerOrderNumber},
      ${input.referenceNumber ?? null},
      ${input.internalStatus ?? "CREATED"},
      ${input.deliveryDate},
      ${input.deliveryStartTime},
      ${input.deliveryEndTime},
      ${input.deliveryType ?? "STANDARD"},
      ${input.taskKind ?? "DELIVERY"},
      ${input.paymentMethod ?? null},
      ${input.codAmount ?? null},
      ${input.declaredValue ?? null},
      ${input.weightKg ?? null},
      ${input.notes ?? null},
      ${input.signatureRequired ?? false},
      ${input.smsNotifications ?? false},
      ${input.deliverToCustomerOnly ?? false}
    )
    RETURNING *
  `);

  if (taskRows.length === 0) {
    // INSERT … RETURNING never returns zero rows on success; if it
    // does, something is very wrong (RLS WITH CHECK shouldn't suppress
    // RETURNING — it raises an error instead). Throw rather than
    // returning a synthetic value so the caller sees the anomaly.
    throw new Error("insertTaskWithPackages: INSERT … RETURNING produced zero rows for task");
  }
  const taskRow = taskRows[0];

  if (input.packages.length === 0) {
    return mapTask(taskRow, []);
  }

  const packageValues = input.packages.map(
    (pkg: CreateTaskPackageInput) => sqlTag`(
      ${taskRow.id},
      ${tenantId},
      ${pkg.position},
      ${pkg.packageStatus ?? "ORDERED"}
    )`
  );
  const valuesClause = sqlTag.join(packageValues, sqlTag`, `);

  const packageRows = await tx.execute<TaskPackageRow>(sqlTag`
    INSERT INTO task_packages (
      task_id,
      tenant_id,
      position,
      package_status
    ) VALUES ${valuesClause}
    RETURNING *
  `);

  const packages = packageRows
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(mapPackageFromRow);

  return mapTask(taskRow, packages);
}

/**
 * SELECT one task by id with its packages joined. Returns null if the
 * row does not exist OR is hidden by RLS (indistinguishable, which is
 * the correct default-deny posture).
 *
 * Packages arrive ordered by position ASC via the json_agg ORDER BY.
 */
export async function findTaskById(tx: DbTx, id: Uuid): Promise<Task | null> {
  const rows = await tx.execute<TaskRowWithPackages>(sqlTag`
    SELECT
      t.*,
      COALESCE(
        (
          SELECT json_agg(tp.* ORDER BY tp.position ASC)
          FROM task_packages tp
          WHERE tp.task_id = t.id
        ),
        '[]'::json
      ) AS packages
    FROM tasks t
    WHERE t.id = ${id}
  `);
  return rows[0] ? mapTaskWithPackages(rows[0]) : null;
}

/**
 * Day 8 / D8-6 — visibility filter for the label-print route.
 *
 * Returns the subset of `ids` that exist AND belong to `tenantId`.
 * Cross-tenant IDs (and bogus / non-existent UUIDs) drop silently —
 * the route handler must NOT 404 / 403 on a partial match (that
 * would leak cross-tenant existence; an attacker submitting a list
 * of UUIDs could probe for which ones live in some other tenant by
 * watching error vs. success responses).
 *
 * Order is NOT preserved relative to the input — Postgres `= ANY($1)`
 * doesn't guarantee row order. The caller must not depend on input
 * ordering being preserved (the PDF page order from SF for a
 * comma-separated taskId list is a separate concern handled inside
 * the SF endpoint; this filter only concerns "which IDs survive
 * the visibility check").
 *
 * Empty input returns []; the caller should bail before calling SF.
 */
export async function listVisibleTaskIds(
  tx: DbTx,
  tenantId: Uuid,
  ids: readonly Uuid[],
): Promise<readonly Uuid[]> {
  if (ids.length === 0) return [];
  type Row = { id: string } & Record<string, unknown>;
  // Pattern E per src/shared/sql-helpers.ts — manual array literal.
  // drizzle-orm 0.45.2 + postgres-js splats `${jsArr}` into a record
  // ($1, $2, ..., $n) which cannot be cast to uuid[]. Constructing the
  // Postgres array literal `{a,b,c}` server-side as a single string
  // parameter avoids the splat. Safe for uuid[] (alphanumeric +
  // hyphens only — no escaping required); see sql-helpers.ts for the
  // type-restriction contract.
  const rows = await tx.execute<Row>(sqlTag`
    SELECT id FROM tasks
    WHERE id = ANY(${'{' + ids.join(',') + '}'}::uuid[])
      AND tenant_id = ${tenantId}
  `);
  return rows.map((r) => r.id);
}

/**
 * Variant of listVisibleTaskIds that returns the (id, external_id,
 * pushed_to_external_at) triple per visible row. Powers
 * printLabelsForTasks's Day-17 Planner-UUID → SF-external-id translation
 * (`memory/followup_planner_uuid_to_sf_external_id_translation.md`).
 *
 * SF's `/generate-label` endpoint requires SF's own task UUID
 * (`tasks.external_id`); Planner UUIDs trigger 502 from SF's gateway.
 * The service layer fetches both columns, partitions the result into
 * eligible (both columns non-null) vs skipped (either null), and only
 * passes external_ids of eligible rows to the SF adapter.
 *
 * Same Pattern E array-binding convention as listVisibleTaskIds; same
 * RLS + explicit-tenant defence-in-depth.
 *
 * Empty input returns []; the caller should bail before calling SF.
 */
export async function listVisibleTaskExternalIds(
  tx: DbTx,
  tenantId: Uuid,
  ids: readonly Uuid[],
): Promise<readonly { id: string; externalId: string | null; pushedToExternalAt: string | null }[]> {
  if (ids.length === 0) return [];
  type Row = {
    id: string;
    external_id: string | null;
    pushed_to_external_at: Date | string | null;
  } & Record<string, unknown>;
  const rows = await tx.execute<Row>(sqlTag`
    SELECT id, external_id, pushed_to_external_at
    FROM tasks
    WHERE id = ANY(${'{' + ids.join(',') + '}'}::uuid[])
      AND tenant_id = ${tenantId}
  `);
  return rows.map((r) => ({
    id: r.id,
    externalId: r.external_id,
    pushedToExternalAt: toIsoOrNull(r.pushed_to_external_at),
  }));
}

/**
 * SELECT tasks for `tenantId`, newest first, each with its packages
 * joined. The tenant filter is explicit alongside RLS — same value,
 * same result, but the WHERE clause makes the query self-describing
 * in logs and pg_stat.
 *
 * One round-trip total; packages arrive denormalised into a JSON
 * column and are deserialised by the mapper.
 *
 * Day 11 / P5 — opts adds offset-based pagination + status filter.
 * Both fields optional and additive; absent opts preserves Day-7
 * "every task" semantics so existing callers (cron paths, repository
 * tests) keep working unchanged.
 */
export interface ListTasksOpts {
  readonly limit?: number;
  readonly offset?: number;
  /**
   * D56 Phase 8 / Lane 3 — the operator `/tasks` filter is now the FINE
   * `courier_status` (Love ruling: ?status= carries the 14-state vocabulary).
   * Matches on `tasks.courier_status`; NULL-courier rows (pre-backfill /
   * Planner-only) only surface under the no-filter "All" view. The coarse
   * `internal_status` filter lives on in the admin list path (Lane 5).
   */
  readonly status?: CourierStatus;
  /**
   * Optional case-insensitive substring match against the AWB
   * (`external_tracking_number`), the operator-set `customer_order_number`,
   * or the consignee name (LEFT JOIN consignees). Empty/whitespace-only
   * strings are treated as no filter.
   */
  readonly searchTerm?: string;
  /**
   * Day-24 PM: inclusive `delivery_date` lower bound (YYYY-MM-DD).
   * Caller (tenant /tasks page boundary) ensures dateFrom ≤ dateTo.
   */
  readonly dateFrom?: string;
  /** Inclusive `delivery_date` upper bound (YYYY-MM-DD). */
  readonly dateTo?: string;
  /**
   * Day-54 P2 — exact AWB-set filter (`external_tracking_number =
   * ANY(...)`). Powers the bag-tracking report drill-downs (plan #502
   * Q4 ruling). Page boundary validates AWB shape before passing.
   */
  readonly awbs?: readonly string[];
}

/**
 * Day 17 / Session A — list tasks for a single consignee within a date
 * range, ordered by deliveryDate ASC then deliveryStartTime ASC.
 * Powers the consignee detail-page Calendar tab (Week view) per brief
 * §3.3.3.
 *
 * Date params are inclusive ISO dates (YYYY-MM-DD), Asia/Dubai per the
 * task table's deliveryDate convention. Tenant filter is explicit
 * alongside RLS — same value, same result, but query is self-describing
 * in pg_stat.
 *
 * Empty result returns []; the caller (Calendar view) renders empty days
 * naturally without a separate guard.
 */
export async function listTasksByConsigneeAndDateRange(
  tx: DbTx,
  tenantId: Uuid,
  consigneeId: Uuid,
  startDate: string,
  endDate: string,
): Promise<readonly Task[]> {
  const rows = await tx.execute<TaskRowWithPackages>(sqlTag`
    SELECT
      t.*,
      a.label AS address_label,
      COALESCE(
        (
          SELECT json_agg(tp.* ORDER BY tp.position ASC)
          FROM task_packages tp
          WHERE tp.task_id = t.id
        ),
        '[]'::json
      ) AS packages
    FROM tasks t
    LEFT JOIN addresses a ON t.address_id = a.id
    WHERE t.tenant_id = ${tenantId}
      AND t.consignee_id = ${consigneeId}
      AND t.delivery_date >= ${startDate}::date
      AND t.delivery_date <= ${endDate}::date
    ORDER BY t.delivery_date ASC, t.delivery_start_time ASC
  `);
  return rows.map(mapTaskWithPackages);
}

export async function listTasksByTenant(
  tx: DbTx,
  tenantId: Uuid,
  opts: ListTasksOpts = {},
): Promise<readonly TaskListRow[]> {
  const { limit, offset = 0, status, searchTerm, dateFrom, dateTo, awbs } = opts;
  // D57 Item A — render-aligned status filter, shared with /admin/tasks (#554).
  // Operator /tasks had the same courier_status-only defect: 100% of rows carry
  // courier_status NULL, so every specific filter returned 0 while rows rendered
  // via the coarse internal_status fallback. buildCourierStatusFilter matches
  // courier_status when present, else the coarse value the row actually carries.
  const statusFilter = buildCourierStatusFilter(status);
  const searchFilter = buildTaskSearchFilter(searchTerm);
  const dateFromFilter = buildDateFromFilter(dateFrom);
  const dateToFilter = buildDateToFilter(dateTo);
  const awbsFilter = buildAwbsFilter(awbs);
  const limitClause = limit !== undefined ? sqlTag`LIMIT ${limit}` : sqlTag``;
  const offsetClause = offset > 0 ? sqlTag`OFFSET ${offset}` : sqlTag``;
  // R6-part-1: the consignees join is now UNCONDITIONAL (was search-gated
  // via needsConsigneeJoin) so every list row can carry consignee
  // name/phone; the addresses join resolves the task's effective address.
  // effective_* COALESCE the override address (tasks.address_id →
  // addresses) onto the consignee's own fields when address_id IS NULL.
  const rows = await tx.execute<TaskRowWithConsignee>(sqlTag`
    SELECT
      t.*,
      c.name AS consignee_name,
      c.phone AS consignee_phone,
      COALESCE(a.line, c.address_line) AS effective_address_line,
      COALESCE(a.district, c.district) AS effective_district,
      COALESCE(a.emirate, c.emirate_or_region) AS effective_emirate,
      COALESCE(
        (
          SELECT json_agg(tp.* ORDER BY tp.position ASC)
          FROM task_packages tp
          WHERE tp.task_id = t.id
        ),
        '[]'::json
      ) AS packages
    FROM tasks t
    LEFT JOIN consignees c ON c.id = t.consignee_id AND c.tenant_id = t.tenant_id
    LEFT JOIN addresses a ON a.id = t.address_id AND a.tenant_id = t.tenant_id
    WHERE t.tenant_id = ${tenantId}
      ${statusFilter}
      ${searchFilter}
      ${dateFromFilter}
      ${dateToFilter}
      ${awbsFilter}
    ORDER BY t.created_at DESC
    ${limitClause}
    ${offsetClause}
  `);
  return rows.map(mapTaskListRow);
}


function needsConsigneeJoin(searchTerm: string | undefined): boolean {
  if (!searchTerm) return false;
  return searchTerm.trim().length > 0;
}

function buildTaskSearchFilter(searchTerm: string | undefined) {
  if (!searchTerm) return sqlTag``;
  const trimmed = searchTerm.trim();
  if (trimmed.length === 0) return sqlTag``;
  const pattern = `%${trimmed}%`;
  return sqlTag`AND (
    t.external_tracking_number ILIKE ${pattern}
    OR t.customer_order_number ILIKE ${pattern}
    OR c.name ILIKE ${pattern}
  )`;
}

// -----------------------------------------------------------------------------
// Day-22 §3.22 Fix 2 — list tasks for a single subscription
// -----------------------------------------------------------------------------

/**
 * SELECT all tasks attached to one subscription, ordered by
 * delivery_date ASC. Tenant-scoped via the explicit predicate +
 * RLS. Default limit 30 (clamped to 200 — anything more belongs on
 * the full /tasks list).
 *
 * Powers the "Tasks" panel on /subscriptions/[id] per PR #238 §3.22
 * Fix 2.
 */
export async function listTasksBySubscription(
  tx: DbTx,
  tenantId: Uuid,
  subscriptionId: Uuid,
  limit = 30,
): Promise<readonly Task[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const rows = await tx.execute<TaskRowWithPackages>(sqlTag`
    SELECT
      t.*,
      COALESCE(
        (
          SELECT json_agg(tp.* ORDER BY tp.position ASC)
          FROM task_packages tp
          WHERE tp.task_id = t.id
        ),
        '[]'::json
      ) AS packages
    FROM tasks t
    WHERE t.tenant_id = ${tenantId}
      AND t.subscription_id = ${subscriptionId}
    ORDER BY t.delivery_date ASC
    LIMIT ${safeLimit}
  `);
  return rows.map(mapTaskWithPackages);
}

// -----------------------------------------------------------------------------
// Day 19 / Phase 1.5 — cross-tenant admin list
// -----------------------------------------------------------------------------

/**
 * Filters for listAllTasksRows. Same shape as ListTasksOpts plus an
 * optional merchantSlug for narrowing to a single tenant's rows.
 *
 * `searchTerm` runs a case-insensitive ILIKE across the joined task +
 * consignee + merchant surface (AWB, consignee name, merchant name).
 * Trim + min-length is the caller's responsibility; the helper here
 * collapses empty/whitespace to the no-filter SQL fragment.
 */
export interface ListAllTasksFilters {
  readonly merchantSlug?: string;
  readonly limit?: number;
  readonly offset?: number;
  /**
   * D56 Phase 8 / Lane 5 — the cross-tenant /admin/tasks filter migrated to
   * the FINE `courier_status` (matches the operator /tasks filter; Love ruling:
   * ?status= carries the 14-state vocabulary). Matches on `tasks.courier_status`;
   * NULL-courier rows (pre-backfill / Planner-only) only surface under the
   * no-filter "All" view. The coarse `internal_status` is no longer a filter
   * axis on any surface.
   */
  readonly status?: CourierStatus;
  readonly searchTerm?: string;
  /**
   * Day-24 PM: inclusive `delivery_date` lower bound (YYYY-MM-DD). When
   * set, SQL adds `AND t.delivery_date >= ${dateFrom}::date`. Caller is
   * responsible for ensuring dateFrom ≤ dateTo at the page boundary —
   * the helper does not swap or validate ordering.
   */
  readonly dateFrom?: string;
  /** Inclusive `delivery_date` upper bound (YYYY-MM-DD). */
  readonly dateTo?: string;
  /** Day-54 P2 — exact AWB-set filter; see ListTasksOpts.awbs. */
  readonly awbs?: readonly string[];
}

/**
 * Wide row shape for the JOIN tenants admin SELECT. The task columns
 * are the existing TaskRow shape; merchant_* columns come from the
 * tenants alias.
 */
type AdminTaskJoinRow = TaskRow & {
  readonly merchant_tenant_id: string;
  readonly merchant_slug: string;
  readonly merchant_name: string;
  readonly merchant_status: TenantStatus;
};

/**
 * Day 19 / Phase 1.5 — cross-tenant SELECT of tasks across all merchants.
 * Caller is in withServiceRole; no RLS predicate (cross-tenant scope by
 * definition). Per merged plan §5.1 SQL pattern: JOIN tenants for the
 * merchant surface columns (id, slug, name, status); single round-trip.
 *
 * Pagination defaults match the operator-side conventions from merged
 * plan scope item 8: default limit 50, max 500. Offset-based; cursor
 * pagination is a Phase 2 candidate per plan §5 amendment if cross-tenant
 * volume scales to 10k+ rows.
 *
 * Packages NOT loaded for the cross-tenant view — admin operators
 * don't drill into package detail in the cross-tenant table; the
 * single-tenant /tasks page remains the authoritative per-package
 * surface. AdminTaskRow.task.packages comes back as [] by construction.
 */
export async function listAllTasksRows(
  tx: DbTx,
  filters: ListAllTasksFilters = {},
): Promise<
  readonly {
    task: Task;
    merchant: {
      tenantId: Uuid;
      slug: string;
      name: string;
      status: TenantStatus;
    };
  }[]
> {
  const limit = Math.min(filters.limit ?? 50, 500);
  const offset = filters.offset ?? 0;
  // D57 — render-aligned status filter (see buildCourierStatusFilter).
  const statusFilter = buildCourierStatusFilter(filters.status);
  const merchantFilter =
    filters.merchantSlug !== undefined
      ? sqlTag`AND ten.slug = ${filters.merchantSlug}`
      : sqlTag``;
  const searchFilter = buildAdminTaskSearchFilter(filters.searchTerm);
  const dateFromFilter = buildDateFromFilter(filters.dateFrom);
  const dateToFilter = buildDateToFilter(filters.dateTo);
  const awbsFilter = buildAwbsFilter(filters.awbs);

  const rows = await tx.execute<AdminTaskJoinRow>(sqlTag`
    SELECT
      t.*,
      ten.id   AS merchant_tenant_id,
      ten.slug AS merchant_slug,
      ten.name AS merchant_name,
      ten.status AS merchant_status
    FROM tasks t
    JOIN tenants ten ON ten.id = t.tenant_id
    LEFT JOIN consignees c ON c.id = t.consignee_id
    WHERE 1 = 1
      ${buildGenuineTenantsFilter("ten")}
      ${statusFilter}
      ${merchantFilter}
      ${searchFilter}
      ${dateFromFilter}
      ${dateToFilter}
      ${awbsFilter}
    ORDER BY t.delivery_date DESC, t.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return rows.map((row) => ({
    task: mapTask(row, []),
    merchant: {
      tenantId: row.merchant_tenant_id as Uuid,
      slug: row.merchant_slug,
      name: row.merchant_name,
      status: row.merchant_status,
    },
  }));
}

/**
 * D57 — /admin/tasks status filter, aligned to what each row RENDERS.
 *
 * Every admin row renders `resolveCourierDisplay(courier_status, internal_status)`:
 * the FINE `courier_status` when present, else the COARSE `internal_status`
 * fallback. The filter mirrors that resolution, so a row that DISPLAYS a status
 * is matched by filtering on it. This matters because the fine state is
 * webhook-backfilled going forward — rows without it carry `courier_status NULL`
 * and render via the coarse value, which a `courier_status`-only filter could
 * never match (every specific filter returned 0).
 *
 * Fine-only values (OUT_FOR_DELIVERY, PICKED_UP, …) never appear in the 8-value
 * `internal_status` domain, so the fallback branch is inert for them — no false
 * positives. Once `courier_status` is populated the fine clause is authoritative
 * (the fallback only applies while it is NULL). Shared by the admin list + count
 * so the two never diverge.
 */
function buildCourierStatusFilter(status: CourierStatus | undefined) {
  if (!status) return sqlTag``;
  return sqlTag`AND (t.courier_status = ${status} OR (t.courier_status IS NULL AND t.internal_status = ${status}))`;
}

function buildAdminTaskSearchFilter(searchTerm: string | undefined) {
  if (!searchTerm) return sqlTag``;
  const trimmed = searchTerm.trim();
  if (trimmed.length === 0) return sqlTag``;
  const pattern = `%${trimmed}%`;
  return sqlTag`AND (t.external_tracking_number ILIKE ${pattern} OR c.name ILIKE ${pattern} OR ten.name ILIKE ${pattern})`;
}

/**
 * Day-24 PM: shared `delivery_date >=` SQL fragment. Empty string or
 * undefined collapses to no filter. Used by both `listAllTasksRows`
 * + `countAllTasksRows` (admin) and `listTasksByTenant` +
 * `countTasksByTenantRows` (tenant).
 */
function buildDateFromFilter(dateFrom: string | undefined) {
  if (!dateFrom) return sqlTag``;
  return sqlTag`AND t.delivery_date >= ${dateFrom}::date`;
}

/** Shared `delivery_date <=` fragment. See buildDateFromFilter. */
function buildDateToFilter(dateTo: string | undefined) {
  if (!dateTo) return sqlTag``;
  return sqlTag`AND t.delivery_date <= ${dateTo}::date`;
}

/**
 * Day-54 P2 — exact AWB-set fragment via `= ANY($::text[])`. Array
 * literal built the bulkUpdateTaskStatuses way (uuid[] precedent at
 * the `id = ANY(...)` site); the page boundary has already validated
 * each AWB against the strict shape, so the literal join is safe.
 */
function buildAwbsFilter(awbs: readonly string[] | undefined) {
  if (!awbs || awbs.length === 0) return sqlTag``;
  return sqlTag`AND t.external_tracking_number = ANY(${"{" + awbs.join(",") + "}"}::text[])`;
}

/**
 * Day-24 PM: cross-tenant COUNT of tasks matching the same filter set
 * as `listAllTasksRows`. Same JOIN topology + composable filter
 * fragments — drops ORDER BY + LIMIT/OFFSET. Returns a single integer
 * for the hero count card on /admin/tasks.
 *
 * The `LEFT JOIN consignees` is preserved even when no `searchTerm` is
 * set, because the LEFT JOIN cannot multiply rows (each task has at
 * most one consignee). If a task has a NULL consignee_id, the LEFT
 * JOIN produces one row with NULL `c.*`; INNER JOIN would have dropped
 * it. Same posture as `listAllTasksRows`.
 */
export async function countAllTasksRows(
  tx: DbTx,
  filters: Omit<ListAllTasksFilters, "limit" | "offset"> = {},
): Promise<number> {
  // D57 — render-aligned status filter (mirrors listAllTasksRows exactly so the
  // hero count agrees with the rows). See buildCourierStatusFilter.
  const statusFilter = buildCourierStatusFilter(filters.status);
  const merchantFilter =
    filters.merchantSlug !== undefined
      ? sqlTag`AND ten.slug = ${filters.merchantSlug}`
      : sqlTag``;
  const searchFilter = buildAdminTaskSearchFilter(filters.searchTerm);
  const dateFromFilter = buildDateFromFilter(filters.dateFrom);
  const dateToFilter = buildDateToFilter(filters.dateTo);
  const awbsFilter = buildAwbsFilter(filters.awbs);

  const rows = await tx.execute<{ count: number }>(sqlTag`
    SELECT COUNT(*)::int AS count
    FROM tasks t
    JOIN tenants ten ON ten.id = t.tenant_id
    LEFT JOIN consignees c ON c.id = t.consignee_id
    WHERE 1 = 1
      ${buildGenuineTenantsFilter("ten")}
      ${statusFilter}
      ${merchantFilter}
      ${searchFilter}
      ${dateFromFilter}
      ${dateToFilter}
      ${awbsFilter}
  `);
  return rows[0]?.count ?? 0;
}

/**
 * Day 17 / Session B — list IDs only for tasks visible to `tenantId`,
 * optionally filtered by status. Lightweight companion to
 * listTasksByTenant: powers the /tasks page's "Select all X tasks"
 * action without dragging the full Task+packages payload over the
 * wire (the SF label endpoint only needs the IDs).
 *
 * Same ordering as listTasksByTenant (created_at DESC) so the IDs the
 * client receives match the order of rows on screen — a follow-up
 * "select all then deselect a few" flow stays predictable.
 *
 * No limit/offset: the use case is "every visible task ID at once".
 * The caller is the across-pages selection action; bounding it would
 * defeat the point. Tenant cardinality is bounded by pilot scale
 * (low thousands); RLS + the explicit tenant_id WHERE keep this
 * scoped.
 */
export async function listAllTaskIdsByTenant(
  tx: DbTx,
  tenantId: Uuid,
  opts: { readonly status?: CourierStatus } = {},
): Promise<readonly Uuid[]> {
  const { status } = opts;
  // D56 Lane 3 — fine courier_status filter (matches listTasksByTenant).
  const statusFilter = status
    ? sqlTag`AND courier_status = ${status}`
    : sqlTag``;
  type Row = { id: string };
  const rows = await tx.execute<Row>(sqlTag`
    SELECT id FROM tasks
    WHERE tenant_id = ${tenantId}
      ${statusFilter}
    ORDER BY created_at DESC
  `);
  return rows.map((r) => r.id as Uuid);
}

/**
 * Day-21 PR-A2 — per-day-per-status task counts for a single consignee
 * within an inclusive ISO date range. Powers the consignee detail-page
 * Calendar tab Year view (heat-map per BRD §6.2.1) per DECISION-1 (b)
 * locked at PR #221 plan-PR. Single-pass GROUP BY aggregation; the
 * caller (CalendarYearView) buckets the rows into a Map<date, ...> for
 * O(1) per-cell lookup.
 *
 * Tenant filter is explicit alongside RLS — same value, same result,
 * but query is self-describing in pg_stat. delivery_date + tenant_id
 * indices already exist (Day 11 + Day 17), so the GROUP BY hits an
 * index scan rather than a sequential walk.
 *
 * Empty result returns [] when no tasks fall in the window. Caller
 * renders blank cells uniformly without a separate guard.
 */
export interface DayBucketCount {
  readonly date: string;
  readonly status: TaskInternalStatus;
  readonly count: number;
}

export async function countTasksByConsigneeAndDayBucket(
  tx: DbTx,
  tenantId: Uuid,
  consigneeId: Uuid,
  startDate: string,
  endDate: string,
): Promise<readonly DayBucketCount[]> {
  type Row = {
    date: string;
    status: TaskInternalStatus;
    count: string | number;
  };
  const rows = await tx.execute<Row>(sqlTag`
    SELECT
      to_char(delivery_date, 'YYYY-MM-DD') AS date,
      internal_status AS status,
      COUNT(*)::int AS count
    FROM tasks
    WHERE tenant_id = ${tenantId}
      AND consignee_id = ${consigneeId}
      AND delivery_date >= ${startDate}::date
      AND delivery_date <= ${endDate}::date
    GROUP BY delivery_date, internal_status
    ORDER BY delivery_date ASC, internal_status ASC
  `);
  return rows.map((r) => ({
    date: r.date,
    status: r.status,
    count: typeof r.count === "string" ? Number.parseInt(r.count, 10) : r.count,
  }));
}

/**
 * Day 11 / P5 — count tasks for `tenantId` with the same optional
 * status filter as listTasksByTenant. Used by the operator UI to
 * render total counts + total page count without a second pass over
 * every row.
 *
 * Day-24 PM: extended with `dateFrom`/`dateTo` (inclusive
 * `delivery_date` bounds) to power the tenant `/tasks` hero count
 * card alongside the new DateRangeFilter UI.
 */
export async function countTasksByTenant(
  tx: DbTx,
  tenantId: Uuid,
  opts: {
    // D56 Lane 3 — fine courier_status filter (mirrors ListTasksOpts.status).
    readonly status?: CourierStatus;
    readonly searchTerm?: string;
    readonly dateFrom?: string;
    readonly dateTo?: string;
    readonly awbs?: readonly string[];
  } = {},
): Promise<number> {
  const { status, searchTerm, dateFrom, dateTo, awbs } = opts;
  // D57 Item A — render-aligned status filter; mirrors listTasksByTenant so the
  // operator count agrees with the rows. See buildCourierStatusFilter (#554).
  const statusFilter = buildCourierStatusFilter(status);
  const searchFilter = buildTaskSearchFilter(searchTerm);
  const consigneeJoin = needsConsigneeJoin(searchTerm)
    ? sqlTag`LEFT JOIN consignees c ON c.id = t.consignee_id AND c.tenant_id = t.tenant_id`
    : sqlTag``;
  const dateFromFilter = buildDateFromFilter(dateFrom);
  const dateToFilter = buildDateToFilter(dateTo);
  const awbsFilter = buildAwbsFilter(awbs);
  type Row = { count: string | number };
  const rows = await tx.execute<Row>(sqlTag`
    SELECT COUNT(*)::int AS count FROM tasks t
    ${consigneeJoin}
    WHERE t.tenant_id = ${tenantId}
      ${statusFilter}
      ${searchFilter}
      ${dateFromFilter}
      ${dateToFilter}
      ${awbsFilter}
  `);
  const raw = rows[0]?.count ?? 0;
  return typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
}

/**
 * Day 8 / D8-4a — list tasks for a tenant that have NOT yet been
 * pushed to the external system. The cron's bulk-push phase walks
 * this set, builds payloads, calls the SF adapter, and marks tasks
 * pushed via `markTaskPushed` on success.
 *
 * Filter: `pushed_to_external_at IS NULL` — covers both never-pushed
 * tasks and tasks that failed to push (failed_pushes records exist
 * but `pushed_to_external_at` stays null until a successful push
 * lands).
 *
 * Order: oldest-first by created_at. Older tasks have higher
 * operational priority (closer to delivery cutoff).
 *
 * Defence-in-depth tenant_id predicate alongside RLS, same posture
 * as `listTasksByTenant`.
 */
export async function listUnpushedTasksByTenant(
  tx: DbTx,
  tenantId: Uuid,
): Promise<readonly Task[]> {
  const rows = await tx.execute<TaskRowWithPackages>(sqlTag`
    SELECT
      t.*,
      COALESCE(
        (
          SELECT json_agg(tp.* ORDER BY tp.position ASC)
          FROM task_packages tp
          WHERE tp.task_id = t.id
        ),
        '[]'::json
      ) AS packages
    FROM tasks t
    WHERE t.tenant_id = ${tenantId}
      AND t.pushed_to_external_at IS NULL
    ORDER BY t.created_at ASC
  `);
  return rows.map(mapTaskWithPackages);
}

/**
 * Day 14 — reconciliation-scan query for the materialization cron's
 * Phase 1 per §1.1 of the Day-14 cron decoupling plan
 * (memory/plans/day-14-cron-decoupling.md). Returns task IDs that are:
 *
 *   1. unpushed (`pushed_to_external_at IS NULL`)        — Phase 5 needs to enqueue them
 *   2. have a resolved address (`address_id IS NOT NULL`) — §2.2 quarantine guard
 *
 * The address-id filter is load-bearing: rows quarantined by §2.2's
 * refuse-to-materialize policy stay pinned at NULL and are NOT eligible
 * for re-enqueue. Re-enqueueing them would re-trigger the §5.1 Step 1.5
 * null-address guard at the queue handler, which DLQs them via
 * failureCallback. The handler-side guard exists for defense-in-depth
 * (per §5.1 amendment 2); the cron-side filter here is the primary gate
 * that keeps quarantined rows out of the queue in steady state.
 *
 * Distinct from `listUnpushedTasksByTenant` (which returns full Task
 * objects with packages, used by the legacy `pushTasksForTenant` path
 * retiring per §1.3) — the reconciliation scan only needs IDs because
 * the queue handler re-reads the full task by id at delivery time.
 *
 * Caller wraps in `withServiceRole` (system actor — cron); RLS not
 * enforced at this layer. Returns IDs in `created_at` ascending order
 * to drain oldest-first.
 */
export async function listReconciliationCandidatesByTenant(
  tx: DbTx,
  tenantId: Uuid,
): Promise<readonly Uuid[]> {
  // Day-32 PR-A / F-5 (plan #317 §3.5 Surface 3 + §6 OQ-3 ruling (a)):
  // exclude past-dated tasks from the reconciliation re-enqueue. SF
  // rejects strictly-past delivery dates (production MPL 400 row
  // confirms); past-dated rows stay in DLQ awaiting operator triage
  // (CLEANUP-1 in PR-D) rather than being re-enqueued every cron tick.
  // Evaluated via Postgres CURRENT_DATE (not parameterised JS Date)
  // per OQ-3 ruling. The push-time guard in pushSingleTask is the
  // belt-and-braces partner — this filter is the upstream cron-side
  // gate that prevents enqueue in the first place.
  type IdRow = { id: Uuid };
  const rows = await tx.execute<IdRow>(sqlTag`
    SELECT id
    FROM tasks
    WHERE tenant_id = ${tenantId}
      AND pushed_to_external_at IS NULL
      AND address_id IS NOT NULL
      AND delivery_date >= CURRENT_DATE
      -- R-E r1 (PR #480 review): never re-push a dead row. A churn-
      -- cancelled (or pause-cancelled / skipped) unpushed task would
      -- otherwise be re-CREATED at the vendor on the next nightly tick,
      -- defeating the hard stop. pushSingleTask carries the belt-and-
      -- braces partner guard (not_pushable_status).
      AND internal_status NOT IN ('CANCELED', 'SKIPPED', 'DELIVERED', 'FAILED')
    ORDER BY created_at ASC
  `);
  return rows.map((row) => row.id);
}

/**
 * Day 8 / D8-4a — mark a task as pushed to the external system.
 * Sets `external_id`, `external_tracking_number`,
 * `pushed_to_external_at = now()`, and `outbound_sync_state = 'synced'`
 * atomically. Defence-in-depth tenant_id predicate.
 *
 * Idempotency posture: NO `WHERE pushed_to_external_at IS NULL`
 * guard. If a future caller re-attempts a push for a task that's
 * already pushed (race / cron retry / operator), the second call
 * UPDATEs with the new external_id. Caller is responsible for not
 * re-pushing already-pushed tasks (the cron's `listUnpushedTasksByTenant`
 * filter is the upstream gate).
 *
 * Day-33 PR-C / F-3 (a) per plan-PR #317 §3.3: the same UPDATE flips
 * outbound_sync_state to 'synced' so the column reflects post-push
 * truth without a second statement. Unconditional flip — a successful
 * push from any prior state (pre-0028 'synced' default, post-0028
 * 'pending', or 'failed' on retry) converges to 'synced'. Cancel-lane
 * states ('pending_cancel' / 'pending_reschedule') are unreachable
 * here because markTaskSkipped only sets 'pending_cancel' on rows that
 * are already pushed (external_tracking_number IS NOT NULL), so a
 * createTask push on a 'pending_cancel' row would be a state-machine
 * violation upstream.
 *
 * Returns true if a row was updated, false otherwise (unknown id,
 * RLS-hidden cross-tenant, or tenant_id mismatch).
 */
export async function markTaskPushed(
  tx: DbTx,
  tenantId: Uuid,
  taskId: Uuid,
  externalId: string,
  externalTrackingNumber: string,
): Promise<boolean> {
  const result = await tx.execute(sqlTag`
    UPDATE tasks
    SET external_id = ${externalId},
        external_tracking_number = ${externalTrackingNumber},
        pushed_to_external_at = now(),
        outbound_sync_state = 'synced'
    WHERE id = ${taskId} AND tenant_id = ${tenantId}
  `);
  const count =
    typeof (result as { count?: number }).count === "number"
      ? (result as { count: number }).count
      : Array.isArray(result)
        ? result.length
        : 0;
  return count > 0;
}

/**
 * UPDATE selected scalar fields on one task, scoped to `tenantId` for
 * defence in depth alongside RLS. Only fields present on `patch` are
 * written. Identity columns, association columns, lifecycle columns,
 * and packages are excluded by the type definition.
 *
 * Returns the updated task with packages re-fetched, or null if no
 * row matched. Packages do NOT change as part of this update — the
 * re-fetch picks up whatever the current package set is.
 *
 * Empty patch (no keys present) short-circuits to a tenant-scoped
 * findTaskById — one round-trip, no UPDATE statement issued.
 */
export async function updateTask(
  tx: DbTx,
  tenantId: Uuid,
  id: Uuid,
  patch: UpdateTaskPatch
): Promise<Task | null> {
  const sets: SQL[] = [];
  if (patch.customerOrderNumber !== undefined)
    sets.push(sqlTag`customer_order_number = ${patch.customerOrderNumber}`);
  if (patch.referenceNumber !== undefined)
    sets.push(sqlTag`reference_number = ${patch.referenceNumber}`);
  if (patch.internalStatus !== undefined)
    sets.push(sqlTag`internal_status = ${patch.internalStatus}`);
  if (patch.deliveryDate !== undefined) sets.push(sqlTag`delivery_date = ${patch.deliveryDate}`);
  if (patch.deliveryStartTime !== undefined)
    sets.push(sqlTag`delivery_start_time = ${patch.deliveryStartTime}`);
  if (patch.deliveryEndTime !== undefined)
    sets.push(sqlTag`delivery_end_time = ${patch.deliveryEndTime}`);
  if (patch.deliveryType !== undefined) sets.push(sqlTag`delivery_type = ${patch.deliveryType}`);
  if (patch.taskKind !== undefined) sets.push(sqlTag`task_kind = ${patch.taskKind}`);
  if (patch.paymentMethod !== undefined) sets.push(sqlTag`payment_method = ${patch.paymentMethod}`);
  if (patch.codAmount !== undefined) sets.push(sqlTag`cod_amount = ${patch.codAmount}`);
  if (patch.declaredValue !== undefined) sets.push(sqlTag`declared_value = ${patch.declaredValue}`);
  if (patch.weightKg !== undefined) sets.push(sqlTag`weight_kg = ${patch.weightKg}`);
  if (patch.notes !== undefined) sets.push(sqlTag`notes = ${patch.notes}`);
  if (patch.signatureRequired !== undefined)
    sets.push(sqlTag`signature_required = ${patch.signatureRequired}`);
  if (patch.smsNotifications !== undefined)
    sets.push(sqlTag`sms_notifications = ${patch.smsNotifications}`);
  if (patch.deliverToCustomerOnly !== undefined)
    sets.push(sqlTag`deliver_to_customer_only = ${patch.deliverToCustomerOnly}`);
  if (patch.addressId !== undefined) sets.push(sqlTag`address_id = ${patch.addressId}`);

  if (sets.length === 0) {
    const rows = await tx.execute<TaskRowWithPackages>(sqlTag`
      SELECT
        t.*,
        COALESCE(
          (
            SELECT json_agg(tp.* ORDER BY tp.position ASC)
            FROM task_packages tp
            WHERE tp.task_id = t.id
          ),
          '[]'::json
        ) AS packages
      FROM tasks t
      WHERE t.id = ${id} AND t.tenant_id = ${tenantId}
    `);
    return rows[0] ? mapTaskWithPackages(rows[0]) : null;
  }

  const setClause = sqlTag.join(sets, sqlTag`, `);
  const updateRows = await tx.execute<TaskRow>(sqlTag`
    UPDATE tasks
    SET ${setClause}
    WHERE id = ${id} AND tenant_id = ${tenantId}
    RETURNING *
  `);
  if (updateRows.length === 0) {
    return null;
  }

  // Re-fetch packages alongside the updated task in a single query so
  // the returned value is the canonical aggregate. Two-round-trip cost
  // is unavoidable when the UPDATE itself doesn't carry packages.
  const packageRows = await tx.execute<TaskPackageRow>(sqlTag`
    SELECT * FROM task_packages
    WHERE task_id = ${id} AND tenant_id = ${tenantId}
    ORDER BY position ASC
  `);
  const packages = packageRows.map(mapPackageFromRow);
  return mapTask(updateRows[0], packages);
}

/**
 * DELETE one task, scoped to `tenantId` for defence in depth.
 * Returns true if a row was removed, false if no row matched.
 * task_packages are reaped via ON DELETE CASCADE.
 */
export async function deleteTask(tx: DbTx, tenantId: Uuid, id: Uuid): Promise<boolean> {
  const result = await tx.execute(sqlTag`
    DELETE FROM tasks WHERE id = ${id} AND tenant_id = ${tenantId}
  `);
  // Same shape as deleteConsignee's count handling — postgres.js's
  // row-list result carries `count` for non-RETURNING statements.
  // Fall back to length check for stubs returning a plain array.
  const count =
    typeof (result as { count?: number }).count === "number"
      ? (result as { count: number }).count
      : Array.isArray(result)
        ? result.length
        : 0;
  return count > 0;
}

// -----------------------------------------------------------------------------
// Day-16 / Block 4-B Service A — subscription-exception-driven UPDATEs
// -----------------------------------------------------------------------------

/**
 * Day-16 §3.2 step 13 — find a task by its (subscription_id,
 * delivery_date) tuple. Used by `addSubscriptionException` (skip flow)
 * and the target_date_override collision check per plan §3.2 step 13b.
 *
 * Returns null when no task matches — sub-cases 13a (original date's
 * task hasn't materialized yet, beyond the 14-day horizon) and 13c
 * (target_date_override beyond the 14-day horizon) both surface as
 * a null return; the service treats both as no-op success.
 *
 * Tenant-id predicate alongside RLS for defence in depth, mirroring
 * the rest of this module's read shape.
 */
export async function findTaskBySubscriptionAndDate(
  tx: DbTx,
  tenantId: Uuid,
  subscriptionId: Uuid,
  deliveryDate: string,
): Promise<Task | null> {
  const rows = await tx.execute<TaskRowWithPackages>(sqlTag`
    SELECT
      t.*,
      COALESCE(
        (
          SELECT json_agg(tp.* ORDER BY tp.position ASC)
          FROM task_packages tp
          WHERE tp.task_id = t.id
        ),
        '[]'::json
      ) AS packages
    FROM tasks t
    WHERE t.tenant_id = ${tenantId}
      AND t.subscription_id = ${subscriptionId}
      AND t.delivery_date = ${deliveryDate}
    LIMIT 1
  `);
  return rows[0] ? mapTaskWithPackages(rows[0]) : null;
}

/**
 * Day-16 §3.2 step 13 — flip a task's internal_status to 'SKIPPED'
 * when an operator records a skip exception on its (subscription_id,
 * target_date) tuple.
 *
 * Day-29 §D(2) Phase-1 extension (plan-PR #302 §2.2 / §6.3): in the
 * same UPDATE, conditionally flip outbound_sync_state from 'synced'
 * to 'pending_cancel' when the task has been pushed to SuiteFleet
 * (external_tracking_number IS NOT NULL). Returns the affected task's
 * id + external_tracking_number so the service-layer post-commit
 * block can decide whether to enqueue the SF cancel push.
 *
 * Return contract:
 *   - { taskId, externalTrackingNumber }: task existed and is now
 *     SKIPPED (happy path). externalTrackingNumber is null if the
 *     task was never pushed to SF (sub-case 13b — task materialized
 *     locally but cron's nightly push hasn't reached it yet); the
 *     post-commit enqueue gates on this being non-null.
 *   - null: the date's task hasn't materialized yet (sub-case 13a
 *     per merged plan §3.2 step 13). The subscription_exceptions
 *     row IS the durable record; the cron's §2.4 row 1 skip-the-date
 *     EXISTS guard reads it on the next materialization tick when
 *     the horizon eventually reaches that date. No service-side
 *     error; no outbound enqueue.
 *
 * Tenant-id predicate alongside RLS. The `internal_status` value
 * 'SKIPPED' is included in the `tasks_internal_status_check` CHECK
 * constraint per migration 0019 (Day-13 part 1). The
 * `outbound_sync_state` enum 'pending_cancel' is per migration 0026
 * (Day-29).
 *
 * Note: this method does NOT carry the exception_id back onto the
 * task row — there's no FK column for that on `tasks`. The link is
 * resolved by `(subscription_id, delivery_date)` against
 * `subscription_exceptions` at read time, which is the pattern the
 * §2.4 cron's skip-the-date EXISTS guard already uses.
 */
export async function markTaskSkipped(
  tx: DbTx,
  tenantId: Uuid,
  subscriptionId: Uuid,
  deliveryDate: string,
): Promise<{ taskId: Uuid; externalTrackingNumber: string | null } | null> {
  const result = (await tx.execute(sqlTag`
    UPDATE tasks
    SET internal_status = 'SKIPPED',
        outbound_sync_state = CASE
          WHEN external_tracking_number IS NOT NULL THEN 'pending_cancel'
          ELSE outbound_sync_state
        END
    WHERE tenant_id = ${tenantId}
      AND subscription_id = ${subscriptionId}
      AND delivery_date = ${deliveryDate}
      -- R-A: driver-bound rows are frozen (no edits/cancellations once
      -- assigned); the service probes + rejects on the null path.
      AND internal_status NOT IN ('DELIVERED', 'FAILED', 'CANCELED', 'ASSIGNED', 'IN_TRANSIT')
    RETURNING id, external_tracking_number
  `)) as readonly { id: string; external_tracking_number: string | null }[];

  if (result.length === 0) {
    return null;
  }
  const row = result[0];
  return {
    taskId: row.id as Uuid,
    externalTrackingNumber: row.external_tracking_number,
  };
}

/**
 * R4 (calendar-management lane Phase 1, plan-PR #335 §2.R4) — apply a
 * one-off address override to the single materialized task at
 * (subscription_id, delivery_date). Sibling of `markTaskSkipped`
 * directly above; same single-row UPDATE-by-tuple shape, same
 * return contract, same CASE flip on outbound_sync_state — but to
 * 'pending_update' (migration 0029) instead of 'pending_cancel',
 * because the outbound leg is an SF update, not a cancel.
 *
 * Status filter additionally excludes 'SKIPPED' (markTaskSkipped's
 * own target state): a skipped delivery has no SF-live row to
 * re-address — its cancel is already in flight or done — and
 * re-pointing its address locally would imply a delivery that is not
 * happening.
 *
 * Return contract (mirrors markTaskSkipped):
 *   - { taskId, externalTrackingNumber }: task existed and now
 *     carries the override address. externalTrackingNumber null ⇒
 *     never pushed; the caller skips the SF enqueue (cron's first
 *     push reads tasks.address_id → already correct).
 *   - null: no materialized task at that date (sub-case 13a analog).
 *     The subscription_exceptions row IS the durable record; the
 *     materializer CTE's one-off branch (cte-builder.ts
 *     resolved_addresses layer 1) applies the override when the
 *     horizon reaches that date. No outbound enqueue.
 */
export async function markTaskAddressOverridden(
  tx: DbTx,
  tenantId: Uuid,
  subscriptionId: Uuid,
  deliveryDate: string,
  addressId: Uuid,
): Promise<{ taskId: Uuid; externalTrackingNumber: string | null } | null> {
  const result = (await tx.execute(sqlTag`
    UPDATE tasks
    SET address_id = ${addressId},
        outbound_sync_state = CASE
          WHEN external_tracking_number IS NOT NULL THEN 'pending_update'
          ELSE outbound_sync_state
        END
    WHERE tenant_id = ${tenantId}
      AND subscription_id = ${subscriptionId}
      AND delivery_date = ${deliveryDate}
      AND internal_status NOT IN ('DELIVERED', 'FAILED', 'CANCELED', 'SKIPPED')
    RETURNING id, external_tracking_number
  `)) as readonly { id: string; external_tracking_number: string | null }[];

  if (result.length === 0) {
    return null;
  }
  const row = result[0];
  return {
    taskId: row.id as Uuid,
    externalTrackingNumber: row.external_tracking_number,
  };
}

/**
 * R5 (calendar-management lane Phase 1, plan-PR #335 §2.R5; Day-53
 * correction) — apply a forward address override to EVERY upcoming
 * materialized task on the subscription (`delivery_date >=
 * start_date`, no upper date bound). Bulk sibling of
 * `markTaskAddressOverridden` directly above: same SET shape
 * (address_id + the 'pending_update' CASE flip on pushed rows,
 * migration 0029). Same terminal+SKIPPED status exclusion as the
 * one-off variant.
 *
 * Day-53 ruling correction (Love, 2026-06-11): the Day-52 ruling's
 * "CURRENT_DATE + 14 days" window was stale framing from before the
 * Day-28 horizon bump (MATERIALIZATION_HORIZON_DAYS = 21,
 * dubai-date.ts). A literal 14-day bound left materialized tasks
 * 15-21 days out on the OLD address forever — the materializer's
 * INSERTs are ON CONFLICT DO NOTHING, so re-materialization never
 * repairs an existing row. No upper bound is the correct shape: no
 * tasks exist beyond the horizon, and the query stays correct across
 * any future horizon change.
 *
 * Returns ALL updated rows (RETURNING tuple per row) so the caller can
 * fan out SF updates for the pushed subset — mirrors
 * `markTasksCanceledInWindow` (R2) below. Empty array = nothing
 * materialized from start_date on; the exception row alone carries the
 * override forward.
 */
export async function markTasksAddressOverriddenForward(
  tx: DbTx,
  tenantId: Uuid,
  subscriptionId: Uuid,
  startDate: string,
  addressId: Uuid,
): Promise<readonly { taskId: Uuid; externalTrackingNumber: string | null }[]> {
  const result = (await tx.execute(sqlTag`
    UPDATE tasks
    SET address_id = ${addressId},
        outbound_sync_state = CASE
          WHEN external_tracking_number IS NOT NULL THEN 'pending_update'
          ELSE outbound_sync_state
        END
    WHERE tenant_id = ${tenantId}
      AND subscription_id = ${subscriptionId}
      AND delivery_date >= ${startDate}
      -- R-A: driver-bound rows keep their address (assignment freeze);
      -- the forward override applies from the next unassigned task on.
      AND internal_status NOT IN ('DELIVERED', 'FAILED', 'CANCELED', 'SKIPPED', 'ASSIGNED', 'IN_TRANSIT')
    RETURNING id, external_tracking_number
  `)) as readonly { id: string; external_tracking_number: string | null }[];

  return result.map((row) => ({
    taskId: row.id as Uuid,
    externalTrackingNumber: row.external_tracking_number,
  }));
}

/**
 * Day-16 / Block 4-C Service B — bulk-flip tasks in a pause window
 * to internal_status='CANCELED'. Used by `pauseSubscription` step 9
 * per merged plan §4.1 + brief §3.1.7.
 *
 * Filter `NOT IN ('DELIVERED', 'FAILED', 'CANCELED')` excludes
 * already-terminal tasks so an in-flight delivery completing
 * mid-pause-creation is not retroactively canceled (per merged plan
 * §8.1 row 2 — "whichever wins owns the final state"). Webhook-race
 * handling stays at the SF-webhook receiver layer.
 *
 * Returns rows affected for the audit-event metadata. The cancel
 * `reason='subscription_paused'` is captured on the linked
 * `subscription_exceptions.reason` row + on the
 * `subscription.paused` audit event (per Conflict 4 routing B1-α —
 * no cancellation_reason column on tasks).
 *
 * Tenant-id predicate alongside RLS for defence in depth.
 */
export type CanceledInWindowTaskRow = {
  readonly id: Uuid;
  /** SF AWB; non-null ⇒ task is pushed and has a live SF row to cancel. */
  readonly external_tracking_number: string | null;
} & Record<string, unknown>;

export async function markTasksCanceledInWindow(
  tx: DbTx,
  tenantId: Uuid,
  subscriptionId: Uuid,
  pauseStart: string,
  pauseEnd: string,
): Promise<readonly CanceledInWindowTaskRow[]> {
  // R2 (calendar-management lane Phase 1, plan-PR #337 §2.R2): two
  // additions over the original local-only cancel:
  //   (a) pushed rows (non-null external_tracking_number = live SF AWB)
  //       flip to outbound_sync_state='pending_cancel' so the
  //       outbound-sync badge lights up and the post-commit fan-out can
  //       drive SF cancels. Unpushed rows keep their existing state.
  //   (b) RETURNING (id, external_tracking_number) so pauseSubscription
  //       can build CancelTaskPayload[] for enqueueBulkCancelTasks.
  // Mirrors the Day-29 §D(2) single-skip cancel pattern
  // (markTaskSkipped), generalised to the bounded-pause window.
  const rows = await tx.execute<CanceledInWindowTaskRow>(sqlTag`
    UPDATE tasks
    SET internal_status = 'CANCELED',
        outbound_sync_state = CASE
          WHEN external_tracking_number IS NOT NULL THEN 'pending_cancel'
          ELSE outbound_sync_state
        END
    WHERE tenant_id = ${tenantId}
      AND subscription_id = ${subscriptionId}
      AND delivery_date BETWEEN ${pauseStart} AND ${pauseEnd}
      -- R-A: driver-bound rows survive the pause (assignment freeze;
      -- only the R-E churn cascade may recall them). The service counts
      -- them via countDriverBoundTasksInWindow for honest audit metadata.
      AND internal_status NOT IN ('DELIVERED', 'FAILED', 'CANCELED', 'ASSIGNED', 'IN_TRANSIT')
    RETURNING id, external_tracking_number
  `);
  return rows;
}

/**
 * Day-16 / Block 4-C Service B — restore CANCELED tasks back to
 * 'CREATED' on early manual resume. Used by `resumeSubscription`
 * when an operator resumes BEFORE `pause_end` per merged plan §4.2
 * + brief §3.1.7.
 *
 * Filter:
 *   - delivery_date >= restoreFromDate (today; tasks already-passed
 *     during the pause stay CANCELED forever)
 *   - delivery_date <= restoreToDate (the original pause_end)
 *   - internal_status = 'CANCELED' (only restore the pause-canceled
 *     tasks; tasks canceled for other reasons should not be
 *     restored)
 *
 * MVP simplification: there's no exception_id link on tasks (per
 * Conflict 4 B1-α), so this restores ALL CANCELED tasks in the
 * `[restoreFromDate, restoreToDate]` window for the subscription.
 * In demo flow this is safe because only the active pause causes
 * cancellations during a paused subscription's lifetime.
 *
 * Returns the restored rows (id + the AWB each row held BEFORE the
 * restore) so `resumeSubscription` can drive the R16 re-push fan-out.
 */
export type RestoredInWindowTaskRow = {
  readonly id: string;
  /** The SF AWB the row carried before the restore cleared it; null = never pushed. */
  readonly previous_external_tracking_number: string | null;
} & Record<string, unknown>;

export async function markTasksRestoredInWindow(
  tx: DbTx,
  tenantId: Uuid,
  subscriptionId: Uuid,
  restoreFromDate: string,
  restoreToDate: string,
): Promise<readonly RestoredInWindowTaskRow[]> {
  // R16 (plan memory/plans/day-53-r16-resume-sf-reactivation.md §2.1) —
  // supersedes the R2 safe-state half (pending_cancel → 'synced'):
  // SF cancel is terminal (un-cancel probe → 403), so a restored row
  // that was SF-cancelled needs a FRESH SF create. Pushed rows
  // (external_tracking_number NOT NULL — covers 'pending_cancel',
  // webhook-converged 'synced', and 'failed') get their external ids
  // cleared and flip to 'pending', the unpushed-row state the push
  // pipeline + materializer reconciliation already own. Never-pushed
  // rows restore status-only, untouched otherwise.
  //
  // The CTE captures the pre-UPDATE AWB: RETURNING alone would yield
  // the NEW (nulled) value; referencing the FROM alias returns the old
  // one. The old AWB feeds the resume audit event's previous_awbs
  // forensics — after this UPDATE it no longer exists on the row.
  const rows = await tx.execute<RestoredInWindowTaskRow>(sqlTag`
    WITH restorable AS (
      SELECT id, external_tracking_number
      FROM tasks
      WHERE tenant_id = ${tenantId}
        AND subscription_id = ${subscriptionId}
        AND delivery_date BETWEEN ${restoreFromDate} AND ${restoreToDate}
        AND internal_status = 'CANCELED'
      FOR UPDATE
    )
    UPDATE tasks t
    SET internal_status = 'CREATED',
        external_id = CASE
          WHEN r.external_tracking_number IS NOT NULL THEN NULL
          ELSE t.external_id
        END,
        external_tracking_number = CASE
          WHEN r.external_tracking_number IS NOT NULL THEN NULL
          ELSE t.external_tracking_number
        END,
        pushed_to_external_at = CASE
          WHEN r.external_tracking_number IS NOT NULL THEN NULL
          ELSE t.pushed_to_external_at
        END,
        outbound_sync_state = CASE
          WHEN r.external_tracking_number IS NOT NULL THEN 'pending'
          ELSE t.outbound_sync_state
        END
    FROM restorable r
    WHERE t.id = r.id AND t.tenant_id = ${tenantId}
    RETURNING t.id, r.external_tracking_number AS previous_external_tracking_number
  `);
  return rows;
}

// -----------------------------------------------------------------------------
// R-E — churn hard-stop cascade (plan day-54-session-c-re-churn-cascade §1)
// -----------------------------------------------------------------------------

export interface ChurnCascadeTaskResult {
  /** Never-pushed rows flipped CANCELED locally (no vendor to confirm). */
  readonly canceledLocalCount: number;
  /**
   * Pushed, non-terminal rows (INCLUDING driver-bound — churn is the
   * single sanctioned bypass of the R-A assignment freeze) flipped to
   * outbound_sync_state='pending_cancel' WITHOUT touching
   * internal_status: the honesty rule — local status flips only when
   * the vendor confirms (webhook) ; a refused recall keeps the true
   * status and lands the existing cancel-DLQ 'failed' signal.
   */
  readonly recalls: readonly { id: string; external_tracking_number: string }[];
}

export async function cancelConsigneeTasksForChurn(
  tx: DbTx,
  tenantId: Uuid,
  consigneeId: Uuid,
): Promise<ChurnCascadeTaskResult> {
  const canceledLocal = (await tx.execute(sqlTag`
    UPDATE tasks
    SET internal_status = 'CANCELED', updated_at = now()
    WHERE tenant_id = ${tenantId}
      AND consignee_id = ${consigneeId}
      AND external_tracking_number IS NULL
      AND internal_status NOT IN ('DELIVERED', 'FAILED', 'CANCELED')
    RETURNING id
  `)) as readonly { id: string }[];

  const recalls = (await tx.execute(sqlTag`
    UPDATE tasks
    SET outbound_sync_state = 'pending_cancel', updated_at = now()
    WHERE tenant_id = ${tenantId}
      AND consignee_id = ${consigneeId}
      AND external_tracking_number IS NOT NULL
      AND internal_status NOT IN ('DELIVERED', 'FAILED', 'CANCELED')
    RETURNING id, external_tracking_number
  `)) as readonly { id: string; external_tracking_number: string }[];

  return { canceledLocalCount: canceledLocal.length, recalls };
}

// -----------------------------------------------------------------------------
// R-A — assignment-freeze helpers (plan day-54-session-c-ra-assignment-gate §2.3)
// -----------------------------------------------------------------------------

/**
 * Status of the driver-bound task (ASSIGNED/IN_TRANSIT) at a given
 * subscription+date, or null when none. Used by the skip and one-off
 * address-override flows to convert the guarded UPDATE's null result
 * into an honest rejection instead of a silent no-op.
 */
export async function findDriverBoundTaskForSubscriptionDate(
  tx: DbTx,
  tenantId: Uuid,
  subscriptionId: Uuid,
  deliveryDate: string,
): Promise<TaskInternalStatus | null> {
  const rows = (await tx.execute(sqlTag`
    SELECT internal_status FROM tasks
    WHERE tenant_id = ${tenantId}
      AND subscription_id = ${subscriptionId}
      AND delivery_date = ${deliveryDate}
      AND internal_status IN ('ASSIGNED', 'IN_TRANSIT')
    LIMIT 1
  `)) as readonly { internal_status: TaskInternalStatus }[] | undefined;
  return rows?.[0]?.internal_status ?? null;
}

/**
 * Count of driver-bound tasks inside a pause window — the rows
 * markTasksCanceledInWindow now deliberately leaves untouched. Feeds
 * pauseSubscription's assigned_tasks_excluded audit metadata.
 */
export async function countDriverBoundTasksInWindow(
  tx: DbTx,
  tenantId: Uuid,
  subscriptionId: Uuid,
  pauseStart: string,
  pauseEnd: string,
): Promise<number> {
  const rows = (await tx.execute(sqlTag`
    SELECT count(*)::int AS n FROM tasks
    WHERE tenant_id = ${tenantId}
      AND subscription_id = ${subscriptionId}
      AND delivery_date BETWEEN ${pauseStart} AND ${pauseEnd}
      AND internal_status IN ('ASSIGNED', 'IN_TRANSIT')
  `)) as readonly { n: number }[] | undefined;
  return rows?.[0]?.n ?? 0;
}

// Task domain types.
//
// camelCase TypeScript at the module boundary; the repository layer
// maps to/from the snake_case columns in 0006_task.sql + 0007_task_package.sql.
//
// The Task aggregate root carries its packages as a non-nullable array
// (zero or more — the schema does not require packages to exist, even
// though every pilot-scope task will have at least one). Reads return
// fully-hydrated tasks; writes accept the package list inline so the
// service layer can transact a parent + N children atomically.
//
// Day-5 limitation, documented for the T-3/T-4 review: the patch shape
// uses `field?: T` for nullable optional columns. Field omitted means
// "do not change"; there is no way through this shape to *clear* a
// previously-set nullable column back to NULL. Same gap as the C-3
// consignees patch shape — extend with explicit-null support
// (e.g., `paymentMethod?: string | null`) when the edit UI lands.
//
// Excluded from `UpdateTaskPatch` deliberately:
//   - id, tenantId, consigneeId, subscriptionId — identity / association
//     columns, not edited in place. Re-creating the task is the supported
//     reassignment path per the assignment-cutoff rule (Day 8+).
//   - externalId, externalTrackingNumber, pushedToExternalAt — populated
//     by specific lifecycle paths (Day-7 cron post-push), not the generic
//     update surface.
//   - packages — packages have their own update path (which lands when
//     the webhook receiver wires up in Day 6 / a future task).
//   - createdAt, updatedAt — repository-managed.

import type { IsoTimestamp, Uuid } from "@/shared/types";

/** 7-value internal status. Mirrors the CHECK constraint on tasks.internal_status. */
export type TaskInternalStatus =
  | "CREATED"
  | "ASSIGNED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "FAILED"
  | "CANCELED"
  | "ON_HOLD";

/** 2-value task kind. Mirrors the CHECK constraint on tasks.task_kind. */
export type TaskKind = "DELIVERY" | "PICKUP";

/** 6-value package status. Mirrors the CHECK constraint on task_packages.package_status. */
export type TaskPackageStatus =
  | "ORDERED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "FAILED"
  | "RETURNED";

export interface TaskPackage {
  readonly id: Uuid;
  readonly taskId: Uuid;
  readonly tenantId: Uuid;
  readonly externalPackageId: string | null;
  readonly trackingId: string | null;
  readonly packageStatus: TaskPackageStatus;
  readonly position: number;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface Task {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly consigneeId: Uuid;
  /** Nullable until subscriptions module lands Day 6. */
  readonly subscriptionId: Uuid | null;
  readonly customerOrderNumber: string;
  readonly referenceNumber: string | null;
  readonly internalStatus: TaskInternalStatus;
  /** Set by the Day-7 push path; null until pushed. */
  readonly externalId: string | null;
  /** Set by the Day-7 push path; null until pushed. */
  readonly externalTrackingNumber: string | null;
  /** ISO date (YYYY-MM-DD), Asia/Dubai per cutoff convention. */
  readonly deliveryDate: string;
  /** HH:MM:SS, Asia/Dubai. */
  readonly deliveryStartTime: string;
  /** HH:MM:SS, Asia/Dubai. */
  readonly deliveryEndTime: string;
  readonly deliveryType: string;
  readonly taskKind: TaskKind;
  /**
   * Nullable per the S-8 finding — SuiteFleet drops the field from
   * create-response payloads. Webhook payload may surface it; verified
   * empirically Day 6+.
   */
  readonly paymentMethod: string | null;
  /**
   * AED, two decimals. Returned as a string (postgres-js preserves
   * `numeric` precision via string serialisation; Number coercion would
   * lose accuracy on values > 2^53).
   */
  readonly codAmount: string | null;
  readonly declaredValue: string | null;
  /** Kilograms, three decimals. String for the same reason as codAmount. */
  readonly weightKg: string | null;
  readonly notes: string | null;
  readonly signatureRequired: boolean;
  readonly smsNotifications: boolean;
  readonly deliverToCustomerOnly: boolean;
  /** ISO 8601 with timezone; null until the Day-7 cron pushes the task. */
  readonly pushedToExternalAt: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  /** Zero or more packages, ordered by `position` ascending. */
  readonly packages: readonly TaskPackage[];
}

/**
 * Per-package payload accepted by `insertTaskWithPackages`. The
 * task_id and tenant_id are supplied by the repository (read from
 * the freshly-inserted parent task and the call's tenantId); the
 * `position` and optional `packageStatus` are caller-supplied.
 *
 * `externalPackageId` and `trackingId` are deliberately not in this
 * type — those are populated by the webhook receiver (Day 6+) and are
 * not part of the create surface.
 */
export interface CreateTaskPackageInput {
  readonly position: number;
  readonly packageStatus?: TaskPackageStatus;
}

/**
 * Insert payload. `tenantId` is supplied by the service layer
 * (typically `ctx.tenantId`); keeping it out of this type makes
 * accidental tenant-id-from-input impossible.
 *
 * `internalStatus`, `taskKind`, `deliveryType`, `signatureRequired`,
 * `smsNotifications`, `deliverToCustomerOnly` are optional because the
 * SQL DEFAULTs cover them. Callers may override.
 */
export interface CreateTaskInput {
  readonly consigneeId: Uuid;
  readonly subscriptionId?: Uuid;
  readonly customerOrderNumber: string;
  readonly referenceNumber?: string;
  readonly internalStatus?: TaskInternalStatus;
  readonly deliveryDate: string;
  readonly deliveryStartTime: string;
  readonly deliveryEndTime: string;
  readonly deliveryType?: string;
  readonly taskKind?: TaskKind;
  readonly paymentMethod?: string;
  readonly codAmount?: string;
  readonly declaredValue?: string;
  readonly weightKg?: string;
  readonly notes?: string;
  readonly signatureRequired?: boolean;
  readonly smsNotifications?: boolean;
  readonly deliverToCustomerOnly?: boolean;
  /**
   * Zero or more packages inserted atomically alongside the parent
   * task. Pilot-scope tasks always have at least one; the repository
   * does not enforce a minimum, the service layer does.
   */
  readonly packages: readonly CreateTaskPackageInput[];
}

/**
 * Update payload. Every field is optional — only present fields are
 * written. Identity columns, association columns, lifecycle columns
 * (external refs, pushed_to_external_at), and packages are excluded
 * by design (see file header).
 */
export interface UpdateTaskPatch {
  readonly customerOrderNumber?: string;
  readonly referenceNumber?: string;
  readonly internalStatus?: TaskInternalStatus;
  readonly deliveryDate?: string;
  readonly deliveryStartTime?: string;
  readonly deliveryEndTime?: string;
  readonly deliveryType?: string;
  readonly taskKind?: TaskKind;
  readonly paymentMethod?: string;
  readonly codAmount?: string;
  readonly declaredValue?: string;
  readonly weightKg?: string;
  readonly notes?: string;
  readonly signatureRequired?: boolean;
  readonly smsNotifications?: boolean;
  readonly deliverToCustomerOnly?: boolean;
}

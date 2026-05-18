// /tasks page server actions — Day-30 B2 (plan #308 v2, §3.6 cleared).
//
// Three operator-facing actions on the merchant /tasks list:
//   - cancelTaskAction        — subscription-linked task only (OQ-1 single-canonical-path)
//   - editTaskAddressAction   — addressId only (OQ-2 Path A, OQ-5 .pick whitelist)
//   - editTaskNoteAction      — notes only (OQ-4 addNoteToDriver path)
// Plus one read helper for the edit modal:
//   - getTaskEditContextAction — returns the current task + available consignee addresses
//
// All actions:
//   - REUSE existing service-layer fns (no new service code per plan §1 locked constraint)
//   - Are gated by `.pick().strict()` boundary schemas to enforce the
//     §6 OQ-5 defense-in-depth contract — delivery-date is rejected even
//     though UpdateTaskBodySchema admits it
//   - Return discriminated-union results so the client component can
//     surface inline UX without throwing
//
// OQ-1 single-canonical-path enforcement:
//   - cancelTaskAction dispatches subscription-linked tasks through
//     addSubscriptionException(type: "skip", skipWithoutAppend: true) —
//     the literal mechanism behind cancelNoAppendAction.
//   - Ad-hoc tasks (subscription_id IS NULL) are REJECTED server-side
//     with ValidationError. The UI ALSO renders the button disabled
//     for ad-hoc rows (two-layer defense-in-depth per B2-I2′; disabled
//     button is bypassable).
//   - tasks.cancelTask service-fn is intentionally NOT consumed.
//
// OQ-3 UX disclosure: the client surfaces the verbatim copy
//   "Address change saved; SuiteFleet will reflect on the next
//    scheduled push pass"
// after a successful address edit. Copy must NOT be paraphrased.

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { addSubscriptionException } from "@/modules/subscription-exceptions";
import {
  addNoteToDriver,
  getTask,
  updateTask,
} from "@/modules/tasks";
import { listConsigneeAddresses } from "@/modules/subscription-addresses";
import type { ConsigneeAddressRow } from "@/modules/subscription-addresses";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

// =============================================================================
// Discriminated-union result shapes
// =============================================================================

export type CancelTaskActionResult =
  | { readonly kind: "success" }
  | { readonly kind: "idempotent_replay" }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "validation"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

export type EditTaskActionResult =
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "validation"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

export type GetTaskEditContextActionResult =
  | {
      readonly kind: "success";
      readonly task: {
        readonly id: string;
        readonly addressId: string | null;
        readonly notes: string | null;
        readonly deliveryDate: string;
      };
      readonly availableAddresses: readonly ConsigneeAddressRow[];
    }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "validation"; readonly message: string };

type IdleOrCancelResult = CancelTaskActionResult | { readonly kind: "idle" };
type IdleOrEditResult = EditTaskActionResult | { readonly kind: "idle" };

// =============================================================================
// Boundary schemas — OQ-5 defense-in-depth .pick().strict()
// =============================================================================
//
// UpdateTaskBodySchema admits 16 fields including deliveryDate. The B2
// /tasks-page form-action surface NARROWS the contract to addressId or
// notes only. Any other field — including deliveryDate — fails parse
// before the service-layer call is issued, with a clear inline message
// that points the operator to the calendar-popover skip-with-override
// (the canonical date-edit surface). Pinned by integration spec B2-I7.

const AddressEditSchema = z
  .object({
    addressId: z.string().uuid({ message: "addressId must be a uuid" }),
  })
  .strict();

const NoteEditSchema = z
  .object({
    notes: z.string().min(1, { message: "Note cannot be empty." }),
  })
  .strict();

// =============================================================================
// cancelTaskAction — OQ-1 single-canonical-path
// =============================================================================

export async function cancelTaskAction(
  taskId: string,
  _prevState: IdleOrCancelResult,
  _formData: FormData,
): Promise<CancelTaskActionResult> {
  const requestId = randomUUID();
  const idempotencyKey = randomUUID();

  try {
    const ctx = await buildRequestContext("/tasks", requestId);
    const task = await getTask(ctx, taskId as Uuid);
    if (task === null) {
      return { kind: "not_found", message: "Task not found." };
    }

    // OQ-1 ad-hoc rejection — server-side defense-in-depth. The UI
    // renders the button disabled for ad-hoc rows, but a disabled
    // button is bypassable via direct POST. This rejection pins the
    // contract.
    if (task.subscriptionId === null) {
      return {
        kind: "validation",
        message:
          "Ad-hoc tasks cannot be cancelled from /tasks; cancel directly on SuiteFleet.",
      };
    }

    // Subscription-linked: route through cancelNoAppendAction's exact
    // service path (addSubscriptionException type='skip' + skipWithoutAppend).
    // Post-#305: in-tx markTaskSkipped flips outbound_sync_state→'pending_cancel'
    // when external_tracking_number IS NOT NULL; post-commit enqueueCancelTask
    // fires for SF outbound. Time-cutoff guard at service.ts:397.
    const result = await addSubscriptionException(ctx, task.subscriptionId, {
      type: "skip",
      date: task.deliveryDate,
      idempotencyKey: idempotencyKey as Uuid,
      skipWithoutAppend: true,
    });

    revalidatePath("/tasks", "page");

    return result.status === "idempotent_replay"
      ? { kind: "idempotent_replay" }
      : { kind: "success" };
  } catch (err) {
    return mapToCancelResult(err);
  }
}

// =============================================================================
// editTaskAddressAction — OQ-2 Path A (updateTask direct column write)
// =============================================================================

export async function editTaskAddressAction(
  taskId: string,
  _prevState: IdleOrEditResult,
  formData: FormData,
): Promise<EditTaskActionResult> {
  const requestId = randomUUID();

  // OQ-5 defense-in-depth — pass the full FormData entry-set so `.strict()`
  // can reject any extraneous key (e.g. deliveryDate). Hand-extracting only
  // the expected key with formData.get(...) would make `.strict()` a no-op
  // because Zod would never see the extras. Pinned by B2-I7.
  const parsed = AddressEditSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      kind: "validation",
      message: firstIssue?.message ?? "Pick an address.",
    };
  }

  try {
    const ctx = await buildRequestContext("/tasks", requestId);
    await updateTask(ctx, taskId as Uuid, { addressId: parsed.data.addressId as Uuid });

    revalidatePath("/tasks", "page");

    // OQ-3 verbatim UX copy — DO NOT paraphrase. Pinned by integration spec.
    return {
      kind: "success",
      message: "Address change saved; SuiteFleet will reflect on the next scheduled push pass",
    };
  } catch (err) {
    return mapToEditResult(err, "Task");
  }
}

// =============================================================================
// editTaskNoteAction — OQ-4 addNoteToDriver
// =============================================================================

export async function editTaskNoteAction(
  taskId: string,
  _prevState: IdleOrEditResult,
  formData: FormData,
): Promise<EditTaskActionResult> {
  const requestId = randomUUID();

  // OQ-5 defense-in-depth — see AddressEditSchema rationale above.
  const parsed = NoteEditSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      kind: "validation",
      message: firstIssue?.message ?? "Note cannot be empty.",
    };
  }

  try {
    const ctx = await buildRequestContext("/tasks", requestId);
    await addNoteToDriver(ctx, taskId as Uuid, parsed.data.notes);

    revalidatePath("/tasks", "page");

    return { kind: "success", message: "Driver note saved." };
  } catch (err) {
    return mapToEditResult(err, "Task");
  }
}

// =============================================================================
// getTaskEditContextAction — modal data fetch
// =============================================================================

export async function getTaskEditContextAction(
  taskId: string,
): Promise<GetTaskEditContextActionResult> {
  const requestId = randomUUID();

  try {
    const ctx = await buildRequestContext("/tasks", requestId);
    const task = await getTask(ctx, taskId as Uuid);
    if (task === null) {
      return { kind: "not_found", message: "Task not found." };
    }
    const availableAddresses = await listConsigneeAddresses(ctx, task.consigneeId);

    return {
      kind: "success",
      task: {
        id: task.id,
        addressId: task.addressId,
        notes: task.notes,
        deliveryDate: task.deliveryDate,
      },
      availableAddresses,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { kind: "forbidden", message: "You don't have permission to read this task." };
    }
    if (err instanceof NotFoundError) {
      return { kind: "not_found", message: "Task not found." };
    }
    if (err instanceof ValidationError) {
      return { kind: "validation", message: err.message };
    }
    throw err;
  }
}

// =============================================================================
// Error → result mappers
// =============================================================================

function mapToCancelResult(err: unknown): CancelTaskActionResult {
  if (err instanceof ConflictError) {
    return { kind: "conflict", message: err.message };
  }
  if (err instanceof ForbiddenError) {
    return {
      kind: "forbidden",
      message: "You don't have permission to cancel this task.",
    };
  }
  if (err instanceof NotFoundError) {
    return { kind: "not_found", message: "Task or subscription not found." };
  }
  if (err instanceof ValidationError) {
    // Cutoff guard message from addSubscriptionException surfaces here:
    // "delivery date is past the 18:00 Dubai cut-off the day before; cannot apply exception"
    return { kind: "validation", message: err.message };
  }
  throw err;
}

function mapToEditResult(err: unknown, resourceLabel: string): EditTaskActionResult {
  if (err instanceof ConflictError) {
    return { kind: "conflict", message: err.message };
  }
  if (err instanceof ForbiddenError) {
    return { kind: "forbidden", message: "You don't have permission to edit this task." };
  }
  if (err instanceof NotFoundError) {
    return { kind: "not_found", message: `${resourceLabel} not found.` };
  }
  if (err instanceof ValidationError) {
    return { kind: "validation", message: err.message };
  }
  throw err;
}

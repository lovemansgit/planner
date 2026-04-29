// /api/tasks/[id] — per-row routes (GET + PATCH).
//
// GET    /api/tasks/:id   task:read    (no audit, per R-4)
// PATCH  /api/tasks/:id   task:update  → task.updated
//                                        (only when fields change)
//
// Per the Day-5 design call (memory/decision_task_module_no_user_create_delete.md):
// no DELETE endpoint. There is no MVP caller for user-driven task
// deletion; the cron uses the failed_pushes DLQ rather than delete +
// retry, and administrative cleanup is out-of-band.
//
// Same demo-context + Zod-at-boundary pattern as the consignees
// routes. Returns 404 when the row is missing or RLS-hidden — same
// observable state from the caller's viewpoint per R-3.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getTask, updateTask } from "@/modules/tasks";
import { buildDemoContext } from "@/shared/demo-context";
import { NotFoundError, ValidationError } from "@/shared/errors";

import { errorResponse } from "../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// -----------------------------------------------------------------------------
// Request schemas
// -----------------------------------------------------------------------------

const IdParamSchema = z.string().uuid({ message: "id must be a uuid" });

// Patch shape mirrors UpdateTaskPatch from the tasks module. Identity,
// association, and lifecycle columns (id, tenantId, consigneeId,
// subscriptionId, externalId, externalTrackingNumber, pushedToExternalAt,
// timestamps) are deliberately excluded — those are not patchable
// through the user-facing surface. The service layer enforces the
// same invariant; the boundary schema makes it explicit.
const UpdateBodySchema = z
  .object({
    customerOrderNumber: z.string().optional(),
    referenceNumber: z.string().optional(),
    internalStatus: z
      .enum(["CREATED", "ASSIGNED", "IN_TRANSIT", "DELIVERED", "FAILED", "CANCELED", "ON_HOLD"])
      .optional(),
    deliveryDate: z.string().optional(),
    deliveryStartTime: z.string().optional(),
    deliveryEndTime: z.string().optional(),
    deliveryType: z.string().optional(),
    taskKind: z.enum(["DELIVERY", "PICKUP"]).optional(),
    paymentMethod: z.string().optional(),
    codAmount: z.string().optional(),
    declaredValue: z.string().optional(),
    weightKg: z.string().optional(),
    notes: z.string().optional(),
    signatureRequired: z.boolean().optional(),
    smsNotifications: z.boolean().optional(),
    deliverToCustomerOnly: z.boolean().optional(),
  })
  .strict();

// Next.js 16 dynamic route segments are async — `params` is a Promise.
type RouteContext = { params: Promise<{ id: string }> };

// -----------------------------------------------------------------------------
// GET /api/tasks/:id
// -----------------------------------------------------------------------------

export async function GET(_req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    const ctx = await buildDemoContext(`/api/tasks/${id}`, requestId);
    const row = await getTask(ctx, id);
    if (!row) {
      throw new NotFoundError(`task not found: ${id}`);
    }
    return NextResponse.json(row);
  } catch (e) {
    return errorResponse(e);
  }
}

// -----------------------------------------------------------------------------
// PATCH /api/tasks/:id
// -----------------------------------------------------------------------------

export async function PATCH(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);

    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = UpdateBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(`request body invalid: ${parsed.error.message}`);
    }

    const ctx = await buildDemoContext(`/api/tasks/${id}`, requestId);
    const updated = await updateTask(ctx, id, parsed.data);
    return NextResponse.json(updated);
  } catch (e) {
    return errorResponse(e);
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function parseId(raw: string): string {
  const result = IdParamSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(`id must be a uuid, got '${raw}'`);
  }
  return result.data;
}

// /api/subscriptions/[id] — per-row routes (GET + PATCH).
//
// GET    /api/subscriptions/:id   subscription:read    (no audit, per R-4)
// PATCH  /api/subscriptions/:id   subscription:update  → subscription.updated
//                                                       (only when fields change)
//
// Lifecycle transitions (pause / resume / end) live on dedicated
// sub-routes — `/api/subscriptions/:id/pause` etc. — to mirror the
// 1:1 permission ↔ audit-event design from S-4. PATCH does NOT
// accept a `status` field; the lifecycle columns are deliberately
// absent from `UpdateSubscriptionBodySchema`.
//
// Same demo-context + Zod-at-boundary pattern as the consignees /
// tasks routes. Returns 404 when the row is missing or RLS-hidden —
// same observable state from the caller's viewpoint per R-3.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSubscription, updateSubscription } from "@/modules/subscriptions";
import { UpdateSubscriptionBodySchema } from "@/modules/subscriptions/schemas";
import { buildRequestContext } from "@/shared/request-context";
import { NotFoundError, ValidationError } from "@/shared/errors";

import { errorResponse } from "../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// -----------------------------------------------------------------------------
// Request schemas
// -----------------------------------------------------------------------------

const IdParamSchema = z.string().uuid({ message: "id must be a uuid" });

// Next.js 16 dynamic route segments are async — `params` is a Promise.
type RouteContext = { params: Promise<{ id: string }> };

// -----------------------------------------------------------------------------
// GET /api/subscriptions/:id
// -----------------------------------------------------------------------------

export async function GET(_req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    const ctx = await buildRequestContext(`/api/subscriptions/${id}`, requestId);
    const row = await getSubscription(ctx, id);
    if (!row) {
      throw new NotFoundError(`subscription not found: ${id}`);
    }
    return NextResponse.json(row);
  } catch (e) {
    return errorResponse(e);
  }
}

// -----------------------------------------------------------------------------
// PATCH /api/subscriptions/:id
// -----------------------------------------------------------------------------

export async function PATCH(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);

    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = UpdateSubscriptionBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(`request body invalid: ${parsed.error.message}`);
    }

    const ctx = await buildRequestContext(`/api/subscriptions/${id}`, requestId);
    const updated = await updateSubscription(ctx, id, parsed.data);
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

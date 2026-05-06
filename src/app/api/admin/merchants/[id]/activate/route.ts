// POST /api/admin/merchants/:id/activate   merchant:activate
//                                          → merchant.activated
//
// Day-16 Block 4-F Commit 4 — admin merchant activate route.
// Composes against Service D `activateMerchant` from
// `src/modules/merchants/service.ts` (Block 4-D commit 8c52cfb).
// PLAN-STRICT state machine per Block 4-D Option C: only
// `provisioning → active` transition is allowed; all other from-
// states fail with ConflictError 409 at the service layer.
//
// Auth posture per Block 4-F §A Option A: SERVICE-LAYER-ONLY
// enforcement via Service D's requirePermission(merchant:activate).
// Mirrors the rejectAnyBody body-less POST precedent from
// `failed-pushes/[id]/retry/route.ts:91-96`.
//
// Body: NONE. Empty body or `{}` accepted; any non-empty body → 400.
//
// Success:
//   - 200 with ActivateMerchantResult JSON
//     { status: 'activated', tenantId, previousStatus, newStatus }
//
// Errors:
//   - 400 ValidationError (non-uuid id; non-empty body)
//   - 403 ForbiddenError (lacks merchant:activate)
//   - 404 NotFoundError (merchant not found)
//   - 409 ConflictError (status !== 'provisioning' — locks plan-strict
//                        state machine per Block 4-D Option C)

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { activateMerchant } from "@/modules/merchants";
import { buildRequestContext } from "@/shared/request-context";
import { ValidationError } from "@/shared/errors";
import type { Uuid } from "@/shared/types";

import { errorResponse } from "../../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const IdParamSchema = z.string().uuid({ message: "id must be a uuid" });

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    rejectAnyBody(await req.json().catch(() => undefined));

    const ctx = await buildRequestContext(
      `/api/admin/merchants/${id}/activate`,
      requestId,
    );

    const result = await activateMerchant(ctx, id as Uuid);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return errorResponse(e);
  }
}

function parseId(raw: string): string {
  const result = IdParamSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(`id must be a uuid, got '${raw}'`);
  }
  return result.data;
}

/**
 * Mirrors the `rejectAnyBody` pattern from
 * `failed-pushes/[id]/retry/route.ts:91-96`. POSTs with no body
 * (req.json() rejects → undefined) and POSTs with empty `{}` are
 * both accepted; any non-empty body shape is a contract violation
 * (this endpoint takes no body) and yields 400.
 */
function rejectAnyBody(body: unknown): void {
  if (body === undefined) return;
  if (typeof body !== "object" || body === null || Object.keys(body).length > 0) {
    throw new ValidationError("activate endpoint takes no body");
  }
}

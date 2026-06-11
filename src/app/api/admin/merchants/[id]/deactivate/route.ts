// POST /api/admin/merchants/:id/deactivate   merchant:deactivate
//                                            → merchant.deactivated
//
// Day-16 Block 4-F Commit 4 — admin merchant deactivate route.
// Composes against Service D `deactivateMerchant` from
// `src/modules/merchants/service.ts` (Block 4-D commit 8c52cfb).
// PLAN-STRICT state machine per Block 4-D Option C: only
// `active → inactive` transition is allowed; all other from-states
// (provisioning, suspended, inactive) → ConflictError 409.
//
// Auth posture per Block 4-F §A Option A: SERVICE-LAYER-ONLY
// enforcement via Service D's requirePermission(merchant:deactivate).
//
// Body: NONE. Same `rejectAnyBody` pattern as the activate route.
//
// Success:
//   - 200 with DeactivateMerchantResult JSON
//     { status: 'deactivated', tenantId, previousStatus, newStatus }
//
// Errors:
//   - 400 ValidationError (non-uuid id; non-empty body)
//   - 403 ForbiddenError (lacks merchant:deactivate)
//   - 404 NotFoundError (merchant not found)
//   - 409 ConflictError (status !== 'active' — locks plan-strict
//                        state machine per Block 4-D Option C)

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { deactivateMerchant } from "@/modules/merchants";
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
      `/api/admin/merchants/${id}/deactivate`,
      requestId,
    );

    const result = await deactivateMerchant(ctx, id as Uuid);
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

/** Mirrors `rejectAnyBody` from `failed-pushes/[id]/retry/route.ts:91-96`. */
function rejectAnyBody(body: unknown): void {
  if (body === undefined) return;
  if (typeof body !== "object" || body === null || Object.keys(body).length > 0) {
    throw new ValidationError("deactivate endpoint takes no body");
  }
}

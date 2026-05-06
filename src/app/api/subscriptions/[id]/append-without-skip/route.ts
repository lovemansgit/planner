// POST /api/subscriptions/:id/append-without-skip
//                                     subscription:override_skip_rules
//                                     → subscription.exception.created
//                                       + subscription.end_date.extended
//
// Day-16 Block 4-F Commit 1 — append-without-skip route handler.
// Composes against Service A `appendWithoutSkip` (the dedicated
// goodwill-flow entry point per merged plan §3.1 + service.ts:660+).
//
// Body shape per merged plan §6.1 row 2 (snake_case at the wire):
//   { reason, idempotency_key, target_date_override? }
//
// `reason` is REQUIRED here (distinct from skip's optional reason)
// per merged plan §3.6 + Service A's `appendWithoutSkip` contract —
// every operator-initiated tail-end addition is reason-recorded for
// the audit trail.
//
// Permission gate: Service A's `appendWithoutSkip` requires
// 'subscription:override_skip_rules' unconditionally (no input-shape
// resolution like the skip variant — append is always an override-
// permission action per merged plan §1).
//
// Success:
//   - 201 with AppendWithoutSkipResult JSON (status='inserted')
//   - 409 with AppendWithoutSkipResult JSON (status='idempotent_replay')
//
// Errors:
//   - 400 ValidationError (input shape, malformed JSON, missing reason)
//   - 403 ForbiddenError (lacks subscription:override_skip_rules)
//   - 404 NotFoundError (subscription not in tenant)
//   - 409 ConflictError (subscription not active)

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { appendWithoutSkip } from "@/modules/subscription-exceptions";
import type { AppendWithoutSkipInput } from "@/modules/subscription-exceptions";
import { buildRequestContext } from "@/shared/request-context";
import { ValidationError } from "@/shared/errors";
import type { Uuid } from "@/shared/types";

import { errorResponse } from "../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const IdParamSchema = z.string().uuid({ message: "id must be a uuid" });

/**
 * Body schema — wire-side snake_case per merged plan §6.1 + the
 * existing pause/resume convention. `idempotency_key` is REQUIRED
 * per merged plan §6.5. `reason` is REQUIRED per Service A's
 * `appendWithoutSkip` contract (every goodwill addition is operator-
 * recorded).
 */
const AppendBodySchema = z.object({
  reason: z.string().min(1),
  idempotency_key: z.string().uuid({ message: "idempotency_key must be a uuid" }),
  target_date_override: z.string().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    const body = parseBody(await req.json().catch(() => undefined));

    const ctx = await buildRequestContext(
      `/api/subscriptions/${id}/append-without-skip`,
      requestId,
    );

    const serviceInput: AppendWithoutSkipInput = {
      reason: body.reason,
      idempotencyKey: body.idempotency_key as Uuid,
      targetDateOverride: body.target_date_override,
    };

    const result = await appendWithoutSkip(ctx, id as Uuid, serviceInput);
    return NextResponse.json(result, { status: result.httpStatus });
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

function parseBody(body: unknown): z.infer<typeof AppendBodySchema> {
  if (body === undefined || body === null) {
    throw new ValidationError(
      "append-without-skip endpoint requires a body: { reason, idempotency_key, target_date_override? }",
    );
  }
  const parsed = AppendBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(`append-without-skip body invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

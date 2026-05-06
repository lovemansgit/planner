// POST /api/subscriptions/:id/pause   subscription:pause → subscription.paused
//
// Day-16 Block 4-C — bounded pause per brief §3.1.7. Body shape:
//   { pause_start, pause_end, reason?, idempotency_key }
//
// Replaces the pre-Day-16 placeholder route which took no body. The
// rewrite lands alongside the service-layer rewrite at
// `src/modules/subscriptions/service.ts:pauseSubscription`.
//
// Success:
//   - 201 with PauseSubscriptionResult JSON (status='inserted')
//   - 200 with PauseSubscriptionResult JSON (status='idempotent_replay'
//     — but the service maps to http_status: 409; surfacing here as 409)
//
// Errors:
//   - 400 ValidationError (input shape, cut-off elapsed)
//   - 403 ForbiddenError (lacks subscription:pause)
//   - 404 NotFoundError (subscription not in tenant)
//   - 409 ConflictError (subscription not active, OR idempotent replay)

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { pauseSubscription } from "@/modules/subscriptions";
import { PauseSubscriptionBodySchema } from "@/modules/subscriptions/schemas";
import { buildRequestContext } from "@/shared/request-context";
import { ValidationError } from "@/shared/errors";

import { errorResponse } from "../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const IdParamSchema = z.string().uuid({ message: "id must be a uuid" });

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    const body = parseBody(await req.json().catch(() => undefined));

    const ctx = await buildRequestContext(`/api/subscriptions/${id}/pause`, requestId);
    const result = await pauseSubscription(ctx, id, body);
    return NextResponse.json(result, { status: result.http_status });
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

function parseBody(body: unknown): {
  pause_start: string;
  pause_end: string;
  reason?: string;
  idempotency_key: string;
} {
  if (body === undefined || body === null) {
    throw new ValidationError(
      "pause endpoint requires a body: { pause_start, pause_end, reason?, idempotency_key }",
    );
  }
  const parsed = PauseSubscriptionBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(`pause body invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

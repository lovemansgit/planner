// POST /api/subscriptions/:id/pause   subscription:pause → subscription.paused
//
// Lifecycle transition: 'active' → 'paused'. Takes NO request body —
// the id is path-only, the transition is the verb. An incoming body
// is allowed to be empty (`{}`) or absent; ANY key is rejected to
// stop a caller from stuffing a `status` field into a /pause request
// and having it silently dropped at parse time.
//
// Success: 200 with the updated Subscription as JSON.
// Returns 404 when the row is missing or RLS-hidden.
// Returns 409 (ConflictError → CONFLICT, mapped at error-response.ts:51)
// when the row exists but is not in 'active' state — propagated from
// the repository's state-validity guard (S-3).

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { pauseSubscription } from "@/modules/subscriptions";
import { LifecycleNoBodySchema } from "@/modules/subscriptions/schemas";
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
    rejectAnyBody(await req.json().catch(() => undefined));

    const ctx = await buildRequestContext(`/api/subscriptions/${id}/pause`, requestId);
    const updated = await pauseSubscription(ctx, id);
    return NextResponse.json(updated);
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
 * Lifecycle endpoints take no input. Allow an absent body or `{}`;
 * reject anything else (including a non-object payload). Wrap the
 * .strict() empty-object schema so a typo'd field name surfaces at
 * the boundary as a 400 ValidationError instead of being silently
 * ignored.
 */
function rejectAnyBody(body: unknown): void {
  if (body === undefined) return;
  const parsed = LifecycleNoBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      `lifecycle endpoint takes no body: ${parsed.error.message}`
    );
  }
}

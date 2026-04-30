// POST /api/subscriptions/:id/pause   subscription:pause → subscription.paused
//
// Lifecycle transition: 'active' → 'paused'. No request body.
//
// Returns 404 when the row is missing or RLS-hidden.
// Returns 409 (ConflictError → CONFLICT) when the row exists but is
// not in 'active' state — propagated from the repository's state-
// validity guard (S-3).

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { pauseSubscription } from "@/modules/subscriptions";
import { buildDemoContext } from "@/shared/demo-context";
import { ValidationError } from "@/shared/errors";

import { errorResponse } from "../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const IdParamSchema = z.string().uuid({ message: "id must be a uuid" });

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    const ctx = await buildDemoContext(`/api/subscriptions/${id}/pause`, requestId);
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

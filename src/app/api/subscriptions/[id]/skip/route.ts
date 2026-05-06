// POST /api/subscriptions/:id/skip   subscription:skip|override_skip_rules
//                                     → subscription.exception.created
//                                     [+ subscription.end_date.extended]
//
// Day-16 Block 4-F Commit 1 — skip route handler. Composes against
// Service A `addSubscriptionException` with `type='skip'` fixed.
//
// Body shape per merged plan §6.1 row 1 (snake_case at the wire):
//   { date, reason?, idempotency_key, target_date_override?, skip_without_append? }
//
// Permission gate: Service A resolves the required permission from
// input shape per merged plan §1 + service.ts:141-147 (default skip
// → 'subscription:skip'; target_date_override OR skip_without_append=true
// → 'subscription:override_skip_rules'). The route does NOT do its
// own gate; it builds ctx + calls service + lets service throw
// ForbiddenError → errorResponse → 403.
//
// Success:
//   - 201 with AddSubscriptionExceptionResult JSON (status='inserted')
//   - 409 with AddSubscriptionExceptionResult JSON (status='idempotent_replay')
//
// Errors:
//   - 400 ValidationError (input shape, cut-off elapsed, malformed JSON,
//                          days-of-week mismatch, address ownership)
//   - 403 ForbiddenError (lacks permission resolved by service)
//   - 404 NotFoundError (subscription not in tenant)
//   - 409 ConflictError (subscription not active)

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { addSubscriptionException } from "@/modules/subscription-exceptions";
import type { AddSubscriptionExceptionInput } from "@/modules/subscription-exceptions";
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
 * per merged plan §6.5 (locked Zod contract; no `.optional()`,
 * no server-side fallback).
 *
 * `date` is a free-form string — Service A asserts the YYYY-MM-DD
 * shape via `assertIsoDate` per shipped semantic. The route does
 * not pre-validate the date format here to keep the error-message
 * surface owned by the service layer.
 */
const SkipBodySchema = z.object({
  date: z.string().min(1),
  reason: z.string().optional(),
  idempotency_key: z.string().uuid({ message: "idempotency_key must be a uuid" }),
  target_date_override: z.string().optional(),
  skip_without_append: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    const body = parseBody(await req.json().catch(() => undefined));

    const ctx = await buildRequestContext(`/api/subscriptions/${id}/skip`, requestId);

    const serviceInput: AddSubscriptionExceptionInput = {
      type: "skip",
      date: body.date,
      reason: body.reason,
      idempotencyKey: body.idempotency_key as Uuid,
      targetDateOverride: body.target_date_override,
      skipWithoutAppend: body.skip_without_append,
    };

    const result = await addSubscriptionException(ctx, id as Uuid, serviceInput);
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

function parseBody(body: unknown): z.infer<typeof SkipBodySchema> {
  if (body === undefined || body === null) {
    throw new ValidationError(
      "skip endpoint requires a body: { date, reason?, idempotency_key, target_date_override?, skip_without_append? }",
    );
  }
  const parsed = SkipBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(`skip body invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

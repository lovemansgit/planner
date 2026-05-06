// POST /api/subscriptions/:id/address-override
//                  subscription:change_address_one_off
//                  OR subscription:change_address_forward
//                  → subscription.exception.created
//                    + subscription.address_override.applied
//
// Day-16 Block 4-F Commit 2 — address override route handler.
// Discriminated body per Block 4-E §C C1 ruling + merged plan
// §6.1 row 6: this route is the API-layer thunk for Service E (2)
// + (3); it composes against Service A `addSubscriptionException`
// with `type='address_override_one_off'` or `'address_override_forward'`
// fixed based on the body's `scope` discriminator.
//
// Body shape per merged plan §6.1 row 6 (snake_case at the wire):
//   {
//     scope: 'one_off' | 'forward',
//     date: <YYYY-MM-DD>,
//     address_id: <uuid>,
//     idempotency_key: <uuid>
//   }
//
// scope='one_off' → service input type='address_override_one_off'
// scope='forward' → service input type='address_override_forward'
//
// Permission gate: Service A's resolveRequiredPermission per
// service.ts:148-151 maps the type to the appropriate
// subscription:change_address_one_off / _forward permission. Route
// does NOT pre-resolve.
//
// Cross-consignee address ownership: Service A's address_override
// branches call findAddressForConsignee at step 5b (per Block 4-E
// §B B1 — extension shipped at 92edee6). Route does NOT pre-validate.
//
// Success:
//   - 201 with AddSubscriptionExceptionResult JSON (status='inserted')
//   - 409 with AddSubscriptionExceptionResult JSON (status='idempotent_replay')
//
// Errors:
//   - 400 ValidationError (input shape, malformed date, address ownership,
//                          cut-off elapsed, days-of-week mismatch)
//   - 403 ForbiddenError (lacks the resolved permission)
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
 * Discriminated-union body schema. Zod's `discriminatedUnion`
 * narrows on the `scope` literal at parse time, providing typed
 * exhaustiveness in the route handler. First codebase use of the
 * pattern (Day-16 pre-flight probe confirmed Zod 4 supports it).
 *
 * `date` validated as YYYY-MM-DD via `z.string().date()` (Zod 3.23+
 * built-in; verified against pinned package.json zod ^4.3.6).
 *
 * Both branches have identical fields except for the `scope`
 * literal — the duplication is deliberate (Zod requires distinct
 * object schemas per branch); future fields that diverge between
 * one_off and forward go in their respective branch.
 */
const AddressOverrideBodySchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("one_off"),
    date: z.string().date(),
    address_id: z.string().uuid({ message: "address_id must be a uuid" }),
    idempotency_key: z
      .string()
      .uuid({ message: "idempotency_key must be a uuid" }),
  }),
  z.object({
    scope: z.literal("forward"),
    date: z.string().date(),
    address_id: z.string().uuid({ message: "address_id must be a uuid" }),
    idempotency_key: z
      .string()
      .uuid({ message: "idempotency_key must be a uuid" }),
  }),
]);

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    const body = parseBody(await req.json().catch(() => undefined));

    const ctx = await buildRequestContext(
      `/api/subscriptions/${id}/address-override`,
      requestId,
    );

    // scope discriminator → Service A type
    const type =
      body.scope === "one_off"
        ? ("address_override_one_off" as const)
        : ("address_override_forward" as const);

    const serviceInput: AddSubscriptionExceptionInput = {
      type,
      date: body.date,
      idempotencyKey: body.idempotency_key as Uuid,
      addressOverrideId: body.address_id as Uuid,
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

function parseBody(body: unknown): z.infer<typeof AddressOverrideBodySchema> {
  if (body === undefined || body === null) {
    throw new ValidationError(
      "address-override endpoint requires a body: { scope: 'one_off' | 'forward', date, address_id, idempotency_key }",
    );
  }
  const parsed = AddressOverrideBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(`address-override body invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

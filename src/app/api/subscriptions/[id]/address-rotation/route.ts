// PATCH /api/subscriptions/:id/address-rotation
//                     subscription:change_address_rotation (no audit emit)
//
// Day-16 Block 4-F Commit 2 — address rotation route handler.
// Composes against Service E `changeAddressRotation` from
// `src/modules/subscription-addresses/service.ts`. Full-replace
// semantic per merged plan §5.3.1: input is the COMPLETE new
// rotation map; weekdays in current state but absent from input get
// DELETEd; empty array = full-delete (subscription falls back to
// consignee primary address per task-materialization Layer 4).
//
// PATCH (not POST) is the right verb here — full-replace mutation of
// an existing resource attribute, not a resource-creation action.
// Mirrors plan §6.1 row 5.
//
// Body shape per merged plan §6.1 row 5 (snake_case at the wire):
//   { rotation: Array<{ weekday: 1-7, address_id: <uuid> }> }
//
// Permission gate: Service E does requirePermission(
// 'subscription:change_address_rotation') internally. The route does
// NOT pre-gate.
//
// No audit emit per merged plan §10.6 default + brief §3.1.2 — rotation
// changes are routine config, not audit-grade. Service E pins this with
// 3 explicit "did NOT emit" tests (subscription-addresses/tests/service.spec.ts).
//
// Success:
//   - 200 with ChangeAddressRotationResult JSON
//     { status: 'updated' | 'no_op', subscriptionId, rotation: [...] }
//
// Errors:
//   - 400 ValidationError (input shape, cross-consignee address ownership,
//                          duplicate weekday, malformed JSON)
//   - 403 ForbiddenError (lacks subscription:change_address_rotation)
//   - 404 NotFoundError (subscription not in tenant)
//   - 409 ConflictError (subscription not active)

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { changeAddressRotation } from "@/modules/subscription-addresses";
import type {
  ChangeAddressRotationInput,
  IsoWeekday,
} from "@/modules/subscription-addresses";
import { buildRequestContext } from "@/shared/request-context";
import { ValidationError } from "@/shared/errors";
import type { Uuid } from "@/shared/types";

import { errorResponse } from "../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const IdParamSchema = z.string().uuid({ message: "id must be a uuid" });

/**
 * Body schema — wire-side snake_case `address_id` per merged plan
 * §6.1. The route maps to camelCase `addressId` before the service
 * call. Empty rotation array is VALID (full-delete per Service E).
 *
 * Duplicate-weekday rejection happens at the service layer too
 * (subscription-addresses/service.ts:validateRotationInput); the
 * route's Zod schema does NOT enforce uniqueness — that's a business
 * rule, kept at the service layer where the test coverage lives.
 */
const RotationEntrySchema = z.object({
  weekday: z.number().int().min(1).max(7),
  address_id: z.string().uuid({ message: "address_id must be a uuid" }),
});

const AddressRotationBodySchema = z.object({
  rotation: z.array(RotationEntrySchema),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    const body = parseBody(await req.json().catch(() => undefined));

    const ctx = await buildRequestContext(
      `/api/subscriptions/${id}/address-rotation`,
      requestId,
    );

    const serviceInput: ChangeAddressRotationInput = {
      rotation: body.rotation.map((e) => ({
        weekday: e.weekday as IsoWeekday,
        addressId: e.address_id as Uuid,
      })),
    };

    const result = await changeAddressRotation(ctx, id as Uuid, serviceInput);
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

function parseBody(body: unknown): z.infer<typeof AddressRotationBodySchema> {
  if (body === undefined || body === null) {
    throw new ValidationError(
      "address-rotation endpoint requires a body: { rotation: [{ weekday: 1-7, address_id: <uuid> }, ...] }",
    );
  }
  const parsed = AddressRotationBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(`address-rotation body invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

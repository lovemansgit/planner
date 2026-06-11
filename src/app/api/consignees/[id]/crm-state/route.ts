// POST /api/consignees/:id/crm-state
//                  consignee:change_crm_state → consignee.crm_state.changed
//
// Day-16 Block 4-F Commit 3 — consignee CRM state route handler.
// Composes against Service C `changeConsigneeCrmState` from
// `src/modules/consignees/service.ts` (Block 4-D commit ffc9943).
//
// POST verb (NOT PATCH) per merged plan §6.1 row 7 + brief §3.1.9
// + Block 4-F §D ruling: state-transition action with side effects
// (audit emit + consignee_crm_events insert + matrix gate including
// CHURNED → ACTIVE keyword check), not a field-update.
//
// Body shape per merged plan §6.1 row 7 (snake_case at the wire):
//   { to_state: <enum>, reason: <non-empty string> }
//
// Wire-to-service mapping: snake_case `to_state` → camelCase `toState`.
//
// Permission gate: Service C does requirePermission(
// 'consignee:change_crm_state') internally. Route does NOT pre-gate.
//
// §10.4 matrix lock — handled inside Service C via the
// transitions.ts pure helper:
//   - INACTIVE → ACTIVE: routine reactivation, permission gate alone
//   - CHURNED → ACTIVE: requires case-insensitive 'reactivation'
//     substring in `reason`; reactivation_keyword_required errorCode
//     → ConflictError 409 (per service.ts:437-441; verified Day-16
//     Block 4-F Commit 3 pre-flight WATCH 1 probe).
//   - invalid_transition errorCode → ConflictError 409
//   - same-state from === to → no_op (no DB write, no audit)
//
// Success:
//   - 200 with ChangeConsigneeCrmStateResult JSON
//     { status: 'updated', consigneeId, fromState, toState, eventId }
//     OR { status: 'no_op', consigneeId, fromState, toState }
//
// Errors:
//   - 400 ValidationError (input shape, empty reason, invalid enum,
//                          malformed JSON, no tenant context)
//   - 403 ForbiddenError (lacks consignee:change_crm_state)
//   - 404 NotFoundError (consignee not in tenant)
//   - 409 ConflictError (invalid_transition OR reactivation_keyword_required)

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { changeConsigneeCrmState } from "@/modules/consignees";
import type {
  ChangeConsigneeCrmStateInput,
  ConsigneeCrmState,
} from "@/modules/consignees";
import { buildRequestContext } from "@/shared/request-context";
import { ValidationError } from "@/shared/errors";
import type { Uuid } from "@/shared/types";

import { errorResponse } from "../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const IdParamSchema = z.string().uuid({ message: "id must be a uuid" });

/**
 * The 6 CRM states per brief §3.1.1 + migration 0016 CHECK
 * constraint. Mirrors `ConsigneeCrmState` from
 * `src/modules/consignees/types.ts:29-36`. Verified Day-16 Block 4-F
 * Commit 3 pre-flight WATCH 2 probe.
 */
const CrmStateEnum = z.enum([
  "ACTIVE",
  "ON_HOLD",
  "HIGH_RISK",
  "INACTIVE",
  "CHURNED",
  "SUBSCRIPTION_ENDED",
]);

/**
 * Body schema — snake_case wire → camelCase service input. `reason`
 * is REQUIRED non-empty (Service C also validates via requireNonEmpty;
 * the route boundary's `.min(1)` is the first-line check; service
 * trims + re-validates before insert).
 */
const CrmStateBodySchema = z.object({
  to_state: CrmStateEnum,
  reason: z.string().min(1, { message: "reason is required" }),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    const body = parseBody(await req.json().catch(() => undefined));

    const ctx = await buildRequestContext(
      `/api/consignees/${id}/crm-state`,
      requestId,
    );

    const serviceInput: ChangeConsigneeCrmStateInput = {
      toState: body.to_state as ConsigneeCrmState,
      reason: body.reason,
    };

    const result = await changeConsigneeCrmState(ctx, id as Uuid, serviceInput);
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

function parseBody(body: unknown): z.infer<typeof CrmStateBodySchema> {
  if (body === undefined || body === null) {
    throw new ValidationError(
      "crm-state endpoint requires a body: { to_state: <enum>, reason: <string> }",
    );
  }
  const parsed = CrmStateBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(`crm-state body invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

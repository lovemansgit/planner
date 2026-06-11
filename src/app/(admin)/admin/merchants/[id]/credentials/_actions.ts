// Day 26 / T3 Sub-PR 3 — Credentials write-only server action.
//
// Wraps storeSuitefleetCredentials with form-state semantics. Two
// load-bearing properties:
//
//   1. invalidateSession DI wiring (the carry-forward watch-item
//      from Sub-PR 2): the action MUST pass the REAL LastMileAdapter's
//      invalidateSession as the fourth argument to the service so the
//      in-memory token cache is dropped on initial-set AND rotation
//      per ratified OQ-5. Otherwise rotation silently fails to
//      invalidate and pushes keep authenticating against stale
//      cached sessions. Stubbed/no-op DI here would mean the service
//      ships but the operationally-critical cache invalidation
//      doesn't happen.
//
//   2. plaintext NEVER returns through this action's result. The
//      service result carries only the classifier ('initial-set' |
//      'rotation'); both kinds surface as a `stored` result variant
//      with no credential payload. The form remounts on success and
//      the operator lands on the merchant detail page with the
//      credentials badge flipped to green.

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import {
  storeSuitefleetCredentials,
  type CredentialsClassifier,
} from "@/modules/credentials";
import { getSuiteFleetAdapter } from "@/modules/integration/providers/suitefleet/get-adapter";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

export type StoreCredentialsActionResult =
  | {
      readonly kind: "stored";
      readonly tenantId: string;
      readonly classifier: CredentialsClassifier;
    }
  | {
      readonly kind: "validation";
      readonly fieldErrors: Readonly<Record<string, string>>;
    }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

export async function storeCredentialsAction(
  tenantId: string,
  _prevState: StoreCredentialsActionResult | { kind: "idle" },
  formData: FormData,
): Promise<StoreCredentialsActionResult> {
  const requestId = randomUUID();

  // Client-side parse: trim + non-empty check on both generic
  // credential fields. The server-side Zod schema (.strict() +
  // .min(1)) is the canonical validation; this is defense-in-depth
  // so the operator sees inline field errors without round-tripping.
  const trimmed = (key: string): string => {
    const v = formData.get(key);
    return typeof v === "string" ? v : "";
  };
  const credential1 = trimmed("credential_1");
  const credential2 = trimmed("credential_2");

  const fieldErrors: Record<string, string> = {};
  if (credential1.length === 0) {
    fieldErrors.credential_1 = "This field is required.";
  }
  if (credential2.length === 0) {
    fieldErrors.credential_2 = "This field is required.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { kind: "validation", fieldErrors };
  }

  // LOAD-BEARING DI WIRE: pass the REAL adapter's invalidateSession.
  // The credentials service takes the invalidator as a parameter
  // (Sub-PR 2 deviation #2) so the service module doesn't need to
  // import the adapter factory; Sub-PR 3's action layer is the
  // closure point.
  const adapter = getSuiteFleetAdapter();

  try {
    const ctx = await buildRequestContext(
      `/admin/merchants/${tenantId}/credentials`,
      requestId,
    );
    const result = await storeSuitefleetCredentials(
      ctx,
      tenantId as Uuid,
      { credential1, credential2 },
      (tid) => adapter.invalidateSession(tid),
    );
    revalidatePath(`/admin/merchants/${tenantId}`, "page");
    revalidatePath(`/admin/merchants/${tenantId}/credentials`, "page");
    return {
      kind: "stored",
      tenantId: result.tenantId,
      classifier: result.classifier,
    };
  } catch (err) {
    if (err instanceof ConflictError) {
      return { kind: "conflict", message: err.message };
    }
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to set merchant credentials.",
      };
    }
    if (err instanceof NotFoundError) {
      return { kind: "not_found", message: "Merchant not found." };
    }
    if (err instanceof ValidationError) {
      return {
        kind: "validation",
        fieldErrors: { _form: err.message },
      };
    }
    throw err;
  }
}

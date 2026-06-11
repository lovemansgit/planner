// Day 26 / T3 Sub-PR 3 — New region form (client component).
//
// useActionState binds to createRegionAction — server action reads
// FormData, validates via parseCreateRegionForm, calls createRegion
// service fn, and returns a discriminated-union result the form renders
// inline.
//
// Permission preflight is handled by new/page.tsx (region:manage); this
// form is reached only by transcorp-staff actors with the permission.
//
// `auth_method` radio is REQUIRED — no default selection. Operators must
// explicitly pick because the choice is permanent post-create per v1.15.
// A pre-selected default would create a footgun (a distracted operator
// could submit without engaging with the choice).

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import {
  createRegionAction,
  type CreateRegionActionResult,
} from "../../_actions";

export function CreateRegionForm() {
  const router = useRouter();
  const [actionResult, formAction, isPending] = useActionState<
    CreateRegionActionResult | { readonly kind: "idle" },
    FormData
  >(createRegionAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "created") {
      router.push("/admin/regions");
    }
  }, [actionResult.kind, router]);

  const fieldErrors =
    actionResult.kind === "validation" ? actionResult.fieldErrors : {};
  const formError =
    actionResult.kind === "conflict"
      ? actionResult.message
      : actionResult.kind === "forbidden"
        ? actionResult.message
        : actionResult.kind === "validation" && fieldErrors._form
          ? fieldErrors._form
          : null;

  return (
    <>
      {formError ? (
        <p
          role="alert"
          className="mb-6 rounded-sm border border-red/40 bg-red/10 px-3 py-2 text-sm text-red"
        >
          {formError}
        </p>
      ) : null}

      <form action={formAction} className="space-y-8">
        <div>
          <label
            htmlFor="region-client_id"
            className="mb-1 block text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]"
          >
            Client ID
          </label>
          <input
            id="region-client_id"
            name="client_id"
            type="text"
            placeholder="transcorpuae"
            required
            aria-invalid={fieldErrors.client_id ? "true" : undefined}
            aria-describedby={
              fieldErrors.client_id
                ? "region-client_id-error"
                : "region-client_id-hint"
            }
            className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 font-mono text-sm text-navy placeholder:text-[color:var(--color-text-tertiary)] focus:border-navy focus:outline-none aria-[invalid=true]:border-red"
          />
          {fieldErrors.client_id ? (
            <p
              id="region-client_id-error"
              role="alert"
              className="mt-1 text-xs text-red"
            >
              {fieldErrors.client_id}
            </p>
          ) : (
            <p
              id="region-client_id-hint"
              className="mt-1 text-xs text-[color:var(--color-text-tertiary)]"
            >
              Lowercase letter then lowercase letters/digits (e.g. transcorpuae). The SuiteFleet
              authentication client ID for this region. Cannot be changed after creation.
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="region-display_name"
            className="mb-1 block text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]"
          >
            Display name
          </label>
          <input
            id="region-display_name"
            name="display_name"
            type="text"
            placeholder="Transcorp UAE"
            required
            aria-invalid={fieldErrors.display_name ? "true" : undefined}
            aria-describedby={
              fieldErrors.display_name ? "region-display_name-error" : undefined
            }
            className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy placeholder:text-[color:var(--color-text-tertiary)] focus:border-navy focus:outline-none aria-[invalid=true]:border-red"
          />
          {fieldErrors.display_name ? (
            <p
              id="region-display_name-error"
              role="alert"
              className="mt-1 text-xs text-red"
            >
              {fieldErrors.display_name}
            </p>
          ) : null}
        </div>

        <fieldset
          className="space-y-3 border-t border-[color:var(--color-border-strong)] pt-8"
          aria-describedby={
            fieldErrors.auth_method ? "region-auth_method-error" : "region-auth_method-hint"
          }
        >
          <legend className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Authentication method
          </legend>

          <label className="flex cursor-pointer items-start gap-3 border border-stone-200 bg-paper p-4 transition-colors duration-[120ms] ease-out hover:bg-ivory has-[:checked]:border-navy">
            <input
              type="radio"
              name="auth_method"
              value="oauth"
              required
              className="mt-1 h-4 w-4 accent-navy"
            />
            <div>
              <p className="text-sm font-medium text-navy">OAuth — username + password</p>
              <p className="mt-1 text-xs text-[color:var(--color-text-secondary)]">
                Per-merchant OAuth username and password authenticate against SuiteFleet&rsquo;s
                standard auth endpoint. Sandbox uses this flavor.
              </p>
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 border border-stone-200 bg-paper p-4 transition-colors duration-[120ms] ease-out hover:bg-ivory has-[:checked]:border-navy">
            <input
              type="radio"
              name="auth_method"
              value="api_key"
              required
              className="mt-1 h-4 w-4 accent-navy"
            />
            <div>
              <p className="text-sm font-medium text-navy">API Key — api_key + secret_key</p>
              <p className="mt-1 text-xs text-[color:var(--color-text-secondary)]">
                Per-merchant API Key and Secret Key issued via SuiteFleet OpsPortal. Used by
                production regions.
              </p>
            </div>
          </label>

          {fieldErrors.auth_method ? (
            <p
              id="region-auth_method-error"
              role="alert"
              className="text-xs text-red"
            >
              {fieldErrors.auth_method}
            </p>
          ) : (
            <p
              id="region-auth_method-hint"
              className="text-xs text-[color:var(--color-text-tertiary)]"
            >
              This selection is permanent for this region. Authentication method cannot be
              changed after creation.
            </p>
          )}
        </fieldset>

        <div className="flex items-center justify-end gap-3 border-t border-[color:var(--color-border-strong)] pt-8">
          <Link
            href="/admin/regions"
            className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create region"}
          </button>
        </div>
      </form>
    </>
  );
}

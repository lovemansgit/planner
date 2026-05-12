// Day 22 / Phase 1 forms lane — edit-consignee form (client component).
//
// Single-page edit form for non-address consignee scalar fields.
// Address editing deferred to Phase 2 per
// memory/followup_multi_address_rotation_phase_2.md.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { FormError } from "@/components/forms/FormError";
import { FormField } from "@/components/forms/FormField";
import { FormSubmitButton } from "@/components/forms/FormSubmitButton";

import {
  editConsigneeAction,
  type EditConsigneeActionResult,
} from "../_actions";

interface EditConsigneeFormProps {
  readonly consigneeId: string;
  readonly defaults: {
    readonly name: string;
    readonly phone: string;
    readonly email: string | null;
    readonly deliveryNotes: string | null;
    readonly externalRef: string | null;
    readonly notesInternal: string | null;
  };
}

export function EditConsigneeForm({
  consigneeId,
  defaults,
}: EditConsigneeFormProps) {
  const router = useRouter();
  const boundAction = editConsigneeAction.bind(null, consigneeId);
  const [actionResult, formAction, isPending] = useActionState<
    EditConsigneeActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "updated") {
      router.push(`/consignees/${consigneeId}`);
    }
  }, [actionResult, router, consigneeId]);

  const fieldErrors =
    actionResult.kind === "validation" ? actionResult.fieldErrors : {};
  const formError =
    actionResult.kind === "conflict"
      ? actionResult.message
      : actionResult.kind === "forbidden"
        ? actionResult.message
        : actionResult.kind === "not_found"
          ? actionResult.message
          : actionResult.kind === "validation" && fieldErrors._form
            ? fieldErrors._form
            : null;

  return (
    <>
      <FormError message={formError} className="mb-6" />

      <form action={formAction} className="space-y-6">
        <FormField
          name="name"
          label="Full name"
          required
          defaultValue={defaults.name}
          error={fieldErrors.name}
          autoComplete="name"
        />
        <FormField
          name="phone"
          label="Primary phone"
          hint="E.164 format (country code prefix, no spaces)."
          required
          defaultValue={defaults.phone}
          error={fieldErrors.phone}
          inputMode="tel"
          autoComplete="tel"
        />
        <FormField
          name="email"
          label="Email"
          labelTrailing={
            <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              Optional
            </span>
          }
          type="email"
          defaultValue={defaults.email ?? ""}
          error={fieldErrors.email}
          autoComplete="email"
        />
        <FormField
          name="delivery_notes"
          label="Delivery notes"
          labelTrailing={
            <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              Optional
            </span>
          }
          hint="Visible to drivers."
          defaultValue={defaults.deliveryNotes ?? ""}
        />
        <FormField
          name="external_ref"
          label="Merchant internal reference"
          labelTrailing={
            <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              Optional
            </span>
          }
          defaultValue={defaults.externalRef ?? ""}
        />
        <FormField
          name="notes_internal"
          label="Internal notes"
          labelTrailing={
            <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              Optional
            </span>
          }
          hint="Operator-only context. Not visible to drivers."
          defaultValue={defaults.notesInternal ?? ""}
        />

        <div className="flex items-center justify-between gap-3 border-t border-stone-200 pt-8">
          <Link
            href={`/consignees/${consigneeId}`}
            className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:text-navy"
          >
            Cancel
          </Link>
          <FormSubmitButton pending={isPending} pendingLabel="Saving…">
            Save changes
          </FormSubmitButton>
        </div>
      </form>
    </>
  );
}

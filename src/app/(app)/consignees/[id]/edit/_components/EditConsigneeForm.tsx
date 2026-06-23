// Day 22 / Phase 1 forms lane — edit-consignee form (client component).
//
// Single-page edit form for non-address consignee scalar fields.
// Address editing deferred to Phase 2 per
// memory/followup_multi_address_rotation_phase_2.md.
//
// Phase 10 · Batch B4 — fields migrate off forms/FormField onto the shipped
// Field kit: the local TextField composes <Field> (sentence-case label + the
// "Optional" eyebrow + help/error a11y) over a native input on the recipe
// surface (inputClass). FormError + FormSubmitButton are unchanged (out of the
// field/select scope). Pure presentation — names, defaults, hints, error
// branches, and the bound action are all preserved.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, type InputHTMLAttributes } from "react";

import { Field } from "@/components/Field";
import { inputClass } from "@/components/form-field-recipe";
import { FormError } from "@/components/forms/FormError";
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
        <TextField
          name="name"
          label="Full name"
          required
          defaultValue={defaults.name}
          error={fieldErrors.name}
          autoComplete="name"
        />
        <TextField
          name="phone"
          label="Primary phone"
          hint="E.164 format (country code prefix, no spaces)."
          required
          defaultValue={defaults.phone}
          error={fieldErrors.phone}
          inputMode="tel"
          autoComplete="tel"
        />
        <TextField
          name="email"
          label="Email"
          optional
          type="email"
          defaultValue={defaults.email ?? ""}
          error={fieldErrors.email}
          autoComplete="email"
        />
        <TextField
          name="delivery_notes"
          label="Delivery notes"
          optional
          hint="Visible to drivers."
          defaultValue={defaults.deliveryNotes ?? ""}
        />
        <TextField
          name="external_ref"
          label="Merchant internal reference"
          optional
          defaultValue={defaults.externalRef ?? ""}
        />
        <TextField
          name="notes_internal"
          label="Internal notes"
          optional
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

interface TextFieldProps {
  readonly label: string;
  readonly name: string;
  readonly type?: string;
  readonly defaultValue?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly optional?: boolean;
  readonly autoComplete?: string;
  readonly inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
}

// Composes the shipped <Field> wrapper over a native input on the B+ recipe
// surface (input-only, matching the FormField it replaces). A shared TextInput
// primitive is the documented form-kit follow-up; kept form-local per B4 scope.
function TextField({
  label,
  name,
  type = "text",
  defaultValue,
  hint,
  error,
  required,
  optional,
  autoComplete,
  inputMode,
}: TextFieldProps) {
  const id = `field-${name}`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-help` : undefined;
  return (
    <Field label={label} htmlFor={id} optional={optional} help={hint} error={error}>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputClass(Boolean(error))}
      />
    </Field>
  );
}

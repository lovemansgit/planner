// Day-22 Phase 1 forms — generic form field wrapper (server component).
//
// Generalises the inline `Field` helper that landed in
// CreateMerchantForm (Day 18 / C1) — same label + input + error +
// hint shape, lifted to a shared primitive so the next round of
// Phase 1 forms (subscription editor, consignee CRUD, address
// management) consume one source of truth for visual posture.
//
// Server-renderable; uncontrolled by default. Caller passes `name`
// and the parent <form action={formAction}> reads from FormData at
// the server-action layer. `error` arrives as a string from the
// action's discriminated-union result (e.g. fieldErrors.X) and gets
// rendered inline below the input. `hint` is a passive helper
// rendered below the input only when no error is present.
//
// Brand-canon visuals per brief §3.3.11:
//   - hairline 1px stone-200 border at rest
//   - text-xs uppercase tracking-[0.1em] eyebrow label
//   - text-sm input typography (text-navy on bg-paper)
//   - red border + red error text on aria-invalid
//   - placeholder uses --color-text-tertiary
// No shadows, no rounded-lg, no color drift.

import type { InputHTMLAttributes, ReactNode } from "react";

export interface FormFieldProps {
  readonly label: string;
  readonly name: string;
  /**
   * Optional override id; defaults to `field-${name}`. Provide when
   * multiple fields with the same `name` co-exist on a page (rare).
   */
  readonly id?: string;
  readonly type?: InputHTMLAttributes<HTMLInputElement>["type"];
  readonly placeholder?: string;
  readonly defaultValue?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly autoComplete?: string;
  readonly inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  /** Optional content rendered immediately to the right of the label
   *  (e.g. an "optional" tag, a help-link). Stays in the eyebrow row. */
  readonly labelTrailing?: ReactNode;
}

export function FormField({
  label,
  name,
  id,
  type = "text",
  placeholder,
  defaultValue,
  hint,
  error,
  required,
  disabled,
  autoComplete,
  inputMode,
  pattern,
  minLength,
  maxLength,
  labelTrailing,
}: FormFieldProps) {
  const fieldId = id ?? `field-${name}`;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label
          htmlFor={fieldId}
          className="block text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]"
        >
          {label}
        </label>
        {labelTrailing ? (
          <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
            {labelTrailing}
          </span>
        ) : null}
      </div>
      <input
        id={fieldId}
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        disabled={disabled}
        autoComplete={autoComplete}
        inputMode={inputMode}
        pattern={pattern}
        minLength={minLength}
        maxLength={maxLength}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={
          error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
        }
        className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy placeholder:text-[color:var(--color-text-tertiary)] focus:border-navy focus:outline-none aria-[invalid=true]:border-red disabled:cursor-not-allowed disabled:opacity-60"
      />
      {hint && !error ? (
        <p
          id={`${fieldId}-hint`}
          className="mt-1 text-xs text-[color:var(--color-text-tertiary)]"
        >
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${fieldId}-error`} role="alert" className="mt-1 text-xs text-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

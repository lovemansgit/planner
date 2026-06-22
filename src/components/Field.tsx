// <Field> (Phase 9 · Step 3.6 — Gap G core).
//
// The label + control + help/error wrapper for any form control (the styled
// Select below, or a native input). Sentence-case label (D2), an optional
// "Optional" eyebrow tag, and one place for help text or an error (error wins).

import type { ReactNode } from "react";

import {
  FORM_ERROR,
  FORM_GROUP,
  FORM_HELP,
  FORM_LABEL,
  FORM_LABEL_ROW,
  FORM_OPTIONAL,
} from "./form-field-recipe";

interface FieldProps {
  readonly label: string;
  /** Associates the label with the control's id. */
  readonly htmlFor?: string;
  /** Shows an "Optional" tag (so required is the unmarked default). */
  readonly optional?: boolean;
  readonly help?: string;
  readonly error?: string;
  /** The control (Select, input, …). */
  readonly children: ReactNode;
}

export function Field({ label, htmlFor, optional, help, error, children }: FieldProps) {
  return (
    <div className={FORM_GROUP}>
      <div className={FORM_LABEL_ROW}>
        <label htmlFor={htmlFor} className={FORM_LABEL}>
          {label}
        </label>
        {optional ? <span className={FORM_OPTIONAL}>Optional</span> : null}
      </div>
      {children}
      {error ? (
        <p className={FORM_ERROR}>{error}</p>
      ) : help ? (
        <p className={FORM_HELP}>{help}</p>
      ) : null}
    </div>
  );
}

// <FieldRow> (Phase 9 · Step 3.5 — Gap D).
//
// One label/value row for every detail surface. Sentence-case label (D2),
// optional mono figures, and an inline empty state ("Not set") instead of a
// bare "—". Because every value renders through this one row, labels can't
// drift — the recurring "Auth method" indent bug dies here.
//
// Renders as a <div> wrapping <dt>/<dd>; nest inside a <dl> (DetailSection).

import type { ReactNode } from "react";

import { FIELD_EMPTY, FIELD_LABEL, FIELD_ROW, fieldValueClass } from "./detail-view-recipe";

interface FieldRowProps {
  readonly label: string;
  readonly value?: ReactNode;
  /** Render the value in the B+ mono tabular face (figures, IDs, dates). */
  readonly mono?: boolean;
  /** Inline empty text when the value is null / undefined / "". */
  readonly emptyText?: string;
}

function isEmpty(value: ReactNode): boolean {
  return value === null || value === undefined || value === "";
}

export function FieldRow({ label, value, mono = false, emptyText = "Not set" }: FieldRowProps) {
  const empty = isEmpty(value);
  return (
    <div className={FIELD_ROW}>
      <dt className={FIELD_LABEL}>{label}</dt>
      <dd className={empty ? FIELD_EMPTY : fieldValueClass(mono)}>{empty ? emptyText : value}</dd>
    </div>
  );
}

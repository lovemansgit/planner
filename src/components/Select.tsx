// <Select> (Phase 9 · Step 3.6 — Gap G core).
//
// A styled native <select> to retire the 13 hand-rolled native selects. It is a
// real <select> (full keyboard + a11y behaviour), restyled to B+: warm-white
// surface, green focus ring, and our own chevron (appearance-none hides the
// native one). All native props pass through. Pair with <Field> for the label.

import type { ReactNode, SelectHTMLAttributes } from "react";

import { SELECT_CHEVRON, selectClass } from "./form-field-recipe";

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> {
  readonly invalid?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

export function Select({ invalid = false, className = "", children, ...rest }: SelectProps) {
  return (
    <div className="relative">
      <select
        className={selectClass(invalid, className)}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {children}
      </select>
      <svg
        className={SELECT_CHEVRON}
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden
      >
        <path
          d="M4 6l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

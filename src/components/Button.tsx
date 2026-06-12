// Day-54 component-lib rollout — shared prominent-action button.
//
// The larger page-action button used on admin surfaces (e.g. the
// failed-pushes DLQ): an `outline` treatment (border + surface fill,
// bg-shift hover) or a `filled` navy primary. `size` is md (page actions)
// or sm (table-row actions); `tone` selects the outline border weight.
// Distinct from <OutlineButton> (the small inline button with opacity-fade
// hover). The recipe lives in the node-tested ./button-recipe sibling so
// each combo stays locked (audit finding 2).

import type { ReactNode } from "react";

import { buttonClass, type ButtonSize, type ButtonTone, type ButtonVariant } from "./button-recipe";

export function Button({
  variant = "outline",
  size = "md",
  tone = "strong",
  type = "button",
  disabled = false,
  onClick,
  className = "",
  children,
}: {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Outline border weight; ignored for `filled`. */
  readonly tone?: ButtonTone;
  readonly type?: "button" | "submit";
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={buttonClass(variant, size, tone, className)}
    >
      {children}
    </button>
  );
}

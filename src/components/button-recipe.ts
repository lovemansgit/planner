// Shared prominent-action button recipe (audit finding 2 — button drift).
//
// Captures the real button treatments on the failed-pushes DLQ admin surface
// so they live in one node-tested place. Distinct from <OutlineButton>, which
// is the small inline (table-row) button with opacity-fade hover; this is the
// larger page-action button (outline with surface-bg/bg-hover, or filled-navy
// primary). The class strings stay here so button-recipe.spec can lock them.

export type ButtonVariant = "filled" | "outline";
export type ButtonSize = "md" | "sm";
export type ButtonTone = "strong" | "default";

// Caption type + border + disabled fade shared by every button.
const INVARIANT = "border text-xs font-medium uppercase tracking-[0.15em] disabled:opacity-40";

const SIZE: Record<ButtonSize, string> = {
  md: "px-5 py-2",
  sm: "px-3 py-1.5",
};

const BORDER_TONE: Record<ButtonTone, string> = {
  strong: "border-[color:var(--color-border-strong)]",
  default: "border-[color:var(--color-border-default)]",
};

/**
 * Compose the button shell classes. `tone` selects the outline border weight
 * and is ignored for `filled` (its border is always strong). Caller treatment
 * (e.g. `w-full`) is appended.
 */
export function buttonClass(
  variant: ButtonVariant = "outline",
  size: ButtonSize = "md",
  tone: ButtonTone = "strong",
  className = "",
): string {
  const variantClasses =
    variant === "filled"
      ? `${BORDER_TONE.strong} bg-navy text-paper transition-opacity hover:opacity-80`
      : `${BORDER_TONE[tone]} bg-[color:var(--color-surface-primary)] text-navy transition-colors hover:bg-[color:var(--color-surface-secondary)]`;
  return [INVARIANT, SIZE[size], variantClasses, className].filter(Boolean).join(" ");
}

// Shared prominent-action button recipe (audit finding 2 — button drift).
//
// Captures the real button treatments on the failed-pushes DLQ admin surface
// so they live in one node-tested place. Distinct from <OutlineButton>, which
// is the small inline (table-row) button with opacity-fade hover; this is the
// larger page-action button (outline with surface-bg/bg-hover, or filled-navy
// primary). The class strings stay here so button-recipe.spec can lock them.

/** @deprecated Direction-B variants (`primary`/`secondary`/`ghost`/`danger`)
 *  replace these. Kept only for the not-yet-migrated failed-pushes surface;
 *  removal rides the final Phase-9 button adoption bundle. */
export type ButtonVariant = "filled" | "outline";
/** @deprecated use the Direction-B size ladder (`BButtonSize`). */
export type ButtonSize = "md" | "sm";
/** @deprecated outline-only border weight; B variants don't use it. */
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

/* =====================================================================
 * Direction B ("Dispatch") button recipe — Phase 9 Step 3.2.
 *
 * The single button treatment Love picked (PR #568). Authoritative values:
 * memory/plans/day-57-phase9-visual-directions/direction-b-dispatch.html.
 * Sentence-case (D2), green primary (D1), label never wraps, only the
 * primary action lifts (round-0 cut), green focus ring (a11y floor).
 *
 * Each combo emits EXACTLY ONE utility per CSS property (one height, one px,
 * one text-size, one radius, one min-width, one bg/border/text) so classes
 * never cancel each other — base styles only; hover/focus/disabled are
 * state-scoped variants that don't collide. Locked by button-recipe.spec.
 * ===================================================================== */

export type BButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type BButtonSize = "sm" | "md" | "lg";

// Shape, type, motion, focus, disabled — shared by every B button.
// Focus uses `outline` (not `ring`) so a visible green focus indicator can't be
// clobbered by the primary's elevation box-shadow. Honours reduced-motion.
const B_INVARIANT =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-b-body font-semibold border border-transparent " +
  "transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out active:translate-y-px " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-green)] " +
  "disabled:opacity-45 disabled:pointer-events-none disabled:shadow-none " +
  "aria-disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:shadow-none";

// Height + radius + text-size (NOT px/min-width — those depend on ghost).
const B_SHAPE: Record<BButtonSize, string> = {
  sm: "h-8 rounded-lg text-[12.5px]",
  md: "h-10 rounded-[10px] text-sm",
  lg: "h-[46px] rounded-[10px] text-[15px]",
};

// Horizontal padding + min-width. Ghost is a text button: tighter padding, no
// min-width. Solid buttons get a min-width so a short label can't render tiny.
const B_METRICS: Record<"solid" | "ghost", Record<BButtonSize, string>> = {
  solid: {
    sm: "px-[13px] min-w-[64px]",
    md: "px-[18px] min-w-[88px]",
    lg: "px-6 min-w-[104px]",
  },
  ghost: { sm: "px-2", md: "px-3", lg: "px-4" },
};

// Colour treatment per variant. Only `primary` carries a resting shadow and
// lifts on hover; secondary/danger stay flat (round-0 cut). `text-paper` is the
// brand cream-white (no bare #fff). Danger border is the brand red at 34%.
const B_VARIANT: Record<BButtonVariant, string> = {
  primary:
    "bg-green text-paper shadow-[var(--shadow-b-rest)] hover:bg-[color:var(--color-green-hover)] hover:shadow-[var(--shadow-b-lift)]",
  secondary:
    "bg-[color:var(--color-b-card)] text-navy border-[color:var(--color-border-strong)] hover:border-navy",
  ghost:
    "bg-transparent text-[color:var(--color-text-secondary)] hover:text-navy hover:bg-[rgba(37,45,96,0.05)]",
  danger:
    "bg-[color:var(--color-b-card)] text-red border-[color:rgb(var(--color-red-rgb)/0.34)] hover:bg-red hover:text-paper hover:border-red",
};

/**
 * Compose the Direction-B button classes. Caller treatment (e.g. `w-full` for
 * a full-bleed form-submit) is appended last.
 */
export function bButtonClass(
  variant: BButtonVariant = "primary",
  size: BButtonSize = "md",
  className = "",
): string {
  const metrics = variant === "ghost" ? B_METRICS.ghost[size] : B_METRICS.solid[size];
  return [B_INVARIANT, B_SHAPE[size], metrics, B_VARIANT[variant], className].filter(Boolean).join(" ");
}

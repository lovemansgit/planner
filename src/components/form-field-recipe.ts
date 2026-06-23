// Shared form-field recipe (Phase 9 · Step 3.6 — Gap G core).
//
// The <Field> wrapper (label + control + help + optional "Optional" tag + error)
// and the styled <Select> that retires the 13 native <select>s the audit found.
// Skinned to B+: sentence-case labels (D2), the green focus ring, the warm-white
// control surface. Class strings here (node-testable) so form-field-recipe.spec
// locks the label casing and the Select chrome.
//
// Scope note: this bundle ships the Field + Select foundation. The rest of the
// form kit (TextInput/Textarea/DateField/TimeField + promoting the good one-offs
// RadioCardGroup/ChipToggle/SegmentedControl/PreviewPanel) is a documented
// follow-up — a full form kit deserves its own focused bundle, not the tail.

export const FORM_GROUP = "flex flex-col gap-1.5";
export const FORM_LABEL_ROW = "flex items-baseline justify-between gap-2";
// Sentence-case (D2) — never uppercase.
export const FORM_LABEL = "text-[13px] font-medium text-[color:var(--color-text-secondary)]";
export const FORM_OPTIONAL =
  "font-b-mono text-[10px] uppercase tracking-[0.1em] text-[color:var(--color-text-tertiary)]";
export const FORM_HELP = "text-xs text-[color:var(--color-text-tertiary)]";
export const FORM_ERROR = "text-xs text-red";

// Styled native <select>: chromeless (appearance-none) so the chevron is ours,
// warm-white surface, green focus ring. pr-9 leaves room for the chevron.
const SELECT_BASE =
  "h-10 w-full appearance-none rounded-[10px] border bg-[color:var(--color-b-card)] pl-3.5 pr-9 text-sm text-[color:var(--color-ink)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-b-focus-ring)]";

export function selectClass(invalid = false, className = ""): string {
  return [
    SELECT_BASE,
    invalid ? "border-red" : "border-[color:var(--color-border-strong)] focus-visible:border-navy",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

// The chevron sits in the reserved right gutter; pointer-events-none so clicks
// fall through to the native select.
export const SELECT_CHEVRON =
  "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--color-text-tertiary)]";

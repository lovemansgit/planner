// Shared form-field recipe (Phase 9 · Step 3.6 — Gap G core).
//
// The <Field> wrapper (label + control + help + optional "Optional" tag + error)
// and the styled <Select> that retires the 13 native <select>s the audit found.
// Skinned to B+: sentence-case labels (D2), the green focus ring, the warm-white
// control surface. Class strings here (node-testable) so form-field-recipe.spec
// locks the label casing and the Select chrome.
//
// Scope note: this bundle ships the Field + Select foundation, plus the recipe-
// level inputClass()/textareaClass() surface (Phase 10 · Batch B4) so native
// <input>/<textarea> share the Select chrome when the forms adopt <Field>. The
// full-primitive form kit (TextInput/Textarea/DateField/TimeField *components* +
// promoting the good one-offs RadioCardGroup/ChipToggle/SegmentedControl/
// PreviewPanel) is still a documented follow-up — its own focused bundle.

export const FORM_GROUP = "flex flex-col gap-1.5";
export const FORM_LABEL_ROW = "flex items-baseline justify-between gap-2";
// Sentence-case (D2) — never uppercase.
export const FORM_LABEL = "text-[13px] font-medium text-[color:var(--color-text-secondary)]";
export const FORM_OPTIONAL =
  "font-b-mono text-[10px] uppercase tracking-[0.1em] text-[color:var(--color-text-tertiary)]";
export const FORM_HELP = "text-xs text-[color:var(--color-text-tertiary)]";
export const FORM_ERROR = "text-xs text-red";

// The shared B+ control surface — warm-white card, ink text, green focus ring,
// disabled affordance. One source of truth for every control chrome below so the
// styled <Select> and native <input>/<textarea> read as one kit on the A0 white
// field. Border (rest vs invalid) layers on per-control via fieldBorder().
const FIELD_SURFACE =
  "w-full rounded-[10px] border bg-[color:var(--color-b-card)] text-sm text-[color:var(--color-ink)] transition-colors placeholder:text-[color:var(--color-text-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-b-focus-ring)] disabled:cursor-not-allowed disabled:opacity-60";

// Rest = strong border + navy focus edge; invalid = red border (the ring stays).
function fieldBorder(invalid: boolean): string {
  return invalid
    ? "border-red"
    : "border-[color:var(--color-border-strong)] focus-visible:border-navy";
}

// Styled native <select>: chromeless (appearance-none) so the chevron is ours;
// pr-9 leaves room for the chevron in the right gutter.
const SELECT_BASE = `h-10 appearance-none pl-3.5 pr-9 ${FIELD_SURFACE}`;
// Native <input>: same surface, symmetric padding (no chevron gutter).
const INPUT_BASE = `h-10 px-3.5 ${FIELD_SURFACE}`;
// Native <textarea>: multi-line — min height + top-aligned padding, no fixed h-10.
const TEXTAREA_BASE = `min-h-[5rem] px-3.5 py-2.5 ${FIELD_SURFACE}`;

export function selectClass(invalid = false, className = ""): string {
  return [SELECT_BASE, fieldBorder(invalid), className].filter(Boolean).join(" ");
}

// Native <input> styled to the Select surface (Phase 10 · Batch B4). Pair with
// <Field> for the label; caller wires `aria-describedby` to the Field error/help.
export function inputClass(invalid = false, className = ""): string {
  return [INPUT_BASE, fieldBorder(invalid), className].filter(Boolean).join(" ");
}

// Native <textarea> styled to match (Phase 10 · Batch B4).
export function textareaClass(invalid = false, className = ""): string {
  return [TEXTAREA_BASE, fieldBorder(invalid), className].filter(Boolean).join(" ");
}

// The chevron sits in the reserved right gutter; pointer-events-none so clicks
// fall through to the native select.
export const SELECT_CHEVRON =
  "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--color-text-tertiary)]";

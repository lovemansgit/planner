// Shared EmptyState recipe (Phase 9 · Step 3.6 — Gap H).
//
// One empty treatment to replace the four the Step-1 audit found (card vs
// plain-text vs bare "—" vs nothing). Two variants: `block` for empty pages /
// lists, `inline` for empty field values (the muted value that replaces a bare
// "—"). Skinned to Direction B+: sentence-case display title (D2), calm muted
// body. Class strings here (node-testable) so empty-state-recipe.spec locks them.

// Block container — a centred, vertically-generous panel between hairline rules.
export function emptyBlockClass(className = ""): string {
  return [
    "border-y border-[color:var(--color-border-default)] py-16 text-center",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export const EMPTY_TITLE = "font-b-display text-lg font-semibold text-navy";
export const EMPTY_BODY = "mx-auto mt-2 max-w-md text-sm text-[color:var(--color-text-secondary)]";
export const EMPTY_ACTION = "mt-5 flex justify-center";

// Inline value — the muted text that replaces a bare "—" in a field/cell.
export const EMPTY_INLINE = "text-sm text-[color:var(--color-text-tertiary)]";

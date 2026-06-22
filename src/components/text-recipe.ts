// Phase 9 Step 3.1 (Foundations) — shared typography recipe (Gap I / D2).
//
// One place that encodes casing decision D2: sentence-case is the default for
// every human-facing role; UPPERCASE is reserved for the Eyebrow token ONLY.
// Class strings live here (node-testable, no JSX) so the casing rule can't
// silently drift — mirrors button-recipe / badge-recipe. Font families/weights
// come from the brand tokens (brand-tokens.css). Additive: defining these does
// not restyle any screen; adoption is a later bundle.

export type TextRole = "display" | "heading" | "body" | "caption" | "eyebrow";

const RECIPE: Record<TextRole, string> = {
  display: "font-display text-4xl font-bold tracking-[-0.01em] text-[color:var(--color-navy)]",
  heading: "font-display text-2xl font-semibold text-[color:var(--color-navy)]",
  body: "font-sans text-[15px] leading-relaxed text-[color:var(--color-ink)]",
  caption: "font-sans text-xs text-[color:var(--color-text-secondary)]",
  // The ONLY uppercase role — D2 reserves caps for the tiny eyebrow label.
  eyebrow:
    "font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--color-text-tertiary)]",
};

/** Compose the text classes for a role, appending caller treatment. */
export function textClass(role: TextRole, className = ""): string {
  return [RECIPE[role], className].filter(Boolean).join(" ");
}

// Phase 9 Step 3.1 (Foundations) — typography components (Gap I / D2).
//
// Thin wrappers over the node-tested text-recipe. The convenience exports
// (Display/Heading/Body/Caption/Eyebrow) give every surface one vocabulary for
// text, with D2's casing rule baked in (only Eyebrow is uppercase). Additive —
// no screen is migrated onto these in this bundle.

import type { ElementType, ReactNode } from "react";

import { textClass, type TextRole } from "./text-recipe";

interface TextProps {
  /** Override the rendered element (defaults per role). */
  readonly as?: ElementType;
  readonly className?: string;
  readonly children: ReactNode;
}

const DEFAULT_TAG: Record<TextRole, ElementType> = {
  display: "h1",
  heading: "h2",
  body: "p",
  caption: "p",
  eyebrow: "p",
};

export function Text({
  role,
  as,
  className = "",
  children,
}: TextProps & { readonly role: TextRole }) {
  const Tag = as ?? DEFAULT_TAG[role];
  return <Tag className={textClass(role, className)}>{children}</Tag>;
}

export function Display(props: TextProps) {
  return <Text role="display" {...props} />;
}
export function Heading(props: TextProps) {
  return <Text role="heading" {...props} />;
}
export function Body(props: TextProps) {
  return <Text role="body" {...props} />;
}
export function Caption(props: TextProps) {
  return <Text role="caption" {...props} />;
}
export function Eyebrow(props: TextProps) {
  return <Text role="eyebrow" {...props} />;
}

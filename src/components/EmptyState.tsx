// <EmptyState> (Phase 9 · Step 3.6 — Gap H).
//
// One empty treatment for empty lists/pages (`block`) and empty values
// (`inline`). Replaces the four divergent treatments the audit found. An empty
// screen is an invitation to act, so the block variant explains what's missing
// and offers an optional action.

import type { ReactNode } from "react";

import { EMPTY_ACTION, EMPTY_BODY, EMPTY_INLINE, EMPTY_TITLE, emptyBlockClass } from "./empty-state-recipe";

interface EmptyStateProps {
  readonly title: string;
  readonly body?: string;
  /** A primary action (e.g. a Button) — block variant only. */
  readonly action?: ReactNode;
  /** "block" for empty lists/pages (default); "inline" for empty values. */
  readonly variant?: "block" | "inline";
  readonly className?: string;
}

export function EmptyState({ title, body, action, variant = "block", className = "" }: EmptyStateProps) {
  if (variant === "inline") {
    return <span className={`${EMPTY_INLINE} ${className}`.trim()}>{title}</span>;
  }
  return (
    <div className={emptyBlockClass(className)}>
      <p className={EMPTY_TITLE}>{title}</p>
      {body ? <p className={EMPTY_BODY}>{body}</p> : null}
      {action ? <div className={EMPTY_ACTION}>{action}</div> : null}
    </div>
  );
}

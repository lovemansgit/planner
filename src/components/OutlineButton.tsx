// Day-53 Tier-2 #5 — shared outline (bordered text) button.
//
// The canonical small bordered-text action button used in table rows and
// inline controls: uppercase caption type, hairline border, the app's
// standard opacity-fade transition, focus-visible ring, and a muted
// disabled state. `tone` selects navy (neutral) or red (destructive).
// Extracting it locks the button recipe so it can't drift (audit
// finding 2). Filled/primary buttons + a full <Button> API are the
// follow-on; this is the first extracted variant.

import type { ReactNode } from "react";

type OutlineButtonTone = "navy" | "red";

export function OutlineButton({
  tone = "navy",
  disabled = false,
  title,
  onClick,
  children,
}: {
  readonly tone?: OutlineButtonTone;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}) {
  const toneClass = tone === "red" ? "border-red text-red" : "border-navy text-navy";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`border px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] ${toneClass} transition-opacity duration-[120ms] ease-out hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary disabled:cursor-not-allowed disabled:border-[color:var(--color-border-default)] disabled:text-[color:var(--color-text-tertiary)]`}
    >
      {children}
    </button>
  );
}

// Day 17 / T2 #1 — user-menu dropdown (client component).
//
// First React client component in the codebase with non-trivial
// interaction surface (click-outside, escape-key close, aria-expanded
// toggle, focus-return on close). Replaces the prior standalone
// "Sign out" button at the right end of the top nav with an enterprise
// user-menu surface: tenant eyebrow + tenant name, displayName, email,
// hairline divider, sign-out form posting to /logout.
//
// Aesthetic direction: refined minimalist editorial per brief v1.4
// §3.3.11. Generous negative space; hairline default borders; navy on
// paper. The one signature detail is a 1px Grass Green hairline on the
// top edge of the opened panel — the corporate go-signal token used as
// a single restrained chrome accent. No shadows; depth from spacing
// and hairline contrast only.
//
// Typography per brief: identity block stays under 18px throughout, so
// every text node here uses the body face (Mulish via font-sans /
// default). Manrope (font-display) is reserved for brand-identity text
// at the wordmark + page chrome elsewhere.
//
// Test coverage: helper-only unit test on resolveDisplayName (pure
// function) plus Vercel preview manual visual + interaction smoke at
// PR open. Full interaction-test infrastructure (jsdom +
// @testing-library/react + .spec.tsx pattern) deferred to a dedicated
// future PR per memory/followup_client_component_test_infra.md.

"use client";

import { useEffect, useRef, useState } from "react";

import type { UserIdentity } from "./layout";

/**
 * Resolve the operator's display name for the user-menu trigger button.
 * Falls through three sources: explicit displayName → email local-part →
 * "Account" sentinel.
 *
 * Pure function; exported for unit-testability without rendering the
 * component (no client-component test infrastructure in the codebase
 * yet — see followup_client_component_test_infra.md).
 */
export function resolveDisplayName(identity: UserIdentity): string {
  if (identity.displayName && identity.displayName.trim().length > 0) {
    return identity.displayName;
  }
  const emailLocal = identity.email?.split("@")[0]?.trim();
  if (emailLocal && emailLocal.length > 0) {
    return emailLocal;
  }
  return "Account";
}

interface UserMenuProps {
  readonly identity: UserIdentity;
}

export function UserMenu({ identity }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const displayName = resolveDisplayName(identity);

  // Click-outside close. Mousedown rather than click so the panel
  // collapses on the press, not the release — feels more responsive
  // and matches platform menu conventions.
  useEffect(() => {
    if (!open) return;
    function handleMousedown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleMousedown);
    return () => document.removeEventListener("mousedown", handleMousedown);
  }, [open]);

  // Escape close. Returns focus to the trigger so keyboard users land
  // back where they started — required for proper menu semantics.
  useEffect(() => {
    if (!open) return;
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-sm font-medium text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
      >
        <span>{displayName}</span>
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-200 ease-out ${open ? "rotate-180" : ""}`}
        >
          <polyline points="3 5 6 8 9 5" />
        </svg>
      </button>

      <div
        ref={panelRef}
        role="menu"
        aria-label="Account menu"
        className={`absolute right-0 top-full mt-2 min-w-64 origin-top-right rounded-sm border border-[color:var(--color-border-default)] border-t-[1px] border-t-green bg-surface-primary p-4 transition-all duration-[120ms] ease-out ${
          open
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        <div>
          <p className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
            Tenant
          </p>
          <p className="mb-3 text-xs text-[color:var(--color-text-secondary)]">
            {identity.tenantName || "—"}
          </p>
          <p className="mb-0.5 text-sm font-medium text-navy">{displayName}</p>
          <p className="text-xs text-[color:var(--color-text-secondary)]">
            {identity.email || ""}
          </p>
        </div>
        <div className="mt-3 border-t border-[color:var(--color-border-default)] pt-3">
          <form action="/logout" method="POST">
            <button
              type="submit"
              role="menuitem"
              className="-mx-2 w-full rounded-sm px-2 py-1.5 text-left text-sm text-navy transition-colors duration-[80ms] ease-out hover:bg-ivory"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

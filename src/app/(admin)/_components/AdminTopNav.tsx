// Day 18 / C1 — Transcorp-staff admin top nav (client component).
//
// Mirrors (app)/nav.tsx's brand-canon header (Transcorp logo +
// Manrope wordmark + UserMenu) but renders ADMIN_NAV_ITEMS instead
// of operator NAV_ITEMS — the (admin)/ route group is a parallel
// shell to (app)/ per brief §3.2.2, so the navigation surface is
// distinct (Transcorp-staff cross-tenant items only; no
// tenant-operator items like Tasks / Subscriptions / Consignees).
//
// No dedicated TopNav refactor: keeping operator-side and admin-side
// nav components separate keeps the C1 scope additive — zero touch
// to existing tenant operator UI.
//
// Day-54 walk F2 (overflow repair, not redesign): adopted the
// operator nav's wrap idiom (shrink-0 brand, flex-wrap + gap-y) —
// this component predated that fix, so the brand block overlapped
// "Overview" once the two report tabs landed — and the report items
// now render under one "Reports" dropdown via groupNavItems (plan
// #502 Q1's Reports group). Dropdown open/close behaviour mirrors
// UserMenu (click-outside on mousedown, Escape returns focus).

"use client";

import { useEffect, useRef, useState } from "react";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { shellClass } from "@/components/page-shell-recipe";

import { groupNavItems, isActiveNavPath, type NavItem } from "../../(app)/nav-config";
import { UserMenu } from "../../(app)/user-menu";
import type { UserIdentity } from "../../(app)/layout";

export interface AdminTopNavProps {
  readonly items: readonly NavItem[];
  readonly userIdentity: UserIdentity | null;
}

// D56 S1 — shared tab geometry. Both states reserve a 2px underline + pb-1 so
// the text baseline / underline never shift between active and idle (only the
// border colour + weight change). Focus-ring + transition brought to parity with
// the operator nav (a11y: admin links previously had no focus-visible ring).
const LINK_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary";
const LINK_ACTIVE = `rounded-sm border-b-2 border-green pb-1 text-sm font-medium text-navy ${LINK_FOCUS}`;
const LINK_IDLE = `rounded-sm border-b-2 border-transparent pb-1 text-sm text-[color:var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:text-navy focus-visible:text-navy ${LINK_FOCUS}`;

export function AdminTopNav({ items, userIdentity }: AdminTopNavProps) {
  const pathname = usePathname() ?? "/";
  const entries = groupNavItems(items);

  return (
    <nav
      aria-label="Primary admin"
      className="border-b border-[color:var(--color-border-strong)] bg-surface-primary"
    >
      <div className={shellClass("flex flex-wrap items-center justify-between gap-x-8 gap-y-4 py-6")}>
        <Link
          href="/admin/merchants"
          className="flex shrink-0 items-center gap-3 transition-opacity duration-150 hover:opacity-80"
          aria-label="Subscription Planner — Transcorp admin home"
        >
          <Image
            src="/brand/transcorp-logo.svg"
            alt="Transcorp"
            width={186}
            height={64}
            priority
            unoptimized
            className="h-14 w-auto"
          />
          <span className="font-display text-xs uppercase tracking-[0.2em] leading-none text-[color:var(--color-text-secondary)]">
            Subscription planner · Admin
          </span>
        </Link>
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {entries.map((entry) =>
            entry.kind === "item" ? (
              <li key={entry.item.path}>
                <Link
                  href={entry.item.path}
                  aria-current={isActiveNavPath(pathname, entry.item) ? "page" : undefined}
                  className={`whitespace-nowrap ${
                    isActiveNavPath(pathname, entry.item) ? LINK_ACTIVE : LINK_IDLE
                  }`}
                >
                  {entry.item.label}
                </Link>
              </li>
            ) : (
              <li key={`group-${entry.label}`}>
                <NavGroupDropdown label={entry.label} items={entry.items} pathname={pathname} />
              </li>
            ),
          )}
          {userIdentity ? (
            <li>
              <UserMenu identity={userIdentity} />
            </li>
          ) : null}
        </ul>
      </div>
    </nav>
  );
}

function NavGroupDropdown({
  label,
  items,
  pathname,
}: {
  readonly label: string;
  readonly items: readonly NavItem[];
  readonly pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const groupActive = items.some((item) => isActiveNavPath(pathname, item));

  // Click-outside close — mousedown, same rationale as UserMenu.
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

  // Escape close with focus return — same posture as UserMenu.
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
        className={`inline-flex items-center gap-1.5 whitespace-nowrap ${
          groupActive ? LINK_ACTIVE : LINK_IDLE
        }`}
      >
        <span>{label}</span>
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
      <ul
        ref={panelRef}
        role="menu"
        aria-label={`${label} menu`}
        className={`absolute right-0 top-full z-10 mt-2 min-w-44 origin-top-right rounded-sm border border-[color:var(--color-border-default)] border-t-[1px] border-t-green bg-surface-primary py-2 transition-all duration-[120ms] ease-out ${
          open
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        {items.map((item) => {
          const active = isActiveNavPath(pathname, item);
          return (
            <li key={item.path} role="none">
              <Link
                href={item.path}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`block whitespace-nowrap px-4 py-2 text-sm ${
                  active
                    ? "font-medium text-navy"
                    : "text-[color:var(--color-text-secondary)] hover:bg-ivory hover:text-navy"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

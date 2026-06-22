// Day 11 / P4 — top nav (client component).
// Day 17 / T2 #1 — brand pass: logo + Manrope wordmark lockup
// (replaces text wordmark) and UserMenu (replaces standalone /logout
// form). Active-tab logic + permission-filtered nav items unchanged.
//
// Active-tab indicator runs on the client via usePathname() — the
// layout passes the resolved permission set in as a prop, the client
// filters via visibleNavItems, and the active-tab match runs against
// the live pathname so client-side navigation updates the indicator
// without a full re-render of the parent server component.
//
// Logout is rendered inside UserMenu as a form posting to /logout
// (existing route from P2). Form-with-POST is preferred over an
// `<a href="/logout">` for CSRF posture — same-origin enforcement on
// POST blocks cross-site dispatch via `<img src="/logout">` style
// abuse. The /logout handler accepts both methods (canonical POST +
// idempotent GET) so direct URL hits still work.

"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Permission } from "@/shared/types";

import type { UserIdentity } from "./layout";
import { isActiveNavPath, visibleNavItems } from "./nav-config";
import { UserMenu } from "./user-menu";

export interface TopNavProps {
  readonly permissions: ReadonlySet<Permission>;
  readonly userIdentity: UserIdentity | null;
  /** Day-54 P2 — tenant dark switch; gates requiresAssetTracking items. */
  readonly assetTrackingEnabled?: boolean;
}

export function TopNav({ permissions, userIdentity, assetTrackingEnabled }: TopNavProps) {
  const pathname = usePathname() ?? "/";
  const items = visibleNavItems(permissions, { assetTrackingEnabled });

  return (
    <nav
      aria-label="Primary"
      className="border-b border-[color:var(--color-border-strong)] bg-surface-primary"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-4 px-12 py-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-3 rounded-sm transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary"
          aria-label="Subscription Planner — Transcorp home"
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
            Subscription planner
          </span>
        </Link>
        <ul className="flex flex-wrap items-center gap-x-8 gap-y-2">
          {items.map((item) => {
            const active = isActiveNavPath(pathname, item);
            return (
              <li key={item.path}>
                <Link
                  href={item.path}
                  aria-current={active ? "page" : undefined}
                  className={
                    // Idle reserves the same 2px underline (transparent) + pb-1
                    // as the active state so the text baseline and underline sit
                    // identically across tabs — only the border colour + weight
                    // change between states (no vertical jump). D56 S1 alignment.
                    active
                      ? "rounded-sm border-b-2 border-green pb-1 text-sm font-medium text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary"
                      : "rounded-sm border-b-2 border-transparent pb-1 text-sm text-[color:var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:text-navy focus-visible:outline-none focus-visible:text-navy focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary"
                  }
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
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

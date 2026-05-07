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
}

export function TopNav({ permissions, userIdentity }: TopNavProps) {
  const pathname = usePathname() ?? "/";
  const items = visibleNavItems(permissions);

  return (
    <nav
      aria-label="Primary"
      className="border-b border-[color:var(--color-border-strong)] bg-surface-primary"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-12 py-6">
        <Link
          href="/"
          className="flex items-center gap-3 transition-opacity duration-150 hover:opacity-80"
          aria-label="Subscription Planner — Transcorp home"
        >
          <Image
            src="/brand/transcorp-logo.png"
            alt="Transcorp"
            width={40}
            height={40}
            priority
            className="h-10 w-10"
          />
          <span className="font-display text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Subscription planner
          </span>
        </Link>
        <ul className="flex items-center gap-8">
          {items.map((item) => {
            const active = isActiveNavPath(pathname, item);
            return (
              <li key={item.path}>
                <Link
                  href={item.path}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "border-b border-navy pb-1 text-sm font-medium text-navy"
                      : "text-sm text-[color:var(--color-text-secondary)] hover:text-navy"
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

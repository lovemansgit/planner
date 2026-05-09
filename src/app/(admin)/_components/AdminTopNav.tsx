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

"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActiveNavPath, type NavItem } from "../../(app)/nav-config";
import { UserMenu } from "../../(app)/user-menu";
import type { UserIdentity } from "../../(app)/layout";

export interface AdminTopNavProps {
  readonly items: readonly NavItem[];
  readonly userIdentity: UserIdentity | null;
}

export function AdminTopNav({ items, userIdentity }: AdminTopNavProps) {
  const pathname = usePathname() ?? "/";

  return (
    <nav
      aria-label="Primary admin"
      className="border-b border-[color:var(--color-border-strong)] bg-surface-primary"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-12 py-6">
        <Link
          href="/admin/merchants"
          className="flex items-end gap-3 transition-opacity duration-150 hover:opacity-80"
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
                      ? "border-b-2 border-green pb-1 text-sm font-medium text-navy"
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

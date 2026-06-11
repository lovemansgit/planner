// Day 19 / Phase 1.5 — Transcorp-staff merchant filter dropdown.
//
// Shared across /admin/tasks, /admin/consignees, /admin/subscriptions.
// URL-state via `?merchant=<slug>` query param. Mirrors the
// PageSizeDropdown pattern (PR #175 Day-17 Session B): native <select>
// for keyboard-a11y + zero-bundle styling; useRouter to navigate.
//
// Path-agnostic: `usePathname()` resolves the current admin path so the
// dropdown navigates back to the same page with mutated query params.
// One component, three consumers.
//
// Param mutation discipline:
//   - empty value (slug = "") → delete `merchant` param entirely
//   - non-empty value         → set `merchant` to the new slug
//   - `page` is RESET on filter change (page-N of unfiltered ≠ page-N
//     of filtered; preserving stale page is a worse UX than resetting)
//   - all other params (status, perPage, etc.) preserved
//
// Brand-canon: matches PageSizeDropdown surface — uppercase eyebrow
// label + native select with brand-token chrome.
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ChangeEvent } from "react";

import type { TenantStatus } from "@/modules/merchants/types";

interface MerchantFilterMerchant {
  readonly slug: string;
  readonly name: string;
  readonly status: TenantStatus;
}

interface MerchantFilterDropdownProps {
  readonly merchants: readonly MerchantFilterMerchant[];
  readonly currentSlug: string | null;
}

export function MerchantFilterDropdown({
  merchants,
  currentSlug,
}: MerchantFilterDropdownProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();

  function onChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.delete("page");
    if (next === "") {
      params.delete("merchant");
    } else {
      params.set("merchant", next);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <label className="inline-flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
      <span>Merchant</span>
      <select
        value={currentSlug ?? ""}
        onChange={onChange}
        className="border border-[color:var(--color-border-default)] bg-paper px-3 py-1.5 text-xs uppercase tracking-[0.1em] text-navy hover:border-[color:var(--color-border-strong)] focus:outline-none focus:border-navy"
        aria-label="Filter by merchant"
      >
        <option value="">All merchants</option>
        {merchants.map((m) => (
          <option key={m.slug} value={m.slug}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}

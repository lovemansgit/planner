// Day-24 demo-critical primitive — URL-synced search input.
//
// Renders a single <input type="search"> bound to the URL's ?q= query
// param. Typing triggers a 300ms debounce before pushing a router URL
// update with the new value (or clearing the param when empty). The
// server component on the consuming page reads `searchParams.q` and
// passes the value to its service-layer list fn; the SQL ILIKE filter
// runs server-side.
//
// 1-character minimum is enforced by the consumer (page reads
// searchParams.q?.trim() and threads only when length >= 1). The bar
// itself does not gate — single-char prefixes are useful for short
// surnames or AWB hashes.
//
// Brand-canon:
//   - hairline stone-200 border at rest
//   - stone-100 background on focus (matches PR #238 form-token tier)
//   - navy focus border, 120ms ease-out
//   - sentence-case placeholder
//   - no shadow, no rounded
//
// Why "use client": URL mutation on debounce needs `useRouter` +
// `useSearchParams`. The server component on the consuming page can
// still render this primitive as a child — the directive only marks
// the component itself, not its parent boundary.

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export interface SearchBarProps {
  readonly placeholder: string;
  readonly label: string;
  readonly debounceMs?: number;
  /**
   * Optional callback fired after the URL has been updated. Lets a
   * consuming page co-locate analytics or scroll-reset logic without
   * subscribing to the router separately.
   */
  readonly onCommit?: (value: string) => void;
}

const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Search input that mirrors its value into the URL's `?q=` parameter
 * after a debounce. The initial render reads the current `?q=` so
 * deep-links restore correctly.
 *
 * Empty / whitespace-only values strip the param from the URL so the
 * canonical /consignees, /subscriptions, /tasks URLs stay clean for
 * bookmarking.
 */
export function SearchBar({
  placeholder,
  label,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  onCommit,
}: SearchBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = searchParams.get("q") ?? "";
  const [value, setValue] = useState(initial);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      const trimmed = value.trim();
      const current = new URLSearchParams(searchParams.toString());
      if (trimmed.length === 0) {
        current.delete("q");
      } else {
        current.set("q", trimmed);
      }
      // Reset paginated views to page 1 on a new query so the operator
      // doesn't land on an empty later page after filtering.
      current.delete("page");
      const qs = current.toString();
      router.replace(qs.length > 0 ? `?${qs}` : "?");
      onCommit?.(trimmed);
    }, debounceMs);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
    // searchParams is a stable URLSearchParams snapshot per render; we
    // intentionally re-read it on every debounce tick rather than
    // subscribing here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="mb-6">
      <label htmlFor="searchbar-input" className="sr-only">
        {label}
      </label>
      <input
        id="searchbar-input"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        inputMode="search"
        autoComplete="off"
        className="w-full max-w-md border border-stone-200 bg-paper px-3 py-2 text-sm text-navy placeholder:text-[color:var(--color-text-tertiary)] transition-colors duration-[120ms] ease-out focus:border-navy focus:bg-stone-100 focus:outline-none"
      />
    </div>
  );
}

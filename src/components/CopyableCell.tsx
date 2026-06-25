"use client";

// Phase 12.2 Batch B / Item 6 — copy affordance for truncated DataTable cells.
//
// The identity cells (Merchant / Consignee / Email / Tenant) truncate at
// max-w-[230px] with an ellipsis. The owner wants to KEEP the "…" but add a
// hover-to-reveal-full-value + click-to-copy affordance so a long value can be
// read and copied without widening the column.
//
//   - Hover reveal: the cell's native `title` (set by DataTable from the
//     column's title(row)) shows the full value as a browser tooltip. That is
//     used rather than a custom popover because the table scrolls inside an
//     overflow-x-auto card, which would clip an in-cell tooltip.
//   - Click to copy: a small copy button surfaces on hover and copies the full
//     value. It stops propagation + prevents default so it never triggers the
//     row-link navigation the cell is wrapped in.
//
// The button's subtle elevation uses an INLINE boxShadow (not a Tailwind
// arbitrary-shadow utility) per the Phase 11 arbitrary-var parser bug — even
// in a comment the literal arbitrary-shadow token is scanned by Tailwind and
// emits an invalid CSS rule that breaks `next build`, so it is not written here.

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyableCellProps {
  /** Full plain-text value to copy (the column's title(row)). */
  readonly value: string;
  /** When set, the cell content is a row-link to this href (navigation). */
  readonly href?: string;
  /** The (truncating) rendered cell content. */
  readonly children: ReactNode;
}

export function CopyableCell({ value, href, children }: CopyableCellProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: MouseEvent<HTMLButtonElement>) {
    // Never let the copy click bubble to the row-link or navigate the page.
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Non-secure context / denied permission — leave the value selectable.
    }
  }

  return (
    <span className="group/copy flex items-center gap-1">
      {href ? (
        <Link href={href} className="block min-w-0 flex-1 truncate">
          {children}
        </Link>
      ) : (
        <span className="block min-w-0 flex-1 truncate">{children}</span>
      )}
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : `Copy ${value}`}
        title={copied ? "Copied" : "Copy"}
        className="shrink-0 rounded-md bg-[color:var(--color-b-card)] p-1 text-[color:var(--color-text-tertiary)] opacity-0 transition-opacity duration-[120ms] ease-out hover:text-navy focus-visible:opacity-100 group-hover/copy:opacity-100"
        style={{ boxShadow: "0 1px 2px rgba(37, 45, 96, 0.12)" }}
      >
        {copied ? (
          <Check className="h-3 w-3 text-green" aria-hidden="true" />
        ) : (
          <Copy className="h-3 w-3" aria-hidden="true" />
        )}
      </button>
    </span>
  );
}

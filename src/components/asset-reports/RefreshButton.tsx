"use client";

// Manual refresh button — Day-54 P3 (Love's constraint 4: the
// operator's "now" override; the "as of" stamp shows the last
// successful sweep). POSTs the bounded refresh route, then
// router.refresh() re-renders the server component with fresh data.

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Outcome of one bounded SuiteFleet poll for a single merchant (or, with no
 *  slug, the caller's own tenant). */
export type RefreshOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: number; readonly message: string };

/**
 * Fire ONE bounded refresh poll against the existing
 * `POST /api/reports/asset-tracking/refresh` route — `?merchant=<slug>` for a
 * named merchant (Transcorp staff), or no query for the caller's own tenant.
 *
 * Single source for the SuiteFleet refresh contract: both the single-merchant
 * RefreshButton and the multi-select MerchantRefreshControl call it, so neither
 * can drift the request shape. Each call is exactly one poll tick's load — the
 * #509 cost guard is preserved by the CALLER choosing which (and how many)
 * merchants to poll, never by an implicit fan-out here.
 */
export async function refreshMerchant(merchantSlug?: string): Promise<RefreshOutcome> {
  try {
    const qs = merchantSlug ? `?merchant=${encodeURIComponent(merchantSlug)}` : "";
    const res = await fetch(`/api/reports/asset-tracking/refresh${qs}`, {
      method: "POST",
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: res.status === 403 ? "Not enabled" : "Refresh failed",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 0, message: "Refresh failed" };
  }
}

export function RefreshButton({
  merchantSlug,
}: {
  /** Set on the admin pages; tenant operators refresh their own tenant. */
  readonly merchantSlug?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    const result = await refreshMerchant(merchantSlug);
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(result.message);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="border border-[color:var(--color-border-strong)] px-4 py-2 text-xs uppercase tracking-[0.15em] transition-colors hover:bg-[color:var(--color-tint-navy-subtle)] disabled:opacity-50"
      >
        {busy ? "Refreshing…" : "Refresh now"}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}

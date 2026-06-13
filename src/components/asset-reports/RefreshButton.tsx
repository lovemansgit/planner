"use client";

// Manual refresh button — Day-54 P3 (Love's constraint 4: the
// operator's "now" override; the "as of" stamp shows the last
// successful sweep). POSTs the bounded refresh route, then
// router.refresh() re-renders the server component with fresh data.

import { useRouter } from "next/navigation";
import { useState } from "react";

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
    try {
      const qs = merchantSlug ? `?merchant=${encodeURIComponent(merchantSlug)}` : "";
      const res = await fetch(`/api/reports/asset-tracking/refresh${qs}`, {
        method: "POST",
      });
      if (!res.ok) {
        setError(res.status === 403 ? "Not enabled" : "Refresh failed");
        return;
      }
      router.refresh();
    } catch {
      setError("Refresh failed");
    } finally {
      setBusy(false);
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

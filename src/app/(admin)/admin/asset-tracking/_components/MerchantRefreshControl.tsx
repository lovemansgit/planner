"use client";

// Phase 12 Batch AT — one refresh control for the whole Asset Tracking page.
//
// Replaces the N per-merchant "Refresh now" buttons (one per report row) with
// a single merchant multi-select + "Select all" + one Refresh action. The user
// picks the scope; Refresh polls EXACTLY the selected merchants.
//
// #509 COST GUARD — preserved, not changed. Each refresh still fires the
// existing `POST /api/reports/asset-tracking/refresh?merchant=<slug>` route
// once per selected merchant (via the shared refreshMerchant helper), polled
// SEQUENTIALLY. That is byte-identical to a human clicking N per-merchant
// buttons one at a time — same request shape, same per-merchant bounding, no
// implicit all-merchants fan-out. Selecting "all" and clicking Refresh is an
// EXPLICIT user choice of scope, never an implicit one. No wiring, frequency,
// registration, or SuiteFleet-contract change — pure UI.
//
// Native <details> disclosure for open/close (keyboard-a11y, zero-bundle —
// same posture as MerchantFilterDropdown's native <select>); React state drives
// the selection and the sequential poll progress.

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { refreshMerchant } from "@/components/asset-reports/RefreshButton";

interface RefreshMerchant {
  readonly slug: string;
  readonly name: string;
}

interface MerchantRefreshControlProps {
  /** Genuine merchants offered as refresh targets (same list as the filter
   *  dropdown). Test tenants are never offered. */
  readonly merchants: readonly RefreshMerchant[];
  /** Pre-select the currently filtered merchant, if any, for convenience. */
  readonly currentSlug: string | null;
}

interface Failure {
  readonly name: string;
  readonly message: string;
}

export function MerchantRefreshControl({ merchants, currentSlug }: MerchantRefreshControlProps) {
  const router = useRouter();
  const labelId = useId();

  const [selected, setSelected] = useState<ReadonlySet<string>>(() =>
    currentSlug && merchants.some((m) => m.slug === currentSlug)
      ? new Set([currentSlug])
      : new Set(),
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ readonly done: number; readonly total: number } | null>(null);
  const [failures, setFailures] = useState<readonly Failure[]>([]);
  const [doneTotal, setDoneTotal] = useState<number | null>(null);

  const allSelected = merchants.length > 0 && selected.size === merchants.length;
  const someSelected = selected.size > 0 && selected.size < merchants.length;

  // Native checkboxes have no JSX prop for the indeterminate (partial) state —
  // it must be set imperatively on the DOM node.
  const masterRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(merchants.map((m) => m.slug)) : new Set());
  }

  function toggleOne(slug: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(slug);
      else next.delete(slug);
      return next;
    });
  }

  async function onRefresh() {
    // Stable on-screen order; only the selected set.
    const targets = merchants.filter((m) => selected.has(m.slug));
    if (targets.length === 0 || busy) return;

    setBusy(true);
    setFailures([]);
    setDoneTotal(null);
    setProgress({ done: 0, total: targets.length });

    const fails: Failure[] = [];
    // Sequential — one bounded poll at a time, never a concurrent burst.
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      const outcome = await refreshMerchant(target.slug);
      if (!outcome.ok) fails.push({ name: target.name, message: outcome.message });
      setProgress({ done: i + 1, total: targets.length });
    }

    setBusy(false);
    setProgress(null);
    setFailures(fails);
    setDoneTotal(targets.length);
    // Re-render the server component with the freshly polled data.
    router.refresh();
  }

  const count = selected.size;
  const refreshLabel = busy && progress
    ? `Refreshing ${progress.done}/${progress.total}…`
    : count > 0
      ? `Refresh ${count} selected`
      : "Refresh";

  const succeeded = doneTotal !== null ? doneTotal - failures.length : 0;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-3">
        <details className="relative">
          <summary
            className="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-[10px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-b-card)] px-[18px] text-sm font-semibold text-navy transition-colors hover:border-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-green)] [&::-webkit-details-marker]:hidden"
            aria-label="Choose merchants to refresh"
          >
            <span>Merchants</span>
            <span className="tabular-nums text-[color:var(--color-text-secondary)]">
              {count}/{merchants.length}
            </span>
            <span aria-hidden="true" className="text-[color:var(--color-text-secondary)]">
              ▾
            </span>
          </summary>

          <div className="absolute right-0 z-20 mt-2 w-72 rounded-2xl border border-[color:var(--color-border-default)] bg-[color:var(--color-b-card)] p-2 shadow-b-card">
            <fieldset>
              <legend id={labelId} className="sr-only">
                Merchants to refresh
              </legend>
              {merchants.length === 0 ? (
                <p className="px-2 py-3 text-xs text-[color:var(--color-text-secondary)]">
                  No merchants available to refresh.
                </p>
              ) : (
                <>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-navy hover:bg-[color:var(--color-tint-navy-subtle)]">
                    <input
                      ref={masterRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => toggleAll(e.target.checked)}
                      className="h-4 w-4 accent-[color:var(--color-green)]"
                    />
                    <span>Select all</span>
                  </label>
                  <div className="my-1 border-t border-[color:var(--color-border-default)]" />
                  <ul className="max-h-64 overflow-y-auto" aria-labelledby={labelId}>
                    {merchants.map((m) => (
                      <li key={m.slug}>
                        <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-navy hover:bg-[color:var(--color-tint-navy-subtle)]">
                          <input
                            type="checkbox"
                            checked={selected.has(m.slug)}
                            onChange={(e) => toggleOne(m.slug, e.target.checked)}
                            className="h-4 w-4 accent-[color:var(--color-green)]"
                          />
                          <span className="truncate">{m.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </fieldset>
          </div>
        </details>

        <Button
          variant="primary"
          onClick={onRefresh}
          loading={busy}
          disabled={count === 0}
          title={count === 0 ? "Select at least one merchant to refresh" : undefined}
        >
          {refreshLabel}
        </Button>
      </div>

      {/* Cost-guard reassurance: scope is exactly what the user picks. */}
      <p className="text-right text-[11px] text-[color:var(--color-text-tertiary)]">
        Polls only the merchants you select — one live check each.
      </p>

      {failures.length > 0 ? (
        <p role="alert" className="max-w-xs text-right text-xs text-red-700">
          Couldn’t refresh {failures.map((f) => `${f.name} (${f.message})`).join(", ")}
        </p>
      ) : doneTotal !== null ? (
        <p className="text-right text-xs text-[color:var(--color-text-secondary)]">
          Refreshed {succeeded} merchant{succeeded === 1 ? "" : "s"}.
        </p>
      ) : null}
    </div>
  );
}

// Day-23 §3.3.2 — Toast primitive.
//
// First reusable confirmation primitive in the codebase. Renders a
// fixed-position banner anchored to the bottom-right of the viewport.
// The success signal arrives as a server-side query param (`?created=1`
// from OnboardConsigneeWizard's router.push); the consuming server
// component conditionally renders this Toast based on that param's
// presence. After `durationMs` elapses the Toast calls
// router.replace(pathname + stripped-params) to clear the param so
// (a) the toast doesn't re-show on a browser refresh, and (b) operators
// don't share URLs that trigger the toast for an unrelated viewer.
//
// Brand-canon per brief §3.3.11 + reviewer spec: navy text on stone-100
// background, hairline 1px stone-200 border, NO shadow, sentence case,
// 120ms ease-out fade-out. role="status" + aria-live="polite" so
// assistive tech announces the message without interrupting.
//
// Pure-logic extraction: `stripParamFromSearchParams(params, key)`
// exposed for spec coverage per the codebase's no-render-test
// convention (memory/followup_client_component_test_infra.md).

"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface ToastProps {
  readonly message: string;
  /** Which search-param to strip on auto-dismiss. Default: "created". */
  readonly paramKey?: string;
  /** Auto-dismiss delay in milliseconds. Default: 5000. */
  readonly durationMs?: number;
}

/**
 * Return the query-string portion (no leading "?") with `paramKey`
 * removed. Empty result means no other params remained — the caller
 * should then route to the bare pathname.
 */
export function stripParamFromSearchParams(
  searchParams: URLSearchParams,
  paramKey: string,
): string {
  const params = new URLSearchParams(searchParams.toString());
  params.delete(paramKey);
  return params.toString();
}

const DEFAULT_DURATION_MS = 5000;
const FADE_OUT_MS = 200;

export function Toast({
  message,
  paramKey = "created",
  durationMs = DEFAULT_DURATION_MS,
}: ToastProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Two-phase dismiss: fade opacity first, then strip the param so the
    // toast is no longer in the rendered tree on the next URL render.
    // Operators see a smooth 120ms ease-out fade rather than a hard
    // disappear at the durationMs mark.
    const fadeTimer = setTimeout(() => {
      setVisible(false);
    }, durationMs);
    const stripTimer = setTimeout(() => {
      const stripped = stripParamFromSearchParams(
        new URLSearchParams(searchParams.toString()),
        paramKey,
      );
      const url = stripped ? `${pathname}?${stripped}` : pathname;
      router.replace(url);
    }, durationMs + FADE_OUT_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(stripTimer);
    };
  }, [router, pathname, searchParams, paramKey, durationMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed bottom-6 right-6 z-50 max-w-sm transition-opacity duration-[200ms] ease-out ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="rounded-sm border border-stone-200 bg-stone-100 px-4 py-3 text-sm text-navy">
        {message}
      </div>
    </div>
  );
}

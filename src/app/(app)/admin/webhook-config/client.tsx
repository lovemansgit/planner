"use client";

// /admin/webhook-config — interactive client island (Day 9 / P4a).
//
// Sole interactive element on the page: the copy-to-clipboard control
// for the webhook URL. Server component renders the URL string; this
// island handles the click + transient confirmation state.
//
// Defensive posture: navigator.clipboard is gated on async permission
// in some browsers + may throw on http (non-secure context). The
// onClick handler catches and surfaces a "Copy failed" hint so the
// operator can fall back to manual selection.

import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyableUrlProps {
  readonly url: string;
}

type CopyState = "idle" | "copied" | "failed";

export function CopyableUrl({ url }: CopyableUrlProps) {
  const [state, setState] = useState<CopyState>("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
      setTimeout(() => setState("idle"), 2000);
    }
  }

  return (
    <div className="flex items-start gap-3">
      <code className="flex-1 break-all rounded border border-[color:var(--color-border-default)] bg-[color:var(--color-surface-secondary,white)] px-3 py-2 font-serif text-sm text-navy">
        {url}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy webhook URL"
        className="inline-flex shrink-0 items-center gap-2 rounded border border-[color:var(--color-border-default)] bg-[color:var(--color-surface-secondary,white)] px-3 py-2 text-xs uppercase tracking-[0.15em] text-navy transition-colors hover:border-[color:var(--color-border-strong)]"
      >
        {state === "copied" ? (
          <>
            <Check className="h-3.5 w-3.5" /> Copied
          </>
        ) : state === "failed" ? (
          <>
            <Copy className="h-3.5 w-3.5" /> Copy failed
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" /> Copy
          </>
        )}
      </button>
    </div>
  );
}

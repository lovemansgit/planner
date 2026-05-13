"use client";

// Shared copy-to-clipboard primitive (Day 25 / T2 extraction).
//
// Originally shipped Day 9 / P4a as the interactive client island on
// /admin/webhook-config; relocated to src/components/ during the
// admin-merchants-detail page lane (PR #270 plan §6) so both
// consumers (tenant-admin webhook-config + transcorp-staff merchant
// detail) can reuse without page-colocation coupling.
//
// Behavior unchanged from the original implementation: idle → copied
// (2s revert) → failed (2s revert) state machine driven by a single
// onClick handler.
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

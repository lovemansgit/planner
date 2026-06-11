// Day-54 — per-merchant auth-method switch control.
//
// Plan day-54-sandbox-apikey-method-switch.md §4.4. Renders the
// merchant's EFFECTIVE method and offers the other one behind an
// explicit confirm step whose copy states the consequence verbatim:
// switching clears the stored credentials and the merchant FAILS LOUD
// on SuiteFleet pushes until a new pair is entered for the new method.
// No credential value is ever displayed (write-only posture unchanged).

"use client";

import { useState, useTransition } from "react";

import {
  setAuthMethodAction,
  type SetAuthMethodActionResult,
} from "../_actions";

const METHOD_LABEL: Record<"oauth" | "api_key", string> = {
  oauth: "OAuth (username / password)",
  api_key: "API Key (Client Credentials)",
};

interface AuthMethodSwitchProps {
  readonly tenantId: string;
  readonly effectiveMethod: "oauth" | "api_key";
  readonly overrideActive: boolean;
}

export function AuthMethodSwitch({
  tenantId,
  effectiveMethod,
  overrideActive,
}: AuthMethodSwitchProps) {
  const other: "oauth" | "api_key" = effectiveMethod === "oauth" ? "api_key" : "oauth";
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<SetAuthMethodActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const onConfirm = () => {
    startTransition(async () => {
      const r = await setAuthMethodAction(tenantId, other);
      setResult(r);
      setConfirming(false);
    });
  };

  return (
    <section className="mb-10 rounded-sm border border-stone-200 bg-paper p-5">
      <h2 className="font-display text-sm font-semibold text-navy">
        Authentication method
      </h2>
      <p className="mt-2 text-sm text-[color:var(--color-text-secondary)]">
        Current:{" "}
        <span className="font-medium text-navy">{METHOD_LABEL[effectiveMethod]}</span>
        {overrideActive ? (
          <span className="ml-2 inline-flex items-center rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-amber-900">
            merchant override
          </span>
        ) : (
          <span className="ml-2 text-xs">(region default)</span>
        )}
      </p>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 rounded-sm border border-stone-300 px-3 py-1.5 text-sm font-medium text-navy transition-opacity duration-[120ms] ease-out hover:opacity-80"
        >
          Switch to {METHOD_LABEL[other]}
        </button>
      ) : (
        <div
          role="alertdialog"
          aria-label="Confirm authentication method switch"
          className="mt-4 rounded-sm border border-amber-300 bg-amber-50 p-4"
        >
          <p className="text-sm text-navy">
            Switching to <span className="font-semibold">{METHOD_LABEL[other]}</span>{" "}
            immediately <span className="font-semibold">clears this merchant&apos;s stored
            credentials</span>. Until you enter a new credential pair for the new
            method below, every SuiteFleet push for this merchant will{" "}
            <span className="font-semibold">fail and appear in failed-push</span>. No
            silent fallback occurs.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="rounded-sm bg-navy px-3 py-1.5 text-sm font-medium text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Switching…" : `Switch and clear credentials`}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="rounded-sm border border-stone-300 px-3 py-1.5 text-sm font-medium text-navy transition-opacity duration-[120ms] ease-out hover:opacity-80 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result !== null && result.kind !== "switched" ? (
        <p role="alert" className="mt-3 rounded-sm border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {result.kind === "noop"
            ? "The merchant is already on that method."
            : result.message}
        </p>
      ) : null}
    </section>
  );
}

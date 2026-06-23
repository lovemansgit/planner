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

import { Button } from "@/components/Button";

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
    <section className="mb-10 rounded-2xl bg-[color:var(--color-b-card)] p-6 shadow-[var(--shadow-b-card)]">
      <h2 className="font-b-display text-sm font-semibold text-navy">
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
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => setConfirming(true)}
        >
          Switch to {METHOD_LABEL[other]}
        </Button>
      ) : (
        <div
          role="alertdialog"
          aria-label="Confirm authentication method switch"
          className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4"
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
            <Button
              variant="danger"
              size="sm"
              onClick={onConfirm}
              disabled={pending}
            >
              {pending ? "Switching…" : `Switch and clear credentials`}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {result !== null && result.kind !== "switched" ? (
        <p role="alert" className="mt-3 rounded-[10px] border border-red/40 bg-red/10 px-3.5 py-2.5 text-sm text-red">
          {result.kind === "noop"
            ? "The merchant is already on that method."
            : result.message}
        </p>
      ) : null}
    </section>
  );
}

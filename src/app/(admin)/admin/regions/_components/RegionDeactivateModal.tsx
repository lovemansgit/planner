// Day 26 / T3 Sub-PR 3 — SuiteFleet region deactivate confirmation modal.
//
// Mirrors the MerchantStatusModal pattern (hand-rolled per the
// AdHocTaskDialog / MerchantStatusModal precedent — no Radix Dialog
// import per v1.14 plan §8.1):
//   - Trigger button + role="dialog" aria-modal="true" panel
//   - Click-outside (mousedown) close
//   - Escape close + return focus to trigger
//   - useActionState form remounted via formKey for state reset
//   - Inline error rendering for the discriminated-union result kinds
//
// Two confirmation copies driven by `inUseCount`:
//   - 0   — short copy ("Deactivate this region? It can't be reactivated
//           in v1.")
//   - >0  — plan §7.3 copy spelling out that existing merchants keep
//           authenticating; only new selection is blocked.

"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  deactivateRegionAction,
  type DeactivateRegionActionResult,
} from "../_actions";

interface FormChildProps {
  readonly regionId: string;
  readonly regionDisplayName: string;
  readonly inUseCount: number;
  readonly onCancel: () => void;
  readonly onSuccess: () => void;
}

function RegionDeactivateModalForm({
  regionId,
  regionDisplayName,
  inUseCount,
  onCancel,
  onSuccess,
}: FormChildProps) {
  const boundAction = deactivateRegionAction.bind(null, regionId);
  const [actionResult, formAction, isPending] = useActionState<
    DeactivateRegionActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "deactivated") {
      onSuccess();
    }
  }, [actionResult.kind, onSuccess]);

  const summary = inUseCount > 0
    ? `Deactivating ${regionDisplayName} prevents new merchants from selecting it but does not affect existing merchants. Existing merchants will continue to authenticate; their credentials remain valid. Continue?`
    : `Deactivating ${regionDisplayName} prevents new merchants from selecting it. The region cannot be reactivated through the UI in v1.`;

  const errorMessage =
    actionResult.kind === "conflict" ||
    actionResult.kind === "forbidden" ||
    actionResult.kind === "not_found"
      ? actionResult.message
      : null;

  return (
    <form action={formAction} className="mt-6">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
        SuiteFleet region
      </p>
      <h2 className="mt-1 font-display text-xl font-semibold text-navy">
        Deactivate region
      </h2>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        {summary}
      </p>

      {errorMessage ? (
        <p
          role="alert"
          className="mt-4 rounded-sm border border-red/40 bg-red/10 px-2 py-1.5 text-xs text-red"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Deactivating…" : "Deactivate"}
        </button>
      </div>
    </form>
  );
}

interface RegionDeactivateModalProps {
  readonly regionId: string;
  readonly regionDisplayName: string;
  readonly inUseCount: number;
  /** Variant: 'row' renders compact button for table; 'detail' renders larger button for detail page. */
  readonly variant?: "row" | "detail";
}

export function RegionDeactivateModal({
  regionId,
  regionDisplayName,
  inUseCount,
  variant = "row",
}: RegionDeactivateModalProps) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function openModal() {
    setOpen(true);
    setFormKey((k) => k + 1);
  }
  function closeModal() {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function handleMousedown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleMousedown);
    return () => document.removeEventListener("mousedown", handleMousedown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [open]);

  const triggerClass = variant === "row"
    ? "inline-flex min-w-[120px] items-center justify-center rounded-sm border border-navy bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-[0.1em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
    : "inline-flex items-center rounded-sm border border-navy bg-paper px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openModal}
        className={triggerClass}
      >
        Deactivate
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Deactivate region"
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/20 p-4"
        >
          <div
            ref={panelRef}
            className="w-full max-w-md rounded-sm border border-stone-200 border-t-[1px] border-t-green bg-surface-primary p-6"
          >
            <RegionDeactivateModalForm
              key={formKey}
              regionId={regionId}
              regionDisplayName={regionDisplayName}
              inUseCount={inUseCount}
              onCancel={closeModal}
              onSuccess={closeModal}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

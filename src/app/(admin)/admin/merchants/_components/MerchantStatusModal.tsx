// Day 18 / C1 — Activate / deactivate confirmation modal.
//
// Mirrors the CrmStateModal interaction pattern (PR #174):
//   - Trigger button + role="dialog" aria-modal="true" panel
//   - Click-outside (mousedown) close
//   - Escape close + return focus to trigger
//   - useActionState form remounted via formKey for state reset
//   - Inline error rendering for the discriminated-union result kinds
//   - Grass Green submit; 120ms transitions
//
// Each action posts an empty FormData (no payload — the tenantId is
// bound at the trigger-button render site) and the action returns a
// StatusActionResult variant the form renders against.

"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  activateMerchantAction,
  deactivateMerchantAction,
  type StatusActionResult,
} from "../_actions";

interface FormChildProps {
  readonly action: typeof activateMerchantAction | typeof deactivateMerchantAction;
  readonly tenantId: string;
  readonly variant: "activate" | "deactivate";
  readonly merchantName: string;
  readonly onCancel: () => void;
  readonly onSuccess: () => void;
}

function MerchantStatusModalForm({
  action,
  tenantId,
  variant,
  merchantName,
  onCancel,
  onSuccess,
}: FormChildProps) {
  const boundAction = action.bind(null, tenantId);
  const [actionResult, formAction, isPending] = useActionState<
    StatusActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "activated" || actionResult.kind === "deactivated") {
      onSuccess();
    }
  }, [actionResult.kind, onSuccess]);

  const heading = variant === "activate" ? "Activate merchant" : "Deactivate merchant";
  const summary =
    variant === "activate"
      ? `Set ${merchantName} to active. New tasks can be generated for this merchant once activated.`
      : `Set ${merchantName} to inactive. New tasks will not be generated until reactivated.`;
  const submitLabel = isPending
    ? variant === "activate"
      ? "Activating…"
      : "Deactivating…"
    : variant === "activate"
      ? "Activate"
      : "Deactivate";

  const errorMessage =
    actionResult.kind === "conflict" ||
    actionResult.kind === "forbidden" ||
    actionResult.kind === "not_found" ||
    actionResult.kind === "validation"
      ? actionResult.message
      : null;

  return (
    <form action={formAction} className="mt-6">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
        Merchant lifecycle
      </p>
      <h2 className="mt-1 font-display text-xl font-semibold text-navy">{heading}</h2>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">{summary}</p>

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
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

interface MerchantStatusModalProps {
  readonly tenantId: string;
  readonly merchantName: string;
  readonly variant: "activate" | "deactivate";
}

export function MerchantStatusModal({
  tenantId,
  merchantName,
  variant,
}: MerchantStatusModalProps) {
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

  // Click-outside (mousedown) close — matches CrmStateModal posture.
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

  // Escape close (returns focus to the trigger).
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

  const action = variant === "activate" ? activateMerchantAction : deactivateMerchantAction;
  const triggerLabel = variant === "activate" ? "Activate" : "Deactivate";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openModal}
        className="inline-flex items-center rounded-sm border border-navy bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-[0.1em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
      >
        {triggerLabel}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${triggerLabel} merchant`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/20 p-4"
        >
          <div
            ref={panelRef}
            className="w-full max-w-md rounded-sm border border-stone-200 border-t-[1px] border-t-green bg-surface-primary p-6"
          >
            <MerchantStatusModalForm
              key={formKey}
              action={action}
              tenantId={tenantId}
              variant={variant}
              merchantName={merchantName}
              onCancel={closeModal}
              onSuccess={closeModal}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

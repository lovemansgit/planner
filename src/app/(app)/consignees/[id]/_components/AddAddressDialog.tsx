// Day-53 add-a-second-address — Add address modal.
//
// The detail-page surface the onboarding copy promises ("Add more from
// the consignee detail page after onboarding"). Mirrors the
// AdHocTaskDialog / MerchantStatusModal interaction pattern:
//   - Trigger button + role="dialog" aria-modal="true" panel
//   - Click-outside (mousedown) close
//   - Escape close + return focus to trigger
//   - useActionState form remounted via formKey for state reset
//   - Inline error rendering for the discriminated-union result kinds
//
// Fields match the onboarding address block exactly (label / line /
// district / emirate; lat-lng stays Phase 2). The new address is always
// NON-PRIMARY — it becomes selectable in the R4/R5 override pickers and
// assignable to rotation, but changes no routing until selected.

"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { addAddressAction, type AddAddressActionResult } from "../_actions";

interface FormProps {
  readonly consigneeId: string;
  readonly onCancel: () => void;
  readonly onSuccess: (addressId: string) => void;
}

export function AddAddressForm({ consigneeId, onCancel, onSuccess }: FormProps) {
  const boundAction = addAddressAction.bind(null, consigneeId);
  const [actionResult, formAction, isPending] = useActionState<
    AddAddressActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "created") {
      onSuccess(actionResult.addressId);
    }
  }, [actionResult, onSuccess]);

  const errorMessage =
    actionResult.kind === "validation" ||
    actionResult.kind === "forbidden" ||
    actionResult.kind === "not_found"
      ? actionResult.message
      : null;

  return (
    <form action={formAction} className="mt-6 space-y-5">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Add address
        </p>
        <h2 className="mt-1 font-display text-xl font-semibold text-navy">
          Additional delivery address
        </h2>
        <p className="mt-2 text-sm text-[color:var(--color-text-secondary)]">
          The primary address stays unchanged. The new address becomes selectable for one-off and
          forward address changes, and for per-weekday rotation.
        </p>
      </div>

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-sm border border-red/40 bg-red/10 px-2 py-1.5 text-xs text-red"
        >
          {errorMessage}
        </p>
      ) : null}

      <div>
        <label
          htmlFor="add-address-label"
          className="mb-1 block text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]"
        >
          Label
        </label>
        <select
          id="add-address-label"
          name="label"
          defaultValue="office"
          className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none"
        >
          <option value="home">Home</option>
          <option value="office">Office</option>
          <option value="other">Other</option>
        </select>
      </div>

      <Field label="Address line" name="line" required />
      <div className="grid grid-cols-2 gap-3">
        <Field label="District" name="district" required />
        <Field label="City" name="emirate" required />
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
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
          {isPending ? "Saving…" : "Save address"}
        </button>
      </div>
    </form>
  );
}

interface FieldProps {
  readonly label: string;
  readonly name: string;
  readonly required?: boolean;
}

function Field({ label, name, required }: FieldProps) {
  const id = `add-address-${name}`;
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        required={required}
        className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none"
      />
    </div>
  );
}

interface AddAddressDialogProps {
  readonly consigneeId: string;
}

export function AddAddressDialog({ consigneeId }: AddAddressDialogProps) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function openModal() {
    setOpen(true);
    setFormKey((k) => k + 1);
  }
  function closeModal() {
    setOpen(false);
  }
  function handleSuccess(_addressId: string) {
    setOpen(false);
    setToast("Address added");
    setTimeout(() => setToast(null), 5000);
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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openModal}
        className="inline-flex items-center justify-center rounded-sm border border-navy bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
      >
        Add address
      </button>

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-sm border border-stone-200 bg-paper px-4 py-3 text-sm text-navy"
        >
          {toast}
        </div>
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add address"
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
        >
          <div
            ref={panelRef}
            className="w-full max-w-md rounded-sm border border-stone-200 border-t-[1px] border-t-green bg-surface-primary p-6"
          >
            <AddAddressForm
              key={formKey}
              consigneeId={consigneeId}
              onCancel={closeModal}
              onSuccess={handleSuccess}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

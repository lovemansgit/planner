// Day-25 / brief v1.12 §3.3 — Add ad-hoc task modal.
//
// Mirrors MerchantStatusModal (PR #260) interaction pattern:
//   - Trigger button + role="dialog" aria-modal="true" panel
//   - Click-outside (mousedown) close
//   - Escape close + return focus to trigger
//   - useActionState form remounted via formKey for state reset
//   - Inline error rendering for the discriminated-union result kinds
//
// Optimistic-ack semantics — on success the toast says
// "Saved — pushing to SuiteFleet" because the DB row is durable but
// the SF push happens asynchronously via the QStash queue.

"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  createAdHocTaskAction,
  type CreateAdHocTaskActionResult,
} from "../_actions";

interface AddressOption {
  readonly id: string;
  readonly label: string;
}

interface FormChildProps {
  readonly consigneeId: string;
  readonly addresses: readonly AddressOption[];
  readonly onCancel: () => void;
  readonly onSuccess: (taskId: string) => void;
}

function AdHocTaskDialogForm({
  consigneeId,
  addresses,
  onCancel,
  onSuccess,
}: FormChildProps) {
  const boundAction = createAdHocTaskAction.bind(null, consigneeId);
  const [actionResult, formAction, isPending] = useActionState<
    CreateAdHocTaskActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "created") {
      onSuccess(actionResult.taskId);
    }
  }, [actionResult, onSuccess]);

  const errorMessage =
    actionResult.kind === "validation" ||
    actionResult.kind === "forbidden" ||
    actionResult.kind === "not_found"
      ? actionResult.message
      : null;

  // Default date = today, computed client-side at render so the user
  // doesn't have to type a default.
  const today = new Date();
  const defaultDate = today.toISOString().slice(0, 10);

  return (
    <form action={formAction} className="mt-6 space-y-5">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Add ad-hoc task
        </p>
        <h2 className="mt-1 font-display text-xl font-semibold text-navy">
          One-off delivery
        </h2>
        <p className="mt-2 text-sm text-[color:var(--color-text-secondary)]">
          Creates a single delivery task independent of any subscription. Push to SuiteFleet runs
          asynchronously after save.
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

      <Field label="Date" name="date" type="date" defaultValue={defaultDate} required />

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Window start"
          name="window_start"
          type="time"
          defaultValue="10:00"
          required
        />
        <Field
          label="Window end"
          name="window_end"
          type="time"
          defaultValue="12:00"
          required
        />
      </div>

      {addresses.length > 1 ? (
        <div>
          <label
            htmlFor="ad-hoc-address_id"
            className="mb-1 block text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]"
          >
            Delivery address
          </label>
          <select
            id="ad-hoc-address_id"
            name="address_id"
            defaultValue=""
            className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none"
          >
            <option value="">Primary address (default)</option>
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div>
        <label
          htmlFor="ad-hoc-notes"
          className="mb-1 block text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]"
        >
          Notes (optional)
        </label>
        <textarea
          id="ad-hoc-notes"
          name="notes"
          rows={2}
          className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy placeholder:text-[color:var(--color-text-tertiary)] focus:border-navy focus:outline-none"
        />
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
          {isPending ? "Saving…" : "Save task"}
        </button>
      </div>
    </form>
  );
}

interface FieldProps {
  readonly label: string;
  readonly name: string;
  readonly type?: string;
  readonly defaultValue?: string;
  readonly required?: boolean;
}

function Field({ label, name, type = "text", defaultValue, required }: FieldProps) {
  const id = `ad-hoc-${name}`;
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
        type={type}
        defaultValue={defaultValue}
        required={required}
        className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none"
      />
    </div>
  );
}

interface AdHocTaskDialogProps {
  readonly consigneeId: string;
  readonly addresses: readonly AddressOption[];
  readonly triggerVariant?: "primary" | "secondary";
}

export function AdHocTaskDialog({
  consigneeId,
  addresses,
  triggerVariant = "secondary",
}: AdHocTaskDialogProps) {
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
  function handleSuccess(_taskId: string) {
    setOpen(false);
    setToast("Saved — pushing to SuiteFleet");
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

  const triggerClass =
    triggerVariant === "primary"
      ? "inline-flex items-center justify-center rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90"
      : "inline-flex items-center justify-center rounded-sm border border-navy bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory";

  return (
    <>
      <button ref={triggerRef} type="button" onClick={openModal} className={triggerClass}>
        Add ad-hoc task
      </button>

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-sm border border-stone-200 bg-paper px-4 py-3 text-sm text-navy shadow-sm"
        >
          {toast}
        </div>
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add ad-hoc task"
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/20 p-4"
        >
          <div
            ref={panelRef}
            className="w-full max-w-md rounded-sm border border-stone-200 border-t-[1px] border-t-green bg-surface-primary p-6"
          >
            <AdHocTaskDialogForm
              key={formKey}
              consigneeId={consigneeId}
              addresses={addresses}
              onCancel={closeModal}
              onSuccess={handleSuccess}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

// Day-24 — Disable-user confirmation modal.
//
// Mirrors MerchantStatusModal interaction posture: trigger button +
// role="dialog" aria-modal panel; click-outside (mousedown) close;
// Escape close + return focus to the trigger; useActionState form
// remounted via formKey for state reset; inline error rendering for
// the discriminated-union result kinds.
//
// One material divergence: includes an optional `reason` textarea
// (Love's brief). The reason is forwarded to the audit-event
// metadata so a forensic search can recall WHY a particular login
// was blocked. Empty / whitespace-only reasons drop to null at the
// service layer so we don't pollute the audit log with empty
// strings.

"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  disableUserAction,
  type UserStatusActionResult,
} from "../_actions";

interface ModalFormProps {
  readonly userId: string;
  readonly email: string;
  readonly onCancel: () => void;
  readonly onSuccess: () => void;
}

function UserDisableModalForm({
  userId,
  email,
  onCancel,
  onSuccess,
}: ModalFormProps) {
  const boundAction = disableUserAction.bind(null, userId);
  const [actionResult, formAction, isPending] = useActionState<
    UserStatusActionResult,
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "disabled") {
      onSuccess();
    }
  }, [actionResult.kind, onSuccess]);

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
        User lifecycle
      </p>
      <h2 className="mt-1 font-display text-xl font-semibold text-navy">
        Disable user
      </h2>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        Block sign-in for <span className="font-medium text-navy">{email}</span>. They
        cannot log in until re-enabled. Existing sessions stay active until
        their cookie expires.
      </p>

      <div className="mt-5 space-y-2">
        <label
          htmlFor="user-disable-reason"
          className="block text-xs font-medium uppercase tracking-[0.14em] text-navy"
        >
          Reason <span className="text-[color:var(--color-text-tertiary)] normal-case">(optional)</span>
        </label>
        <textarea
          id="user-disable-reason"
          name="reason"
          rows={3}
          maxLength={500}
          placeholder="e.g. Left the company; rotating credentials; demo cleanup."
          className="w-full border border-stone-200 bg-paper px-3 py-2 text-sm text-navy placeholder:text-[color:var(--color-text-tertiary)] transition-colors duration-[120ms] ease-out focus:border-navy focus:bg-stone-100 focus:outline-none"
        />
        <p className="text-xs text-[color:var(--color-text-secondary)]">
          Logged in the audit trail. Visible to other Transcorp staff.
        </p>
      </div>

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
          className="rounded-sm border border-red bg-red px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Disabling…" : "Disable"}
        </button>
      </div>
    </form>
  );
}

export interface UserDisableModalProps {
  readonly userId: string;
  readonly email: string;
}

export function UserDisableModal({ userId, email }: UserDisableModalProps) {
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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openModal}
        className="inline-flex items-center justify-center rounded-sm border border-stone-200 bg-paper px-3 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-navy transition-colors duration-[120ms] ease-out hover:border-red hover:text-red"
      >
        Disable
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Disable user"
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/20 p-4"
        >
          <div
            ref={panelRef}
            className="w-full max-w-md rounded-sm border border-stone-200 border-t-[1px] border-t-red bg-surface-primary p-6"
          >
            <UserDisableModalForm
              key={formKey}
              userId={userId}
              email={email}
              onCancel={closeModal}
              onSuccess={closeModal}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

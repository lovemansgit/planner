// F5 — Reset-password modal.
//
// Mirrors UserDisableModal's interaction posture: trigger button +
// role="dialog" aria-modal panel; click-outside (mousedown) close;
// Escape close + return focus to the trigger; useActionState form
// remounted via formKey for state reset; inline error rendering for
// the discriminated-union result kinds.
//
// Divergences from the disable modal:
//   - The body is a single `newPassword` input (the temporary password
//     the admin types). Min-length 8 client-side; the service layer is
//     the authority (ValidationError → inline message).
//   - On success the modal swaps to a confirmation panel rather than
//     closing silently, because nothing in the list row changes after a
//     password reset (unlike disable/enable, which flip the Status
//     badge). The panel reminds the admin to hand the temp password to
//     the user; "force change on next login" is a Phase-1.5 follow-up.
//   - The plaintext password is never echoed back from the server.

"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { bButtonClass } from "@/components/button-recipe";
import { Field } from "@/components/Field";
import { inputClass } from "@/components/form-field-recipe";

import {
  resetUserPasswordAction,
  type UserPasswordResetActionResult,
} from "../_actions";

const MIN_PASSWORD_LENGTH = 8;

interface ModalFormProps {
  readonly userId: string;
  readonly email: string;
  readonly onCancel: () => void;
  readonly onDone: () => void;
}

function UserPasswordResetModalForm({
  userId,
  email,
  onCancel,
  onDone,
}: ModalFormProps) {
  const boundAction = resetUserPasswordAction.bind(null, userId);
  const [actionResult, formAction, isPending] = useActionState<
    UserPasswordResetActionResult,
    FormData
  >(boundAction, { kind: "idle" });

  const succeeded = actionResult.kind === "reset";

  const errorMessage =
    actionResult.kind === "conflict" ||
    actionResult.kind === "forbidden" ||
    actionResult.kind === "not_found" ||
    actionResult.kind === "validation"
      ? actionResult.message
      : null;

  if (succeeded) {
    return (
      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          User lifecycle
        </p>
        <h2 className="mt-1 font-display text-xl font-semibold text-navy">
          Password reset
        </h2>
        <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
          A temporary password is now set for{" "}
          <span className="font-medium text-navy">{email}</span>. Share it with
          them over a trusted channel — they should change it after signing in.
        </p>
        <div className="mt-6 flex items-center justify-end">
          <Button type="button" variant="secondary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-0">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
        User lifecycle
      </p>
      <h2 className="mt-1 font-display text-xl font-semibold text-navy">
        Reset password
      </h2>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        Set a temporary password for{" "}
        <span className="font-medium text-navy">{email}</span>. Their existing
        sessions stay active until their cookie expires; the new password
        applies on next sign-in.
      </p>

      <div className="mt-5">
        <Field
          label="Temporary password"
          htmlFor="user-reset-password"
          help="Not stored or logged in plain text. The reset is recorded in the audit trail (password excluded)."
        >
          <input
            id="user-reset-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            placeholder="At least 8 characters"
            aria-describedby="user-reset-password-help"
            className={inputClass()}
          />
        </Field>
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
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? "Resetting…" : "Reset password"}
        </Button>
      </div>
    </form>
  );
}

export interface UserPasswordResetModalProps {
  readonly userId: string;
  readonly email: string;
}

export function UserPasswordResetModal({
  userId,
  email,
}: UserPasswordResetModalProps) {
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
      {/* Native <button> (not <Button>) so triggerRef stays attached for
          focus-return on Escape; styled with the shared B+ recipe (secondary). */}
      <button
        ref={triggerRef}
        type="button"
        onClick={openModal}
        className={bButtonClass("secondary", "sm")}
      >
        Reset password
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Reset password"
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/20 p-4"
        >
          <div
            ref={panelRef}
            className="w-full max-w-md rounded-sm border border-stone-200 border-t-[1px] border-t-navy bg-surface-primary p-6"
          >
            <UserPasswordResetModalForm
              key={formKey}
              userId={userId}
              email={email}
              onCancel={closeModal}
              onDone={closeModal}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

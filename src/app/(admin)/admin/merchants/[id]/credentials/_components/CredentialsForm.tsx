// Day 26 / T3 Sub-PR 3 — Per-merchant credentials write-only form.
//
// Field labels branch on the merchant's region.auth_method per v1.15
// amendment §8.1:
//   - oauth   → "OAuth Username" + "OAuth Password"
//   - api_key → "API Key" + "Secret Key"
//
// Under the hood both inputs are submitted as generic `credential_1`
// and `credential_2`; the storeCredentialsAction passes them through
// to the credentials service which stores them in the generic Vault
// columns. The semantic interpretation lives downstream in the
// resolver (which switches on the region's auth_method).
//
// Submit button label:
//   - SET CREDENTIALS  — initial-set (hasCredentials === false)
//   - ROTATE CREDENTIALS — rotation (hasCredentials === true)
//
// Rotation gates submit on a hand-rolled confirmation modal (mirrors
// the AdHocTaskDialog / MerchantStatusModal precedent — NO Radix
// Dialog import per v1.14 plan §8.1). Modal copy branches on
// auth_method per v1.15 amendment §8.2.
//
// On submit success: form remounts via formKey + the router pushes
// the merchant detail page (credentials badge there will reflect
// the new state after revalidatePath flushes). The page never
// fetches `decrypted_secret` and never shows masked previews —
// write-only by design per brief §3.7.

"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { bButtonClass } from "@/components/button-recipe";
import { Field } from "@/components/Field";
import { inputClass } from "@/components/form-field-recipe";
import type { RegionAuthMethod } from "@/modules/credentials";

import {
  storeCredentialsAction,
  type StoreCredentialsActionResult,
} from "../_actions";

// B+ floating card surface (Phase 9 · Gap C/D), mirroring DetailView so the
// form and the AuthMethodSwitch above it read on the same warm-white elevation.
const FORM_CARD =
  "rounded-2xl bg-[color:var(--color-b-card)] p-8 shadow-b-card";

interface CredentialsFormProps {
  readonly tenantId: string;
  readonly merchantName: string;
  readonly authMethod: RegionAuthMethod;
  readonly hasCredentials: boolean;
}

interface BranchedCopy {
  readonly credential1Label: string;
  readonly credential1Type: "text" | "password";
  readonly credential2Label: string;
  readonly credential2Type: "text" | "password";
  readonly rotateModalCopy: string;
}

function copyFor(authMethod: RegionAuthMethod): BranchedCopy {
  if (authMethod === "oauth") {
    return {
      credential1Label: "OAuth Username",
      credential1Type: "text",
      credential2Label: "OAuth Password",
      credential2Type: "password",
      rotateModalCopy:
        "Rotating the OAuth username and password will invalidate the current credentials. Pushes from this merchant will fail until SuiteFleet's side is updated. Continue?",
    };
  }
  return {
    credential1Label: "API Key",
    credential1Type: "password",
    credential2Label: "Secret Key",
    credential2Type: "password",
    rotateModalCopy:
      "Rotating the API Key and Secret Key will invalidate the current credentials. Pushes from this merchant will fail until SuiteFleet OpsPortal is updated. Continue?",
  };
}

export function CredentialsForm({
  tenantId,
  merchantName,
  authMethod,
  hasCredentials,
}: CredentialsFormProps) {
  const router = useRouter();
  const boundAction = storeCredentialsAction.bind(null, tenantId);
  const [actionResult, formAction, isPending] = useActionState<
    StoreCredentialsActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (actionResult.kind === "stored") {
      router.push(`/admin/merchants/${tenantId}`);
    }
  }, [actionResult.kind, router, tenantId]);

  useEffect(() => {
    if (!confirmOpen) return;
    function handleMousedown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setConfirmOpen(false);
    }
    document.addEventListener("mousedown", handleMousedown);
    return () => document.removeEventListener("mousedown", handleMousedown);
  }, [confirmOpen]);

  useEffect(() => {
    if (!confirmOpen) return;
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setConfirmOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [confirmOpen]);

  const copy = copyFor(authMethod);
  const fieldErrors =
    actionResult.kind === "validation" ? actionResult.fieldErrors : {};
  const formError =
    actionResult.kind === "conflict"
      ? actionResult.message
      : actionResult.kind === "forbidden"
        ? actionResult.message
        : actionResult.kind === "not_found"
          ? actionResult.message
          : actionResult.kind === "validation" && fieldErrors._form
            ? fieldErrors._form
            : null;

  const submitLabel = hasCredentials ? "Rotate credentials" : "Set credentials";

  function handleSubmitClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (!hasCredentials) {
      // Initial-set: no modal, just submit.
      return;
    }
    // Rotation: open confirm modal; defer submit until confirm clicked.
    e.preventDefault();
    setConfirmOpen(true);
  }

  function handleConfirmRotation() {
    setConfirmOpen(false);
    // Manually trigger form submission via requestSubmit so the
    // useActionState binding fires correctly.
    formRef.current?.requestSubmit();
  }

  return (
    <>
      {formError ? (
        <p
          role="alert"
          className="mb-6 rounded-[10px] border border-red/40 bg-red/10 px-3.5 py-2.5 text-sm text-red"
        >
          {formError}
        </p>
      ) : null}

      <div className={FORM_CARD}>
        <form ref={formRef} action={formAction} className="space-y-8">
          <fieldset className="space-y-6">
            <legend className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
              {hasCredentials ? "Rotate credentials" : "Set credentials"}
            </legend>
            <p className="text-xs text-[color:var(--color-text-secondary)]">
              Credentials for{" "}
              <span className="font-medium text-navy">{merchantName}</span>{" "}
              are write-only — existing values cannot be displayed back. Submitting overwrites
              whatever is currently stored.
            </p>

            <CredentialField
              id="credential_1"
              label={copy.credential1Label}
              type={copy.credential1Type}
              error={fieldErrors.credential_1}
            />

            <CredentialField
              id="credential_2"
              label={copy.credential2Label}
              type={copy.credential2Type}
              error={fieldErrors.credential_2}
            />
          </fieldset>

          <div className="flex items-center justify-end gap-3 border-t border-[color:var(--color-border-default)] pt-6">
            <Button href={`/admin/merchants/${tenantId}`} variant="ghost">
              Cancel
            </Button>
            <button
              ref={triggerRef}
              type="submit"
              disabled={isPending}
              onClick={handleSubmitClick}
              className={bButtonClass("primary", "md")}
            >
              {isPending
                ? hasCredentials
                  ? "Rotating…"
                  : "Saving…"
                : submitLabel}
            </button>
          </div>
        </form>
      </div>

      {confirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm credential rotation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/20 p-4"
        >
          <div
            ref={panelRef}
            className="w-full max-w-md rounded-2xl bg-[color:var(--color-b-card)] p-6 shadow-b-card"
          >
            <p className="font-b-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              Credential rotation
            </p>
            <h2 className="mt-1 font-b-display text-xl font-semibold text-navy">
              Rotate credentials
            </h2>
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              {copy.rotateModalCopy}
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleConfirmRotation}>
                Rotate
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

interface CredentialFieldProps {
  readonly id: "credential_1" | "credential_2";
  readonly label: string;
  readonly type: "text" | "password";
  readonly error?: string;
}

function CredentialField({ id, label, type, error }: CredentialFieldProps) {
  const fieldId = `credentials-${id}`;
  return (
    <Field label={label} htmlFor={fieldId} error={error}>
      <input
        id={fieldId}
        name={id}
        type={type}
        autoComplete="off"
        required
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={inputClass(Boolean(error))}
      />
    </Field>
  );
}

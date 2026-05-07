// Day 17 / Session A — CRM state transition modal (client component).
//
// Second React client component in the codebase (UserMenu was first).
// Composes against the changeCrmStateAction server action via React's
// useActionState; the action's discriminated-union result drives modal
// state (close, keep-open with inline error, etc).
//
// Visual posture per brief v1.6 §3.3.11 + the refined-minimalist
// editorial direction established in PR #168:
//   - Generous spacing; hairline borders (1px stone-200)
//   - No shadows; depth from spacing + hairline contrast
//   - Sentence case; submit button uses Grass Green go-signal
//   - Click-outside + Escape close (mirrors UserMenu interaction
//     pattern from PR #168)
//
// Permission gate: caller (HeaderCard) hides the trigger entirely if
// the actor lacks consignee:change_crm_state per brief §3.3.10 rule 1.
// The modal itself does no permission check beyond what the server
// action enforces — defense-in-depth.
//
// Test coverage: helper-only unit tests (resolveAllowedToStates +
// requiresReactivationKeyword). Full interaction tests
// (click-outside, Escape, aria toggles, focus management) deferred
// to a future PR establishing client-component test infrastructure
// per memory/followup_client_component_test_infra.md.

"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  ALLOWED_TRANSITIONS,
  type ConsigneeCrmState,
} from "@/modules/consignees";

import {
  changeCrmStateAction,
  type ChangeCrmStateActionResult,
} from "../_actions";

import { CRM_STATE_LABELS } from "./CrmStateBadge";

interface FormChildProps {
  readonly consigneeId: string;
  readonly currentState: ConsigneeCrmState;
  readonly allowedToStates: readonly ConsigneeCrmState[];
  readonly selectedToState: ConsigneeCrmState | null;
  readonly onSelectToState: (s: ConsigneeCrmState) => void;
  readonly onCancel: () => void;
  readonly onSuccess: () => void;
}

/**
 * Form child — owns its own useActionState. Remounted on each modal
 * open via parent's `formKey` so action state starts fresh. Calls
 * onSuccess() when the action transitions to "updated" or "no_op";
 * parent closes the modal in response (no setState-in-effect at the
 * parent layer — the success signal flows down via callback).
 */
function CrmStateModalForm({
  consigneeId,
  currentState,
  allowedToStates,
  selectedToState,
  onSelectToState,
  onCancel,
  onSuccess,
}: FormChildProps) {
  const boundAction = changeCrmStateAction.bind(null, consigneeId);
  const [actionResult, formAction, isPending] = useActionState<
    ChangeCrmStateActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  // Single onSuccess fire per success transition; the lint rule
  // tolerates an effect that calls a parent callback (not a local
  // setState). The parent's setOpen(false) then takes effect.
  useEffect(() => {
    if (actionResult.kind === "updated" || actionResult.kind === "no_op") {
      onSuccess();
    }
  }, [actionResult.kind, onSuccess]);

  const reactivationGate =
    selectedToState !== null &&
    requiresReactivationKeyword(currentState, selectedToState);

  return (
    <form action={formAction} className="mt-6">
      <div className="mb-4">
        <p className="mb-1 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
          Current
        </p>
        <p className="text-sm font-medium text-navy">{CRM_STATE_LABELS[currentState]}</p>
      </div>

      {allowedToStates.length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-secondary)]">
          This is a terminal state. No transitions allowed.
        </p>
      ) : (
        <fieldset className="mb-4">
          <legend className="mb-2 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
            New state
          </legend>
          <div className="space-y-1.5">
            {allowedToStates.map((s) => (
              <label
                key={s}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-sm text-navy hover:bg-ivory"
              >
                <input
                  type="radio"
                  name="to_state"
                  value={s}
                  checked={selectedToState === s}
                  onChange={() => onSelectToState(s)}
                  required
                />
                <span>{CRM_STATE_LABELS[s]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="mb-2">
        <label
          htmlFor="crm-reason"
          className="mb-1 block text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]"
        >
          Reason
        </label>
        {reactivationGate ? (
          <p className="mb-2 rounded-sm border border-amber/40 bg-amber/10 px-2 py-1.5 text-xs text-amber-deep">
            Reactivation required — include the word
            {" "}<span className="font-medium">&ldquo;reactivation&rdquo;</span>{" "}
            in your reason.
          </p>
        ) : null}
        <textarea
          id="crm-reason"
          name="reason"
          rows={3}
          required
          minLength={1}
          className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy placeholder:text-[color:var(--color-text-tertiary)] focus:border-navy focus:outline-none"
          placeholder="Why is this changing?"
        />
      </div>

      {actionResult.kind === "invalid_transition" ||
      actionResult.kind === "reactivation_keyword_required" ||
      actionResult.kind === "validation" ||
      actionResult.kind === "forbidden" ||
      actionResult.kind === "not_found" ? (
        <p
          role="alert"
          className="mb-3 rounded-sm border border-red/40 bg-red/10 px-2 py-1.5 text-xs text-red"
        >
          {actionResult.message}
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
          disabled={isPending || allowedToStates.length === 0}
          className="rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Confirm"}
        </button>
      </div>
    </form>
  );
}

interface CrmStateModalProps {
  readonly consigneeId: string;
  readonly currentState: ConsigneeCrmState;
}

/**
 * Resolve the to-states the modal renders as radio options. Pure
 * helper — exported for unit-test coverage without rendering the
 * component (no client-component test infrastructure yet).
 */
export function resolveAllowedToStates(
  fromState: ConsigneeCrmState,
): readonly ConsigneeCrmState[] {
  const set = ALLOWED_TRANSITIONS[fromState];
  // Convert ReadonlySet → readonly array; preserve enum ordering
  // by mapping over a fixed order.
  const ORDERED: readonly ConsigneeCrmState[] = [
    "ACTIVE",
    "ON_HOLD",
    "HIGH_RISK",
    "INACTIVE",
    "CHURNED",
    "SUBSCRIPTION_ENDED",
  ];
  return ORDERED.filter((s) => set.has(s));
}

/**
 * Whether the active selection is a CHURNED → ACTIVE transition that
 * needs the reactivation keyword in `reason` per CRM plan §10.4 +
 * transitions.ts canTransition logic. Pure; exported for tests.
 */
export function requiresReactivationKeyword(
  fromState: ConsigneeCrmState,
  toState: ConsigneeCrmState,
): boolean {
  return fromState === "CHURNED" && toState === "ACTIVE";
}

export function CrmStateModal({ consigneeId, currentState }: CrmStateModalProps) {
  // `open` carries the user's intent (clicked the trigger). The
  // effective open state is derived from `open` AND whether the
  // action has succeeded — successful action implicitly closes the
  // modal without a setState-in-effect (which the lint rule
  // correctly disallows). On next trigger click, formKey bumps and
  // remounts the form so its useActionState resets to idle.
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [selectedToState, setSelectedToState] = useState<ConsigneeCrmState | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const allowedToStates = resolveAllowedToStates(currentState);

  function openModal() {
    setOpen(true);
    setSelectedToState(null);
    setFormKey((k) => k + 1);
  }
  function closeModal() {
    setOpen(false);
    setSelectedToState(null);
  }

  // Click-outside close (mousedown-based; matches UserMenu pattern).
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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openModal}
        className="inline-flex items-center rounded-sm border border-navy bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-[0.1em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
      >
        Change state
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Change CRM state"
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/20 p-4"
        >
          <div
            ref={panelRef}
            className="w-full max-w-md rounded-sm border border-stone-200 border-t-[1px] border-t-green bg-surface-primary p-6"
          >
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              CRM state
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-navy">
              Change state
            </h2>

            <CrmStateModalForm
              key={formKey}
              consigneeId={consigneeId}
              currentState={currentState}
              allowedToStates={allowedToStates}
              selectedToState={selectedToState}
              onSelectToState={setSelectedToState}
              onCancel={closeModal}
              onSuccess={closeModal}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

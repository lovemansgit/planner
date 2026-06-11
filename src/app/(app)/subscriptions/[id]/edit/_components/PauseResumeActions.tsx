// Day 22 / Phase 1 forms lane — pause / resume CTAs.
//
// Renders one of two surfaces depending on subscription status:
//   - active  → Pause CTA (opens an inline pause-window picker)
//   - paused  → Resume CTA (one-click resume; no input)
//   - ended   → no CTA (terminal status)
//
// Pause flow per Day-19 plan §D + brief §3.1.7 bounded-pause:
//   - pause_start (date picker, ≥ today)
//   - pause_end (date picker, > pause_start)
//   - reason (optional textarea)
//   - Inline confirmation panel above the submit button surfaces the
//     `--color-tint-navy-subtle` atmosphere primitive per §J-3 idiom.
//
// Resume flow: idempotency_key generated server-side (action layer);
// no operator input required.

"use client";

import { useActionState, useState } from "react";

import { FormError } from "@/components/forms/FormError";
import { FormField } from "@/components/forms/FormField";
import { FormSubmitButton } from "@/components/forms/FormSubmitButton";

import {
  pauseSubscriptionAction,
  resumeSubscriptionAction,
  type PauseSubscriptionActionResult,
  type ResumeSubscriptionActionResult,
} from "../_actions";

type Status = "active" | "paused" | "ended";

interface PauseResumeActionsProps {
  readonly subscriptionId: string;
  readonly status: Status;
}

export function PauseResumeActions({
  subscriptionId,
  status,
}: PauseResumeActionsProps) {
  if (status === "ended") {
    return (
      <div className="rounded-sm border border-stone-200 bg-paper p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Lifecycle
        </p>
        <p className="mt-2 text-sm text-[color:var(--color-text-secondary)]">
          This subscription has ended. Create a new subscription to reactivate.
        </p>
      </div>
    );
  }

  if (status === "paused") {
    return <ResumePanel subscriptionId={subscriptionId} />;
  }

  return <PausePanel subscriptionId={subscriptionId} />;
}

function PausePanel({ subscriptionId }: { readonly subscriptionId: string }) {
  const [open, setOpen] = useState(false);
  const boundAction = pauseSubscriptionAction.bind(null, subscriptionId);
  const [actionResult, formAction, isPending] = useActionState<
    PauseSubscriptionActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  if (actionResult.kind === "paused") {
    return (
      <div
        className="rounded-sm border border-stone-200 p-4"
        style={{ backgroundColor: "var(--color-tint-navy-subtle)" }}
      >
        <p className="text-xs uppercase tracking-[0.14em] text-navy">Paused</p>
        <p className="mt-2 text-sm text-navy">
          {actionResult.canceledTasks} task{actionResult.canceledTasks === 1 ? "" : "s"} cancelled.
        </p>
        <p className="mt-1 text-xs text-[color:var(--color-text-secondary)]">
          End date now {actionResult.newEndDate}.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="rounded-sm border border-stone-200 bg-paper p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
          Lifecycle
        </p>
        <p className="mt-2 text-sm text-[color:var(--color-text-secondary)]">
          Pause this subscription for a window. In-flight tasks cancel; the end date extends to
          compensate.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 rounded-sm border border-stone-200 bg-paper px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-navy transition-colors duration-[120ms] ease-out hover:border-navy"
        >
          Pause subscription
        </button>
      </div>
    );
  }

  const formError =
    actionResult.kind === "validation"
      ? actionResult.message
      : actionResult.kind === "conflict"
        ? actionResult.message
        : actionResult.kind === "forbidden"
          ? actionResult.message
          : actionResult.kind === "not_found"
            ? actionResult.message
            : null;

  return (
    <div
      className="rounded-sm border border-stone-200 p-6"
      style={{ backgroundColor: "var(--color-tint-navy-subtle)" }}
    >
      <p className="text-xs uppercase tracking-[0.14em] text-navy">Pause subscription</p>
      <p className="mt-2 text-sm text-navy">
        Pause window cancels in-flight tasks. Subscription end date extends to compensate.
      </p>

      <FormError message={formError} className="mt-4" />

      <form action={formAction} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="pause_start" label="Pause from" type="date" required />
          <FormField name="pause_end" label="Pause until" type="date" required />
        </div>
        <FormField
          name="reason"
          label="Reason"
          labelTrailing={
            <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              Optional
            </span>
          }
          placeholder="Customer travel, kitchen closure, etc."
        />
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={isPending}
            className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:text-navy disabled:opacity-50"
          >
            Cancel
          </button>
          <FormSubmitButton pending={isPending} pendingLabel="Pausing…">
            Confirm pause
          </FormSubmitButton>
        </div>
      </form>
    </div>
  );
}

function ResumePanel({ subscriptionId }: { readonly subscriptionId: string }) {
  const boundAction = resumeSubscriptionAction.bind(null, subscriptionId);
  const [actionResult, formAction, isPending] = useActionState<
    ResumeSubscriptionActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  if (actionResult.kind === "resumed") {
    return (
      <div
        className="rounded-sm border border-stone-200 p-4"
        style={{ backgroundColor: "var(--color-tint-navy-subtle)" }}
      >
        <p className="text-xs uppercase tracking-[0.14em] text-navy">Resumed</p>
        <p className="mt-2 text-sm text-navy">
          {actionResult.restoredTasks} task{actionResult.restoredTasks === 1 ? "" : "s"} restored.
        </p>
        {actionResult.newEndDate ? (
          <p className="mt-1 text-xs text-[color:var(--color-text-secondary)]">
            End date now {actionResult.newEndDate}.
          </p>
        ) : null}
      </div>
    );
  }

  const formError =
    actionResult.kind === "conflict"
      ? actionResult.message
      : actionResult.kind === "forbidden"
        ? actionResult.message
        : actionResult.kind === "not_found"
          ? actionResult.message
          : null;

  return (
    <div className="rounded-sm border border-stone-200 bg-paper p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
        Lifecycle
      </p>
      <p className="mt-2 text-sm text-[color:var(--color-text-secondary)]">
        Subscription is paused. Resume to lift the pause and restore in-window tasks.
      </p>
      <FormError message={formError} className="mt-3" />
      <form action={formAction} className="mt-3">
        <FormSubmitButton pending={isPending} pendingLabel="Resuming…" tone="primary">
          Resume now
        </FormSubmitButton>
      </form>
    </div>
  );
}

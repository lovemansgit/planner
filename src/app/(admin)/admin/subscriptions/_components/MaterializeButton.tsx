// F6 — One-click "Materialize" button for the /admin/subscriptions list.
//
// Forces a single subscription's tasks to materialize now, off-cycle
// from the daily cron. No confirmation modal: the operation is
// idempotent and non-destructive (it only INSERTs the tasks the cron
// would create anyway; re-runs collapse via ON CONFLICT DO NOTHING), so
// it mirrors the no-confirm UserEnableButton rather than the
// confirm-gated disable modal. Result + errors render inline beside the
// button so Ops get a visible signal without a page-level error
// boundary.

"use client";

import { useActionState } from "react";

import { Button } from "@/components/Button";

import {
  triggerMaterializationAction,
  type MaterializeActionResult,
} from "../_actions";

export interface MaterializeButtonProps {
  readonly subscriptionId: string;
}

export function MaterializeButton({ subscriptionId }: MaterializeButtonProps) {
  const boundAction = triggerMaterializationAction.bind(null, subscriptionId);
  const [state, formAction, pending] = useActionState<
    MaterializeActionResult,
    FormData
  >(boundAction, { kind: "idle" });

  const errorMessage =
    state.kind === "forbidden" ||
    state.kind === "not_found" ||
    state.kind === "error"
      ? state.message
      : null;

  const successMessage =
    state.kind === "done"
      ? state.newCount === 0
        ? "Already up to date"
        : `Materialized ${state.newCount} task${state.newCount === 1 ? "" : "s"}` +
          (state.failedCount > 0
            ? ` · ${state.failedCount} skipped (address gap)`
            : "")
      : null;

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? "Materializing…" : "Materialize"}
      </Button>
      {successMessage ? (
        <span className="max-w-[220px] text-right text-[10px] text-[color:var(--color-text-secondary)]">
          {successMessage}
        </span>
      ) : null}
      {errorMessage ? (
        <span
          role="alert"
          className="max-w-[220px] text-right text-[10px] text-red"
        >
          {errorMessage}
        </span>
      ) : null}
    </form>
  );
}

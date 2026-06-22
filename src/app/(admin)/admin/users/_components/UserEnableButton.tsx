// Day-24 — One-click Enable button for the /admin/users list page.
//
// Paired with UserDisableModal. No modal here per brief — Enable is
// the less-destructive direction of the pair (restoring access), so
// the operator can re-enable a user inline without an extra
// confirmation gate. Server-action errors render inline alongside
// the button so the operator gets a visible signal without a
// page-level error boundary.

"use client";

import { useActionState } from "react";

import { Button } from "@/components/Button";

import {
  enableUserAction,
  type UserStatusActionResult,
} from "../_actions";

export interface UserEnableButtonProps {
  readonly userId: string;
}

export function UserEnableButton({ userId }: UserEnableButtonProps) {
  const boundAction = enableUserAction.bind(null, userId);
  const [state, formAction, pending] = useActionState<
    UserStatusActionResult,
    FormData
  >(boundAction, { kind: "idle" });

  const errorMessage =
    state.kind === "conflict" ||
    state.kind === "forbidden" ||
    state.kind === "not_found" ||
    state.kind === "validation"
      ? state.message
      : null;

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? "Enabling…" : "Enable"}
      </Button>
      {errorMessage ? (
        <span
          role="alert"
          className="max-w-[200px] text-right text-[10px] text-red"
        >
          {errorMessage}
        </span>
      ) : null}
    </form>
  );
}

// F4 — Per-merchant asset-tracking gate toggle (THE DARK SWITCH,
// migration 0034). Lights or hides every bag-tracking surface for this
// merchant (Inventory / Asset Tracking reports, the 30-minute poll, and
// the nav entries all read this flag).
//
// Rendered on the merchant detail page. The button is shown only when
// the actor can edit (merchant:update); the service layer is the real
// authority. The current state is read server-side and passed in as
// `enabled`; the action is bound to flip to `!enabled`, and after a
// successful flip revalidatePath re-renders this page so `enabled`
// re-syncs to the new value (and the binding flips with it). The action
// result also feeds the badge immediately for instant feedback.

"use client";

import { useActionState } from "react";

import { bButtonClass } from "@/components/button-recipe";

import { setAssetTrackingAction, type AssetTrackingActionResult } from "../_actions";

export interface AssetTrackingToggleProps {
  readonly tenantId: string;
  readonly enabled: boolean;
  readonly canEdit: boolean;
}

export function AssetTrackingToggle({ tenantId, enabled, canEdit }: AssetTrackingToggleProps) {
  // Bound to flip from the server-passed current value. revalidatePath
  // re-renders the page after each flip, so `enabled` (and this binding)
  // re-sync for the next click.
  const [state, formAction, pending] = useActionState<AssetTrackingActionResult, FormData>(
    setAssetTrackingAction.bind(null, tenantId, !enabled),
    { kind: "idle" }
  );

  // Action result wins immediately after a flip; otherwise the server value.
  const effective = state.kind === "done" ? state.enabled : enabled;

  const errorMessage =
    state.kind === "forbidden" || state.kind === "not_found" || state.kind === "error"
      ? state.message
      : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        {effective ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green/15 px-2.5 py-1 text-xs font-medium text-green">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green" />
            Enabled
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--color-text-tertiary)]/15 px-2.5 py-1 text-xs font-medium text-[color:var(--color-text-tertiary)]">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-text-tertiary)]"
            />
            Disabled
          </span>
        )}

        {canEdit ? (
          <form action={formAction}>
            <button type="submit" disabled={pending} className={bButtonClass("secondary", "sm")}>
              {pending
                ? enabled
                  ? "Disabling…"
                  : "Enabling…"
                : enabled
                  ? "Disable"
                  : "Enable for this merchant"}
            </button>
          </form>
        ) : null}
      </div>

      {errorMessage ? (
        <span role="alert" className="max-w-[320px] text-[10px] text-red">
          {errorMessage}
        </span>
      ) : null}
    </div>
  );
}

// R5 forward-override confirmation dialog (Day-52 ruling, OQ-3 = INLINE
// modal-within-popover, NOT full-screen). Presentational only — no
// server imports — so the JSX-shape spec can render it without the
// popover's server-action dependency chain.
//
// The copy is RULING-VERBATIM — do NOT paraphrase. The dialog never
// submits the form itself: both buttons are type="button"; the owning
// panel calls requestSubmit() in its onConfirm handler.

"use client";

export const FORWARD_OVERRIDE_CONFIRM_COPY =
  "Are you sure you want to update the address for all future tasks on this subscription?";

export function ForwardOverrideConfirmDialog({
  onConfirm,
  onCancel,
  isPending,
}: {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly isPending: boolean;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Confirm forward address override"
      className="absolute inset-0 z-10 flex items-center justify-center rounded-sm bg-scrim p-4"
    >
      <div className="w-full rounded-sm border border-stone-200 border-t-[1px] border-t-green bg-surface-primary p-4">
        <p className="text-sm text-navy">{FORWARD_OVERRIDE_CONFIRM_COPY}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 rounded-sm border border-green bg-green px-3 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Yes, update address"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="flex-1 rounded-sm border border-stone-200 bg-paper px-3 py-2 text-xs font-medium uppercase tracking-[0.1em] text-navy transition-colors duration-[120ms] ease-out hover:border-navy disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

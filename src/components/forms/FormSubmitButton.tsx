// Day-22 Phase 1 forms — primary submit button (server component).
//
// Generalises the green-bordered submit button from CreateMerchantForm
// + MerchantStatusModalForm + CrmStateModalForm. Same brand posture
// across all action-form surfaces:
//   - Grass Green (--color-green) primary tint per brief §3.3.11
//   - text-paper on bg-green at rest
//   - hover: opacity-90 (no color drift, no scale)
//   - disabled-while-pending: opacity-50 + cursor-not-allowed
//   - 120ms ease-out transitions per brand-pass cadence
//
// Accepts a `pending` flag so the caller (which owns useActionState's
// isPending) can drive the disabled+label swap without reaching into
// the button internals. Passing both `pending` and `pendingLabel`
// drives the swap; passing neither leaves the visible label fixed.

import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface FormSubmitButtonProps {
  readonly children: ReactNode;
  /** Whether the form action is currently in flight. Drives disabled
   *  state + the optional label swap. */
  readonly pending?: boolean;
  /** Optional label rendered while pending (e.g. "Saving…"). When
   *  omitted, the button renders `children` regardless of pending. */
  readonly pendingLabel?: ReactNode;
  /** Additional disabled gates beyond `pending` (e.g. validation
   *  blocking submit before any action fires). */
  readonly disabled?: boolean;
  /** Tone — primary (green submit) or secondary (navy outline).
   *  Defaults to primary. Secondary mirrors the trigger-button posture
   *  established by CrmStateModal trigger / "Sign in" /tasks. */
  readonly tone?: "primary" | "secondary";
  /** Explicit type override (e.g. button vs submit when used outside
   *  a <form>). Defaults to "submit". */
  readonly type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  /** Optional className override (e.g. width fill via w-full). */
  readonly className?: string;
}

export function FormSubmitButton({
  children,
  pending,
  pendingLabel,
  disabled,
  tone = "primary",
  type = "submit",
  className,
}: FormSubmitButtonProps) {
  const isDisabled = pending || disabled;
  const tonalClasses =
    tone === "primary"
      ? "border border-green bg-green text-paper hover:opacity-90"
      : "border border-navy bg-paper text-navy hover:bg-ivory";
  const visibleLabel = pending && pendingLabel !== undefined ? pendingLabel : children;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={pending ? "true" : undefined}
      className={`rounded-sm px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] transition-opacity duration-[120ms] ease-out disabled:cursor-not-allowed disabled:opacity-50 ${tonalClasses} ${className ?? ""}`}
    >
      {visibleLabel}
    </button>
  );
}

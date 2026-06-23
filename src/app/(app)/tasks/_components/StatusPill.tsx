// Phase 11 Batch P — the unified task-status pill.
//
// Before this, /tasks rendered statuses through the shared <Badge> (an
// UPPERCASE caption chip) with a per-state `pillClass` from ../status. Two
// craft gaps remained: the casing/shape didn't match the B+ <StatusBadge>
// family used on /subscriptions (sentence-case, rounded-full), and — worse —
// the coarse NULL-courier neutrals (CREATED / SKIPPED / CANCELED) shipped a
// `bg-[color:var(--color-text-tertiary)]/20` fill. `--color-text-tertiary` is
// a baked `rgba()`, so the Tailwind `/20` opacity modifier compiles to an
// invalid `rgb(rgba(...) / .2)` and the background is dropped — those pills
// rendered as BARE TEXT beside the filled fine-status chips (the finding-14
// trap documented in brand-tokens.css).
//
// This component renders EVERY task status through one geometry — rounded-full,
// sentence-case, consistent weight, glyph + label — so only the family colour
// (and the icon) varies by state, matching the B+ StatusBadge family. The
// family colour + label + glyph still come from `resolveCourierDisplay`
// (../status, owned by the status-filter lane and untouched): no status LOGIC,
// label, tone, or icon mapping changes here. The one repair is `repairFill`,
// which swaps the broken neutral fill for the valid channel-mapped stone the
// fine ORDERED / ON_HOLD pills already use, so the bare-text states become
// filled chips like the rest. Presentation only.

import type { CourierStatus } from "@/modules/integration";
import type { TaskInternalStatus } from "@/modules/tasks/types";

import { resolveCourierDisplay } from "../status";

import { StatusIcon } from "./StatusIcon";

/**
 * One pill geometry for the whole status column — B+ StatusBadge family:
 * rounded-full, sentence-case, semibold, glyph+label. Exported so the
 * sibling "Failed push" chip renders in the same shape.
 */
export const STATUS_PILL_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold";

/**
 * Repair the coarse NULL-courier neutral fill. ../status (status-filter lane,
 * outside this batch's fence) ships CREATED / SKIPPED / CANCELED with
 * `bg-[color:var(--color-text-tertiary)]/20` — invalid CSS (opacity modifier
 * on a baked rgba token) → no background → bare text. Substitute the valid
 * channel-mapped stone neutral the fine ORDERED / ON_HOLD pills already use.
 * A no-op for every already-valid fine/coarse fill.
 */
function repairFill(pillClass: string): string {
  return pillClass.replace(
    "bg-[color:var(--color-text-tertiary)]/20",
    "bg-stone-200/60",
  );
}

interface StatusPillProps {
  readonly courierStatus: CourierStatus | null | undefined;
  readonly internalStatus: TaskInternalStatus;
}

export function StatusPill({ courierStatus, internalStatus }: StatusPillProps) {
  const { label, pillClass } = resolveCourierDisplay(courierStatus, internalStatus);
  return (
    <span
      className={`${STATUS_PILL_BASE} ${repairFill(pillClass)}`}
      aria-label={`Status: ${label}`}
    >
      <StatusIcon courierStatus={courierStatus} status={internalStatus} />
      {label}
    </span>
  );
}

// Day 19 / PR-B Lane 4 — status-icon dispatcher.
// D56 Phase 8 / Lane 3 — re-keyed on the fine `courier_status`.
//
// The glyph is chosen from the fine SuiteFleet courier state when present,
// falling back to the coarse `internal_status` when it is NULL/absent (pre-
// backfill / Planner-only rows — and the /admin/tasks call site, which still
// passes only `status` until Lane 5 threads the fine field). The single
// status→icon-key mapping lives in `resolveCourierDisplay` (../status); this
// component owns only the key→SVG binding (incl. the ReturnIcon variants).
//
// Inert states (CANCELED, ON_HOLD, SKIPPED) deliberately render null — pills
// stay label-only (CANCELED additionally renders a strikethrough label via
// its pillClass). Per the original PR-B brief: "no glyph for inert states".

import type { CourierStatus } from "@/modules/integration";
import type { TaskInternalStatus } from "@/modules/tasks/types";

import { resolveCourierDisplay, type StatusIconKey } from "../status";

import { CautionIcon } from "./CautionIcon";
import { DcIcon } from "./DcIcon";
import { HubTransferIcon } from "./HubTransferIcon";
import { OutForDeliveryIcon } from "./OutForDeliveryIcon";
import { PackageIcon } from "./PackageIcon";
import { PickupIcon } from "./PickupIcon";
import { PodIcon } from "./PodIcon";
import { RescheduleIcon } from "./RescheduleIcon";
import { RetryIcon } from "./RetryIcon";
import { ReturnIcon } from "./ReturnIcon";
import { TruckIcon } from "./TruckIcon";
import { VanIcon } from "./VanIcon";

interface StatusIconProps {
  /**
   * Fine SuiteFleet courier status. When present + recognized, it drives the
   * glyph; NULL/absent falls back to the coarse `status` below.
   */
  readonly courierStatus?: CourierStatus | null;
  /** Coarse internal status — the NULL-courier fallback (always required). */
  readonly status: TaskInternalStatus;
  /** Pixel size for both width + height. Default 12. */
  readonly size?: number;
}

function renderGlyph(iconKey: StatusIconKey, size: number) {
  switch (iconKey) {
    case "package":
      return <PackageIcon size={size} variant="solid" />;
    case "van":
      return <VanIcon size={size} />;
    case "truck":
      return <TruckIcon size={size} />;
    case "pod":
      return <PodIcon size={size} tone="active" />;
    case "caution":
      return <CautionIcon size={size} />;
    case "pickup":
      return <PickupIcon size={size} />;
    case "dc":
      return <DcIcon size={size} />;
    case "hub":
      return <HubTransferIcon size={size} />;
    case "ofd":
      return <OutForDeliveryIcon size={size} />;
    case "return-outline":
      return <ReturnIcon size={size} variant="outline" />;
    case "return-solid":
      return <ReturnIcon size={size} variant="solid" />;
    case "reschedule":
      return <RescheduleIcon size={size} />;
    case "retry":
      return <RetryIcon size={size} />;
    default: {
      // Exhaustiveness guard — a new StatusIconKey must wire a glyph here.
      const _never: never = iconKey;
      return _never;
    }
  }
}

export function StatusIcon({ courierStatus, status, size = 12 }: StatusIconProps) {
  const { iconKey } = resolveCourierDisplay(courierStatus, status);
  if (iconKey === null) return null;
  return renderGlyph(iconKey, size);
}

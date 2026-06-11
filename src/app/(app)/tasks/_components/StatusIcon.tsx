// Day 19 / PR-B Lane 4 — status-icon dispatcher.
//
// Single-source mapping from TaskInternalStatus to the corresponding
// status-pill prefix glyph. Used by both operator /tasks/client.tsx
// (Row component) and admin /admin/tasks/page.tsx (Row component) —
// the cross-route import pattern established in PR #213 + PR #206.
//
// Terminal states (CANCELED, ON_HOLD) deliberately render null — per
// PR-B brief ("CREATED / ON_HOLD / CANCELED → either no glyph or
// tiny circle/dot" — picked no-glyph for inert states). Pills stay
// label-only for those.

import type { TaskInternalStatus } from "@/modules/tasks/types";

import { CautionIcon } from "./CautionIcon";
import { PackageIcon } from "./PackageIcon";
import { PodIcon } from "./PodIcon";
import { TruckIcon } from "./TruckIcon";
import { VanIcon } from "./VanIcon";

interface StatusIconProps {
  readonly status: TaskInternalStatus;
  /** Pixel size for both width + height. Default 12. */
  readonly size?: number;
}

export function StatusIcon({ status, size = 12 }: StatusIconProps) {
  switch (status) {
    case "CREATED":
      return <PackageIcon size={size} variant="solid" />;
    case "ASSIGNED":
      return <VanIcon size={size} />;
    case "IN_TRANSIT":
      return <TruckIcon size={size} />;
    case "DELIVERED":
      return <PodIcon size={size} tone="active" />;
    case "FAILED":
      return <CautionIcon size={size} />;
    case "CANCELED":
    case "ON_HOLD":
      return null;
  }
}

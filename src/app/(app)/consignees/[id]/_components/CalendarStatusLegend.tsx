// D56 Phase 8 / Lane 4 (brief v1.31 §3.3.11; OQ-4) — family-grouped status
// legend. Supersedes the Day-20 flat 6-chip legend: the calendar now renders
// all 14 fine SuiteFleet courier states, grouped under journey-stage family
// headings, each chip carrying its family colour + icon + label (Love's
// "render distinctly by the combination" ruling). This is a SEPARATE control
// from the fine-14 filter dropdown (OQ-3) — the legend teaches; the dropdown
// filters.
//
// Chip colour + label + icon all come from Lane 3's shared
// COURIER_STATUS_DISPLAY (single source of truth) so the legend can never
// drift from the row pills. The two calendar-only overlays (Skipped, Appended)
// render from DAY_DISPLAY_VISUALS in a trailing group; CANCELED carries the
// neutral line-through treatment in its own family.

import { StatusIcon } from "@/app/(app)/tasks/_components/StatusIcon";
import { COURIER_STATUS_DISPLAY } from "@/app/(app)/tasks/status";
import type { CourierStatus } from "@/modules/integration";

import { DAY_DISPLAY_VISUALS, type DayExceptionStatus } from "./DayDisplayStatus";

export interface LegendFamily {
  readonly heading: string;
  readonly states: readonly CourierStatus[];
}

/**
 * The 14 fine courier states grouped into journey-stage families. Headings
 * organise by journey stage; each chip keeps its own family colour (e.g.
 * "Pre-transit" holds the neutral ORDERED + the ocean-blue ASSIGNED — the
 * chip colours stay distinct, the heading just groups the stage). The union
 * of all `states` is exhaustive over CourierStatus (pinned by the spec).
 */
export const LEGEND_FAMILIES: readonly LegendFamily[] = [
  { heading: "Pre-transit", states: ["ORDERED", "ASSIGNED"] },
  {
    heading: "In transit",
    states: ["PICKED_UP", "ARRIVED_AT_DC", "IN_TRANSIT", "HUB_TRANSFER", "OUT_FOR_DELIVERY"],
  },
  { heading: "Delivered", states: ["DELIVERED"] },
  { heading: "Failed / returned", states: ["FAILED", "PROCESS_FOR_RETURN", "RETURNED_TO_SHIPPER"] },
  { heading: "On hold", states: ["RESCHEDULED", "REATTEMPT"] },
  { heading: "Cancelled", states: ["CANCELED"] },
];

/** Calendar-only overlays (not courier states) shown as a trailing group. */
const OVERLAY_LEGEND: readonly DayExceptionStatus[] = ["SKIPPED", "APPENDED"];

function CourierChip({ state }: { readonly state: CourierStatus }) {
  const display = COURIER_STATUS_DISPLAY[state];
  return (
    <li className="flex items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${display.pillClass}`}
      >
        {/* courierStatus drives the glyph; `status` is the never-reached coarse
            fallback (always present here) so a valid placeholder is fine. */}
        {display.iconKey !== null ? (
          <StatusIcon courierStatus={state} status="CREATED" size={11} />
        ) : null}
        {display.label}
      </span>
    </li>
  );
}

export function CalendarStatusLegend() {
  return (
    <div aria-label="Calendar status legend" className="mb-6 flex flex-col gap-3">
      {LEGEND_FAMILIES.map((family) => (
        <div key={family.heading} className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="w-28 shrink-0 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
            {family.heading}
          </span>
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {family.states.map((state) => (
              <CourierChip key={state} state={state} />
            ))}
          </ul>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="w-28 shrink-0 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Calendar
        </span>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {OVERLAY_LEGEND.map((status) => {
            const visual = DAY_DISPLAY_VISUALS[status];
            if (!visual.inLegend) return null;
            return (
              <li key={status} className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${visual.classes}`}
                >
                  {visual.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// Day-20 §3.3.3 — 6-entry status legend block per brief §3.3.3 line 485
// (Delivered / Out for delivery / Scheduled / Skipped / Appended /
// Failed). CANCELED hidden per reviewer Day-20 ruling — renders
// muted+strikethrough on day cells, NOT in the legend.

import { DAY_DISPLAY_VISUALS, type DayDisplayStatus } from "./DayDisplayStatus";

/**
 * Legend display order — matches brief §3.3.3 line 485 sequence.
 * Drives both render order and the inLegend filter visualisation.
 */
const LEGEND_ORDER: readonly DayDisplayStatus[] = [
  "DELIVERED",
  "OUT_FOR_DELIVERY",
  "SCHEDULED",
  "SKIPPED",
  "APPENDED",
  "FAILED",
];

export function CalendarStatusLegend() {
  return (
    <ul
      aria-label="Calendar status legend"
      className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      {LEGEND_ORDER.map((status) => {
        const visual = DAY_DISPLAY_VISUALS[status];
        if (!visual.inLegend) return null;
        return (
          <li key={status} className="flex items-center gap-2">
            <span
              className={`inline-flex h-3 w-3 rounded-sm ${visual.classes}`}
              aria-hidden="true"
            />
            <span className="text-[10px] uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
              {visual.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

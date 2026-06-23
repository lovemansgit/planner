// <DeliveryWindowTrack> (Phase 9 · Step 3.4 — B+ signature cell).
//
// Renders a delivery window as a mono time label above a bar positioned on the
// fixed 06:00→22:00 day baseline (see delivery-window-track.ts). Early-morning
// drops cluster left, evening drops sit right — so a column of windows reads as
// the day's load at a glance. Pure presentation.

import { windowTrackGeometry } from "./delivery-window-track";

interface DeliveryWindowTrackProps {
  /** Window start "HH:MM" / "HH:MM:SS". */
  readonly start: string;
  /** Window end "HH:MM" / "HH:MM:SS". */
  readonly end: string;
  /** Ended/neutral rows render the bar muted (stone) instead of green. */
  readonly muted?: boolean;
  readonly className?: string;
}

/** "HH:MM:SS" | "HH:MM" → "HH:MM". */
function hhmm(t: string): string {
  return t.slice(0, 5);
}

export function DeliveryWindowTrack({ start, end, muted = false, className = "" }: DeliveryWindowTrackProps) {
  const { leftPct, widthPct } = windowTrackGeometry(start, end);
  const barColor = muted ? "var(--color-led-ended)" : "var(--color-green)";
  return (
    <div className={`min-w-[120px] ${className}`.trim()}>
      <div
        className={`mb-1.5 font-b-mono text-xs tabular-nums ${muted ? "text-[color:var(--color-text-tertiary)]" : "text-[color:var(--color-ink)]"}`}
      >
        {hhmm(start)}–{hhmm(end)}
      </div>
      <div
        className="relative h-1.5 rounded-full bg-[color:var(--color-b-track)]"
        role="img"
        aria-label={`Delivery window ${hhmm(start)} to ${hhmm(end)}`}
      >
        <span
          className="absolute inset-y-0 rounded-full"
          style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}

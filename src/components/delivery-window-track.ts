// Delivery-window track geometry (Phase 9 · Step 3.4 — B+ signature).
//
// A delivery window ("HH:MM" or "HH:MM:SS" start + end) is drawn as a bar on a
// fixed day baseline so an operator reads the day's load as a shape rather than
// parsing near-identical time strings. Pure math (no JSX) so it is node-testable
// and the placement can't silently drift.

// The baseline runs 06:00 → 22:00 — the operational delivery day.
const DAY_START_MIN = 6 * 60; // 06:00
const DAY_END_MIN = 22 * 60; // 22:00
const SPAN_MIN = DAY_END_MIN - DAY_START_MIN; // 960

export interface WindowGeometry {
  /** Left edge as a percentage of the track (0–100). */
  readonly leftPct: number;
  /** Bar width as a percentage of the track (0–100, never negative). */
  readonly widthPct: number;
}

/** Parse "HH:MM" / "HH:MM:SS" to minutes-from-midnight, or null if malformed. */
function toMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const clampPct = (v: number) => Math.min(100, Math.max(0, v));

/** Position a window on the 06:00→22:00 baseline, clamped to the track. */
export function windowTrackGeometry(start: string, end: string): WindowGeometry {
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  if (startMin === null || endMin === null) return { leftPct: 0, widthPct: 0 };
  const leftPct = clampPct(((startMin - DAY_START_MIN) / SPAN_MIN) * 100);
  const rightPct = clampPct(((endMin - DAY_START_MIN) / SPAN_MIN) * 100);
  return { leftPct, widthPct: Math.max(0, rightPct - leftPct) };
}

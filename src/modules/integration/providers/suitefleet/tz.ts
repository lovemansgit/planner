// Day-31 / A1 — Inbound TZ symmetric helper.
//
// Mirror of A3 (#307)'s outbound `dubaiLocalTimeToUtc` (task-client.ts).
// SF wire times are UTC; Planner storage is Dubai-local TZ-naive
// (`time` columns, no zone). Inbound webhook applies must convert
// UTC → Dubai-local (+4h, wrap) BEFORE writing the column.
//
// Asia/Dubai is permanent UTC+04:00 (no DST), so the conversion is a
// fixed +4h shift. Hard-coded — not pulled from runtime TZ libs;
// symmetric with A3's hard-code.
//
// Ships unconditionally per OQ-10(b) ruling (plan #306 v2 §10). The
// helper is correct regardless of whether currently exercised — gating
// it on current vendor behavior is the exact anti-pattern that
// produced this defect class.

import { ValidationError } from "@/shared/errors";

const DUBAI_UTC_OFFSET_HOURS = 4;
const HMS_TIME_REGEX = /^(\d{2}):(\d{2}):(\d{2})$/;

/**
 * Convert a UTC HH:MM:SS time string to Dubai-local (+4h, wrap).
 *
 * Inverse of A3's `dubaiLocalTimeToUtc` at
 * src/modules/integration/providers/suitefleet/task-client.ts:295-312.
 *
 * Throws ValidationError on malformed input (same posture as A3).
 */
export function utcTimeToDubaiLocal(time: string): string {
  const match = HMS_TIME_REGEX.exec(time);
  if (match === null) {
    throw new ValidationError(
      `Day-31 A1: time string must be HH:MM:SS, got: ${time}`,
    );
  }
  const utcHour = Number(match[1]);
  const minutes = match[2];
  const seconds = match[3];
  if (utcHour < 0 || utcHour > 23) {
    throw new ValidationError(
      `Day-31 A1: time string hour out of range 00-23, got: ${time}`,
    );
  }
  const localHour = (utcHour + DUBAI_UTC_OFFSET_HOURS) % 24;
  return `${String(localHour).padStart(2, "0")}:${minutes}:${seconds}`;
}

// Day-22 Phase 1 forms — start + end time-window picker (server
// component). Captures a delivery time window — the [start, end]
// pair the operator (or merchant admin) sets per subscription.
//
// Renders two HTML <input type="time"> controls side-by-side with
// shared label + a single error slot. Validation (start < end +
// minimum window) lives in the exported helper validateTimeWindow,
// invoked at the server-action layer over FormData. Pure logic;
// the input controls themselves are UA-native (no custom dropdown,
// no third-party time picker).
//
// Brand-canon visuals per brief §3.3.11:
//   - hairline 1px stone-200 border at rest (matches FormField input)
//   - text-sm tabular-nums readout
//   - red border + red error text on aria-invalid

export interface TimeWindowPickerProps {
  /** Field name for the start input — server reads as FormData. */
  readonly startName: string;
  /** Field name for the end input. */
  readonly endName: string;
  /** Optional eyebrow label rendered above the input pair. */
  readonly label?: string;
  /** Initial value HH:MM (24h) for start. Uncontrolled. */
  readonly defaultStart?: string;
  /** Initial value HH:MM (24h) for end. Uncontrolled. */
  readonly defaultEnd?: string;
  /** Inline error from a prior submission attempt. */
  readonly error?: string;
  /** Optional hint shown below when no error. */
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
}

export function TimeWindowPicker({
  startName,
  endName,
  label,
  defaultStart,
  defaultEnd,
  error,
  hint,
  disabled,
  required,
}: TimeWindowPickerProps) {
  const startId = `time-window-${startName}`;
  const endId = `time-window-${endName}`;
  const groupId = `${startId}-group`;
  return (
    <fieldset disabled={disabled} aria-describedby={error ? `${groupId}-error` : hint ? `${groupId}-hint` : undefined}>
      {label ? (
        <legend className="mb-1 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
          {label}
        </legend>
      ) : null}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label
            htmlFor={startId}
            className="block text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]"
          >
            Start
          </label>
          <input
            id={startId}
            name={startName}
            type="time"
            defaultValue={defaultStart}
            required={required}
            aria-invalid={error ? "true" : undefined}
            className="mt-1 w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm tabular-nums text-navy focus:border-navy focus:outline-none aria-[invalid=true]:border-red disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <span className="mt-5 text-xs text-[color:var(--color-text-tertiary)]">→</span>
        <div className="flex-1">
          <label
            htmlFor={endId}
            className="block text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]"
          >
            End
          </label>
          <input
            id={endId}
            name={endName}
            type="time"
            defaultValue={defaultEnd}
            required={required}
            aria-invalid={error ? "true" : undefined}
            className="mt-1 w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm tabular-nums text-navy focus:border-navy focus:outline-none aria-[invalid=true]:border-red disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
      </div>
      {hint && !error ? (
        <p id={`${groupId}-hint`} className="mt-1 text-xs text-[color:var(--color-text-tertiary)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${groupId}-error`} role="alert" className="mt-1 text-xs text-red">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export type TimeWindowValidation =
  | { readonly kind: "ok"; readonly start: string; readonly end: string }
  | { readonly kind: "missing"; readonly field: "start" | "end" }
  | { readonly kind: "format"; readonly field: "start" | "end"; readonly raw: string }
  | { readonly kind: "order"; readonly start: string; readonly end: string }
  | { readonly kind: "below_minimum"; readonly minutes: number; readonly minimum: number };

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validate a time-window pair (HH:MM 24h).
 *   - missing         → field absent or empty string
 *   - format          → not a valid HH:MM (24h) pattern
 *   - order           → end <= start (window has zero or negative span)
 *   - below_minimum   → window span < `minimumMinutes` (default 30 —
 *                       matches existing subscription-window invariant)
 *
 * Pure helper; exported for unit tests + server-action validation.
 * Spans starting and ending on the same day — no cross-midnight
 * window support (subscription tasks are per-day deliveries).
 */
export function validateTimeWindow(
  rawStart: unknown,
  rawEnd: unknown,
  options: { readonly minimumMinutes?: number } = {},
): TimeWindowValidation {
  const minimum = options.minimumMinutes ?? 30;
  if (typeof rawStart !== "string" || rawStart.length === 0) {
    return { kind: "missing", field: "start" };
  }
  if (typeof rawEnd !== "string" || rawEnd.length === 0) {
    return { kind: "missing", field: "end" };
  }
  if (!HHMM_PATTERN.test(rawStart)) {
    return { kind: "format", field: "start", raw: rawStart };
  }
  if (!HHMM_PATTERN.test(rawEnd)) {
    return { kind: "format", field: "end", raw: rawEnd };
  }
  const startMin = hhmmToMinutes(rawStart);
  const endMin = hhmmToMinutes(rawEnd);
  if (endMin <= startMin) {
    return { kind: "order", start: rawStart, end: rawEnd };
  }
  const span = endMin - startMin;
  if (span < minimum) {
    return { kind: "below_minimum", minutes: span, minimum };
  }
  return { kind: "ok", start: rawStart, end: rawEnd };
}

function hhmmToMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(":");
  return parseInt(hh, 10) * 60 + parseInt(mm, 10);
}

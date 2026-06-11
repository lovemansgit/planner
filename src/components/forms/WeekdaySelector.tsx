// Day-22 Phase 1 forms — Mon-Sun weekday selector (server component).
//
// Subscriptions specify delivery days as a subset of the ISO week
// (Mon=1...Sun=7). This primitive renders the 7-day grid as 7
// checkboxes with a shared `name` attribute so FormData.getAll(name)
// returns the selected days as string[] at the server-action layer.
// Caller parses via parseSelectedWeekdays() (exported helper).
//
// Brand-canon visuals per brief §3.3.11:
//   - hairline 1px stone-200 border at rest
//   - selected: bg-navy text-paper (filled chip)
//   - unselected: bg-paper text-navy hover:bg-ivory
//   - disabled: opacity-60 cursor-not-allowed
//   - 120ms transitions (matches CrmStateBadge + FormSubmitButton)
// Visual matches the chip-button pattern from /tasks filter pills
// (status.ts:21-29) for read-write parity across the app.
//
// Default-uncontrolled — caller passes `defaultSelected`. Server-side
// FormData submission carries the selected day strings; the action
// re-validates via parseSelectedWeekdays.
//
// CSS-driven selected state — Day-22 fixup per PR #238 §3.22:
//   The initial implementation computed isSelected at React render
//   time and chose the className statically. That broke perceived
//   interactivity — clicking a label toggled the underlying checkbox
//   natively (HTML behaviour, label htmlFor link), but the className
//   stayed frozen at its render-time value because there's no client
//   state to re-render against (this is a server component).
//   Operators saw no visual feedback on click and abandoned.
//   Fix: switched to Tailwind's `has-[:checked]:` selector so the
//   visible chip styles react to the descendant <input>'s :checked
//   state directly via CSS. No JS state involved; the visual stays in
//   sync with the actual checkbox state regardless of how it got
//   toggled (label click, form reset, programmatic .checked = true,
//   etc.). Requires browser support for :has() — Chrome 105+,
//   Safari 15.4+, Firefox 121+ (all 2022-2023; safe for v1 demo).

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const WEEKDAYS: ReadonlyArray<{ readonly key: Weekday; readonly short: string; readonly iso: number }> = [
  { key: "mon", short: "Mon", iso: 1 },
  { key: "tue", short: "Tue", iso: 2 },
  { key: "wed", short: "Wed", iso: 3 },
  { key: "thu", short: "Thu", iso: 4 },
  { key: "fri", short: "Fri", iso: 5 },
  { key: "sat", short: "Sat", iso: 6 },
  { key: "sun", short: "Sun", iso: 7 },
];

const VALID_WEEKDAY_KEYS: ReadonlySet<string> = new Set(WEEKDAYS.map((w) => w.key));

export interface WeekdaySelectorProps {
  /** Form-data key. Each checkbox shares this name — FormData.getAll
   *  returns the selected weekday strings. */
  readonly name: string;
  /** Initial selection (uncontrolled). */
  readonly defaultSelected?: ReadonlyArray<Weekday>;
  /** Optional eyebrow label rendered above the chip row. */
  readonly label?: string;
  /** Optional inline error from a prior submission attempt. */
  readonly error?: string;
  /** Optional hint shown below when no error. */
  readonly hint?: string;
  readonly disabled?: boolean;
}

export function WeekdaySelector({
  name,
  defaultSelected,
  label,
  error,
  hint,
  disabled,
}: WeekdaySelectorProps) {
  const selectedSet = new Set<Weekday>(defaultSelected ?? []);
  const groupId = `weekday-selector-${name}`;
  return (
    <fieldset disabled={disabled}>
      {label ? (
        <legend className="mb-2 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
          {label}
        </legend>
      ) : null}
      <div
        role="group"
        aria-describedby={
          error ? `${groupId}-error` : hint ? `${groupId}-hint` : undefined
        }
        className="flex flex-wrap gap-1.5"
      >
        {WEEKDAYS.map((day) => {
          const checkboxId = `${groupId}-${day.key}`;
          const isSelected = selectedSet.has(day.key);
          return (
            <label
              key={day.key}
              htmlFor={checkboxId}
              className="inline-flex min-w-[44px] cursor-pointer items-center justify-center rounded-sm border border-stone-200 bg-paper px-2 py-1 text-xs font-medium uppercase tracking-[0.1em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory has-[:checked]:border-navy has-[:checked]:bg-navy has-[:checked]:text-paper has-[:checked]:hover:bg-navy has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
            >
              <input
                id={checkboxId}
                type="checkbox"
                name={name}
                value={day.key}
                defaultChecked={isSelected}
                className="sr-only"
              />
              <span aria-hidden="true">{day.short}</span>
              <span className="sr-only">{day.short}day</span>
            </label>
          );
        })}
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

/**
 * Parse FormData.getAll(name) output into a deduplicated, ISO-ordered
 * array of weekday keys. Drops invalid values (defensive — name=
 * collision or hand-crafted POST). Pure helper — exported for unit
 * tests + server-action callers.
 */
export function parseSelectedWeekdays(raw: ReadonlyArray<unknown>): readonly Weekday[] {
  const valid = new Set<Weekday>();
  for (const v of raw) {
    if (typeof v === "string" && VALID_WEEKDAY_KEYS.has(v)) {
      valid.add(v as Weekday);
    }
  }
  return WEEKDAYS.filter((d) => valid.has(d.key)).map((d) => d.key);
}

/**
 * Convert weekday keys to ISO ordinals (Mon=1...Sun=7) — the
 * subscription module's expected wire shape. Pure helper.
 */
export function weekdaysToIsoOrdinals(keys: ReadonlyArray<Weekday>): readonly number[] {
  const set = new Set(keys);
  return WEEKDAYS.filter((d) => set.has(d.key)).map((d) => d.iso);
}

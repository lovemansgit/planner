// Day-22 Phase 1 forms — consignee address picker (server component).
//
// Surfaces the consignee's saved addresses (primary + alternative
// rotation members) plus a one-off override slot for ad-hoc deliveries
// per brief §3.3.3 popover actions ("Change address for this delivery
// only" / "Change address from this delivery onwards"). Choice maps
// to the FormData field `name` — the consumer's server action reads
// it and dispatches to the correct address-mutation path
// (subscription_addresses / one-off override).
//
// Three slot types per brief §3.3.5 + §3.3.3:
//   - "primary"        — the subscription's default address (always present)
//   - "alternative"    — alternative rotation members (0..N)
//   - "override"       — ad-hoc one-off line, captured inline in a
//                        text input that surfaces when override radio
//                        is selected
//
// Brand-canon visuals per brief §3.3.11:
//   - hairline 1px stone-200 border per radio row
//   - selected: bg-ivory + border-navy + text-navy
//   - unselected: bg-paper + text-[color:--color-text-secondary]
//   - 120ms ease-out transitions

import type { ReactNode } from "react";

export type AddressLabel = "home" | "office" | "other";

export interface AddressOption {
  /** Stable id (subscription_addresses.id). Becomes the radio value. */
  readonly id: string;
  /** Slot kind — drives the eyebrow label rendered above the address line. */
  readonly kind: "primary" | "alternative";
  /** "Home" / "Office" / "Other" semantic label. */
  readonly label: AddressLabel;
  /** Human-readable single-line address copy (line + district). */
  readonly addressLine: string;
}

export interface AddressPickerProps {
  /** Form-data key — the radio group shares this name. */
  readonly name: string;
  /** Consignee's saved addresses. Caller fetches via the
   *  subscription_addresses module + projects to AddressOption[]. */
  readonly options: ReadonlyArray<AddressOption>;
  /** Default-selected address id. Uncontrolled. */
  readonly defaultSelectedId?: string;
  /** Whether to render the override slot (radio + inline text input).
   *  Caller's permission gate decides — operators with
   *  subscription:change_address_one_off see the slot; others don't. */
  readonly allowOverride?: boolean;
  /** When `allowOverride`, the inline text input uses this name. */
  readonly overrideInputName?: string;
  /** Optional eyebrow label rendered above the radio group. */
  readonly label?: string;
  readonly error?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  /** Optional content rendered inside the override slot (e.g. a
   *  district selector). Renders below the override text input. */
  readonly overrideExtras?: ReactNode;
}

const ADDRESS_LABEL_COPY: Record<AddressLabel, string> = {
  home: "Home",
  office: "Office",
  other: "Other",
};

const SLOT_EYEBROW_COPY: Record<AddressOption["kind"], string> = {
  primary: "Primary",
  alternative: "Alternative",
};

export const ADDRESS_OVERRIDE_VALUE = "__override__";

export function AddressPicker({
  name,
  options,
  defaultSelectedId,
  allowOverride,
  overrideInputName,
  label,
  error,
  hint,
  disabled,
  overrideExtras,
}: AddressPickerProps) {
  const groupId = `address-picker-${name}`;
  return (
    <fieldset
      disabled={disabled}
      aria-describedby={error ? `${groupId}-error` : hint ? `${groupId}-hint` : undefined}
    >
      {label ? (
        <legend className="mb-2 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
          {label}
        </legend>
      ) : null}
      <div className="space-y-1.5">
        {options.map((opt) => {
          const radioId = `${groupId}-${opt.id}`;
          const isSelected = defaultSelectedId === opt.id;
          return (
            <label
              key={opt.id}
              htmlFor={radioId}
              className={
                isSelected
                  ? "flex cursor-pointer items-start gap-3 rounded-sm border border-navy bg-ivory px-3 py-2 transition-colors duration-[120ms] ease-out has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                  : "flex cursor-pointer items-start gap-3 rounded-sm border border-stone-200 bg-paper px-3 py-2 transition-colors duration-[120ms] ease-out hover:bg-ivory has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
              }
            >
              <input
                id={radioId}
                type="radio"
                name={name}
                value={opt.id}
                defaultChecked={isSelected}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                  {SLOT_EYEBROW_COPY[opt.kind]} · {ADDRESS_LABEL_COPY[opt.label]}
                </p>
                <p className="mt-0.5 text-sm text-navy">{opt.addressLine}</p>
              </div>
            </label>
          );
        })}
        {allowOverride && overrideInputName ? (
          <OverrideSlot
            groupName={name}
            groupId={groupId}
            inputName={overrideInputName}
            extras={overrideExtras}
            defaultSelected={defaultSelectedId === ADDRESS_OVERRIDE_VALUE}
          />
        ) : null}
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

interface OverrideSlotProps {
  readonly groupName: string;
  readonly groupId: string;
  readonly inputName: string;
  readonly extras?: ReactNode;
  readonly defaultSelected: boolean;
}

function OverrideSlot({
  groupName,
  groupId,
  inputName,
  extras,
  defaultSelected,
}: OverrideSlotProps) {
  const radioId = `${groupId}-${ADDRESS_OVERRIDE_VALUE}`;
  const inputId = `${groupId}-${inputName}-input`;
  return (
    <label
      htmlFor={radioId}
      className={
        defaultSelected
          ? "flex cursor-pointer flex-col gap-2 rounded-sm border border-navy bg-ivory px-3 py-2 transition-colors duration-[120ms] ease-out has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
          : "flex cursor-pointer flex-col gap-2 rounded-sm border border-stone-200 bg-paper px-3 py-2 transition-colors duration-[120ms] ease-out hover:bg-ivory has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
      }
    >
      <div className="flex items-start gap-3">
        <input
          id={radioId}
          type="radio"
          name={groupName}
          value={ADDRESS_OVERRIDE_VALUE}
          defaultChecked={defaultSelected}
          className="mt-1"
        />
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
            One-off override
          </p>
          <p className="mt-0.5 text-sm text-[color:var(--color-text-secondary)]">
            Use a different address for this delivery only.
          </p>
        </div>
      </div>
      <input
        id={inputId}
        name={inputName}
        type="text"
        placeholder="Building, district"
        className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy placeholder:text-[color:var(--color-text-tertiary)] focus:border-navy focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      />
      {extras}
    </label>
  );
}

// Day-20 §3.3.3 — text-only address label indicator for calendar
// day cells per brief §3.3.3 line 487 ("address indicator
// (Home/Office per rotation)"). Resolved address label flows from
// listTasksByConsigneeAndDateRange's LEFT JOIN to addresses(id) into
// Task.addressLabel.
//
// Glyph treatment deferred — text-only matches the "match
// implementation complexity to aesthetic vision" skill principle.
// Glyph extension lands in a follow-up if reviewer §3.6 requires.

interface AddressIndicatorProps {
  readonly label: "home" | "office" | "other" | null;
}

const ADDRESS_LABELS: Record<NonNullable<AddressIndicatorProps["label"]>, string> = {
  home: "Home",
  office: "Office",
  other: "Other",
};

export function AddressIndicator({ label }: AddressIndicatorProps) {
  if (label === null) return null;
  return (
    <span className="block text-[9px] font-medium uppercase tracking-[0.1em] text-[color:var(--color-text-tertiary)]">
      {ADDRESS_LABELS[label]}
    </span>
  );
}

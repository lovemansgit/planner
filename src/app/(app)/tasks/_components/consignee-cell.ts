// Day-53 R6-part-1 — consignee-block cell model.
//
// Pure helper deriving the display model for the /tasks consignee
// columns (Name · Address · District · Emirate · Telephone). Per Love's
// Ruling 2 (R6.4) those five columns are ONE click target to the
// consignee detail page; the telephone is plain text, NOT a `tel:` link.
//
// The repository projects override-resolved effective-address fields
// (COALESCE override → consignee default), all nullable. A null or
// blank field renders as an em-dash so the row never collapses.

export interface ConsigneeCellModel {
  /** Single click target for the whole consignee block (R6.4). */
  readonly href: string;
  readonly name: string;
  readonly addressLine: string;
  readonly district: string;
  readonly emirate: string;
  /** Plain text — operators copy it; not a tel: link (Ruling 2). */
  readonly telephone: string;
}

const EM_DASH = "—";

function displayOrDash(value: string | null): string {
  if (value === null) return EM_DASH;
  const trimmed = value.trim();
  return trimmed.length === 0 ? EM_DASH : trimmed;
}

export function consigneeCellModel(task: {
  readonly consigneeId: string;
  readonly consigneeName: string | null;
  readonly effectiveAddressLine: string | null;
  readonly effectiveDistrict: string | null;
  readonly effectiveEmirate: string | null;
  readonly consigneePhone: string | null;
}): ConsigneeCellModel {
  return {
    href: `/consignees/${task.consigneeId}`,
    name: displayOrDash(task.consigneeName),
    addressLine: displayOrDash(task.effectiveAddressLine),
    district: displayOrDash(task.effectiveDistrict),
    emirate: displayOrDash(task.effectiveEmirate),
    telephone: displayOrDash(task.consigneePhone),
  };
}

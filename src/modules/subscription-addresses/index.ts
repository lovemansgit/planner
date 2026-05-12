// subscription-addresses module — Day 16 / Block 4-E Service E.
//
// Public surface:
//   - changeAddressRotation (the substantive Service E fn)
//   - findAddressForConsignee (shared cross-consignee ownership
//     helper; exported because subscription-exceptions/service.ts
//     imports it for its address_override branches per §B B1)
//   - listAddressesForConsignee (Day-22 / PR-B; picker source for
//     calendar popover address-override actions 4 + 5 per brief §3.3.3)

export type {
  AddressOwnershipRow,
  ChangeAddressRotationInput,
  ChangeAddressRotationResult,
  ConsigneeAddressRow,
  CurrentRotationRow,
  IsoWeekday,
  RotationEntry,
  SubscriptionForRotation,
} from "./types";

export { findAddressForConsignee, listAddressesForConsignee } from "./repository";
export { changeAddressRotation, listConsigneeAddresses } from "./service";

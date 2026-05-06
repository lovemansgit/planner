// subscription-addresses module — Day 16 / Block 4-E Service E.
//
// Public surface:
//   - changeAddressRotation (the substantive Service E fn)
//   - findAddressForConsignee (shared cross-consignee ownership
//     helper; exported because subscription-exceptions/service.ts
//     imports it for its address_override branches per §B B1)

export type {
  AddressOwnershipRow,
  ChangeAddressRotationInput,
  ChangeAddressRotationResult,
  CurrentRotationRow,
  IsoWeekday,
  RotationEntry,
  SubscriptionForRotation,
} from "./types";

export { findAddressForConsignee } from "./repository";
export { changeAddressRotation } from "./service";

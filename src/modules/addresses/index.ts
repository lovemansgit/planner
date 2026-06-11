// addresses module — Day 22 / Phase 1 forms lane.
//
// Public surface:
//   - Address, AddressLabel, CreateAddressInput types
//   - listAddresses (read; consignee:read)
//   - createAddress (Day 53; non-primary add from the consignee detail
//     page; consignee:update)
//
// Repository helpers exported for cross-module orchestration use only
// (createConsigneeWithSubscription in consignees/onboarding.ts):
//   - insertAddress, listAddressesByConsignee, findAddressById
//
// Update / set-primary / delete service surface stays deferred to
// Phase 2 per memory/followup_multi_address_rotation_phase_2.md
// (reviewer-ruled on the Day-53 plan-PR: not trivially-same-surface).

export type { Address, AddressLabel, CreateAddressInput } from "./types";
export type { AddConsigneeAddressInput } from "./service";

export { createAddress, listAddresses } from "./service";

export {
  findAddressById,
  insertAddress,
  listAddressesByConsignee,
} from "./repository";

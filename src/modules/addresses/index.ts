// addresses module — Day 22 / Phase 1 forms lane.
//
// Public surface:
//   - Address, AddressLabel, CreateAddressInput types
//   - listAddresses (read; consignee:read)
//
// Repository helpers exported for cross-module orchestration use only
// (createConsigneeWithSubscription in consignees/onboarding.ts):
//   - insertAddress, listAddressesByConsignee, findAddressById
//
// Standalone create / update / delete service surface deferred to
// Phase 2 per memory/followup_multi_address_rotation_phase_2.md.

export type { Address, AddressLabel, CreateAddressInput } from "./types";

export { listAddresses } from "./service";

export {
  findAddressById,
  insertAddress,
  listAddressesByConsignee,
} from "./repository";

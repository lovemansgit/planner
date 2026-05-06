// merchants module — Day 16 / Block 4-D Service D.
//
// Public surface: createMerchant + activateMerchant +
// deactivateMerchant + listMerchants. Repository (pure-DB) is
// internal — only the service layer is exported.

export type {
  ActivateMerchantResult,
  CreateMerchantInput,
  CreateMerchantResult,
  DeactivateMerchantResult,
  ListMerchantsFilters,
  Merchant,
  PickupAddress,
  TenantStatus,
} from "./types";

export {
  activateMerchant,
  createMerchant,
  deactivateMerchant,
  listMerchants,
} from "./service";

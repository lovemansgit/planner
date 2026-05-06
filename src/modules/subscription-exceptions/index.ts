// Subscription-exceptions module barrel export — Day-16 Block 4-B.

export {
  addSubscriptionException,
  appendWithoutSkip,
} from "./service";
export type {
  AddSubscriptionExceptionInput,
  AddSubscriptionExceptionResult,
  AppendWithoutSkipInput,
  AppendWithoutSkipResult,
  PauseWindowRange,
  SubscriptionException,
  SubscriptionExceptionType,
} from "./types";

// The pure algorithm helper is exported separately so the materialization
// cron + tests can call it directly without going through the service
// layer's I/O wrapper.
export {
  computeCompensatingDate,
  computePauseExtensionDate,
  countEligibleDeliveryDays,
  walkBackwardEligibleDays,
  type ComputeCompensatingDateInput,
  type ComputeCompensatingDateResult,
  type ComputePauseExtensionDateInput,
  type ComputePauseExtensionDateResult,
  type IsoDate,
  type IsoWeekday,
  type PauseWindow,
  type SubscriptionForSkip,
} from "./skip-algorithm";

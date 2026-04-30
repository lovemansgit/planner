// subscriptions module — Day 6 / S-3.
//
// S-3 ships the data-shape layer only: types and repository. No
// service, no API routes, no audit emit (those land in S-4 and S-5).
//
// This barrel re-exports the public types so external callers can
// `import type { Subscription } from '@/modules/subscriptions'` once
// the service layer lands. Until then, the repository is the only
// callable surface, and S-4 will replace this barrel's runtime
// exports with the service layer (matching the tasks-module pattern
// in src/modules/tasks/index.ts).

export type {
  CreateSubscriptionInput,
  Subscription,
  SubscriptionAddressOverride,
  SubscriptionStatus,
  SubscriptionUpdate,
  UpdateSubscriptionPatch,
} from "./types";

// subscriptions module — public surface.
//
// S-3 shipped types + repository (data-shape). S-4 ships the service
// layer (audit-emit + permission gates). S-5 will add API routes and
// the minimal `/subscriptions` UI list page.
//
// Pattern matches src/modules/tasks/index.ts: types are re-exported as
// `export type { … }`, runtime service functions as a flat
// `export { … } from "./service"`. Internal repository helpers stay
// private; consumers go through the service for any operation that
// needs auth or audit.

export type {
  CreateSubscriptionInput,
  Subscription,
  SubscriptionAddressOverride,
  SubscriptionStatus,
  SubscriptionUpdate,
  UpdateSubscriptionPatch,
} from "./types";

export {
  autoPauseSubscriptionForRepeatedFailure,
  createSubscription,
  endSubscription,
  getSubscription,
  listSubscriptions,
  pauseSubscription,
  resumeSubscription,
  sweepEndedSubscriptions,
  updateSubscription,
} from "./service";

export type { AutoPauseInput, SweepResult } from "./service";

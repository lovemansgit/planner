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
  listSubscriptionsWithConsignee,
  pauseSubscription,
  resumeSubscription,
  sweepEndedSubscriptions,
  updateSubscription,
} from "./service";

export type { AutoPauseInput, SubscriptionWithConsignee, SweepResult } from "./service";

// -----------------------------------------------------------------------------
// Orchestration-only repository surface (Day 22 / Phase 1 forms lane)
// -----------------------------------------------------------------------------
// `insertSubscription` is exported for use INSIDE existing
// `withTenant(...)` transactions opened by orchestration fns (e.g.
// consignees/onboarding.ts createConsigneeWithSubscription). NEVER
// call this from a route handler or server action directly — the
// service-layer surface (createSubscription) is the audited /
// permission-gated entry point. Any consumer must:
//   1. Check the relevant permissions (subscription:create).
//   2. Run inside its own withTenant block.
//   3. Emit subscription.created post-commit.
// Mis-use will leave the audit trail incomplete.
export { insertSubscription } from "./repository";

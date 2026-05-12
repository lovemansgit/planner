// consignees module — plan §3.3 / §4.4.5 (MP-05 address rules).
//
// Day 3 / C-3: full service-layer surface. The repository (C-2) is
// internal — only the service layer is exported, so the API routes
// in C-4 reach the DB only through the audited / permission-gated
// surface.

export type {
  ChangeConsigneeCrmStateInput,
  ChangeConsigneeCrmStateResult,
  Consignee,
  ConsigneeCrmEvent,
  ConsigneeCrmState,
  CreateConsigneeInput,
  SubscriptionExceptionType,
  TaskTerminalStatus,
  TimelineEvent,
  UpdateConsigneePatch,
} from "./types";

export {
  changeConsigneeCrmState,
  countConsigneesByTenant,
  createConsignee,
  getConsignee,
  getConsigneeCrmHistory,
  getConsigneeTimeline,
  listConsignees,
  updateConsignee,
  deleteConsignee,
} from "./service";

export type {
  CreateConsigneeWithSubscriptionInput,
  CreateConsigneeWithSubscriptionResult,
} from "./onboarding";

export { createConsigneeWithSubscription } from "./onboarding";

export { ALLOWED_TRANSITIONS, canTransition } from "./transitions";

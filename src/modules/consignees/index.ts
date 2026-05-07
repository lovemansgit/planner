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
  UpdateConsigneePatch,
} from "./types";

export {
  changeConsigneeCrmState,
  createConsignee,
  getConsignee,
  getConsigneeCrmHistory,
  listConsignees,
  updateConsignee,
  deleteConsignee,
} from "./service";

export { ALLOWED_TRANSITIONS, canTransition } from "./transitions";

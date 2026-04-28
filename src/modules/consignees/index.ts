// consignees module — plan §3.3 / §4.4.5 (MP-05 address rules).
//
// Day 3 / C-2: types + repository (Drizzle queries, no business logic).
// Service layer (C-3) and API routes (C-4) land in subsequent commits.

export type { Consignee, CreateConsigneeInput, UpdateConsigneePatch } from "./types";

export {
  insertConsignee,
  findConsigneeById,
  listConsigneesByTenant,
  updateConsignee,
  deleteConsignee,
} from "./repository";

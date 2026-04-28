// integration module — plan §3.3 / §5 SuiteFleet (ADR-007 auth).
//
// Day 4 / S-1: public surface is the `LastMileAdapter` interface plus
// the internal-language types it operates on. SuiteFleet-specific code
// lives under providers/suitefleet/ and is not re-exported — callers
// resolve a provider instance through the adapter factory (lands later
// in Day 4 once auth + cred plumbing is in place).

export type { LastMileAdapter } from "./last-mile-adapter";

export type {
  AuthenticatedSession,
  ConsigneeSnapshot,
  DeliveryAddress,
  DeliveryWindow,
  HeadersLike,
  InternalTaskStatus,
  PaymentMethod,
  TaskCreateRequest,
  TaskCreateResult,
  TaskKind,
  WebhookEvent,
  WebhookEventKind,
  WebhookVerificationResult,
} from "./types";

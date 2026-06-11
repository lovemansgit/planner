// audit module — plan §3.3, R-4 emit + event_types vocabulary.
//
// Day-2 exports: the controlled event-type vocabulary and the emit()
// writer + service-role audit observer.
//
// Day-52 / R8 adds the module's first read surface (read.ts) — the
// resource-scoped list functions behind the task-history drawer. The
// full audit log viewer stays deferred per plan §13.1 / brief §4.

export {
  EVENT_TYPES,
  ALL_EVENT_TYPE_IDS,
  isKnownEventType,
  type EventTypeDef,
  type EventTypeId,
} from "./event-types";

export {
  emit,
  registerAuditObserver,
  serviceRoleAuditObserver,
  AUDIT_EMIT_REASON_PREFIX,
  type AuditActorKind,
  type EmitInput,
} from "./emit";

export {
  listAuditEventsForResource,
  listAuditEventsForSubscription,
  type AuditEventCursor,
  type AuditEventRecord,
  type ListAuditEventsForResourceParams,
  type ListAuditEventsForSubscriptionParams,
} from "./read";

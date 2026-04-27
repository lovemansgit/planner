// audit module — plan §3.3, R-4 emit + event_types vocabulary.
//
// Day-2 exports: the controlled event-type vocabulary and the emit()
// writer + service-role audit observer. A query-side surface (audit
// log viewer) is deferred per plan §13.1.

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

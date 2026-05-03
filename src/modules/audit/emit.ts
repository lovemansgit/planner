// Audit emit + serviceRoleObserver wiring per resolutions R-4.
//
// Two responsibilities in one file because they share the same recursion
// contract:
//
//   1. emit() — the one and only writer to audit_events. Always goes
//      through withServiceRole because the audit_events RLS policy in
//      0002_audit.sql is FOR SELECT only — non-service-role INSERTs
//      get the "no policy permits this command" deny branch, by design
//      per R-4.
//
//   2. serviceRoleAuditObserver() — registered with
//      setServiceRoleObserver in shared/db.ts. Fires a
//      `db.service_role.use` audit event for every withServiceRole call
//      EXCEPT those whose reason starts with the AUDIT_EMIT_REASON_PREFIX.
//      That recursion-skip is the contract documented in the
//      0002_audit.sql header and in src/shared/db.ts L66.
//
// Why the recursion-skip mechanism is reason-string-prefix matching
// rather than AsyncLocalStorage:
//   - The setServiceRoleObserver hook in db.ts is sync (returns void),
//     so AsyncLocalStorage's run-with-context pattern doesn't fit
//     cleanly without restructuring db.ts.
//   - The reason string is at every withServiceRole call site, which
//     means the convention is reviewable. Anyone refactoring emit
//     to use a different reason format will see the prefix constant
//     used in both places (here and in serviceRoleAuditObserver) and
//     update both atomically.
//   - The prefix is explicit and namespaced ("audit:emit:<event_type>"),
//     so accidental match by an unrelated withServiceRole reason is
//     extremely unlikely.

import { sql as sqlTag } from "drizzle-orm";

import { setServiceRoleObserver, withServiceRole } from "../../shared/db";
import { captureException } from "../../shared/sentry-capture";

import { type EventTypeId, isKnownEventType } from "./event-types";

/**
 * Reason-string prefix passed to `withServiceRole` from inside `emit()`.
 * The serviceRoleAuditObserver detects this prefix and skips emitting a
 * recursive `db.service_role.use` event. Refactors to emit's
 * withServiceRole call must keep this prefix at the start of the reason
 * or the observer will recurse. The recursion-skip test in
 * `tests/emit.spec.ts` guards against drift.
 */
export const AUDIT_EMIT_REASON_PREFIX = "audit:emit:";

/**
 * Actor kinds writeable to audit_events. Matches the CHECK constraint
 * on actor_kind in 0002_audit.sql (`'user' | 'system' | 'api_key'`).
 *
 * Wider than the Actor type in shared/tenant-context.ts (which is
 * `user | system` only) because the audit table records api_key actors
 * separately even though the application Actor type currently maps
 * api-key authentication to a synthesized user actor at the request
 * layer. When api-key actors land as a first-class kind, this stays
 * unchanged.
 */
export type AuditActorKind = "user" | "system" | "api_key";

/**
 * Input shape for emit. Field names align with audit_events column
 * names (snake_case in the DB, camelCase here at the call site).
 */
export interface EmitInput {
  /** Must be a known event type from the catalogue. */
  readonly eventType: EventTypeId;
  readonly actorKind: AuditActorKind;
  /**
   * text in the DB — covers user uuids, system actor names like
   * 'cron:generate_tasks', api_key uuids, and the synthetic 'audit'
   * actor for the recursion-suppressed db.service_role.use emit.
   * NOT NULL in the table; non-empty enforced here.
   */
  readonly actorId: string;
  /** null for cross-tenant system events (db.service_role.use, batch.* aggregates). */
  readonly tenantId: string | null;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly metadata?: Record<string, unknown>;
  readonly requestId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

/**
 * Insert one audit_events row. The sole writer; all other modules emit
 * through this. Returns void on success, throws on DB error — callers
 * choose whether to await (synchronous critical-path emit) or
 * fire-and-forget (best-effort telemetry).
 *
 * The `reason` passed to withServiceRole is `audit:emit:<event_type>`,
 * which is what serviceRoleAuditObserver matches on to skip recursion.
 */
export async function emit(input: EmitInput): Promise<void> {
  if (!isKnownEventType(input.eventType)) {
    throw new Error(
      `audit.emit: unknown event_type '${input.eventType}' — must be a member of the EVENT_TYPES vocabulary`
    );
  }
  if (input.actorId.length === 0) {
    throw new Error("audit.emit: actorId must be non-empty");
  }

  const reason = `${AUDIT_EMIT_REASON_PREFIX}${input.eventType}`;
  const metadataJson = JSON.stringify(input.metadata ?? {});

  await withServiceRole(reason, async (tx) => {
    await tx.execute(sqlTag`
      INSERT INTO audit_events (
        actor_kind,
        actor_id,
        tenant_id,
        event_type,
        resource_type,
        resource_id,
        metadata,
        request_id,
        ip_address,
        user_agent
      ) VALUES (
        ${input.actorKind},
        ${input.actorId},
        ${input.tenantId},
        ${input.eventType},
        ${input.resourceType ?? null},
        ${input.resourceId ?? null},
        ${metadataJson}::jsonb,
        ${input.requestId ?? null},
        ${input.ipAddress ?? null},
        ${input.userAgent ?? null}
      )
    `);
  });
}

/**
 * The serviceRoleObserver registered with shared/db.ts. Fires a
 * `db.service_role.use` audit event for every withServiceRole call,
 * EXCEPT those whose reason starts with AUDIT_EMIT_REASON_PREFIX (the
 * recursion-skip contract).
 *
 * Fire-and-forget by design: the observer in db.ts is sync, and we do
 * not want to block the caller's withServiceRole on the audit insert.
 * If the insert fails, we drop the telemetry; we do NOT cascade-fail
 * the wrapped operation. Errors from the dropped insert surface in
 * Sentry once Sentry SDK init lands (Day 9 per plan §10.2).
 */
export function serviceRoleAuditObserver(reason: string): void {
  if (reason.startsWith(AUDIT_EMIT_REASON_PREFIX)) {
    // Recursion skip: this withServiceRole call IS our own audit
    // insert. Do NOT fire another db.service_role.use event for it,
    // or every emit becomes infinite.
    return;
  }

  void emit({
    eventType: "db.service_role.use",
    actorKind: "system",
    actorId: "audit",
    tenantId: null,
    metadata: { reason },
  }).catch((err) => {
    // Best-effort. See doc comment above. Day-7 / C-6 wired Sentry
    // capture so this telemetry-of-telemetry-failure surfaces in
    // production instead of dropping silently.
    captureException(err, {
      component: "audit_emit",
      event_type: "db.service_role.use",
      reason,
    });
  });
}

/**
 * Register the service-role audit observer with shared/db.ts. Idempotent
 * — calling this multiple times is safe; the second call replaces the
 * first registration with the same observer reference, which is a
 * no-op semantically.
 *
 * Call site is once-per-process at server startup. In Next.js, importing
 * this function from src/app/layout.tsx and calling it ensures it runs
 * on first server-side render and the registration persists for the
 * life of the server process (module loads are cached).
 */
export function registerAuditObserver(): void {
  setServiceRoleObserver(serviceRoleAuditObserver);
}

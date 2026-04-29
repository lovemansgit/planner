// SuiteFleet webhook payload parser — Day 4 / S-5.
//
// Pure function: takes a JSON-parsed body (unknown) and returns the
// array of internal-language `WebhookEvent`s. The 15→7 status mapping
// is NOT performed here — that's S-6's job. The parser leaves
// `internalStatus` undefined; the adapter assembly point composes the
// parser output with `mapStatusToInternal` to populate it.
//
// Brief §5: webhooks default to JSON array (batched). Each entry has
// an `action` field (one of 15 types), a `taskId`, a timestamp, and
// arbitrary additional fields. The parser is permissive: it skips
// individual entries that are missing required fields (logging a
// warn) rather than failing the whole batch — a single malformed
// entry shouldn't block valid events from being processed.
//
// Idempotency key: SHA-256 of `JSON.stringify(rawEntry)`. Two
// identical webhook deliveries (SuiteFleet retry) produce the same
// key; two different events produce different keys. Independent of
// how the parser extracts other fields, so future field-extraction
// tweaks don't change the key for events already in flight.
//
// Action vocabulary: only `TASK_HAS_BEEN_ASSIGNED` is verified
// (memory/decision_task_editability_cutoff_at_assigned.md). The other
// 14 names live in `suitefleet-adapter-tech-spec.md` which is not in
// the repo yet — see TODO below. Until verified, the classifier uses
// a name-pattern fallback for kind-classification, and S-6's mapping
// table will leave unrecognised actions producing the safe default
// `CREATED` internal status.

import { createHash } from "node:crypto";

import { ValidationError } from "../../../../shared/errors";
import { logger } from "../../../../shared/logger";

import type { WebhookEvent, WebhookEventKind } from "../../types";

const log = logger.with({ component: "suitefleet_webhook_parser" });

// TODO(Day-4-spec): verify the full 15-action vocabulary against
// suitefleet-adapter-tech-spec.md (or empirical sandbox capture during
// S-9) and replace the heuristic classifier below with an exhaustive
// known-action map. Only `TASK_HAS_BEEN_ASSIGNED` is verified today.
const KNOWN_ACTIONS: Readonly<Record<string, WebhookEventKind>> = {
  TASK_HAS_BEEN_ASSIGNED: "TASK_ASSIGNMENT_CHANGED",
};

function classifySuiteFleetAction(action: string): WebhookEventKind {
  const known = KNOWN_ACTIONS[action];
  if (known !== undefined) return known;
  if (action.includes("ASSIGN")) return "TASK_ASSIGNMENT_CHANGED";
  if (action.includes("LOCATION")) return "TASK_LOCATION_UPDATE";
  if (action.includes("NOTE") || action.includes("PHOTO")) return "TASK_NOTE_ADDED";
  if (action.startsWith("TASK_HAS_BEEN_")) return "TASK_STATUS_CHANGED";
  return "TASK_OTHER";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractAction(raw: Record<string, unknown>): string | null {
  const value = raw.action;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractTaskId(raw: Record<string, unknown>): string | null {
  // SuiteFleet camelCase per brief §5. Accept a few common variants
  // for resilience until the wire shape is captured empirically.
  for (const key of ["taskId", "externalTaskId", "task_id"]) {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function extractOccurredAt(raw: Record<string, unknown>): string {
  // Try the common timestamp field names. If none present, fall back
  // to the parser's wall-clock time. The idempotency key is derived
  // from the raw entry, NOT this field, so the fallback doesn't
  // break dedup on retries.
  for (const key of ["occurredAt", "eventTimestamp", "timestamp", "createdAt"]) {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return new Date().toISOString();
}

function generateIdempotencyKey(raw: unknown): string {
  return createHash("sha256").update(JSON.stringify(raw)).digest("hex");
}

export function parseSuiteFleetWebhookEvents(body: unknown): readonly WebhookEvent[] {
  if (!Array.isArray(body)) {
    throw new ValidationError("SuiteFleet webhook payload must be a JSON array");
  }

  const events: WebhookEvent[] = [];

  for (let index = 0; index < body.length; index++) {
    const entry = body[index];

    if (!isRecord(entry)) {
      log.warn({
        operation: "parse",
        error_code: "entry_not_object",
        index,
      });
      continue;
    }

    const action = extractAction(entry);
    if (action === null) {
      log.warn({
        operation: "parse",
        error_code: "missing_action",
        index,
      });
      continue;
    }

    const externalTaskId = extractTaskId(entry);
    if (externalTaskId === null) {
      log.warn({
        operation: "parse",
        error_code: "missing_task_id",
        index,
      });
      continue;
    }

    events.push({
      kind: classifySuiteFleetAction(action),
      externalTaskId,
      occurredAt: extractOccurredAt(entry),
      idempotencyKey: generateIdempotencyKey(entry),
      raw: entry,
    });
  }

  return events;
}

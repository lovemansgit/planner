// Structured JSON logger with PII redaction.
// Spec: plan-resolutions §2.8 (concern C-16 disposition).
// Output: JSON line per event to stdout (debug, info) / stderr (warn, error).
// Vercel's log viewer reads stdout/stderr directly per plan §3.5 stack table.

/**
 * Field names whose values are replaced with "[REDACTED]" anywhere in any
 * logged object, including nested objects and arrays. Source of truth:
 * resolutions §2.8.
 *
 * Matching is performed against a normalised form of the field name —
 * lowercased with `_` and `-` stripped — so `phoneNumber`, `phone_number`,
 * `PhoneNumber`, and `phone-number` all match the same canonical entry.
 * The normalisation makes the list robust to author-side casing
 * inconsistency (SuiteFleet returns snake_case; Supabase Postgres returns
 * snake_case by convention; portal code is camelCase). The §2.8 list
 * stays authoritative as the catalogue of redactable concepts.
 *
 * `username` is added per ADR-007 (commit-5 amendment): SuiteFleet uses
 * username/password JWT auth, so the username is half of an auth
 * credential pair — consistent with §2.8's intent to redact credentials.
 */
export const REDACTED_FIELDS: ReadonlySet<string> = new Set([
  // Personal identifiers
  "phone",
  "phoneNumber",
  "mobile",
  "name",
  "fullName",
  "firstName",
  "lastName",
  "email",
  // Address
  "addressLine1",
  "addressLine2",
  "address_line_1",
  "address_line_2",
  "district",
  "latitude",
  "longitude",
  "lat",
  "lng",
  // Credentials
  "password",
  "secret",
  "clientSecret",
  "client_secret",
  "apiKey",
  "api_key",
  "token",
  "authorization",
  "accessToken",
  "refreshToken",
  "username", // added per ADR-007 — SuiteFleet username/password JWT auth
  // Webhook payloads
  "rawPayload",
  "raw_payload",
  // Internal IDs that map to people
  "deliveryInstructions",
  "delivery_instructions",
]);

/**
 * Identifiers explicitly safe to log. Documented per resolutions §2.8 for
 * code-review and the future CI lint rule that warns on suspicious-looking
 * field names. Not enforced at runtime today.
 */
export const ALLOWED_LOG_FIELDS: readonly string[] = [
  "tenant_id",
  "user_id",
  "role_id",
  "subscription_id",
  "consignee_id",
  "task_id",
  "suitefleet_task_id",
  "suitefleet_awb",
  "idempotency_key",
  "event_id",
  "request_id",
  "status",
  "event_type",
  "error_code",
];

/**
 * Canonicalise a field name for redaction lookup: lowercase, with `_` and
 * `-` stripped. `phoneNumber`, `phone_number`, `PhoneNumber`, and
 * `phone-number` all collapse to `phonenumber`. Internal helper.
 */
function normaliseFieldName(s: string): string {
  return s.toLowerCase().replace(/[_-]/g, "");
}

const REDACTED_NORMALISED: ReadonlySet<string> = new Set(
  Array.from(REDACTED_FIELDS, normaliseFieldName)
);
const REDACTED_VALUE = "[REDACTED]";
const CIRCULAR_VALUE = "[CIRCULAR]";

function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  // Preserve Date so JSON.stringify renders ISO; do not walk into it.
  if (value instanceof Date) return value;
  // Preserve Error shape; "name" is the error class, not a person name.
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (seen.has(value as object)) return CIRCULAR_VALUE;
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_NORMALISED.has(normaliseFieldName(key))
      ? REDACTED_VALUE
      : redact(val, seen);
  }
  return out;
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(context: LogContext, message?: string): void;
  debug(message: string): void;
  info(context: LogContext, message?: string): void;
  info(message: string): void;
  warn(context: LogContext, message?: string): void;
  warn(message: string): void;
  error(context: LogContext, message?: string): void;
  error(message: string): void;
  /** Returns a new logger with the given context merged into every emission. */
  with(context: LogContext): Logger;
}

function emit(
  level: LogLevel,
  baseContext: LogContext,
  contextOrMessage: LogContext | string,
  message?: string
): void {
  const isStringFirst = typeof contextOrMessage === "string";
  const callContext: LogContext = isStringFirst ? {} : contextOrMessage;
  const finalMessage = isStringFirst ? contextOrMessage : message;
  const merged = { ...baseContext, ...callContext };
  const record: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    ...(finalMessage !== undefined ? { message: finalMessage } : {}),
    ...(redact(merged) as Record<string, unknown>),
  };
  const line = JSON.stringify(record);
  // The logger is the canonical console boundary; other modules log through this.
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

function makeLogger(baseContext: LogContext): Logger {
  function makeFn(level: LogLevel) {
    function fn(context: LogContext, message?: string): void;
    function fn(message: string): void;
    function fn(arg1: LogContext | string, arg2?: string): void {
      emit(level, baseContext, arg1, arg2);
    }
    return fn;
  }
  return {
    debug: makeFn("debug"),
    info: makeFn("info"),
    warn: makeFn("warn"),
    error: makeFn("error"),
    with: (ctx) => makeLogger({ ...baseContext, ...ctx }),
  };
}

/**
 * The default logger. Use `logger.with({ request_id, tenant_id })` to get
 * a request-scoped child logger that automatically includes those
 * identifiers on every emission.
 */
export const logger: Logger = makeLogger({});

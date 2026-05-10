// PII strip helper — Day 21 / Phase 1 / CONCERN B (outbound DLQ).
//
// Per `memory/plans/day-19-phase-1-merchant-crud.md` §3.6 CONCERN B
// + the 0023 migration header: PII is stripped at write time, not
// RLS-gated at read time. Schema-level redaction means that even a
// future read-side bug (RLS misconfigured, /admin route bypassing
// scope, support engineer running a raw SELECT) cannot expose the
// PII because it never landed on disk.
//
// SuiteFleet's outbound PATCH responses echo the full task entity on
// 4xx and on 200. The entity carries:
//   consignee.name / .contactPhone / .location.contactPhone
//   consignee.location.addressLine1 / .addressLine2 / .addressLine3
//   consignee.location.district / .city / .stateProvince / .zip
//   consignee.location.geofence.tags  (SF stuffs free-text neighbourhood
//                                      labels here — sometimes carries
//                                      consignee identifiers)
//   shipFrom.* (warehouse location — less sensitive, but stripped for
//               consistency; merchant address is public per BRD §3.1.1)
//   deliveryInformation.recipientName / .signature / .photos
//   deliveryInformation.consigneeComment / .driverComment
//   notes (free-text from operator; may contain PII; redact)
//   trackingUrl (often carries a token; redact for cosmetic safety)
//   locateConsigneeUrl (token-bearing URL)
//
// Strategy: two-tier predicate.
//   - PII_SUBTREE_KEYS: replace the WHOLE subtree value with a sentinel
//     string. Used for `consignee`, `deliveryInformation`, `shipFrom`.
//     Cleaner than walking every nested field.
//   - PII_LEAF_KEYS: redact the leaf value (string → "[redacted]";
//     other types → "[redacted-non-string]"). Used at the top level
//     and inside non-PII subtrees that may still carry PII keys.
//
// Non-PII keys preserved verbatim: `id`, `awb`, `customerOrderNumber`,
// `status`, `deliveryDate`, `deliveryStartTime`, `deliveryEndTime`,
// `customerId`, `creationSource`, `taskItems`, `shipmentPackages`,
// `bulkUpdateSource`, `tasksExecutedCount`, `expectedTasksCount`,
// timestamps, etc. — operationally useful for triage with no PII risk.
//
// Recursion depth cap: 32. Pathological inputs (cyclic objects already
// handled by JSON.stringify rejection upstream) cap out cleanly.

const PII_SUBTREE_KEYS = new Set<string>([
  "consignee",
  "deliveryInformation",
  "shipFrom",
]);

const PII_LEAF_KEYS = new Set<string>([
  // Identity / contact
  "name",
  "recipientName",
  "contactPhone",
  "contactFax",
  "contactEmail",
  "phone",
  "phoneNumber",
  "email",
  // Address (top-level fields outside the subtree replace)
  "address",
  "addressLine1",
  "addressLine2",
  "addressLine3",
  "addressCode",
  "district",
  "city",
  "stateProvince",
  "state",
  "zip",
  "latitude",
  "longitude",
  "geofence",
  // Free-text / signature / photos
  "notes",
  "details",
  "dispatcherNotes",
  "consigneeComment",
  "driverComment",
  "customerComment",
  "signature",
  "photos",
  "pickupPhotos",
  "tags",
  // Token-bearing URLs
  "trackingUrl",
  "locateConsigneeUrl",
]);

const SUBTREE_SENTINEL = "[redacted-pii-subtree]";
const LEAF_SENTINEL = "[redacted]";
const NON_STRING_LEAF_SENTINEL = "[redacted-non-string]";
const MAX_DEPTH_SENTINEL = "[max-depth]";
const MAX_DEPTH = 32;

/**
 * Strip PII from a parsed JSON value. Returns a new value (object /
 * array / primitive) — does NOT mutate the input.
 *
 * Behaviour:
 *   - Primitives (string, number, boolean, null, undefined): unchanged.
 *   - Arrays: each element recursed.
 *   - Objects: each (key, value) pair routed:
 *       key in PII_SUBTREE_KEYS → value replaced with SUBTREE_SENTINEL.
 *       key in PII_LEAF_KEYS    → value replaced with LEAF_SENTINEL
 *                                 (or NON_STRING_LEAF_SENTINEL).
 *       otherwise               → recurse into value.
 *   - Depth > MAX_DEPTH: return MAX_DEPTH_SENTINEL.
 *
 * Invariant: for any input `v` and any path of keys reaching a node
 * `n` whose key is in PII_SUBTREE_KEYS or PII_LEAF_KEYS, the
 * corresponding output node's value is sentinel-redacted.
 */
export function stripPii(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return MAX_DEPTH_SENTINEL;
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => stripPii(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (PII_SUBTREE_KEYS.has(k)) {
      out[k] = SUBTREE_SENTINEL;
      continue;
    }
    if (PII_LEAF_KEYS.has(k)) {
      out[k] = typeof v === "string" ? LEAF_SENTINEL : NON_STRING_LEAF_SENTINEL;
      continue;
    }
    out[k] = stripPii(v, depth + 1);
  }
  return out;
}

/**
 * Strip PII from a payload object, returning a Record<string, unknown>
 * shape suitable for the failure_payload jsonb column. If the input is
 * an array at the top level, wraps it in `{ items: [...] }` (the SF
 * webhook payload top-level can be an array; repo column is jsonb but
 * we standardise on an object root for consistency with failed_pushes).
 *
 * Returns `null` when the input is null / undefined / non-object —
 * those don't need stripping; the caller writes null to failure_payload.
 */
export function stripPiiObject(
  value: unknown,
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return null;
  if (Array.isArray(value)) {
    return { items: stripPii(value) as unknown[] };
  }
  return stripPii(value) as Record<string, unknown>;
}

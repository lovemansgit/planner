// SuiteFleet webhook parser — Day 4 / S-5 unit tests.
//
// Pure function; no mocks needed. Covers: array validation, field
// extraction, action classification, idempotency-key determinism +
// uniqueness, malformed-entry resilience, raw-payload preservation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "../../../../../shared/errors";

import { parseSuiteFleetWebhookEvents } from "../webhook-parser";

function withConsoleSilenced<T>(fn: () => T): T {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return fn();
  } finally {
    vi.restoreAllMocks();
  }
}

const VALID_ENTRY = {
  action: "TASK_HAS_BEEN_DELIVERED",
  taskId: "sf-task-12345",
  occurredAt: "2026-04-29T10:30:00.000Z",
};

describe("parseSuiteFleetWebhookEvents — array validation", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns an empty array for an empty input array", () => {
    expect(parseSuiteFleetWebhookEvents([])).toEqual([]);
  });

  it("throws ValidationError when input is not an array (object)", () => {
    expect(() => parseSuiteFleetWebhookEvents(VALID_ENTRY)).toThrow(ValidationError);
  });

  it("throws ValidationError when input is null", () => {
    expect(() => parseSuiteFleetWebhookEvents(null)).toThrow(ValidationError);
  });

  it("throws ValidationError when input is a string", () => {
    expect(() => parseSuiteFleetWebhookEvents('"not-an-array"')).toThrow(ValidationError);
  });

  it("throws ValidationError when input is a number", () => {
    expect(() => parseSuiteFleetWebhookEvents(42)).toThrow(ValidationError);
  });
});

describe("parseSuiteFleetWebhookEvents — happy path", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("parses a single valid entry into a one-element WebhookEvent array", () => {
    const result = parseSuiteFleetWebhookEvents([VALID_ENTRY]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "TASK_STATUS_CHANGED",
      externalTaskId: "sf-task-12345",
      occurredAt: "2026-04-29T10:30:00.000Z",
    });
    expect(result[0].idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(result[0].raw).toEqual(VALID_ENTRY);
  });

  it("parses a batched array of entries, preserving order", () => {
    const result = parseSuiteFleetWebhookEvents([
      { ...VALID_ENTRY, taskId: "task-a" },
      { ...VALID_ENTRY, taskId: "task-b" },
      { ...VALID_ENTRY, taskId: "task-c" },
    ]);
    expect(result.map((e) => e.externalTaskId)).toEqual(["task-a", "task-b", "task-c"]);
  });

  it("leaves internalStatus undefined (S-6 fills it in)", () => {
    const result = parseSuiteFleetWebhookEvents([VALID_ENTRY]);
    expect(result[0].internalStatus).toBeUndefined();
  });

  it("preserves the raw entry verbatim including unknown fields", () => {
    const entry = { ...VALID_ENTRY, customField: { nested: "preserved" } };
    const result = parseSuiteFleetWebhookEvents([entry]);
    expect(result[0].raw).toEqual(entry);
  });

  it("coerces a numeric taskId to a string", () => {
    const result = parseSuiteFleetWebhookEvents([{ ...VALID_ENTRY, taskId: 588 }]);
    expect(result[0].externalTaskId).toBe("588");
  });
});

describe("parseSuiteFleetWebhookEvents — action classification", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("classifies TASK_HAS_BEEN_ASSIGNED as TASK_ASSIGNMENT_CHANGED (verified)", () => {
    const result = parseSuiteFleetWebhookEvents([
      { ...VALID_ENTRY, action: "TASK_HAS_BEEN_ASSIGNED" },
    ]);
    expect(result[0].kind).toBe("TASK_ASSIGNMENT_CHANGED");
  });

  it("classifies TASK_HAS_BEEN_DELIVERED as TASK_STATUS_CHANGED (heuristic)", () => {
    const result = parseSuiteFleetWebhookEvents([
      { ...VALID_ENTRY, action: "TASK_HAS_BEEN_DELIVERED" },
    ]);
    expect(result[0].kind).toBe("TASK_STATUS_CHANGED");
  });

  it("classifies actions containing LOCATION as TASK_LOCATION_UPDATE", () => {
    const result = parseSuiteFleetWebhookEvents([
      { ...VALID_ENTRY, action: "DRIVER_LOCATION_UPDATED" },
    ]);
    expect(result[0].kind).toBe("TASK_LOCATION_UPDATE");
  });

  it("classifies actions containing NOTE as TASK_NOTE_ADDED", () => {
    const result = parseSuiteFleetWebhookEvents([
      { ...VALID_ENTRY, action: "TASK_NOTE_ADDED" },
    ]);
    expect(result[0].kind).toBe("TASK_NOTE_ADDED");
  });

  it("classifies unknown action vocabulary as TASK_OTHER", () => {
    const result = parseSuiteFleetWebhookEvents([
      { ...VALID_ENTRY, action: "SOMETHING_NEW_FROM_SUITEFLEET" },
    ]);
    expect(result[0].kind).toBe("TASK_OTHER");
  });
});

describe("parseSuiteFleetWebhookEvents — idempotency key", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("generates the same key for identical payloads (retry safety)", () => {
    const a = parseSuiteFleetWebhookEvents([VALID_ENTRY]);
    const b = parseSuiteFleetWebhookEvents([VALID_ENTRY]);
    expect(a[0].idempotencyKey).toBe(b[0].idempotencyKey);
  });

  it("generates different keys for different payloads", () => {
    const result = parseSuiteFleetWebhookEvents([
      VALID_ENTRY,
      { ...VALID_ENTRY, taskId: "different-task" },
    ]);
    expect(result[0].idempotencyKey).not.toBe(result[1].idempotencyKey);
  });

  it("generates different keys when the action differs but other fields match", () => {
    const result = parseSuiteFleetWebhookEvents([
      VALID_ENTRY,
      { ...VALID_ENTRY, action: "TASK_HAS_BEEN_FAILED" },
    ]);
    expect(result[0].idempotencyKey).not.toBe(result[1].idempotencyKey);
  });

  it("generates a SHA-256 hex string (64 lowercase hex chars)", () => {
    const result = parseSuiteFleetWebhookEvents([VALID_ENTRY]);
    expect(result[0].idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("parseSuiteFleetWebhookEvents — malformed entries", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("skips entries that aren't objects (null)", () => {
    const result = parseSuiteFleetWebhookEvents([null, VALID_ENTRY]);
    expect(result).toHaveLength(1);
    expect(result[0].externalTaskId).toBe(VALID_ENTRY.taskId);
  });

  it("skips entries that aren't objects (string)", () => {
    const result = parseSuiteFleetWebhookEvents(["not-an-object", VALID_ENTRY]);
    expect(result).toHaveLength(1);
  });

  it("skips entries missing the action field", () => {
    const result = parseSuiteFleetWebhookEvents([
      { taskId: "x", occurredAt: "2026-04-29T00:00:00Z" },
      VALID_ENTRY,
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].externalTaskId).toBe(VALID_ENTRY.taskId);
  });

  it("skips entries with empty-string action", () => {
    const result = parseSuiteFleetWebhookEvents([
      { ...VALID_ENTRY, action: "" },
      VALID_ENTRY,
    ]);
    expect(result).toHaveLength(1);
  });

  it("skips entries missing the taskId field", () => {
    const result = parseSuiteFleetWebhookEvents([
      { action: "TASK_HAS_BEEN_DELIVERED" },
      VALID_ENTRY,
    ]);
    expect(result).toHaveLength(1);
  });

  it("does not throw when every entry is malformed (returns empty array)", () => {
    const result = parseSuiteFleetWebhookEvents([null, "string", { foo: "bar" }]);
    expect(result).toEqual([]);
  });
});

describe("parseSuiteFleetWebhookEvents — timestamp extraction", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("uses occurredAt when present", () => {
    const result = parseSuiteFleetWebhookEvents([VALID_ENTRY]);
    expect(result[0].occurredAt).toBe(VALID_ENTRY.occurredAt);
  });

  it("falls back to eventTimestamp when occurredAt is absent", () => {
    const entry = {
      action: VALID_ENTRY.action,
      taskId: VALID_ENTRY.taskId,
      eventTimestamp: "2026-04-29T11:00:00Z",
    };
    const result = parseSuiteFleetWebhookEvents([entry]);
    expect(result[0].occurredAt).toBe("2026-04-29T11:00:00Z");
  });

  it("falls back to wall-clock when no timestamp field is present", () => {
    const entry = { action: VALID_ENTRY.action, taskId: VALID_ENTRY.taskId };
    const before = Date.now();
    const result = parseSuiteFleetWebhookEvents([entry]);
    const after = Date.now();
    const parsedMs = Date.parse(result[0].occurredAt);
    expect(parsedMs).toBeGreaterThanOrEqual(before);
    expect(parsedMs).toBeLessThanOrEqual(after);
  });

  it("preserves idempotency key independence from timestamp fallback", () => {
    // Same entry parsed twice (no occurredAt → fallback to wall clock).
    // Since the idempotency key derives from the raw payload and not
    // from the occurredAt fallback, the keys must match.
    const entry = { action: VALID_ENTRY.action, taskId: VALID_ENTRY.taskId };
    const a = parseSuiteFleetWebhookEvents([entry]);
    const b = parseSuiteFleetWebhookEvents([entry]);
    expect(a[0].idempotencyKey).toBe(b[0].idempotencyKey);
  });
});

describe("parseSuiteFleetWebhookEvents — return shape", () => {
  it("returns a readonly-typed array (compile-time guarantee, runtime mutable)", () => {
    withConsoleSilenced(() => {
      const result = parseSuiteFleetWebhookEvents([VALID_ENTRY]);
      // The TypeScript signature is `readonly WebhookEvent[]`; the
      // runtime array is mutable, but consumers shouldn't mutate it.
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

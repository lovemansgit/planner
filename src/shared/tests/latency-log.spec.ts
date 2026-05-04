// Day 12 — gate verification for the transient latency instrumentation.
// The flag-off behavior is the production-ship safety guarantee.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isLatencyLogEnabled, logLatency, measure } from "../latency-log";

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.ENABLE_LATENCY_LOGS;
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
  vi.restoreAllMocks();
});

describe("isLatencyLogEnabled", () => {
  it("returns false when ENABLE_LATENCY_LOGS is unset", () => {
    expect(isLatencyLogEnabled()).toBe(false);
  });

  it("returns true only on the literal '1' value", () => {
    process.env.ENABLE_LATENCY_LOGS = "1";
    expect(isLatencyLogEnabled()).toBe(true);
  });

  it("returns false on truthy-but-not-1 values", () => {
    process.env.ENABLE_LATENCY_LOGS = "true";
    expect(isLatencyLogEnabled()).toBe(false);
    process.env.ENABLE_LATENCY_LOGS = "yes";
    expect(isLatencyLogEnabled()).toBe(false);
    process.env.ENABLE_LATENCY_LOGS = "0";
    expect(isLatencyLogEnabled()).toBe(false);
  });
});

describe("logLatency", () => {
  it("does NOT call console.log when the flag is off", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logLatency("test", 42);
    expect(spy).not.toHaveBeenCalled();
  });

  it("emits a single line with the [TASKS-LATENCY] prefix when enabled", () => {
    process.env.ENABLE_LATENCY_LOGS = "1";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logLatency("test", 42.345);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe("[TASKS-LATENCY] test=42.3ms");
  });

  it("appends extra payload as JSON", () => {
    process.env.ENABLE_LATENCY_LOGS = "1";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logLatency("test", 10, { tenant: "MPL" });
    expect(spy.mock.calls[0][0]).toBe('[TASKS-LATENCY] test=10.0ms {"tenant":"MPL"}');
  });
});

describe("measure", () => {
  it("returns the inner function's result and bypasses logging when flag is off", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await measure("noop", async () => 42);
    expect(result).toBe(42);
    expect(spy).not.toHaveBeenCalled();
  });

  it("logs duration when flag is on", async () => {
    process.env.ENABLE_LATENCY_LOGS = "1";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await measure("op", async () => "ok");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/^\[TASKS-LATENCY\] op=\d+\.\dms$/);
  });

  it("propagates errors and tags the timing line with error metadata", async () => {
    process.env.ENABLE_LATENCY_LOGS = "1";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      measure("op", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/error.*boom/);
  });
});

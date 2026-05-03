// Unit tests for the Sentry safe-capture wrapper.
//
// Three properties under test:
//   1. Calls Sentry.captureException with the right shape (extra is
//      attached only when context is supplied — passing `undefined` to
//      Sentry's options arg is the documented way to omit).
//   2. Swallows internal Sentry throws — must NEVER propagate.
//   3. Uses the structured logger as the fallback when Sentry throws,
//      so the original error metadata is at least preserved in stdout.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("../logger", () => {
  const childLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    logger: {
      ...childLogger,
      with: () => childLogger,
    },
  };
});

import * as Sentry from "@sentry/nextjs";

import { captureException } from "../sentry-capture";

const mockSentryCapture = vi.mocked(Sentry.captureException);

describe("captureException — safe Sentry wrapper", () => {
  beforeEach(() => {
    mockSentryCapture.mockReset();
  });

  afterEach(() => {
    mockSentryCapture.mockReset();
  });

  it("calls Sentry.captureException with no extras when context is omitted", () => {
    const err = new Error("boom");
    captureException(err);
    expect(mockSentryCapture).toHaveBeenCalledTimes(1);
    expect(mockSentryCapture).toHaveBeenCalledWith(err, undefined);
  });

  it("attaches context as extras when context is supplied", () => {
    const err = new Error("with context");
    captureException(err, { tenant_id: "t-1", run_id: "r-1" });
    expect(mockSentryCapture).toHaveBeenCalledTimes(1);
    expect(mockSentryCapture).toHaveBeenCalledWith(err, {
      extra: { tenant_id: "t-1", run_id: "r-1" },
    });
  });

  it("does not throw when Sentry.captureException throws", () => {
    mockSentryCapture.mockImplementationOnce(() => {
      throw new Error("transport down");
    });
    expect(() => captureException(new Error("original"))).not.toThrow();
  });

  it("does not throw when Sentry.captureException throws with context", () => {
    mockSentryCapture.mockImplementationOnce(() => {
      throw new Error("transport down");
    });
    expect(() =>
      captureException(new Error("original"), { component: "test" }),
    ).not.toThrow();
  });

  it("forwards a non-Error original (string, object) without coercion", () => {
    captureException("string-error");
    expect(mockSentryCapture).toHaveBeenCalledWith("string-error", undefined);
  });
});

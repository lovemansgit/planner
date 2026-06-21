// src/modules/task-materialization/tests/one-off.spec.ts
//
// D56 / Phase-5 move-to-date rework — unit coverage for the
// `materializeSubscriptionOneOffDate` return-value contract.
//
// This primitive materializes EXACTLY ONE task at a single literal date for
// one subscription with NO end_date cap (so a move-to-date target BEYOND the
// schedule end can be created — the capped range materializer cannot do this).
// The real SQL semantics (single-date insert, no generate_series, insert
// beyond end_date) are proven against a live Postgres in
// tests/integration/task-materialization-one-off.spec.ts. Here we pin the
// observable contract: how the two query results map to the returned
// { insertedTaskId, addressResolutionFailed } shape the caller branches on.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The real @/shared/db reads SUPABASE_APP_DATABASE_URL at import time. We pass
// a fake tx into the function, so stub the module to avoid the env requirement.
vi.mock("@/shared/db", () => ({ withServiceRole: vi.fn() }));

// Keep test output pristine — the quarantine path logs a warn + Sentry-captures.
vi.mock("@/shared/logger", () => {
  const stub: Record<string, unknown> = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };
  stub.with = () => stub;
  return { logger: stub };
});
vi.mock("@/shared/sentry-capture", () => ({ captureException: vi.fn() }));

import { materializeSubscriptionOneOffDate } from "../service";
import type { Uuid } from "@/shared/types";

const SUBSCRIPTION_ID = "00000000-0000-0000-0000-000000000bbb" as Uuid;
const CONSIGNEE_ID = "00000000-0000-0000-0000-000000000c0c" as Uuid;
const TASK_ID = "00000000-0000-0000-0000-00000000aaaa" as Uuid;
const REQUEST_ID = "req-oneoff";
const TARGET = "2026-07-06"; // Monday, beyond a typical schedule end

/** Build a fake tx whose `execute` returns the INSERT rows first, then the
 * quarantine (NULL-address) rows — the call order the function issues. */
function txWith(insertRows: unknown, quarantineRows: unknown) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce(insertRows)
    .mockResolvedValueOnce(quarantineRows);
  return { tx: { execute } as never, execute };
}

describe("materializeSubscriptionOneOffDate", () => {
  it("inserts one task at the target date and returns its id when the address resolves", async () => {
    const { tx } = txWith([{ id: TASK_ID }], []);

    const result = await materializeSubscriptionOneOffDate(tx, {
      subscriptionId: SUBSCRIPTION_ID,
      date: TARGET,
      requestId: REQUEST_ID,
    });

    expect(result).toEqual({ insertedTaskId: TASK_ID, addressResolutionFailed: false });
  });

  it("reports addressResolutionFailed (and no insert) when the date resolves no address", async () => {
    const { tx } = txWith(
      [],
      [{ subscription_id: SUBSCRIPTION_ID, consignee_id: CONSIGNEE_ID, delivery_date: TARGET }],
    );

    const result = await materializeSubscriptionOneOffDate(tx, {
      subscriptionId: SUBSCRIPTION_ID,
      date: TARGET,
      requestId: REQUEST_ID,
    });

    expect(result).toEqual({ insertedTaskId: null, addressResolutionFailed: true });
  });

  it("returns null id without failure when the date is an idempotent conflict (already materialized)", async () => {
    const { tx } = txWith([], []);

    const result = await materializeSubscriptionOneOffDate(tx, {
      subscriptionId: SUBSCRIPTION_ID,
      date: TARGET,
      requestId: REQUEST_ID,
    });

    expect(result).toEqual({ insertedTaskId: null, addressResolutionFailed: false });
  });
});

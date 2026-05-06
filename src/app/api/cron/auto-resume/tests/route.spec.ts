// Unit tests for /api/cron/auto-resume — Day-16 Block 4-C, Service B
// Option A scheduler.
//
// Pins:
//   - CRON_SECRET auth gate
//   - Selection SQL pattern (type='pause_window' AND end_date elapsed
//     AND NOT EXISTS resume audit)
//   - Per-row system-actor context construction (cron:auto_resume)
//   - Per-row resumeSubscription invocation with is_auto_resume=true
//   - Outcome aggregation (resumed / already_active / error)
//   - Handler-exit summary shape

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockExecute = vi.fn();
const mockResumeSubscription = vi.fn();

vi.mock("@/shared/db", () => ({
  withServiceRole: vi.fn(async (_reason: string, fn: (tx: unknown) => Promise<unknown>) => {
    return await fn({ execute: mockExecute });
  }),
  withTenant: vi.fn(),
}));

vi.mock("@/modules/subscriptions", () => ({
  resumeSubscription: vi.fn((ctx: unknown, id: unknown, input: unknown, options: unknown) =>
    mockResumeSubscription(ctx, id, input, options),
  ),
}));

vi.mock("@/shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/shared/logger", () => {
  // Chainable logger: every .with(...) returns the same chainable
  // object so route-level + handler-level .with() calls all work.
  const chain = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    with: vi.fn(),
  };
  chain.with.mockReturnValue(chain);
  return { logger: chain };
});

import { GET } from "../route";

const CRON_SECRET = "test-cron-secret-value";

const TENANT_A = "00000000-0000-0000-0000-000000000aaa";
const TENANT_B = "00000000-0000-0000-0000-000000000bbb";
const SUB_A = "11111111-1111-1111-1111-11111111aaaa";
const SUB_B = "11111111-1111-1111-1111-11111111bbbb";
const CORR_A = "22222222-2222-2222-2222-22222222aaaa";
const CORR_B = "22222222-2222-2222-2222-22222222bbbb";

function authedRequest(): Request {
  return new Request("http://localhost/api/cron/auto-resume", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

function dueRow(
  overrides: Partial<{
    id: string;
    subscription_id: string;
    tenant_id: string;
    correlation_id: string;
    end_date: string;
  }> = {},
) {
  return {
    id: overrides.id ?? "ex-1",
    subscription_id: overrides.subscription_id ?? SUB_A,
    tenant_id: overrides.tenant_id ?? TENANT_A,
    correlation_id: overrides.correlation_id ?? CORR_A,
    start_date: "2026-05-01",
    end_date: overrides.end_date ?? "2026-05-15",
  };
}

beforeEach(() => {
  mockExecute.mockReset();
  mockResumeSubscription.mockReset();
  process.env.CRON_SECRET = CRON_SECRET;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
});

describe("/api/cron/auto-resume — auth gate", () => {
  it("returns 500 when CRON_SECRET env var is unset", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(authedRequest());
    expect(response.status).toBe(500);
  });

  it("returns 401 when authorization header is missing", async () => {
    const req = new Request("http://localhost/api/cron/auto-resume");
    const response = await GET(req);
    expect(response.status).toBe(401);
  });

  it("returns 401 when authorization header has wrong secret", async () => {
    const req = new Request("http://localhost/api/cron/auto-resume", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    const response = await GET(req);
    expect(response.status).toBe(401);
  });
});

describe("/api/cron/auto-resume — happy path", () => {
  it("returns 200 with zero counts when no pause windows are due", async () => {
    mockExecute.mockResolvedValueOnce([]); // SELECT due rows → none

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total_due).toBe(0);
    expect(body.resumed_count).toBe(0);
    expect(body.already_active_count).toBe(0);
    expect(body.error_count).toBe(0);
    expect(mockResumeSubscription).not.toHaveBeenCalled();
  });

  it("processes one due row → calls resumeSubscription with is_auto_resume=true + correct system actor", async () => {
    mockExecute.mockResolvedValueOnce([dueRow()]);
    mockResumeSubscription.mockResolvedValueOnce({
      status: "resumed",
      correlation_id: CORR_A,
      actual_resume_date: "2026-05-15",
      new_end_date: "2026-05-29",
      restored_task_count: 0,
      http_status: 200,
    });

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total_due).toBe(1);
    expect(body.resumed_count).toBe(1);
    expect(body.already_active_count).toBe(0);
    expect(body.error_count).toBe(0);

    expect(mockResumeSubscription).toHaveBeenCalledOnce();
    const [ctx, id, input, options] = mockResumeSubscription.mock.calls[0];
    // Per-row context built with system actor.
    expect((ctx as { actor: { kind: string; system: string } }).actor.kind).toBe("system");
    expect((ctx as { actor: { kind: string; system: string } }).actor.system).toBe(
      "cron:auto_resume",
    );
    expect((ctx as { tenantId: string }).tenantId).toBe(TENANT_A);
    expect(id).toBe(SUB_A);
    // Idempotency_key derived deterministically from correlation_id.
    expect((input as { idempotency_key: string }).idempotency_key).toBe(CORR_A);
    expect((options as { is_auto_resume: boolean }).is_auto_resume).toBe(true);
  });

  it("processes multiple due rows across tenants", async () => {
    mockExecute.mockResolvedValueOnce([
      dueRow({ id: "ex-1", subscription_id: SUB_A, tenant_id: TENANT_A, correlation_id: CORR_A }),
      dueRow({ id: "ex-2", subscription_id: SUB_B, tenant_id: TENANT_B, correlation_id: CORR_B }),
    ]);
    mockResumeSubscription.mockResolvedValue({
      status: "resumed",
      correlation_id: CORR_A,
      actual_resume_date: "2026-05-15",
      new_end_date: "2026-05-29",
      restored_task_count: 0,
      http_status: 200,
    });

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total_due).toBe(2);
    expect(body.resumed_count).toBe(2);
    expect(mockResumeSubscription).toHaveBeenCalledTimes(2);

    const tenants = mockResumeSubscription.mock.calls.map(
      (c) => (c[0] as { tenantId: string }).tenantId,
    );
    expect(tenants).toContain(TENANT_A);
    expect(tenants).toContain(TENANT_B);
  });

  it("aggregates already_active outcomes (idempotent across overlapping ticks)", async () => {
    mockExecute.mockResolvedValueOnce([dueRow()]);
    mockResumeSubscription.mockResolvedValueOnce({
      status: "already_active",
      correlation_id: null,
      actual_resume_date: null,
      new_end_date: null,
      restored_task_count: 0,
      http_status: 200,
    });

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resumed_count).toBe(0);
    expect(body.already_active_count).toBe(1);
    expect(body.error_count).toBe(0);
  });
});

describe("/api/cron/auto-resume — error handling", () => {
  it("returns 500 with error_count when a row's resumeSubscription throws", async () => {
    mockExecute.mockResolvedValueOnce([dueRow()]);
    mockResumeSubscription.mockRejectedValueOnce(new Error("simulated DB error"));

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.total_due).toBe(1);
    expect(body.resumed_count).toBe(0);
    expect(body.error_count).toBe(1);
    expect(body.outcomes[0].outcome).toBe("error");
    expect(body.outcomes[0].error).toContain("simulated DB error");
  });

  it("continues processing other rows when one row throws (no early-exit on first error)", async () => {
    mockExecute.mockResolvedValueOnce([
      dueRow({ id: "ex-1", subscription_id: SUB_A, tenant_id: TENANT_A, correlation_id: CORR_A }),
      dueRow({ id: "ex-2", subscription_id: SUB_B, tenant_id: TENANT_B, correlation_id: CORR_B }),
    ]);
    mockResumeSubscription.mockRejectedValueOnce(new Error("first row threw"));
    mockResumeSubscription.mockResolvedValueOnce({
      status: "resumed",
      correlation_id: CORR_B,
      actual_resume_date: "2026-05-15",
      new_end_date: "2026-05-29",
      restored_task_count: 0,
      http_status: 200,
    });

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error_count).toBe(1);
    expect(body.resumed_count).toBe(1);
    expect(mockResumeSubscription).toHaveBeenCalledTimes(2);
  });
});

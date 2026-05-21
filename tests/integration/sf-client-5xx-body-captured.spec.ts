// tests/integration/sf-client-5xx-body-captured.spec.ts
// =============================================================================
// Plan #317 §3.1 + §7.1 / F-1 spec at SHA f0ef560.
//
// Pre-fix behavior (the bug we're closing): the SuiteFleet client methods at
// task-client.ts (createTask, getTaskByAwb, updateTask, cancelTask,
// bulkCancelTasks), asset-tracking-client.ts (fetchByAwb), and auth-client.ts
// (login/refresh) discarded the response body on every 5xx branch — only the
// status code reached the thrown CredentialError. Downstream
// failure_detail (recordFailedPushAttempt → failed_pushes.failure_detail)
// was therefore opaque ("returned 502 — single-attempt policy, no retry"
// with NO upstream context). Diagnosing AWB-blank tasks took 30+ minutes
// of grepping logs that didn't carry the SF error envelope.
//
// Post-fix: each 5xx branch reads `response.text()` once before throwing
// and threads the body excerpt into the CredentialError message. The
// service-layer classifier (task-push/service.ts classifyAdapterError)
// passes that message through into failure_detail.
//
// This spec is a unit-shape test placed in tests/integration/ per plan §7
// filename convention. It does not touch the database; it pins client-layer
// behavior against a stub fetch.
//
// Cases: one per client method touched (createTask + 4 task-client siblings +
// 1 asset-tracking + auth-client login retry-exhaustion path) — 7 cases
// total per plan §7.1 "6-8 cases minimum". All pin "500 or 502 response
// body excerpt reaches the thrown error message" — the bug-fix's load-
// bearing claim.
//
// The auth-client case exercises the retry-exhaustion path (callWithRetry
// loop with 4 attempts all 5xx) — uses retryDelaysMs: [0, 0, 0] to avoid
// real sleep in the test.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Import the client factories from their leaf files (not the barrel
// `@/modules/integration` index) — the barrel transitively pulls in
// modules that require DB env vars at load time, which is wrong for
// a DB-free spec.
import { createSuiteFleetTaskClient } from "../../src/modules/integration/providers/suitefleet/task-client";
import { createSuiteFleetAssetTrackingClient } from "../../src/modules/integration/providers/suitefleet/asset-tracking-client";
import { createSuiteFleetAuthClient } from "../../src/modules/integration/providers/suitefleet/auth-client";
import { CredentialError } from "../../src/shared/errors";
import type { AuthenticatedSession } from "../../src/modules/integration/types";
import type { Uuid } from "../../src/shared/types";

const TENANT_ID = "11111111-2222-3333-4444-555555555555" as Uuid;

const STUB_SESSION: AuthenticatedSession = {
  tenantId: TENANT_ID,
  token: "stub-access-token",
  renewalToken: "stub-renewal-token",
  tokenExpiresAt: "2026-12-31T23:59:59.000Z",
  renewalTokenExpiresAt: "2026-12-31T23:59:59.000Z",
};

function fixedClock(): Date {
  return new Date("2026-05-21T12:00:00.000Z");
}

/**
 * Build a stub `fetch` that returns a 5xx Response carrying the given
 * body. Used by all task-client + asset-tracking-client cases — those
 * paths are single-attempt so one stub-fetch resolution is enough.
 */
function stubFetch5xx(status: number, body: string): typeof globalThis.fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
}

describe("Plan #317 / F-1 — SuiteFleet client 5xx response body is read and threaded into CredentialError", () => {
  it("task-client createTask 502 — body excerpt reaches err.message", async () => {
    const sfBody = '{"error":"createTask underlying upstream message"}';
    const client = createSuiteFleetTaskClient({
      fetch: stubFetch5xx(502, sfBody),
      clientId: "client-stub",
      clock: fixedClock,
    });

    await expect(
      client.createTask({
        session: STUB_SESSION,
        customerId: 1,
        request: {
          tenantId: TENANT_ID,
          customerOrderNumber: "ORDER-F1-CREATE",
          referenceNumber: undefined,
          kind: "DELIVERY",
          consignee: {
            name: "F-1 consignee",
            contactPhone: "+971500000001",
            address: {
              addressLine1: "Stub address",
              city: "Dubai",
              district: "Al Quoz",
              countryCode: "AE",
            },
          },
          window: {
            date: "2026-06-01",
            startTime: "09:00:00",
            endTime: "11:00:00",
          },
          paymentMethod: "PrePaid",
          codAmount: 0,
          declaredValue: 0,
          weightKg: 0,
          itemQuantity: 1,
          signatureRequired: false,
          smsNotifications: false,
          deliverToCustomerOnly: false,
        } as unknown as Parameters<typeof client.createTask>[0]["request"],
      }),
    ).rejects.toMatchObject({
      // CredentialError extends Error; the body excerpt must be in the message.
      message: expect.stringContaining("createTask underlying upstream message"),
    });
  });

  it("task-client getTaskByAwb 500 — body excerpt reaches err.message", async () => {
    const sfBody = "Internal server error from getTaskByAwb upstream";
    const client = createSuiteFleetTaskClient({
      fetch: stubFetch5xx(500, sfBody),
      clientId: "client-stub",
      clock: fixedClock,
    });

    await expect(
      client.getTaskByAwb({
        session: STUB_SESSION,
        customerId: 1,
        awb: "AWB-F1-LOOKUP",
      }),
    ).rejects.toBeInstanceOf(CredentialError);
    await expect(
      client.getTaskByAwb({
        session: STUB_SESSION,
        customerId: 1,
        awb: "AWB-F1-LOOKUP",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "Internal server error from getTaskByAwb upstream",
      ),
    });
  });

  it("task-client updateTask 503 — body excerpt reaches err.message", async () => {
    const sfBody = '{"error":"updateTask upstream unavailable"}';
    const client = createSuiteFleetTaskClient({
      fetch: stubFetch5xx(503, sfBody),
      clientId: "client-stub",
      clock: fixedClock,
    });

    await expect(
      client.updateTask({
        session: STUB_SESSION,
        awb: "AWB-F1-UPDATE",
        patch: {} as unknown as Parameters<typeof client.updateTask>[0]["patch"],
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("updateTask upstream unavailable"),
    });
  });

  it("task-client cancelTask 502 — body excerpt reaches err.message", async () => {
    const sfBody = "<html>Bad Gateway from cancelTask upstream</html>";
    const client = createSuiteFleetTaskClient({
      fetch: stubFetch5xx(502, sfBody),
      clientId: "client-stub",
      clock: fixedClock,
    });

    await expect(
      client.cancelTask({
        session: STUB_SESSION,
        awb: "AWB-F1-CANCEL",
        correlationId: "corr-F1-cancel",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Bad Gateway from cancelTask upstream"),
    });
  });

  it("task-client bulkCancelTasks 504 — body excerpt reaches err.message", async () => {
    const sfBody = '{"error":"bulkCancelTasks upstream timeout"}';
    const client = createSuiteFleetTaskClient({
      fetch: stubFetch5xx(504, sfBody),
      clientId: "client-stub",
      clock: fixedClock,
    });

    await expect(
      client.bulkCancelTasks({
        session: STUB_SESSION,
        sfTaskIds: ["12345"],
        correlationId: "corr-F1-bulk",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("bulkCancelTasks upstream timeout"),
    });
  });

  it("asset-tracking-client fetchByAwb 500 — body excerpt reaches err.message", async () => {
    const sfBody = '{"error":"asset-tracking upstream NPE"}';
    const client = createSuiteFleetAssetTrackingClient({
      fetch: stubFetch5xx(500, sfBody),
      clientId: "client-stub",
    });

    await expect(
      client.fetchByAwb({
        session: STUB_SESSION,
        awb: "AWB-F1-ASSET",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("asset-tracking upstream NPE"),
    });
  });

  it("auth-client login retry-exhaustion 502 — body excerpt from final attempt reaches err.message", async () => {
    // callWithRetry attempts request 4 times (3 retries + 1 initial); each
    // 5xx response increments lastServerStatus + captures lastServerBody.
    // On exhaustion the final body excerpt is appended to the throw.
    // retryDelaysMs [0,0,0] so the test doesn't sleep.
    const sfBody = '{"error":"auth login upstream Bad Gateway"}';
    let callCount = 0;
    const recordingFetch = (async () => {
      callCount += 1;
      return new Response(sfBody, {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const client = createSuiteFleetAuthClient({
      fetch: recordingFetch,
      clock: fixedClock,
      sleep: async () => undefined,
      retryDelaysMs: [0, 0, 0],
    });

    await expect(
      client.login({
        auth_method: "oauth",
        username: "stub-user",
        password: "stub-pass",
        clientId: "stub-client",
        customerId: 1,
      } as unknown as Parameters<typeof client.login>[0]),
    ).rejects.toMatchObject({
      message: expect.stringContaining("auth login upstream Bad Gateway"),
    });
    expect(callCount).toBe(4); // 1 initial + 3 retries per retryDelaysMs.length
  });
});

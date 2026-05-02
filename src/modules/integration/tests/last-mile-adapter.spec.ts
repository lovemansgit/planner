// LastMileAdapter contract tests — Day 4 / S-1.
//
// The interface itself has no runtime to test; what *can* fail at this
// layer is "the public surface accidentally leaks provider vocabulary"
// or "the types refuse to compose into a working implementation". Both
// failures show up at typecheck time, so this file is a structural
// guard: it constructs a no-op implementation of the interface using
// only the public types, and exercises each method once. If any future
// change to the interface or types breaks this, `tsc --noEmit` fails.

import { describe, expect, it } from "vitest";

import type {
  AuthenticatedSession,
  HeadersLike,
  InternalTaskStatus,
  LastMileAdapter,
  TaskCreateRequest,
  TaskCreateResult,
  WebhookEvent,
  WebhookVerificationResult,
} from "../index";
import type { Uuid } from "@/shared/types";

const TENANT_ID: Uuid = "00000000-0000-0000-0000-000000000001";

const SAMPLE_SESSION: AuthenticatedSession = {
  tenantId: TENANT_ID,
  token: "token.sample",
  renewalToken: "renewal.sample",
  tokenExpiresAt: "2026-04-30T08:58:15.295Z",
  renewalTokenExpiresAt: "2026-10-26T08:58:15.295Z",
};

const SAMPLE_TASK: TaskCreateRequest = {
  tenantId: TENANT_ID,
  customerOrderNumber: "ORDER-001",
  referenceNumber: "REF-001",
  kind: "DELIVERY",
  consignee: {
    name: "Sample Consignee",
    contactPhone: "+971500000000",
    address: {
      addressLine1: "Villa 1",
      city: "Dubai",
      district: "Jumeirah 3",
      countryCode: "AE",
      latitude: 25.1972,
      longitude: 55.2744,
      addressCode: "AXD",
    },
  },
  shipFrom: {
    addressLine1: "Warehouse 1",
    city: "Dubai",
    district: "Al Quoz Industrial 1",
    countryCode: "AE",
    latitude: 25.0,
    longitude: 55.0,
  },
  window: { date: "2026-04-30", startTime: "23:00:00", endTime: "02:00:00" },
  paymentMethod: "PrePaid",
  itemQuantity: 2,
};

class StubAdapter implements LastMileAdapter {
  async authenticate(tenantId: Uuid): Promise<AuthenticatedSession> {
    return { ...SAMPLE_SESSION, tenantId };
  }
  async refreshSession(session: AuthenticatedSession): Promise<AuthenticatedSession> {
    return session;
  }
  async createTask(
    session: AuthenticatedSession,
    task: TaskCreateRequest,
  ): Promise<TaskCreateResult> {
    return {
      externalId: `ext-${session.tenantId}`,
      trackingNumber: `TRK-${task.customerOrderNumber}`,
      status: "CREATED",
      createdAt: "2026-04-29T09:00:00.000Z",
    };
  }
  async getTaskByAwb(
    session: AuthenticatedSession,
    awb: string,
  ): Promise<import("../types").TaskByAwbResult> {
    void session;
    void awb;
    return { externalId: "stub-recovered-id" };
  }
  async verifyWebhookRequest(
    tenantId: string,
    headers: HeadersLike,
    body: unknown,
  ): Promise<WebhookVerificationResult> {
    void tenantId;
    void headers;
    void body;
    return { ok: true };
  }
  parseWebhookEvents(body: unknown): readonly WebhookEvent[] {
    void body;
    return [];
  }
  mapStatusToInternal(externalStatus: string): InternalTaskStatus | null {
    if (externalStatus === "") return null;
    return "CREATED";
  }
  async fetchAssetTrackingByAwb(
    session: AuthenticatedSession,
    awb: string,
  ): Promise<readonly import("../types").AssetTrackingPackage[]> {
    void session;
    void awb;
    return [];
  }
}

describe("LastMileAdapter contract", () => {
  const adapter: LastMileAdapter = new StubAdapter();

  it("authenticate returns a session bound to the requested tenant", async () => {
    const session = await adapter.authenticate(TENANT_ID);
    expect(session.tenantId).toBe(TENANT_ID);
    expect(session.token).toBeTypeOf("string");
  });

  it("refreshSession round-trips a session shape", async () => {
    const refreshed = await adapter.refreshSession(SAMPLE_SESSION);
    expect(refreshed.renewalToken).toBe(SAMPLE_SESSION.renewalToken);
  });

  it("createTask returns an internal-language result", async () => {
    const result = await adapter.createTask(SAMPLE_SESSION, SAMPLE_TASK);
    expect(result.trackingNumber).toBe("TRK-ORDER-001");
    expect(result.status).toBe<InternalTaskStatus>("CREATED");
  });

  it("verifyWebhookRequest accepts a tenantId and a Headers-like object", async () => {
    const headers: HeadersLike = { get: () => null };
    const result = await adapter.verifyWebhookRequest(TENANT_ID, headers, {});
    expect(result.ok).toBe(true);
  });

  it("parseWebhookEvents returns a readonly array", () => {
    const events = adapter.parseWebhookEvents([]);
    expect(events).toHaveLength(0);
  });

  it("mapStatusToInternal returns one of the seven internal states or null", () => {
    const status = adapter.mapStatusToInternal("ORDERED");
    const allowed: ReadonlySet<InternalTaskStatus> = new Set<InternalTaskStatus>([
      "CREATED",
      "ASSIGNED",
      "IN_TRANSIT",
      "DELIVERED",
      "FAILED",
      "CANCELED",
      "ON_HOLD",
    ]);
    expect(status === null || allowed.has(status)).toBe(true);
  });

  it("mapStatusToInternal returns null for non-lifecycle inputs (caller must not update state)", () => {
    expect(adapter.mapStatusToInternal("")).toBeNull();
  });
});

describe("WebhookVerificationResult", () => {
  it("narrows to a reason on the failure branch", () => {
    const result: WebhookVerificationResult = {
      ok: false,
      reason: "client_id_mismatch",
    };
    if (!result.ok) {
      expect(result.reason).toBe("client_id_mismatch");
    }
  });
});

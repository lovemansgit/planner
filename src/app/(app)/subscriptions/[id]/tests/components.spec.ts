// Day 22 / §3.3.5 — JSX-shape tests for subscription detail components.
//
// Uses renderToStaticMarkup against the static HTML output. Matches
// the component-test pattern at
// src/components/forms/tests/weekday-selector.spec.ts.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Subscription } from "@/modules/subscriptions";
import type { SubscriptionException } from "@/modules/subscription-exceptions";
import type { Task } from "@/modules/tasks";

import { RecentExceptions } from "../_components/RecentExceptions";
import { SubscriptionDetailHeader } from "../_components/SubscriptionDetailHeader";
import { SubscriptionRuleSummary } from "../_components/SubscriptionRuleSummary";
import { SubscriptionTasksList } from "../_components/SubscriptionTasksList";

const SUB_ID = "00000000-0000-0000-0000-000000000001";
const CONSIGNEE_ID = "00000000-0000-0000-0000-000000000002";
const FIXED_ISO = "2026-05-11T12:00:00.000Z";

function subFixture(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: SUB_ID as never,
    tenantId: "00000000-0000-0000-0000-00000000000a" as never,
    consigneeId: CONSIGNEE_ID as never,
    status: "active",
    startDate: "2026-05-01",
    endDate: "2026-06-30",
    daysOfWeek: [1, 2, 3, 4, 5],
    deliveryWindowStart: "09:00:00",
    deliveryWindowEnd: "11:00:00",
    deliveryAddressOverride: null,
    mealPlanName: "Premium Daily",
    externalRef: null,
    notesInternal: null,
    pausedAt: null,
    endedAt: null,
    createdAt: FIXED_ISO as never,
    updatedAt: FIXED_ISO as never,
    ...overrides,
  };
}

function exceptionFixture(
  overrides: Partial<SubscriptionException> = {},
): SubscriptionException {
  return {
    id: "00000000-0000-0000-0000-000000000ce1" as never,
    subscriptionId: SUB_ID as never,
    tenantId: "00000000-0000-0000-0000-00000000000a" as never,
    type: "skip",
    startDate: "2026-05-18",
    endDate: null,
    targetDateOverride: null,
    skipWithoutAppend: false,
    reason: "operator skip",
    addressOverrideId: null,
    compensatingDate: "2026-06-01",
    correlationId: "00000000-0000-0000-0000-000000000c01" as never,
    idempotencyKey: "00000000-0000-0000-0000-000000000c02" as never,
    createdBy: "00000000-0000-0000-0000-00000000aaaa" as never,
    createdAt: FIXED_ISO as never,
    ...overrides,
  };
}

describe("SubscriptionDetailHeader", () => {
  it("renders the plan name as the H1 (falls back to 'Unnamed plan' when null)", () => {
    const named = renderToStaticMarkup(
      SubscriptionDetailHeader({
        subscription: subFixture({ mealPlanName: "Vegetarian breakfast" }),
        consigneeName: "Sarah Khouri",
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(named).toMatch(/Vegetarian breakfast/);

    const unnamed = renderToStaticMarkup(
      SubscriptionDetailHeader({
        subscription: subFixture({ mealPlanName: null }),
        consigneeName: "Sarah Khouri",
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(unnamed).toMatch(/Unnamed plan/);
  });

  it("links to /consignees/[id] with the consignee name", () => {
    const html = renderToStaticMarkup(
      SubscriptionDetailHeader({
        subscription: subFixture(),
        consigneeName: "Sarah Khouri",
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(html).toMatch(new RegExp(`href="/consignees/${CONSIGNEE_ID}"`));
    expect(html).toMatch(/Sarah Khouri/);
  });

  it("renders the active status badge in green", () => {
    const html = renderToStaticMarkup(
      SubscriptionDetailHeader({
        subscription: subFixture({ status: "active" }),
        consigneeName: "Sarah",
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(html).toMatch(/Active/);
    expect(html).toMatch(/text-green/);
  });

  it("renders the paused status badge in amber", () => {
    const html = renderToStaticMarkup(
      SubscriptionDetailHeader({
        subscription: subFixture({ status: "paused" }),
        consigneeName: "Sarah",
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(html).toMatch(/Paused/);
    expect(html).toMatch(/text-amber/);
  });

  it("renders the ended status badge in muted neutral", () => {
    const html = renderToStaticMarkup(
      SubscriptionDetailHeader({
        subscription: subFixture({ status: "ended" }),
        consigneeName: "Sarah",
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(html).toMatch(/Ended/);
    expect(html).toMatch(/color-text-tertiary/);
  });

  it("renders 'Open-ended' when subscription.endDate is null", () => {
    const html = renderToStaticMarkup(
      SubscriptionDetailHeader({
        subscription: subFixture({ endDate: null }),
        consigneeName: "Sarah",
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(html).toMatch(/Open-ended/);
  });
});

describe("SubscriptionRuleSummary", () => {
  it("marks active weekdays as data-active=true and inactive as data-active=false", () => {
    const html = renderToStaticMarkup(
      SubscriptionRuleSummary({
        subscription: subFixture({ daysOfWeek: [1, 3, 5] }),
        addressLine: "Building 4",
        district: "Al Quoz",
        emirate: "Dubai",
      }),
    );
    // Mon (active)
    expect(html).toMatch(/data-active="true"[^>]*>[\s\S]*?Mon/);
    // Tue (inactive)
    expect(html).toMatch(/data-active="false"[^>]*>Tue/);
    // Wed (active)
    expect(html).toMatch(/data-active="true"[^>]*>[\s\S]*?Wed/);
  });

  it("renders the delivery window as HH:MM – HH:MM (drops seconds component)", () => {
    const html = renderToStaticMarkup(
      SubscriptionRuleSummary({
        subscription: subFixture({
          deliveryWindowStart: "09:30:00",
          deliveryWindowEnd: "11:00:00",
        }),
        addressLine: "Building 4",
        district: "Al Quoz",
        emirate: "Dubai",
      }),
    );
    expect(html).toMatch(/09:30 – 11:00/);
    expect(html).not.toMatch(/09:30:00/);
  });

  it("renders the address line + district · emirate composition", () => {
    const html = renderToStaticMarkup(
      SubscriptionRuleSummary({
        subscription: subFixture(),
        addressLine: "Building 4, Apt 12",
        district: "Al Quoz",
        emirate: "Dubai",
      }),
    );
    expect(html).toMatch(/Building 4, Apt 12/);
    expect(html).toMatch(/Al Quoz · Dubai/);
  });

  it("renders the Phase-2 multi-address-rotation caveat", () => {
    const html = renderToStaticMarkup(
      SubscriptionRuleSummary({
        subscription: subFixture(),
        addressLine: "x",
        district: "y",
        emirate: "z",
      }),
    );
    expect(html).toMatch(/Single-address MVP/);
    expect(html).toMatch(/Phase 2/);
  });
});

describe("RecentExceptions", () => {
  it("renders empty-state copy when no exceptions present", () => {
    const html = renderToStaticMarkup(RecentExceptions({ exceptions: [] }));
    expect(html).toMatch(/No skips, pauses, or address overrides/);
  });

  it("renders a skip with compensating date in the operator-readable form", () => {
    const html = renderToStaticMarkup(
      RecentExceptions({
        exceptions: [
          exceptionFixture({
            type: "skip",
            startDate: "2026-05-18",
            compensatingDate: "2026-06-01",
          }),
        ],
      }),
    );
    expect(html).toMatch(/Skip applied for 2026-05-18; compensating date 2026-06-01/);
  });

  it("renders a pause_window with date range", () => {
    const html = renderToStaticMarkup(
      RecentExceptions({
        exceptions: [
          exceptionFixture({
            type: "pause_window",
            startDate: "2026-05-10",
            endDate: "2026-05-17",
            compensatingDate: null,
          }),
        ],
      }),
    );
    expect(html).toMatch(/Subscription paused 2026-05-10 to 2026-05-17/);
  });

  it("renders an append_without_skip event", () => {
    const html = renderToStaticMarkup(
      RecentExceptions({
        exceptions: [
          exceptionFixture({
            type: "append_without_skip",
            startDate: "2026-05-22",
            compensatingDate: null,
          }),
        ],
      }),
    );
    expect(html).toMatch(/Compensating delivery appended on 2026-05-22/);
  });

  it("renders the reason text when present", () => {
    const html = renderToStaticMarkup(
      RecentExceptions({
        exceptions: [exceptionFixture({ reason: "out of town" })],
      }),
    );
    expect(html).toMatch(/out of town/);
  });

  it("renders newest-first preserving caller order", () => {
    const html = renderToStaticMarkup(
      RecentExceptions({
        exceptions: [
          exceptionFixture({
            id: "newest" as never,
            startDate: "2026-05-22",
            createdAt: "2026-05-11T12:00:00.000Z" as never,
          }),
          exceptionFixture({
            id: "older" as never,
            startDate: "2026-05-10",
            createdAt: "2026-05-08T08:00:00.000Z" as never,
          }),
        ],
      }),
    );
    // Newest entry's start date appears before older entry's.
    const newestIdx = html.indexOf("2026-05-22");
    const olderIdx = html.indexOf("2026-05-10");
    expect(newestIdx).toBeGreaterThanOrEqual(0);
    expect(olderIdx).toBeGreaterThan(newestIdx);
  });
});

// ---------------------------------------------------------------------------
// SubscriptionTasksList — Day-22 §3.22 Fix 2
// ---------------------------------------------------------------------------

function taskFixture(overrides: Partial<Task> = {}): Task {
  return {
    id: "00000000-0000-0000-0000-000000000111" as never,
    tenantId: "00000000-0000-0000-0000-00000000000a" as never,
    consigneeId: CONSIGNEE_ID as never,
    subscriptionId: SUB_ID as never,
    createdVia: "subscription",
    customerOrderNumber: "SUB-abc-20260512",
    referenceNumber: null,
    internalStatus: "CREATED",
    externalId: null,
    externalTrackingNumber: null,
    deliveryDate: "2026-05-12",
    deliveryStartTime: "09:00:00",
    deliveryEndTime: "11:00:00",
    deliveryType: "STANDARD",
    taskKind: "DELIVERY",
    paymentMethod: null,
    codAmount: null,
    declaredValue: null,
    weightKg: null,
    notes: null,
    signatureRequired: false,
    smsNotifications: false,
    deliverToCustomerOnly: false,
    pushedToExternalAt: null,
    addressId: null,
    podPhotos: null,
    addressLabel: null,
    createdAt: FIXED_ISO as never,
    updatedAt: FIXED_ISO as never,
    packages: [],
    ...overrides,
  };
}

describe("SubscriptionTasksList", () => {
  it("renders empty-state copy when no tasks present", () => {
    const html = renderToStaticMarkup(
      SubscriptionTasksList({ tasks: [], consigneeId: CONSIGNEE_ID }),
    );
    expect(html).toMatch(/No tasks yet/);
    expect(html).toMatch(/rolling 14-day horizon/);
  });

  it("renders the delivery date + window (seconds dropped)", () => {
    const html = renderToStaticMarkup(
      SubscriptionTasksList({
        tasks: [
          taskFixture({
            deliveryDate: "2026-05-12",
            deliveryStartTime: "09:30:00",
            deliveryEndTime: "11:00:00",
          }),
        ],
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(html).toMatch(/2026-05-12/);
    expect(html).toMatch(/09:30 – 11:00/);
    expect(html).not.toMatch(/09:30:00/);
  });

  it("renders the AWB when externalTrackingNumber is set, em-dash when null", () => {
    const html = renderToStaticMarkup(
      SubscriptionTasksList({
        tasks: [
          taskFixture({ externalTrackingNumber: "MPL-685000001" }),
          taskFixture({ id: "row-2" as never, externalTrackingNumber: null }),
        ],
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(html).toMatch(/MPL-685000001/);
    expect(html).toMatch(/—/);
  });

  // Day-22 PM overnight §1 FIX 2 — "Pushed to SuiteFleet" indicator
  it("renders the 'Pushed to SuiteFleet' indicator when AWB is populated", () => {
    const html = renderToStaticMarkup(
      SubscriptionTasksList({
        tasks: [taskFixture({ externalTrackingNumber: "MPL-685000001" })],
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(html).toMatch(/Pushed to SuiteFleet/);
  });

  it("does NOT render the 'Pushed to SuiteFleet' indicator when AWB is null", () => {
    const html = renderToStaticMarkup(
      SubscriptionTasksList({
        tasks: [taskFixture({ externalTrackingNumber: null })],
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(html).not.toMatch(/Pushed to SuiteFleet/);
  });

  it("renders DELIVERED status in green-tone", () => {
    const html = renderToStaticMarkup(
      SubscriptionTasksList({
        tasks: [taskFixture({ internalStatus: "DELIVERED" })],
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(html).toMatch(/Delivered/);
    expect(html).toMatch(/text-green/);
  });

  it("renders FAILED status in red-tone", () => {
    const html = renderToStaticMarkup(
      SubscriptionTasksList({
        tasks: [taskFixture({ internalStatus: "FAILED" })],
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(html).toMatch(/Failed/);
    expect(html).toMatch(/text-red/);
  });

  it("renders CANCELED status in muted-tertiary tone", () => {
    const html = renderToStaticMarkup(
      SubscriptionTasksList({
        tasks: [taskFixture({ internalStatus: "CANCELED" })],
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(html).toMatch(/Cancelled/);
  });

  it("renders a Calendar action link routing to /consignees/[id]?tab=calendar&week=YYYY-MM-DD", () => {
    const html = renderToStaticMarkup(
      SubscriptionTasksList({
        tasks: [taskFixture({ deliveryDate: "2026-05-12" })],
        consigneeId: CONSIGNEE_ID,
      }),
    );
    expect(html).toMatch(
      new RegExp(`href="/consignees/${CONSIGNEE_ID}\\?tab=calendar&(?:amp;)?week=2026-05-12"`),
    );
  });

  it("renders the 'Showing first 30 (chronological)' note when count is at the limit", () => {
    const tasks = Array.from({ length: 30 }, (_v, i) =>
      taskFixture({ id: `row-${i}` as never, deliveryDate: `2026-05-${String(i + 1).padStart(2, "0")}` }),
    );
    const html = renderToStaticMarkup(
      SubscriptionTasksList({ tasks, consigneeId: CONSIGNEE_ID }),
    );
    expect(html).toMatch(/Showing first 30/);
  });

  it("renders the actual count when under 30", () => {
    const tasks = Array.from({ length: 5 }, (_v, i) =>
      taskFixture({ id: `row-${i}` as never, deliveryDate: `2026-05-${String(i + 1).padStart(2, "0")}` }),
    );
    const html = renderToStaticMarkup(
      SubscriptionTasksList({ tasks, consigneeId: CONSIGNEE_ID }),
    );
    expect(html).toMatch(/Showing 5/);
  });
});

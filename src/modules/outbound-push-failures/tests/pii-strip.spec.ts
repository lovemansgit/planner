// PII strip tests — Day 21 / Phase 1 / CONCERN B.
//
// Anchored on the actual SuiteFleet PATCH response observed during
// the Day-21 sandbox probe (memory/handoffs/bootstrap-session-a-day-21-am.md
// + LANE 1 §3.6 thread). The fixture below is a trimmed copy of the
// real probe response so the test asserts against bytes that
// production will actually see.

import { describe, expect, it } from "vitest";

import { stripPii, stripPiiObject } from "../pii-strip";

// Trimmed copy of the Day-21 probe response on PATCH /api/tasks/awb/MPL-72915243.
const SAMPLE_SF_RESPONSE = {
  id: 59383,
  type: "DELIVERY",
  status: "CANCELED",
  shipFrom: {
    id: 36964,
    name: "MEAL PLAN SCHEDULAR",
    addressLine1: "Dubai",
    district: "Dubai",
    city: "Dubai",
    contactPhone: "999999",
    countryCode: "AE",
  },
  consignee: {
    id: 32335,
    name: "MPL Customer 0113",
    location: {
      addressLine1: "Building 0113, Jumeirah, Dubai",
      district: "Jumeirah",
      city: "Dubai",
      contactPhone: "+9715000000113",
      geofence: { id: 46, name: "Al Bada'a", tags: "Al Badaa,Albada'a,..." },
    },
  },
  customer: {
    id: 588,
    name: "MEAL PLAN SCHEDULAR",
    code: "MPL",
  },
  deliveryInformation: {
    id: 59392,
    photos: null,
    recipientName: null,
    signature: null,
    consigneeRating: null,
    consigneeComment: null,
    driverComment: null,
  },
  customerOrderNumber: "SUB-61dc840d85e4-20260505",
  awb: "MPL-72915243",
  deliveryDate: "2026-05-05",
  deliveryStartTime: "12:00:00",
  deliveryEndTime: "14:00:00",
  trackingUrl: "https://go.suitefleet.com/VGMW38",
  notes: "Leave with concierge if not home",
};

describe("stripPii — subtree redaction", () => {
  it("redacts the consignee subtree wholesale", () => {
    const out = stripPii(SAMPLE_SF_RESPONSE) as Record<string, unknown>;
    expect(out.consignee).toBe("[redacted-pii-subtree]");
  });

  it("redacts the deliveryInformation subtree wholesale", () => {
    const out = stripPii(SAMPLE_SF_RESPONSE) as Record<string, unknown>;
    expect(out.deliveryInformation).toBe("[redacted-pii-subtree]");
  });

  it("redacts the shipFrom subtree wholesale", () => {
    const out = stripPii(SAMPLE_SF_RESPONSE) as Record<string, unknown>;
    expect(out.shipFrom).toBe("[redacted-pii-subtree]");
  });
});

describe("stripPii — leaf redaction", () => {
  it("redacts top-level notes", () => {
    const out = stripPii(SAMPLE_SF_RESPONSE) as Record<string, unknown>;
    expect(out.notes).toBe("[redacted]");
  });

  it("redacts trackingUrl (token-bearing)", () => {
    const out = stripPii(SAMPLE_SF_RESPONSE) as Record<string, unknown>;
    expect(out.trackingUrl).toBe("[redacted]");
  });

  it("redacts contactPhone wherever it nests outside subtree-keys", () => {
    const out = stripPii({
      level1: {
        contactPhone: "+9715000000113",
        innocent: "stays",
      },
    }) as Record<string, unknown>;
    expect((out.level1 as Record<string, unknown>).contactPhone).toBe("[redacted]");
    expect((out.level1 as Record<string, unknown>).innocent).toBe("stays");
  });

  it("uses NON_STRING_LEAF_SENTINEL for non-string PII leaves", () => {
    const out = stripPii({ photos: ["url1", "url2"], notes: { freeform: "x" } });
    expect((out as Record<string, unknown>).photos).toBe("[redacted-non-string]");
    expect((out as Record<string, unknown>).notes).toBe("[redacted-non-string]");
  });
});

describe("stripPii — preservation", () => {
  it("preserves operationally useful non-PII fields", () => {
    const out = stripPii(SAMPLE_SF_RESPONSE) as Record<string, unknown>;
    expect(out.id).toBe(59383);
    expect(out.awb).toBe("MPL-72915243");
    expect(out.status).toBe("CANCELED");
    expect(out.deliveryDate).toBe("2026-05-05");
    expect(out.deliveryStartTime).toBe("12:00:00");
    expect(out.deliveryEndTime).toBe("14:00:00");
    expect(out.customerOrderNumber).toBe("SUB-61dc840d85e4-20260505");
    expect(out.type).toBe("DELIVERY");
  });

  it("preserves the customer subtree (merchant identity, not PII)", () => {
    const out = stripPii(SAMPLE_SF_RESPONSE) as Record<string, unknown>;
    expect(out.customer).toEqual({
      id: 588,
      // customer.name is the merchant name (not consignee). It's a
      // PII_LEAF_KEY because the predicate is key-only — accept the
      // collateral redaction; merchant name is recoverable from the
      // customer.id (588).
      name: "[redacted]",
      code: "MPL",
    });
  });

  it("preserves arrays of primitives without modification", () => {
    expect(stripPii([1, 2, 3])).toEqual([1, 2, 3]);
    expect(stripPii(["a", "b"])).toEqual(["a", "b"]);
  });

  it("preserves null / undefined / primitives at the top level", () => {
    expect(stripPii(null)).toBe(null);
    expect(stripPii(undefined)).toBe(undefined);
    expect(stripPii("just a string")).toBe("just a string");
    expect(stripPii(42)).toBe(42);
    expect(stripPii(true)).toBe(true);
  });
});

describe("stripPii — recursion & safety", () => {
  it("does not mutate the input", () => {
    const input = { consignee: { name: "Original" }, awb: "MPL-X" };
    const before = JSON.stringify(input);
    stripPii(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("caps recursion depth at MAX_DEPTH and returns the sentinel", () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 60; i++) deep = { nested: deep };
    const out = stripPii(deep);
    // Walk until we hit a non-object (= sentinel string). Should stop
    // within MAX_DEPTH+2 hops; the exact step depends on internal
    // accounting but the contract is "deep enough returns the sentinel".
    let cursor: unknown = out;
    let hops = 0;
    while (
      typeof cursor === "object" &&
      cursor !== null &&
      !Array.isArray(cursor) &&
      "nested" in (cursor as Record<string, unknown>) &&
      hops < 64
    ) {
      cursor = (cursor as Record<string, unknown>).nested;
      hops += 1;
    }
    expect(cursor).toBe("[max-depth]");
    expect(hops).toBeLessThan(40);
  });

  it("handles arrays with mixed object content", () => {
    const out = stripPii([
      { consignee: { name: "X" }, awb: "Y" },
      { notes: "free", awb: "Z" },
    ]) as unknown[];
    expect(out).toHaveLength(2);
    expect((out[0] as Record<string, unknown>).consignee).toBe("[redacted-pii-subtree]");
    expect((out[0] as Record<string, unknown>).awb).toBe("Y");
    expect((out[1] as Record<string, unknown>).notes).toBe("[redacted]");
    expect((out[1] as Record<string, unknown>).awb).toBe("Z");
  });

  it("idempotency — re-stripping a stripped object is a no-op modulo sentinels", () => {
    const once = stripPii(SAMPLE_SF_RESPONSE);
    const twice = stripPii(once);
    expect(twice).toEqual(once);
  });
});

describe("stripPiiObject — top-level shape normalisation", () => {
  it("returns null for null / undefined / non-object inputs", () => {
    expect(stripPiiObject(null)).toBe(null);
    expect(stripPiiObject(undefined)).toBe(null);
    expect(stripPiiObject("string")).toBe(null);
    expect(stripPiiObject(42)).toBe(null);
  });

  it("returns the stripped object verbatim for object inputs", () => {
    const out = stripPiiObject(SAMPLE_SF_RESPONSE);
    expect(out).not.toBeNull();
    expect((out as Record<string, unknown>).consignee).toBe("[redacted-pii-subtree]");
    expect((out as Record<string, unknown>).awb).toBe("MPL-72915243");
  });

  it("wraps array inputs in { items: [...] } for jsonb object-root consistency", () => {
    const out = stripPiiObject([{ awb: "X", consignee: { name: "Y" } }]);
    expect(out).toHaveProperty("items");
    expect(Array.isArray((out as Record<string, unknown>).items)).toBe(true);
    const items = (out as Record<string, unknown>).items as unknown[];
    expect((items[0] as Record<string, unknown>).consignee).toBe("[redacted-pii-subtree]");
  });
});

describe("stripPii — empirical coverage anchored to Day-21 probe", () => {
  it("redacts the geofence.tags field which SF stuffs neighbourhood / consignee labels into", () => {
    const out = stripPii({
      consignee: {
        location: { geofence: { id: 46, name: "Al Bada'a", tags: "..." } },
      },
    });
    // consignee subtree replaces wholesale.
    expect((out as Record<string, unknown>).consignee).toBe("[redacted-pii-subtree]");
  });

  it("redacts geofence even when it surfaces outside the consignee subtree", () => {
    const out = stripPii({ geofence: { tags: "neighbourhood labels" } });
    expect((out as Record<string, unknown>).geofence).toBe("[redacted-non-string]");
  });

  it("redacts an adapter-context wrapper preserving correlation_id and http_status", () => {
    // Pattern the QStash failureCallback builds: SF response wrapped
    // with adapter-side metadata. correlation_id + http_status + url
    // must survive the strip; the body subtree contents get stripped.
    const out = stripPii({
      correlation_id: "00000000-0000-0000-0000-000000000001",
      http_status: 422,
      sf_response: {
        consignee: { name: "X" },
        awb: "MPL-X",
        status: "ORDERED",
      },
      url: "https://api.suitefleet.com/api/tasks/awb/MPL-X",
    });
    expect((out as Record<string, unknown>).correlation_id).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
    expect((out as Record<string, unknown>).http_status).toBe(422);
    const sf = (out as Record<string, unknown>).sf_response as Record<string, unknown>;
    expect(sf.consignee).toBe("[redacted-pii-subtree]");
    expect(sf.awb).toBe("MPL-X");
    expect(sf.status).toBe("ORDERED");
    expect((out as Record<string, unknown>).url).toBe(
      "https://api.suitefleet.com/api/tasks/awb/MPL-X",
    );
  });
});

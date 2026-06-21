// D56 Phase 8 / Lane 3 — StatusIcon dispatch.
//
// The status glyph is keyed on the fine `courier_status`, falling back to
// the coarse `internal_status` when courier_status is NULL/absent (pre-
// backfill / Planner-only rows). CANCELED keeps its null-glyph behaviour.
// Pure server-render to a markup string (the actions-cell-lock idiom) —
// no jsdom; the 6 new glyphs carry a `data-icon` marker so the dispatch
// is assertable. (Which icon belongs to which state is pinned at the data
// layer in status.spec.ts via resolveCourierDisplay/COURIER_STATUS_DISPLAY.)

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusIcon } from "../_components/StatusIcon";

describe("StatusIcon — fine courier_status dispatch", () => {
  it("renders the out-for-delivery glyph for the fine state (distinct from in-transit)", () => {
    const html = renderToStaticMarkup(
      <StatusIcon courierStatus="OUT_FOR_DELIVERY" status="IN_TRANSIT" />,
    );
    expect(html).toContain('data-icon="ofd"');
  });

  it("wires each new ramp/hold glyph to its fine state", () => {
    expect(renderToStaticMarkup(<StatusIcon courierStatus="PICKED_UP" status="IN_TRANSIT" />)).toContain('data-icon="pickup"');
    expect(renderToStaticMarkup(<StatusIcon courierStatus="ARRIVED_AT_DC" status="IN_TRANSIT" />)).toContain('data-icon="dc"');
    expect(renderToStaticMarkup(<StatusIcon courierStatus="HUB_TRANSFER" status="IN_TRANSIT" />)).toContain('data-icon="hub"');
    expect(renderToStaticMarkup(<StatusIcon courierStatus="RESCHEDULED" status="ON_HOLD" />)).toContain('data-icon="reschedule"');
    expect(renderToStaticMarkup(<StatusIcon courierStatus="REATTEMPT" status="ON_HOLD" />)).toContain('data-icon="retry"');
  });

  it("renders the Return glyph in the right variant for the two return states", () => {
    const processForReturn = renderToStaticMarkup(
      <StatusIcon courierStatus="PROCESS_FOR_RETURN" status="FAILED" />,
    );
    expect(processForReturn).toContain('data-icon="return"');
    expect(processForReturn).toContain('data-variant="outline"');

    const returnedToShipper = renderToStaticMarkup(
      <StatusIcon courierStatus="RETURNED_TO_SHIPPER" status="FAILED" />,
    );
    expect(returnedToShipper).toContain('data-icon="return"');
    expect(returnedToShipper).toContain('data-variant="solid"');
  });
});

describe("StatusIcon — NULL falls back to coarse internal_status", () => {
  it("renders the coarse glyph when courier_status is null", () => {
    const html = renderToStaticMarkup(<StatusIcon courierStatus={null} status="DELIVERED" />);
    expect(html).toContain("<svg");
  });

  it("renders the coarse glyph when courier_status is absent (admin backward-compat)", () => {
    const html = renderToStaticMarkup(<StatusIcon status="IN_TRANSIT" />);
    expect(html).toContain("<svg");
  });
});

describe("StatusIcon — null-glyph (inert) states", () => {
  it("renders nothing for CANCELED (fine or coarse)", () => {
    expect(renderToStaticMarkup(<StatusIcon courierStatus="CANCELED" status="CANCELED" />)).toBe("");
    expect(renderToStaticMarkup(<StatusIcon courierStatus={null} status="CANCELED" />)).toBe("");
  });

  it("renders nothing for coarse ON_HOLD / SKIPPED", () => {
    expect(renderToStaticMarkup(<StatusIcon status="ON_HOLD" />)).toBe("");
    expect(renderToStaticMarkup(<StatusIcon status="SKIPPED" />)).toBe("");
  });
});

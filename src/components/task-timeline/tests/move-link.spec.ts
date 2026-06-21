// Pure-logic test for the move-to-date timeline link (D56). No React render
// harness in this repo (see partial-state.spec.ts), so the drawer's move-link
// rendering is extracted to a pure helper and locked here: headline + sub-line
// for both directions, and graceful degradation when an AWB is absent.

import { describe, expect, it } from "vitest";

import { moveLinkFor } from "../move-link";

describe("moveLinkFor — move-to-date timeline link (D56)", () => {
  it("new delivery (task.moved_in): 'Moved from [old date]' + 'replaces AWB [old AWB]'", () => {
    const link = moveLinkFor({
      eventType: "task.moved_in",
      metadata: {
        moved_from_delivery_date: "2026-05-13",
        moved_from_awb: "MLU-21789001",
      },
    });
    expect(link).toEqual({
      headline: "Moved from 2026-05-13",
      subline: "replaces AWB MLU-21789001",
    });
  });

  it("new delivery with an unpushed original (no old AWB): headline only, no AWB sub-line", () => {
    const link = moveLinkFor({
      eventType: "task.moved_in",
      metadata: { moved_from_delivery_date: "2026-05-13", moved_from_awb: null },
    });
    expect(link).toEqual({
      headline: "Moved from 2026-05-13",
      subline: null,
    });
  });

  it("cancelled delivery (task.moved_out): 'Moved to [new date]' + 'see AWB [new AWB]'", () => {
    const link = moveLinkFor({
      eventType: "task.moved_out",
      metadata: {
        moved_to_delivery_date: "2026-07-06",
        moved_to_awb: "MLU-21789999",
      },
    });
    expect(link).toEqual({
      headline: "Moved to 2026-07-06",
      subline: "see AWB MLU-21789999",
    });
  });

  it("cancelled delivery before the moved task is pushed (new AWB pending): headline + pending sub-line", () => {
    const link = moveLinkFor({
      eventType: "task.moved_out",
      metadata: { moved_to_delivery_date: "2026-07-06" },
    });
    expect(link).toEqual({
      headline: "Moved to 2026-07-06",
      subline: "AWB pending — not yet sent to SuiteFleet",
    });
  });

  it("returns null for non-move events", () => {
    expect(moveLinkFor({ eventType: "task.created", metadata: {} })).toBeNull();
    expect(
      moveLinkFor({ eventType: "subscription.exception.created", metadata: { type: "skip" } }),
    ).toBeNull();
  });
});

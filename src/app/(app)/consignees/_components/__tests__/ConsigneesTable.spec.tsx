// Gap J / D4 adoption — the operator consignees list renders phones in
// the human display shape (formatPhone), not raw E.164. renderToStaticMarkup
// per the house pattern (no DOM test runner in the toolchain).

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Consignee } from "@/modules/consignees";

import { ConsigneesTable } from "../ConsigneesTable";

function consigneeRow(overrides: Partial<Consignee> = {}): Consignee & { taskCount: number } {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    name: "Falafel House",
    phone: "+971501234567",
    email: null,
    addressLine: "Building 12, Al Quoz",
    emirateOrRegion: "Dubai",
    district: "Al Quoz Industrial 1",
    deliveryNotes: null,
    externalRef: null,
    notesInternal: null,
    crmState: "ACTIVE",
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
    taskCount: 3,
    ...overrides,
  };
}

describe("ConsigneesTable — phone display (Gap J / D4)", () => {
  it("renders a UAE mobile in the grouped human shape, not raw E.164", () => {
    const html = renderToStaticMarkup(
      <ConsigneesTable rows={[consigneeRow({ phone: "+971501234567" })]} query="" />,
    );
    expect(html).toContain("+971 50 123 4567");
    expect(html).not.toContain("+971501234567");
  });

  it("renders a UAE landline in the grouped human shape", () => {
    const html = renderToStaticMarkup(
      <ConsigneesTable rows={[consigneeRow({ phone: "+97141234567" })]} query="" />,
    );
    expect(html).toContain("+971 4 123 4567");
  });
});

// Phase 12.2 RELABEL lane — the emirate column is relabelled "City" app-wide.
// The bound data field (emirateOrRegion) is unchanged; only the header text.
describe("ConsigneesTable — emirate column relabelled to City (Phase 12.2)", () => {
  it("renders the column header as 'City', never 'Emirate'", () => {
    const html = renderToStaticMarkup(
      <ConsigneesTable rows={[consigneeRow()]} query="" />,
    );
    expect(html).toContain("City");
    expect(html).not.toContain("Emirate");
  });
});

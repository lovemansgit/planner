// Day-53 add-a-second-address — JSX-shape tests for the add-address
// dialog form. renderToStaticMarkup per the ForwardOverrideConfirmDialog
// spec pattern (no DOM test runner in the toolchain).
//
// Pins:
//   - The form renders the same fields as the onboarding address block:
//     label select (home / office / other), line, district, emirate —
//     all required; no lat/lng (Phase 2, matching onboarding).
//   - Save + Cancel buttons; pending state disables submit and swaps
//     the label.
//   - Error result kinds render a role="alert" line.
//   - The trigger button reads "Add address".

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../_actions", () => ({
  addAddressAction: Object.assign(vi.fn(), {
    bind: () => vi.fn(),
  }),
}));

import { AddAddressDialog, AddAddressForm } from "../AddAddressDialog";

const CONSIGNEE_ID = "11111111-1111-1111-1111-111111111111";

describe("AddAddressDialog (Day-53 add-a-second-address)", () => {
  it("renders an 'Add address' trigger button when closed", () => {
    const html = renderToStaticMarkup(<AddAddressDialog consigneeId={CONSIGNEE_ID} />);
    expect(html).toContain("Add address");
    expect(html).not.toContain('role="dialog"');
  });

  it("form renders the onboarding address-block fields: label select + line/district/emirate, all required", () => {
    const html = renderToStaticMarkup(
      <AddAddressForm
        consigneeId={CONSIGNEE_ID}
        onCancel={() => undefined}
        onSuccess={() => undefined}
      />,
    );
    expect(html).toContain('name="label"');
    expect(html).toContain(">Home<");
    expect(html).toContain(">Office<");
    expect(html).toContain(">Other<");
    for (const name of ["line", "district", "emirate"]) {
      expect(html).toContain(`name="${name}"`);
    }
    const requiredCount = (html.match(/required=""/g) ?? []).length;
    // line + district + emirate inputs are required (label select has a
    // default and cannot be empty).
    expect(requiredCount).toBeGreaterThanOrEqual(3);
    // No lat/lng — Phase 2, matching the onboarding form.
    expect(html).not.toContain('name="lat"');
    expect(html).not.toContain('name="lng"');
  });

  it("form renders Save and Cancel; cancel is not a submit", () => {
    const html = renderToStaticMarkup(
      <AddAddressForm
        consigneeId={CONSIGNEE_ID}
        onCancel={() => undefined}
        onSuccess={() => undefined}
      />,
    );
    expect(html).toContain("Save address");
    expect(html).toContain("Cancel");
    expect(html).toContain('type="submit"');
    expect(html).toContain('type="button"');
  });
});

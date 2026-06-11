// Day-52 R5 — JSX-shape tests for the forward-override confirmation
// dialog (OQ-3 ruling: INLINE modal-within-popover). Uses
// renderToStaticMarkup per the ConsolidatedWeekView spec pattern (no
// DOM test runner in the toolchain).
//
// Pins:
//   - The confirmation copy is RULING-VERBATIM (exact-string constant
//     assert — paraphrase = test failure).
//   - The dialog renders the copy, a confirm button, and a cancel
//     button; confirm/cancel are type="button" (the dialog itself never
//     submits the form — submit goes through requestSubmit on confirm).
//   - Pending state disables both buttons and swaps the confirm label.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FORWARD_OVERRIDE_CONFIRM_COPY,
  ForwardOverrideConfirmDialog,
} from "../ForwardOverrideConfirmDialog";

describe("ForwardOverrideConfirmDialog (R5 OQ-3 inline confirm)", () => {
  it("confirmation copy is the Day-52 ruling VERBATIM string", () => {
    expect(FORWARD_OVERRIDE_CONFIRM_COPY).toBe(
      "Are you sure you want to update the address for all future tasks on this subscription?",
    );
  });

  it("renders the verbatim copy + confirm and cancel buttons as an alertdialog", () => {
    const html = renderToStaticMarkup(
      <ForwardOverrideConfirmDialog
        onConfirm={() => undefined}
        onCancel={() => undefined}
        isPending={false}
      />,
    );
    expect(html).toContain(
      "Are you sure you want to update the address for all future tasks on this subscription?",
    );
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("Yes, update address");
    expect(html).toContain("Cancel");
    // Neither button is a submit — the form submit only happens via
    // requestSubmit() in the panel's onConfirm handler.
    expect(html).not.toContain('type="submit"');
  });

  it("pending state disables both buttons and swaps the confirm label", () => {
    const html = renderToStaticMarkup(
      <ForwardOverrideConfirmDialog
        onConfirm={() => undefined}
        onCancel={() => undefined}
        isPending={true}
      />,
    );
    expect(html).toContain("Saving…");
    expect(html).not.toContain("Yes, update address");
    const disabledCount = (html.match(/disabled=""/g) ?? []).length;
    expect(disabledCount).toBe(2);
  });
});

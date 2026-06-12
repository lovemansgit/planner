// Day-54 R-E — JSX-shape tests for the mandatory churn warning
// (plan day-54-session-c-re-churn-cascade §3). renderToStaticMarkup
// per the house pattern.
//
// Pins:
//   - Selecting CHURNED renders the mandatory hard-stop warning,
//     covering the recall attempt ("already assigned") and the hard
//     stop ("nothing else from this moment on"), and the confirm
//     button swaps to the churn-specific label.
//   - Any other selection renders neither.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../_actions", () => ({
  changeCrmStateAction: Object.assign(vi.fn(), {
    bind: () => vi.fn(),
  }),
}));

import { CrmStateModalForm, resolveAllowedToStates } from "../CrmStateModal";

const CONSIGNEE_ID = "11111111-1111-1111-1111-111111111111";

function renderForm(selected: "CHURNED" | "ON_HOLD" | null) {
  return renderToStaticMarkup(
    <CrmStateModalForm
      consigneeId={CONSIGNEE_ID}
      currentState="ACTIVE"
      allowedToStates={["ON_HOLD", "CHURNED"]}
      selectedToState={selected}
      onSelectToState={() => undefined}
      onCancel={() => undefined}
      onSuccess={() => undefined}
    />,
  );
}

describe("CrmStateModal — R-E mandatory churn warning", () => {
  it("CHURNED selection renders the hard-stop warning incl. the recall wording and the churn confirm label", () => {
    const html = renderForm("CHURNED");
    expect(html).toContain("hard stop");
    expect(html).toContain("nothing else from this moment on");
    expect(html).toContain("already assigned");
    expect(html).toContain("vendor refuses a recall");
    expect(html).toContain("Churn — stop everything");
  });

  it("non-churn selection renders neither the warning nor the churn label", () => {
    const html = renderForm("ON_HOLD");
    expect(html).not.toContain("hard stop");
    expect(html).not.toContain("Churn — stop everything");
    expect(html).toContain("Confirm");
  });
});

describe("resolveAllowedToStates — Day-54 churn role gate (merchant-level only)", () => {
  it("includes CHURNED when the actor can churn", () => {
    expect(resolveAllowedToStates("ACTIVE", true)).toContain("CHURNED");
  });

  it("excludes CHURNED when the actor cannot churn, leaving other transitions intact", () => {
    const states = resolveAllowedToStates("ACTIVE", false);
    expect(states).not.toContain("CHURNED");
    expect(states).toContain("ON_HOLD");
    expect(states).toContain("INACTIVE");
  });
});

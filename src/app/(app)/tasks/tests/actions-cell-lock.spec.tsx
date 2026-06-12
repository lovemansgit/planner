// Day-54 walk finding — the /tasks LIST ROW rendered enabled Cancel/Edit
// affordances on driver-bound and terminal tasks while the calendar
// popover (primary surface) and the server gate both lock them. The row
// must not offer actions the server refuses: both buttons render
// disabled with the popover's plain explanation.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../_actions", () => ({
  cancelTaskAction: Object.assign(vi.fn(), { bind: () => vi.fn() }),
  editTaskAction: Object.assign(vi.fn(), { bind: () => vi.fn() }),
  getTaskEditContextAction: vi.fn(),
}));

// client.tsx's import graph reaches @/shared/db (module-eval env check)
// through server-module re-exports; stub the db boundary so the pure
// render stays env-free.
vi.mock("@/shared/db", () => ({
  withTenant: vi.fn(),
  withServiceRole: vi.fn(),
}));
vi.mock("server-only", () => ({}));

import type { Task } from "@/modules/tasks/types";

import { ActionsCell } from "../client";

function taskFixture(overrides: Partial<Task>): Task {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenantId: "00000000-0000-0000-0000-00000000000a",
    subscriptionId: "22222222-2222-2222-2222-222222222222",
    internalStatus: "CREATED",
    deliveryDate: "2026-06-19",
    ...overrides,
  } as Task;
}

function render(status: Task["internalStatus"], subscriptionId?: string | null) {
  return renderToStaticMarkup(
    <ActionsCell
      task={taskFixture({
        internalStatus: status,
        ...(subscriptionId !== undefined ? { subscriptionId } : {}),
      })}
    />,
  );
}

describe("ActionsCell — assignment/terminal lock on row actions (Day-54 walk finding)", () => {
  it("ASSIGNED: both Cancel and Edit are disabled with the assignment-lock explanation", () => {
    const html = render("ASSIGNED");
    expect(html.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Assigned to a driver");
    expect(html).toContain("No edits or cancellations once assigned");
  });

  it("IN_TRANSIT: locked the same way (pickup does not unlock)", () => {
    const html = render("IN_TRANSIT");
    expect(html.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Assigned to a driver");
  });

  it("DELIVERED (terminal): locked with the final-state explanation", () => {
    const html = render("DELIVERED");
    expect(html.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).toContain("final state");
  });

  it("CREATED: both actions remain enabled (no disabled attribute, no lock copy)", () => {
    const html = render("CREATED");
    expect(html.match(/disabled=""/g)?.length ?? 0).toBe(0);
    expect(html).not.toContain("Assigned to a driver");
  });

  it("CREATED ad-hoc (no subscription): Cancel stays disabled for the EXISTING ad-hoc reason, Edit enabled", () => {
    const html = render("CREATED", null);
    expect(html).toContain("no Planner subscription");
    expect(html.match(/disabled=""/g)?.length ?? 0).toBe(1);
  });
});

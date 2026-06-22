// Item 3 (22 Jun 2026) — admin task timeline trigger + drawer host.
//
// Client wrapper for the read-only admin task detail page. Holds the
// open/close state and renders the shared TaskTimelineDrawer, INJECTING
// the cross-tenant admin server actions (getAdminTask*Action — gate
// `task:read_all`, read under withServiceRole, resolve the task's own
// tenant). The same drawer serves the operator surface with its default
// tenant-scoped actions; here it serves the Transcorp admin surface
// cross-tenant, with identical rendering.

"use client";

import { useState } from "react";

import {
  getAdminTaskHistoryAction,
  getAdminTaskTimelineAction,
} from "@/components/task-timeline/admin-actions";
import { TaskTimelineDrawer } from "@/components/task-timeline/TaskTimelineDrawer";

interface AdminTaskTimelineProps {
  readonly consigneeId: string;
  readonly taskId: string;
  readonly deliveryDate: string;
  /** AWB / external tracking number; null → drawer shows the awaiting-push banner. */
  readonly awb: string | null;
}

export function AdminTaskTimeline({
  consigneeId,
  taskId,
  deliveryDate,
  awb,
}: AdminTaskTimelineProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-sm border border-navy px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-navy transition-opacity duration-[120ms] ease-out hover:opacity-80"
      >
        View timeline
      </button>
      {open ? (
        <TaskTimelineDrawer
          consigneeId={consigneeId}
          taskId={taskId}
          deliveryDate={deliveryDate}
          awb={awb}
          fetchTimeline={getAdminTaskTimelineAction}
          fetchHistory={getAdminTaskHistoryAction}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

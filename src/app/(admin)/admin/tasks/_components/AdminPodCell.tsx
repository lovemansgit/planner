// Day 19 / Phase 1.5 — POD cell for /admin/tasks (self-contained client).
//
// Mirrors the operator /tasks PodCell shape from PR #206 but owns its
// own lightbox state per cell rather than lifting to a parent client
// component. /admin/tasks has no parent client wrapper (no selection
// state needed — admin surface is read-only operational view), so
// per-cell state is the simpler structure.
//
// Same precedent as CalendarPodCard from PR #206 — per-card local
// state for one-modal-at-a-time UX. No multi-cell coordination
// needed because the user can only have one modal open at any moment.
"use client";

import { useState } from "react";

import { PodIcon } from "@/app/(app)/tasks/_components/PodIcon";
import { PodLightboxModal } from "@/app/(app)/tasks/_components/PodLightboxModal";
import { podCellState } from "@/app/(app)/tasks/_components/pod-state";
import type { Task } from "@/modules/tasks/types";

interface AdminPodCellProps {
  readonly task: Task;
}

export function AdminPodCell({ task }: AdminPodCellProps) {
  const [open, setOpen] = useState(false);
  const tone = podCellState(task.podPhotos);

  if (tone === "muted") {
    return (
      <span
        aria-label="No proof of delivery"
        title="No proof of delivery"
        className="inline-flex items-center justify-center"
        data-pod-state="muted"
      >
        <PodIcon tone="muted" />
      </span>
    );
  }

  const photos = task.podPhotos ?? [];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View proof of delivery for order ${task.customerOrderNumber}`}
        className="inline-flex items-center justify-center rounded-sm transition-opacity duration-[120ms] ease-out hover:opacity-70"
        data-pod-state="active"
      >
        <PodIcon tone="active" />
      </button>
      {open ? (
        <PodLightboxModal photos={photos} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

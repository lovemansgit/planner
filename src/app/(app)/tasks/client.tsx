// /tasks — client component
//
// Owns the multi-select state for the Print Labels button. Selection
// is React state (not URL state) — selections are an in-page action,
// not something operators want to bookmark. Print is a single batched
// POST to /api/tasks/labels with the array of selected ids.
//
// Permission gate: the underlying POST handler enforces
// `task:print_labels`; the button is rendered unconditionally and the
// 403 from the handler surfaces as an inline error if the operator
// lacks the permission. (We don't suppress the button at the UI layer
// because the layout-resolved permission set is not threaded into this
// client component yet — the route gate is the authoritative check.)
//
// Day 17 / Session B — across-pages selection.
//   - "Select all on page" stays the same (toggles current page's IDs).
//   - When the page is fully selected AND the tenant has more rows
//     than fit on one page, surface "Select all X tasks" — clicking
//     fetches every visible task ID via /api/tasks/visible-ids and
//     dumps them into the selection Set.
//   - Print Labels still respects printLabelsMaxPerRequest
//     (raised to 500 today). Past the cap, the button submits the
//     first 500 only and labels itself "Print first 500 of X selected"
//     so the operator knows the batch is partial.

"use client";

import { useMemo, useState, useTransition } from "react";

import type { Task } from "@/modules/tasks/types";

import { PodIcon } from "./_components/PodIcon";
import { PodLightboxModal } from "./_components/PodLightboxModal";
import { StatusIcon } from "./_components/StatusIcon";
import { podCellState } from "./_components/pod-state";
import { filterTasksByAwb } from "./awb-filter";
import { TASK_STATUS_FILTERS } from "./status";

interface TasksClientProps {
  readonly initialTasks: readonly Task[];
  readonly failedPushTaskIds: readonly string[];
  /** Total tasks matching the current filter (across all pages). */
  readonly totalCount: number;
  /** Current status filter, propagated to /api/tasks/visible-ids. */
  readonly status: string | undefined;
  /**
   * Threaded from the server component so the cap value lives in one
   * place (printLabelsMaxPerRequest in service.ts) without
   * dragging the server-only `@/modules/tasks` graph into the client
   * bundle.
   */
  readonly printLabelsMaxPerRequest: number;
}

export function TasksClient({
  initialTasks,
  failedPushTaskIds,
  totalCount,
  status,
  printLabelsMaxPerRequest,
}: TasksClientProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [printError, setPrintError] = useState<string | null>(null);
  const [selectAllError, setSelectAllError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isFetchingAll, startFetchingAll] = useTransition();
  const [lightboxPhotos, setLightboxPhotos] = useState<readonly string[] | null>(
    null,
  );
  // Day-22 §3.22 fixup — client-side AWB search filter. v1 scope:
  // filters within the current page only (per-page server pagination
  // unchanged). Cross-page AWB search is a Phase-2 server-side surface.
  const [awbQuery, setAwbQuery] = useState("");

  const failedSet = useMemo(() => new Set(failedPushTaskIds), [failedPushTaskIds]);
  const visibleTasks = useMemo(
    () => filterTasksByAwb(initialTasks, awbQuery),
    [initialTasks, awbQuery],
  );
  const pageIds = useMemo(() => initialTasks.map((t) => t.id), [initialTasks]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const allOnPage = pageIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allOnPage) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }

  function selectAllAcrossPages() {
    setSelectAllError(null);
    startFetchingAll(async () => {
      try {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        const qs = params.toString();
        const res = await fetch(qs ? `/api/tasks/visible-ids?${qs}` : "/api/tasks/visible-ids");
        if (!res.ok) {
          setSelectAllError(`Could not load all tasks (HTTP ${res.status}).`);
          return;
        }
        const data = (await res.json()) as { readonly taskIds: readonly string[] };
        setSelected(new Set(data.taskIds));
      } catch (err) {
        setSelectAllError(
          `Network error while loading all tasks. ${err instanceof Error ? err.message : ""}`,
        );
      }
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function printLabels() {
    if (selected.size === 0) return;
    setPrintError(null);
    // Past the cap, take the first N IDs in selection order. Set
    // iteration order in V8 is insertion order, which mirrors either
    // the page-by-page click order or the visible-ids API ordering
    // (created_at DESC). Operators get a deterministic "newest first"
    // slice.
    const idsToSubmit = Array.from(selected).slice(
      0,
      printLabelsMaxPerRequest,
    );
    startTransition(async () => {
      try {
        const res = await fetch("/api/tasks/labels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskIds: idsToSubmit }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          setPrintError(
            `Label print failed (HTTP ${res.status}). ${text || "Try again or contact operations."}`,
          );
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const filename = res.headers.get("content-disposition")?.match(/filename="?([^"]+)"?/)?.[1] ?? "labels.pdf";
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setSelected(new Set());
      } catch (err) {
        setPrintError(
          `Network error while printing labels. ${err instanceof Error ? err.message : ""}`,
        );
      }
    });
  }

  const allOnPageSelected =
    initialTasks.length > 0 && pageIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;
  const exceedsCap = selected.size > printLabelsMaxPerRequest;
  const showAcrossPagesPrompt =
    allOnPageSelected && totalCount > initialTasks.length && selected.size < totalCount;
  const printLabel = (() => {
    if (isPending) return "Printing…";
    if (exceedsCap) return `Print first ${printLabelsMaxPerRequest} of ${selected.size}`;
    return "Print labels";
  })();
  const selectionLabel = (() => {
    if (!someSelected) return `${initialTasks.length} on this page`;
    if (selected.size === totalCount) return `All ${totalCount} selected`;
    return `${selected.size} selected`;
  })();

  return (
    <div className="space-y-4">
      <div
        className={`flex items-center ${
          someSelected ? "justify-between" : "justify-end"
        }`}
      >
        {someSelected ? (
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            {selectionLabel}
          </p>
        ) : null}
        <button
          type="button"
          onClick={printLabels}
          disabled={!someSelected || isPending}
          className="px-4 py-2 text-xs uppercase tracking-[0.2em] border border-navy text-navy hover:opacity-80 disabled:cursor-not-allowed disabled:border-[color:var(--color-border-default)] disabled:text-[color:var(--color-text-tertiary)]"
        >
          {printLabel}
        </button>
      </div>

      {showAcrossPagesPrompt ? (
        <div className="flex flex-wrap items-center gap-3 border border-[color:var(--color-border-default)] bg-[color:var(--color-text-secondary)]/5 px-4 py-3 text-xs uppercase tracking-[0.15em] text-navy">
          <span>All {initialTasks.length} on this page selected.</span>
          <button
            type="button"
            onClick={selectAllAcrossPages}
            disabled={isFetchingAll}
            className="underline underline-offset-2 hover:opacity-80 disabled:cursor-not-allowed disabled:no-underline disabled:text-[color:var(--color-text-tertiary)]"
          >
            {isFetchingAll ? "Loading…" : `Select all ${totalCount} tasks`}
          </button>
        </div>
      ) : null}

      {selected.size === totalCount && totalCount > initialTasks.length ? (
        <div className="flex flex-wrap items-center gap-3 border border-[color:var(--color-border-default)] bg-[color:var(--color-text-secondary)]/5 px-4 py-3 text-xs uppercase tracking-[0.15em] text-navy">
          <span>All {totalCount} tasks selected (across pages).</span>
          <button
            type="button"
            onClick={clearSelection}
            className="underline underline-offset-2 hover:opacity-80"
          >
            Clear selection
          </button>
        </div>
      ) : null}

      {selectAllError ? (
        <p className="border border-red bg-red/5 px-4 py-3 text-sm text-red" role="alert">
          {selectAllError}
        </p>
      ) : null}

      {printError ? (
        <p className="border border-red bg-red/5 px-4 py-3 text-sm text-red" role="alert">
          {printError}
        </p>
      ) : null}

      <div>
        <label htmlFor="tasks-awb-search" className="sr-only">
          Search tasks by AWB
        </label>
        <input
          id="tasks-awb-search"
          type="search"
          value={awbQuery}
          onChange={(e) => setAwbQuery(e.target.value)}
          placeholder="Search by AWB (e.g. MPL-685… or last 6 digits)"
          inputMode="search"
          autoComplete="off"
          className="w-full max-w-md rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy placeholder:text-[color:var(--color-text-tertiary)] transition-colors duration-[120ms] ease-out focus:border-navy focus:outline-none"
        />
        {awbQuery.trim().length > 0 ? (
          <p className="mt-2 text-xs text-[color:var(--color-text-secondary)]">
            {visibleTasks.length} of {initialTasks.length} task
            {initialTasks.length === 1 ? "" : "s"} on this page matching{" "}
            <span className="font-medium text-navy">&quot;{awbQuery.trim()}&quot;</span>
          </p>
        ) : null}
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[color:var(--color-border-strong)]">
            <Th>
              <input
                type="checkbox"
                aria-label="Select all on this page"
                checked={allOnPageSelected}
                onChange={toggleAllOnPage}
                className="cursor-pointer"
              />
            </Th>
            <Th>Status</Th>
            <Th>Order #</Th>
            <Th>Delivery date</Th>
            <Th>Window</Th>
            <Th>AWB</Th>
            <Th>Issues</Th>
            <Th>
              <span className="sr-only">Proof of delivery</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {visibleTasks.map((task) => (
            <Row
              key={task.id}
              task={task}
              checked={selected.has(task.id)}
              onToggle={() => toggle(task.id)}
              failed={failedSet.has(task.id)}
              onOpenPod={(photos) => setLightboxPhotos(photos)}
            />
          ))}
        </tbody>
      </table>

      {lightboxPhotos !== null ? (
        <PodLightboxModal
          photos={lightboxPhotos}
          onClose={() => setLightboxPhotos(null)}
        />
      ) : null}
    </div>
  );
}

function Row({
  task,
  checked,
  onToggle,
  failed,
  onOpenPod,
}: {
  readonly task: Task;
  readonly checked: boolean;
  readonly onToggle: () => void;
  readonly failed: boolean;
  readonly onOpenPod: (photos: readonly string[]) => void;
}) {
  const filter = TASK_STATUS_FILTERS.find((f) => f.value === task.internalStatus);
  const podTone = podCellState(task.podPhotos);
  return (
    <tr
      className={
        checked
          ? "border-b border-[color:var(--color-border-default)] bg-[color:var(--color-text-secondary)]/5 last:border-b-0"
          : "border-b border-[color:var(--color-border-default)] last:border-b-0"
      }
    >
      <Td>
        <input
          type="checkbox"
          aria-label={`Select task ${task.customerOrderNumber}`}
          checked={checked}
          onChange={onToggle}
          className="cursor-pointer"
        />
      </Td>
      <Td>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${filter?.pillClass ?? ""}`}
        >
          <StatusIcon status={task.internalStatus} />
          {filter?.label ?? task.internalStatus}
        </span>
      </Td>
      <Td className="font-mono text-xs tabular-nums">{task.customerOrderNumber}</Td>
      <Td className="tabular-nums">{task.deliveryDate}</Td>
      <Td className="tabular-nums">
        {task.deliveryStartTime.slice(0, 5)} – {task.deliveryEndTime.slice(0, 5)}
      </Td>
      <Td className="font-mono text-xs tabular-nums">
        {task.externalTrackingNumber !== null ? (
          <span className="flex flex-col gap-0.5">
            <span>{task.externalTrackingNumber}</span>
            <span className="font-sans text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
              <span className="text-navy">✓</span> Pushed to SuiteFleet
            </span>
          </span>
        ) : (
          <span className="text-[color:var(--color-text-tertiary)]">—</span>
        )}
      </Td>
      <Td>
        {failed ? (
          <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] bg-red/15 text-red">
            Failed push
          </span>
        ) : (
          <span className="text-[color:var(--color-text-tertiary)]">—</span>
        )}
      </Td>
      <Td>
        <PodCell task={task} tone={podTone} onOpenPod={onOpenPod} />
      </Td>
    </tr>
  );
}

function PodCell({
  task,
  tone,
  onOpenPod,
}: {
  readonly task: Task;
  readonly tone: "active" | "muted";
  readonly onOpenPod: (photos: readonly string[]) => void;
}) {
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
  // tone === "active" requires task.podPhotos to be non-null + non-empty
  // per podCellState contract.
  const photos = task.podPhotos ?? [];
  return (
    <button
      type="button"
      onClick={() => onOpenPod(photos)}
      aria-label={`View proof of delivery for order ${task.customerOrderNumber}`}
      className="inline-flex items-center justify-center rounded-sm transition-opacity duration-[120ms] ease-out hover:opacity-70"
      data-pod-state="active"
    >
      <PodIcon tone="active" />
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="py-4 text-left text-xs font-medium uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)]">
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-4 align-middle ${className}`}>{children}</td>;
}

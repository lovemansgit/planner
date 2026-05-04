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

"use client";

import { useMemo, useState, useTransition } from "react";

import type { Task } from "@/modules/tasks";

import { TASK_STATUS_FILTERS } from "./status";

interface TasksClientProps {
  readonly initialTasks: readonly Task[];
  readonly failedPushTaskIds: readonly string[];
}

export function TasksClient({ initialTasks, failedPushTaskIds }: TasksClientProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [printError, setPrintError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const failedSet = useMemo(() => new Set(failedPushTaskIds), [failedPushTaskIds]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      if (prev.size === initialTasks.length) return new Set();
      return new Set(initialTasks.map((t) => t.id));
    });
  }

  function printLabels() {
    if (selected.size === 0) return;
    setPrintError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/tasks/labels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskIds: Array.from(selected) }),
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

  const allSelected = selected.size === initialTasks.length && initialTasks.length > 0;
  const someSelected = selected.size > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          {someSelected ? `${selected.size} selected` : `${initialTasks.length} on this page`}
        </p>
        <button
          type="button"
          onClick={printLabels}
          disabled={!someSelected || isPending}
          className="px-4 py-2 text-xs uppercase tracking-[0.2em] border border-navy text-navy hover:opacity-80 disabled:cursor-not-allowed disabled:border-[color:var(--color-border-default)] disabled:text-[color:var(--color-text-tertiary)]"
        >
          {isPending ? "Printing…" : "Print labels"}
        </button>
      </div>

      {printError ? (
        <p className="border border-red bg-red/5 px-4 py-3 text-sm text-red" role="alert">
          {printError}
        </p>
      ) : null}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[color:var(--color-border-strong)]">
            <Th>
              <input
                type="checkbox"
                aria-label="Select all on this page"
                checked={allSelected}
                onChange={toggleAll}
                className="cursor-pointer"
              />
            </Th>
            <Th>Status</Th>
            <Th>Order #</Th>
            <Th>Delivery date</Th>
            <Th>Window</Th>
            <Th>AWB</Th>
            <Th>Issues</Th>
          </tr>
        </thead>
        <tbody>
          {initialTasks.map((task) => (
            <Row
              key={task.id}
              task={task}
              checked={selected.has(task.id)}
              onToggle={() => toggle(task.id)}
              failed={failedSet.has(task.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  task,
  checked,
  onToggle,
  failed,
}: {
  readonly task: Task;
  readonly checked: boolean;
  readonly onToggle: () => void;
  readonly failed: boolean;
}) {
  const filter = TASK_STATUS_FILTERS.find((f) => f.value === task.internalStatus);
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
          className={`inline-flex items-center px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${filter?.pillClass ?? ""}`}
        >
          {filter?.label ?? task.internalStatus}
        </span>
      </Td>
      <Td className="font-mono text-xs tabular-nums">{task.customerOrderNumber}</Td>
      <Td className="tabular-nums">{task.deliveryDate}</Td>
      <Td className="tabular-nums">
        {task.deliveryStartTime.slice(0, 5)} – {task.deliveryEndTime.slice(0, 5)}
      </Td>
      <Td className="font-mono text-xs tabular-nums">
        {task.externalTrackingNumber ?? <span className="text-[color:var(--color-text-tertiary)]">—</span>}
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
    </tr>
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

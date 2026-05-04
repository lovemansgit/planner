"use client";

// /admin/failed-pushes — interactive client component
//
// Day 8 / D8-5. Renders the unresolved failed_pushes table with:
//   - per-row retry button
//   - per-row checkbox + a header "select all" toggle
//   - "Retry selected" bulk action that paces the API calls at
//     200ms apart (5 req/sec — same as the cron's per-task pacing).
//
// The bulk-retry throttle is INTENTIONALLY client-side. The brief
// requires "5 req/sec throttle (same as cron) so bulk operation
// doesn't hammer SF" and the cleanest way to honour that without
// adding a server bulk endpoint is sequential `await fetch(...)`
// + `await sleep(200)` between dispatches. Each retry remains
// independently audited via `failed_push.retried` (one event per
// retry, not one event per bulk operation).
//
// Failure handling: a single row's retry-failure (404, 400, 403,
// 502) does NOT abort the bulk run. Each row's outcome is recorded
// in component state and shown inline; the operator sees which rows
// succeeded vs. which need re-investigation. Retried rows are
// removed from the queue on success and stay (with updated
// attempt_count) on failure.

import { useState } from "react";

import type { FailedPush } from "@/modules/failed-pushes";
import type { SinglePushOutcome } from "@/modules/task-push";

const SF_THROTTLE_MS = 200;

interface RetryResultEnvelope {
  readonly failedPush: FailedPush;
  readonly outcome: SinglePushOutcome;
}

type RowState =
  | { readonly kind: "idle" }
  | { readonly kind: "retrying" }
  | { readonly kind: "succeeded"; readonly outcome: SinglePushOutcome }
  | { readonly kind: "failed"; readonly message: string };

export function FailedPushesAdmin({ initialRows }: { initialRows: readonly FailedPush[] }) {
  const [rows, setRows] = useState<readonly FailedPush[]>(initialRows);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkInFlight, setBulkInFlight] = useState(false);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const anySelected = selected.size > 0;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  };

  const setRowState = (id: string, state: RowState) =>
    setRowStates((prev) => ({ ...prev, [id]: state }));

  const removeRowOnSuccess = (outcome: SinglePushOutcome, id: string) => {
    if (
      outcome.kind === "succeeded" ||
      outcome.kind === "awb_reconciled" ||
      outcome.kind === "task_already_pushed"
    ) {
      setRows((prev) => prev.filter((r) => r.id !== id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const updateRowOnFailure = (refreshed: FailedPush) => {
    setRows((prev) => prev.map((r) => (r.id === refreshed.id ? refreshed : r)));
  };

  const retryOne = async (id: string) => {
    setRowState(id, { kind: "retrying" });
    try {
      const res = await fetch(`/api/failed-pushes/${id}/retry`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        const message = body?.error?.message ?? `HTTP ${res.status}`;
        setRowState(id, { kind: "failed", message });
        return;
      }
      const envelope = (await res.json()) as RetryResultEnvelope;
      setRowState(id, { kind: "succeeded", outcome: envelope.outcome });
      if (
        envelope.outcome.kind === "succeeded" ||
        envelope.outcome.kind === "awb_reconciled" ||
        envelope.outcome.kind === "task_already_pushed"
      ) {
        removeRowOnSuccess(envelope.outcome, id);
      } else {
        updateRowOnFailure(envelope.failedPush);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "network error";
      setRowState(id, { kind: "failed", message });
    }
  };

  const retrySelected = async () => {
    if (!anySelected || bulkInFlight) return;
    setBulkInFlight(true);
    const ids = Array.from(selected);
    for (let i = 0; i < ids.length; i++) {
      await retryOne(ids[i]);
      if (i < ids.length - 1) {
        // 5 req/sec — matches the cron's SF_THROTTLE_MS pacing so a
        // bulk admin retry doesn't exceed the same rate the cron is
        // designed for.
        await new Promise((resolve) => setTimeout(resolve, SF_THROTTLE_MS));
      }
    }
    setBulkInFlight(false);
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="text-sm text-[color:var(--color-text-secondary)]">
          {selected.size} of {rows.length} selected
        </p>
        <button
          type="button"
          onClick={retrySelected}
          disabled={!anySelected || bulkInFlight}
          className="border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-primary)] px-5 py-2 text-xs font-medium uppercase tracking-[0.15em] text-navy transition-colors hover:bg-[color:var(--color-surface-secondary)] disabled:opacity-40"
        >
          {bulkInFlight ? "Retrying…" : "Retry selected"}
        </button>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[color:var(--color-border-strong)]">
            <Th className="w-8">
              <input
                type="checkbox"
                aria-label="Select all rows"
                checked={allSelected}
                onChange={toggleAll}
              />
            </Th>
            <Th>Task</Th>
            <Th>Reason</Th>
            <Th>Attempts</Th>
            <Th>Last attempt</Th>
            <Th>Action</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <RowView
              key={row.id}
              row={row}
              state={rowStates[row.id] ?? { kind: "idle" }}
              isSelected={selected.has(row.id)}
              onToggle={() => toggleOne(row.id)}
              onRetry={() => retryOne(row.id)}
              bulkInFlight={bulkInFlight}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowView({
  row,
  state,
  isSelected,
  onToggle,
  onRetry,
  bulkInFlight,
}: {
  row: FailedPush;
  state: RowState;
  isSelected: boolean;
  onToggle: () => void;
  onRetry: () => void;
  bulkInFlight: boolean;
}) {
  const isRetrying = state.kind === "retrying";
  return (
    <tr className="border-b border-[color:var(--color-border-default)] last:border-b-0 align-top">
      <Td className="w-8 py-5">
        <input
          type="checkbox"
          aria-label={`Select task ${row.taskId.slice(0, 8)}`}
          checked={isSelected}
          onChange={onToggle}
          disabled={bulkInFlight}
        />
      </Td>
      <Td className="font-mono text-xs tabular-nums">{row.taskId.slice(0, 8)}</Td>
      <Td>
        <ReasonCell row={row} />
      </Td>
      <Td className="tabular-nums">{row.attemptCount}</Td>
      <Td className="tabular-nums text-[color:var(--color-text-secondary)]">
        {formatTimestamp(row.lastAttemptedAt)}
      </Td>
      <Td>
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying || bulkInFlight}
          className="border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-primary)] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.15em] text-navy transition-colors hover:bg-[color:var(--color-surface-secondary)] disabled:opacity-40"
        >
          {isRetrying ? "Retrying…" : "Retry"}
        </button>
        <ResultBadge state={state} />
      </Td>
    </tr>
  );
}

function ReasonCell({ row }: { row: FailedPush }) {
  return (
    <div>
      <span className="text-xs uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)]">
        {row.failureReason}
      </span>
      {row.failureDetail !== null && row.failureDetail.length > 0 ? (
        <p className="mt-1 line-clamp-2 text-xs text-[color:var(--color-text-tertiary)]">
          {row.failureDetail}
        </p>
      ) : null}
    </div>
  );
}

function ResultBadge({ state }: { state: RowState }) {
  if (state.kind === "idle" || state.kind === "retrying") return null;
  if (state.kind === "succeeded") {
    return (
      <p className="mt-2 text-xs text-green">
        {humanizeOutcome(state.outcome)}
      </p>
    );
  }
  return (
    <p className="mt-2 text-xs text-red" title={state.message}>
      {state.message}
    </p>
  );
}

function humanizeOutcome(outcome: SinglePushOutcome): string {
  switch (outcome.kind) {
    case "succeeded":
      return `Pushed (${outcome.externalId})`;
    case "awb_reconciled":
      return `Reconciled via AWB (${outcome.externalId})`;
    case "awb_exists":
      return `AWB exists; reconcile failed — back to DLQ`;
    case "failed_to_dlq":
      return `Failed (${outcome.failureReason}) — back to DLQ`;
    case "skipped_district":
      return `Skipped — consignee district sentinel`;
    case "tenant_skipped":
      return `Skipped — tenant ${outcome.reason}`;
    case "task_already_pushed":
      return `Already pushed (${outcome.externalId})`;
    case "task_not_found":
      return `Task not found`;
  }
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`py-4 text-left text-xs font-medium uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)] ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-5 align-top ${className}`}>{children}</td>;
}

function formatTimestamp(iso: string): string {
  // Operator-readable: "May 02 17:09" — date + time-of-day in UTC, no
  // year (column width). Timezone displayed in the header tooltip
  // (out of scope; helper covers the row case).
  const d = new Date(iso);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day} ${hours}:${minutes}`;
}

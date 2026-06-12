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

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";

import Link from "next/link";

import { podProxyPhotoPaths } from "@/modules/tasks/pod-proxy";
import type { Task, TaskListRow } from "@/modules/tasks/types";
import type { ConsigneeAddressRow } from "@/modules/subscription-addresses";

import { Badge } from "@/components/Badge";
import { OutlineButton } from "@/components/OutlineButton";
import { TaskTimelineDrawer } from "@/components/task-timeline/TaskTimelineDrawer";

import { consigneeCellModel } from "./_components/consignee-cell";

import {
  cancelTaskAction,
  editTaskAddressAction,
  editTaskNoteAction,
  getTaskEditContextAction,
  type CancelTaskActionResult,
  type EditTaskActionResult,
  type GetTaskEditContextActionResult,
} from "./_actions";
import { PodIcon } from "./_components/PodIcon";
import { PodLightboxModal } from "./_components/PodLightboxModal";
import { StatusIcon } from "./_components/StatusIcon";
import { podCellState } from "./_components/pod-state";
import { TASK_STATUS_FILTERS } from "./status";

interface TasksClientProps {
  readonly initialTasks: readonly TaskListRow[];
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
  // R6-part-2: the task whose timeline drawer is open (null = closed).
  const [timelineTask, setTimelineTask] = useState<TaskListRow | null>(null);

  const failedSet = useMemo(() => new Set(failedPushTaskIds), [failedPushTaskIds]);
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
          className="rounded-sm border border-navy px-4 py-2 text-xs uppercase tracking-[0.2em] text-navy transition-opacity duration-[120ms] ease-out hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary disabled:cursor-not-allowed disabled:border-[color:var(--color-border-default)] disabled:text-[color:var(--color-text-tertiary)]"
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

      {/* R6-part-1: horizontal scroll — the consignee-context columns
          widen the table past narrow viewports. Responsive column
          collapse stays Tier-2. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
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
              <Th>Date</Th>
              <Th>AWB</Th>
              <Th>Status</Th>
              <Th>Consignee</Th>
              <Th>Address</Th>
              <Th>District</Th>
              <Th>Emirate</Th>
              <Th>Telephone</Th>
              <Th>Actions</Th>
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
                onOpenPod={(photos) => setLightboxPhotos(photos)}
                onOpenTimeline={() => setTimelineTask(task)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {lightboxPhotos !== null ? (
        <PodLightboxModal
          photos={lightboxPhotos}
          onClose={() => setLightboxPhotos(null)}
        />
      ) : null}

      {/* R6-part-2: AWB cell opens the shared task-timeline drawer (the same
          one the consignee calendar uses). `awb` drives the R6.3
          partial-state banner for not-yet-pushed (null-AWB) tasks. */}
      {timelineTask !== null ? (
        <TaskTimelineDrawer
          consigneeId={timelineTask.consigneeId}
          taskId={timelineTask.id}
          deliveryDate={timelineTask.deliveryDate}
          awb={timelineTask.externalTrackingNumber}
          onClose={() => setTimelineTask(null)}
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
  onOpenTimeline,
}: {
  readonly task: TaskListRow;
  readonly checked: boolean;
  readonly onToggle: () => void;
  readonly failed: boolean;
  readonly onOpenPod: (photos: readonly string[]) => void;
  readonly onOpenTimeline: () => void;
}) {
  const filter = TASK_STATUS_FILTERS.find((f) => f.value === task.internalStatus);
  const podTone = podCellState(task.podPhotos);
  const cgn = consigneeCellModel(task);
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
      <Td className="whitespace-nowrap tabular-nums">{task.deliveryDate}</Td>
      <Td className="font-mono text-xs tabular-nums">
        {/* R6-part-2: the AWB cell opens the task-timeline drawer. Both
            populated and not-yet-pushed (—) tasks open it; the drawer
            shows the R6.3 banner for the null-AWB case. */}
        <button
          type="button"
          onClick={onOpenTimeline}
          aria-label={
            task.externalTrackingNumber !== null
              ? `View timeline for AWB ${task.externalTrackingNumber}`
              : `View timeline for order ${task.customerOrderNumber} (not yet pushed)`
          }
          className="text-left transition-opacity duration-[120ms] ease-out hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-inset"
        >
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
        </button>
      </Td>
      <Td>
        <Badge className={filter?.pillClass ?? ""}>
          <StatusIcon status={task.internalStatus} />
          {filter?.label ?? task.internalStatus}
        </Badge>
        {/* R6: failed-push state folded onto the Status column (was its
            own "Issues" column). */}
        {failed ? (
          // Component-lib rollout (finding 3) — this badge carried an
          // off-recipe text-[10px]; normalising to the shared <Badge>
          // (text-xs) is a deliberate, visible tidy-up, not a zero-change
          // swap. Margin + red palette preserved via className.
          <Badge className="mt-1 bg-red/15 text-red">Failed push</Badge>
        ) : null}
      </Td>
      {/* R6.4: Consignee · Address · District · Emirate · Telephone form
          ONE click target to the consignee detail page. The name cell is
          the keyboard-focusable primary link; the rest are mouse targets
          (tabIndex -1) so the block is one logical stop. Telephone is
          plain text inside the link — NOT a tel: link. */}
      <ConsigneeCell href={cgn.href} primary ariaLabel={`View consignee ${cgn.name}`}>
        {cgn.name}
      </ConsigneeCell>
      <ConsigneeCell href={cgn.href}>{cgn.addressLine}</ConsigneeCell>
      <ConsigneeCell href={cgn.href}>{cgn.district}</ConsigneeCell>
      <ConsigneeCell href={cgn.href}>{cgn.emirate}</ConsigneeCell>
      <ConsigneeCell href={cgn.href} mono>
        {cgn.telephone}
      </ConsigneeCell>
      {/* R6: POD folded into Actions (was its own column). */}
      <Td>
        <div className="flex items-center gap-2">
          <ActionsCell task={task} />
          <PodCell task={task} tone={podTone} onOpenPod={onOpenPod} />
        </div>
      </Td>
    </tr>
  );
}

// R6.4 — one consignee column cell. Each cell links to the same
// /consignees/[id] href so the Name·Address·District·Emirate·Telephone
// block reads as a single click target. Padding matches `Td` (py-4) so
// the link fills the cell and the hover tint signals the target.
function ConsigneeCell({
  href,
  children,
  primary = false,
  ariaLabel,
  mono = false,
}: {
  readonly href: string;
  readonly children: React.ReactNode;
  readonly primary?: boolean;
  readonly ariaLabel?: string;
  readonly mono?: boolean;
}) {
  return (
    <td className="align-middle">
      <Link
        href={href}
        aria-label={primary ? ariaLabel : undefined}
        tabIndex={primary ? undefined : -1}
        className={`block whitespace-nowrap py-4 text-navy transition-colors duration-[120ms] ease-out hover:bg-[color:var(--color-tint-navy-subtle)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-inset ${
          mono ? "font-mono text-xs tabular-nums" : ""
        }`}
      >
        {children}
      </Link>
    </td>
  );
}

// =============================================================================
// Day-30 B2 — per-row Cancel + Edit affordances (plan #308 v2)
//
// OQ-1 (single canonical path): Cancel is enabled iff task.subscriptionId is
//   non-null. Ad-hoc tasks (subscription_id IS NULL) render the button in
//   visible-but-disabled state with explanatory tooltip; the server action
//   ALSO rejects ad-hoc cancels for defense-in-depth (B2-I2′ two-layer).
//
// OQ-2 (address edit): the Edit modal writes addressId via
//   updateTaskAndPushOutbound (Day-52 R4 ConsigneeSnapshot option B — the
//   wrapper builds the snapshot server-side and enqueues the SF update).
//   The /tasks vs popover address-path asymmetry memo is retired by the
//   same ruling: both paths now push SF.
//
// OQ-3 (UX disclosure): RETIRED Day-52 — the address edit pushes SF
//   directly, so the "next scheduled push pass" deferral copy is gone;
//   the action returns honest "sending update to SuiteFleet" / "saved"
//   copy and the modal renders whatever the action returns.
//
// OQ-5 (defense-in-depth whitelist): delivery-date is NOT exposed in the UI
//   and is rejected at the form-action Zod boundary if a malicious or buggy
//   payload includes it.
// =============================================================================

function ActionsCell({ task }: { readonly task: Task }) {
  const [openModal, setOpenModal] = useState<"cancel" | "edit" | null>(null);
  const canCancel = task.subscriptionId !== null;
  return (
    <>
      <div className="flex gap-2">
        <OutlineButton
          tone="red"
          disabled={!canCancel}
          title={
            canCancel
              ? "Cancel this delivery (notifies SuiteFleet)"
              : "Cancel via SuiteFleet directly — this task has no Planner subscription"
          }
          onClick={() => setOpenModal("cancel")}
        >
          Cancel
        </OutlineButton>
        <OutlineButton tone="navy" onClick={() => setOpenModal("edit")}>
          Edit
        </OutlineButton>
      </div>
      {openModal === "cancel" ? (
        <CancelModal task={task} onClose={() => setOpenModal(null)} />
      ) : null}
      {openModal === "edit" ? (
        <EditModal task={task} onClose={() => setOpenModal(null)} />
      ) : null}
    </>
  );
}

// -----------------------------------------------------------------------------
// CancelModal — confirmation + form action
// -----------------------------------------------------------------------------

function CancelModal({ task, onClose }: { readonly task: Task; readonly onClose: () => void }) {
  const boundAction = cancelTaskAction.bind(null, task.id);
  const [result, formAction, isPending] = useActionState<
    CancelTaskActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (result.kind === "success" || result.kind === "idempotent_replay") {
      onClose();
    }
  }, [result.kind, onClose]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Cancel delivery for order ${task.customerOrderNumber}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
    >
      <div className="w-full max-w-sm border border-stone-200 border-t-[1px] border-t-red bg-surface-primary p-6">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Cancel delivery
        </p>
        <h2 className="mt-1 font-display text-lg font-semibold text-navy">
          Order {task.customerOrderNumber}
        </h2>
        <p className="mt-4 text-xs text-[color:var(--color-text-secondary)]">
          This cancels the delivery on SuiteFleet and reduces subscription count by one. This
          cannot be undone.
        </p>
        <p className="mt-2 text-xs text-[color:var(--color-text-secondary)]">
          Delivery date: <span className="tabular-nums text-navy">{task.deliveryDate}</span>
        </p>
        <ErrorBanner result={result} />
        <form action={formAction} className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
          >
            Keep delivery
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-sm border border-red bg-red px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Cancelling…" : "Cancel delivery"}
          </button>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// EditModal — two sub-modes (address / note)
// -----------------------------------------------------------------------------

function EditModal({ task, onClose }: { readonly task: Task; readonly onClose: () => void }) {
  const [mode, setMode] = useState<"address" | "note">("address");
  const [context, setContext] = useState<
    | { kind: "loading" }
    | { kind: "loaded"; result: GetTaskEditContextActionResult }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void getTaskEditContextAction(task.id).then((result) => {
      if (!cancelled) setContext({ kind: "loaded", result });
    });
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit order ${task.customerOrderNumber}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
    >
      <div className="w-full max-w-md border border-stone-200 border-t-[1px] border-t-green bg-surface-primary p-6">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Edit delivery
        </p>
        <h2 className="mt-1 font-display text-lg font-semibold text-navy">
          Order {task.customerOrderNumber}
        </h2>

        <div className="mt-5 flex gap-2 border-b border-stone-200">
          <ModeTab active={mode === "address"} onClick={() => setMode("address")}>
            Address
          </ModeTab>
          <ModeTab active={mode === "note"} onClick={() => setMode("note")}>
            Driver note
          </ModeTab>
        </div>

        {context.kind === "loading" ? (
          <div aria-busy="true" aria-label="Loading" className="mt-6 animate-pulse space-y-3">
            <div className="h-3 w-1/3 rounded-sm bg-stone-200" />
            <div className="h-9 w-full rounded-sm bg-ivory" />
            <div className="h-9 w-full rounded-sm bg-ivory" />
          </div>
        ) : context.kind === "loaded" && context.result.kind === "success" ? (
          mode === "address" ? (
            <EditAddressPanel
              taskId={task.id}
              currentAddressId={context.result.task.addressId}
              availableAddresses={context.result.availableAddresses}
              onClose={onClose}
            />
          ) : (
            <EditNotePanel
              taskId={task.id}
              currentNotes={context.result.task.notes}
              onClose={onClose}
            />
          )
        ) : context.kind === "loaded" ? (
          <p
            role="alert"
            className="mt-6 border border-red/40 bg-red/10 px-3 py-2 text-xs text-red"
          >
            {context.result.kind === "forbidden"
              ? context.result.message
              : context.result.kind === "not_found"
                ? context.result.message
                : context.result.kind === "validation"
                  ? context.result.message
                  : "Could not load task."}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-[10px] uppercase tracking-[0.14em] ${
        active
          ? "border-b-2 border-green text-navy"
          : "text-[color:var(--color-text-secondary)] hover:text-navy"
      }`}
    >
      {children}
    </button>
  );
}

function EditAddressPanel({
  taskId,
  currentAddressId,
  availableAddresses,
  onClose,
}: {
  readonly taskId: string;
  readonly currentAddressId: string | null;
  readonly availableAddresses: readonly ConsigneeAddressRow[];
  readonly onClose: () => void;
}) {
  const boundAction = editTaskAddressAction.bind(null, taskId);
  const [result, formAction, isPending] = useActionState<
    EditTaskActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });
  const successRef = useRef<HTMLDivElement>(null);

  // Auto-close on idempotent / non-meaningful results; success holds open
  // briefly so the operator can read the OQ-3 disclosure copy.
  useEffect(() => {
    if (result.kind === "success") {
      const t = setTimeout(onClose, 2400);
      return () => clearTimeout(t);
    }
  }, [result.kind, onClose]);

  if (availableAddresses.length === 0) {
    return (
      <p className="mt-6 text-xs text-[color:var(--color-text-secondary)]">
        No alternative addresses on file. Add a second address from the consignee form first.
      </p>
    );
  }

  if (result.kind === "success") {
    // OQ-3 — VERBATIM UX disclosure copy. Do NOT paraphrase.
    return (
      <div
        ref={successRef}
        role="status"
        className="mt-6 rounded-sm border border-green/40 bg-green/10 px-3 py-3 text-xs text-navy"
      >
        {result.message}
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-5 space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Pick a new address
        </legend>
        {availableAddresses.map((addr) => (
          <label
            key={addr.id}
            className="flex items-start gap-2 rounded-sm border border-stone-200 bg-paper px-3 py-2 text-xs text-navy hover:border-navy"
          >
            <input
              type="radio"
              name="addressId"
              value={addr.id}
              required
              defaultChecked={addr.id === currentAddressId}
              className="mt-0.5"
            />
            <span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.1em] text-[color:var(--color-text-tertiary)]">
                {addr.label}
                {addr.isPrimary ? " · primary" : ""}
              </span>
              <span className="block">
                {addr.line}, {addr.district}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <ErrorBanner result={result} />
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save address"}
      </button>
    </form>
  );
}

function EditNotePanel({
  taskId,
  currentNotes,
  onClose,
}: {
  readonly taskId: string;
  readonly currentNotes: string | null;
  readonly onClose: () => void;
}) {
  const boundAction = editTaskNoteAction.bind(null, taskId);
  const [result, formAction, isPending] = useActionState<
    EditTaskActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (result.kind === "success") {
      onClose();
    }
  }, [result.kind, onClose]);

  return (
    <form action={formAction} className="mt-5 space-y-3">
      <label className="block">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Note for driver
        </span>
        <textarea
          name="notes"
          rows={4}
          required
          maxLength={1000}
          defaultValue={currentNotes ?? ""}
          placeholder="e.g. gate code 4521; call on arrival"
          className="mt-1 w-full rounded-sm border border-stone-200 bg-paper px-2 py-1.5 text-sm text-navy focus:border-navy focus:outline-none"
        />
      </label>
      <ErrorBanner result={result} />
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save note"}
      </button>
    </form>
  );
}

function ErrorBanner({
  result,
}: {
  readonly result:
    | CancelTaskActionResult
    | EditTaskActionResult
    | { readonly kind: "idle" }
    | null;
}) {
  if (result === null || result.kind === "idle") return null;
  if (result.kind === "success" || result.kind === "idempotent_replay") return null;
  const message = "message" in result ? result.message : "";
  return (
    <p
      role="alert"
      className="mb-2 rounded-sm border border-red/40 bg-red/10 px-3 py-2 text-xs text-red"
    >
      {message}
    </p>
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
  //
  // Day-53 POD proxy (Love-ruled UAT-blocking): the lightbox renders
  // same-origin proxy paths, not the stored SF pre-signed URLs — the
  // server fetches those (src/modules/tasks/pod-proxy.ts grounding).
  const photos = podProxyPhotoPaths(task.id, task.podPhotos) ?? [];
  return (
    <button
      type="button"
      onClick={() => onOpenPod(photos)}
      aria-label={`View proof of delivery for order ${task.customerOrderNumber}`}
      className="inline-flex items-center justify-center rounded-sm transition-opacity duration-[120ms] ease-out hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-1"
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

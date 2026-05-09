// Day 19 / A2 plan §6.2 — calendar week-card inline POD card.
//
// Renders when a task's internal_status === 'DELIVERED' AND podPhotos is
// non-null + non-empty. Per §6.2 interpretation (ii) ruling: replaces
// the DayActionPopover trigger entirely; click opens the shared
// PodLightboxModal directly. Skip popover stays for non-DELIVERED
// states (and DELIVERED-with-empty-photos, which the parent guards).
//
// Lightbox modal owns local open state per card. Each calendar cell
// hosts at most one task's modal at a time, so per-card state is
// simpler than lifting a shared lightbox up to the week view.
//
// First-photo thumbnail (~64×64-equivalent within the cell) plus
// status label + time window stacked below — preserves the existing
// week-view information density while making POD the primary
// affordance.

"use client";

import { useState } from "react";

import { PodLightboxModal } from "@/app/(app)/tasks/_components/PodLightboxModal";

import { AddressIndicator } from "./AddressIndicator";

interface CalendarPodCardProps {
  readonly photos: readonly string[];
  readonly statusLabel: string;
  readonly statusClasses: string;
  readonly timeWindow: string;
  readonly deliveryDate: string;
  /** Day-20 §3.3.3 — Home/Office/Other label, rendered below time window. */
  readonly addressLabel: "home" | "office" | "other" | null;
}

export function CalendarPodCard({
  photos,
  statusLabel,
  statusClasses,
  timeWindow,
  deliveryDate,
  addressLabel,
}: CalendarPodCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Proof of delivery for ${deliveryDate}`}
        className="block w-full overflow-hidden rounded-sm border border-stone-200 bg-paper text-left transition-opacity duration-[120ms] ease-out hover:opacity-90"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photos[0]}
          alt={`Proof of delivery for ${deliveryDate}`}
          className="block h-16 w-full object-cover"
        />
        <span className="block px-1.5 pt-1 pb-1.5">
          <span
            className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${statusClasses}`}
          >
            {statusLabel}
          </span>
          <span className="mt-0.5 block text-[10px] tabular-nums text-[color:var(--color-text-tertiary)]">
            {timeWindow}
          </span>
          <AddressIndicator label={addressLabel} />
        </span>
      </button>

      {open ? (
        <PodLightboxModal photos={photos} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

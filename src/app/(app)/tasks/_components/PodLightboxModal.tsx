// Day 19 / A2 plan §6.1 + §6.2 — shared POD lightbox modal.
//
// Renders one photo at a time. Multi-photo arrays (length > 1) get
// prev/next chevrons + an "N of M" counter; single-photo arrays render
// just the photo + close affordance. Empty arrays should NOT reach this
// component (callers must short-circuit and render the muted-icon /
// no-trigger state instead — see PodIcon for the muted variant and
// CalendarWeekView for the trigger-swap guard).
//
// Close affordances: ESC, backdrop click, X button. Pattern matches
// CrmStateModal + DayActionPopover (role="dialog", aria-modal="true",
// bg-navy/20 overlay, click-outside via ref containment check).
//
// Image rendering: plain <img src={url}>. No remote-loader config; the
// SF-side URLs are stored verbatim per Option (A) plain string array
// contract (A2 plan §4.4).

"use client";

import { useEffect, useRef, useState } from "react";

interface PodLightboxModalProps {
  readonly photos: readonly string[];
  readonly onClose: () => void;
  /** Optional title for the dialog aria-label; defaults to "Proof of delivery". */
  readonly title?: string;
}

export function PodLightboxModal({
  photos,
  onClose,
  title = "Proof of delivery",
}: PodLightboxModalProps) {
  const [index, setIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // ESC closes; arrow keys navigate when multi-photo.
  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (photos.length > 1) {
        if (event.key === "ArrowRight") {
          setIndex((i) => (i + 1) % photos.length);
        } else if (event.key === "ArrowLeft") {
          setIndex((i) => (i - 1 + photos.length) % photos.length);
        }
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onClose, photos.length]);

  // Backdrop click closes when the click target is outside the panel.
  function handleBackdropMousedown(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as Node;
    if (panelRef.current && !panelRef.current.contains(target)) {
      onClose();
    }
  }

  if (photos.length === 0) return null;
  const current = photos[Math.min(index, photos.length - 1)];
  const showControls = photos.length > 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={handleBackdropMousedown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
    >
      <div
        ref={panelRef}
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-sm border border-stone-200 bg-surface-primary p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
            Proof of delivery
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close proof-of-delivery viewer"
            className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
          >
            ✕
          </button>
        </div>

        <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-stone-200/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current}
            alt={
              showControls
                ? `Proof of delivery photo ${index + 1} of ${photos.length}`
                : "Proof of delivery photo"
            }
            className="max-h-[70vh] max-w-full object-contain"
          />

          {showControls ? (
            <>
              <button
                type="button"
                aria-label="Previous photo"
                onClick={() =>
                  setIndex((i) => (i - 1 + photos.length) % photos.length)
                }
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-sm border border-stone-200 bg-surface-primary/90 px-3 py-2 text-sm text-navy shadow-sm hover:bg-surface-primary"
              >
                ←
              </button>
              <button
                type="button"
                aria-label="Next photo"
                onClick={() => setIndex((i) => (i + 1) % photos.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm border border-stone-200 bg-surface-primary/90 px-3 py-2 text-sm text-navy shadow-sm hover:bg-surface-primary"
              >
                →
              </button>
            </>
          ) : null}
        </div>

        {showControls ? (
          <p className="mt-3 text-center text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] tabular-nums">
            {index + 1} of {photos.length}
          </p>
        ) : null}
      </div>
    </div>
  );
}

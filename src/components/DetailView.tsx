// <DetailView> + <DetailHeader> + <DetailSection> (Phase 9 · Step 3.5 — Gap D).
//
// One detail system for admin AND merchant: a floating B+ card whose only navy
// is a 3px structural spine (never a band), a header (eyebrow + title + status
// + actions), and a two-column fill (D3) of FieldRow sections. Built on the
// shipped DetailGrid (Step 3.1). Compose with <FieldRow> for the rows.
//
//   <DetailView header={<DetailHeader .../>}>
//     <DetailSection label="Contact"> <FieldRow .../> … </DetailSection>
//     <DetailSection label="Delivery"> … </DetailSection>
//   </DetailView>

import type { ReactNode } from "react";

import { DetailGrid } from "./PageShell";
import {
  DETAIL_ACTIONS,
  DETAIL_BODY,
  DETAIL_CARD,
  DETAIL_EYEBROW,
  DETAIL_HEADER,
  DETAIL_SPINE,
  DETAIL_TITLE,
  DETAIL_TITLE_ROW,
  SECTION_LABEL,
} from "./detail-view-recipe";

interface DetailHeaderProps {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  /** A StatusBadge (or other pill) shown inline after the title. */
  readonly status?: ReactNode;
  /** Primary / secondary action buttons. */
  readonly actions?: ReactNode;
}

export function DetailHeader({ eyebrow, title, status, actions }: DetailHeaderProps) {
  return (
    <div className={DETAIL_HEADER}>
      <div className="min-w-0">
        {eyebrow ? <p className={DETAIL_EYEBROW}>{eyebrow}</p> : null}
        <div className={DETAIL_TITLE_ROW}>
          <h1 className={DETAIL_TITLE}>{title}</h1>
          {status}
        </div>
      </div>
      {actions ? <div className={DETAIL_ACTIONS}>{actions}</div> : null}
    </div>
  );
}

interface DetailSectionProps {
  readonly label: string;
  /** FieldRows. */
  readonly children: ReactNode;
}

export function DetailSection({ label, children }: DetailSectionProps) {
  return (
    <section>
      <p className={SECTION_LABEL}>{label}</p>
      <dl>{children}</dl>
    </section>
  );
}

interface DetailViewProps {
  /** A <DetailHeader>. */
  readonly header: ReactNode;
  /** <DetailSection>s, laid out two-column (D3). */
  readonly children: ReactNode;
}

export function DetailView({ header, children }: DetailViewProps) {
  return (
    <div className={DETAIL_CARD}>
      <span className={DETAIL_SPINE} aria-hidden />
      {header}
      <div className={DETAIL_BODY}>
        <DetailGrid>{children}</DetailGrid>
      </div>
    </div>
  );
}

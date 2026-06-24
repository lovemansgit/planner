// Shared action button — Phase 9 Step 3.2 (Direction B "Dispatch" skin).
//
// The one button primitive for the whole app. Direction-B variants —
// `primary` (green, the only one that lifts), `secondary` (navy, flat),
// `ghost` (text), `danger` (red, flat) — across `sm`/`md`/`lg`, each a fixed
// height + min-width, label NEVER wraps. Renders a <button> OR a Next <Link>
// (when `href` is set) with identical appearance, so the green "Onboard / New"
// call-to-action anchor and a form submit are the same component. States:
// default / hover / active / disabled / loading, with a VISIBLE green focus
// ring. A disabled button stays present (aria-disabled) and should carry a
// `title` naming why — never hidden, never silently dead.
//
// The class strings live in the node-tested ./button-recipe sibling so every
// variant×size stays locked (audit finding 2). The legacy `outline`/`filled`
// API (+ `tone`) is @deprecated and kept only for the not-yet-migrated
// failed-pushes surface; it is removed in the final adoption bundle.

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

import {
  bButtonClass,
  buttonClass,
  type BButtonSize,
  type BButtonVariant,
  type ButtonTone,
  type ButtonVariant,
} from "./button-recipe";

type Variant = BButtonVariant | ButtonVariant;

const B_VARIANTS = new Set<Variant>(["primary", "secondary", "ghost", "danger"]);

type CommonProps = {
  /** `primary` | `secondary` | `ghost` | `danger`. (`outline`/`filled` are @deprecated.) */
  readonly variant?: Variant;
  readonly size?: BButtonSize;
  /** @deprecated outline-only border weight; ignored for B variants. */
  readonly tone?: ButtonTone;
  readonly className?: string;
  readonly children: ReactNode;
  /** Optional leading glyph; replaced by the spinner while `loading`. */
  readonly leadingIcon?: ReactNode;
  /** Shows a spinner, sets aria-busy, and blocks interaction. */
  readonly loading?: boolean;
  readonly disabled?: boolean;
  /** Tooltip — name the reason when the button is disabled. */
  readonly title?: string;
};

type ButtonModeProps = CommonProps & {
  readonly href?: undefined;
  readonly type?: "button" | "submit";
  readonly onClick?: () => void;
};

type LinkModeProps = CommonProps & {
  /** Renders a Next <Link> with identical appearance (client-side nav preserved). */
  readonly href: string;
  readonly onClick?: () => void;
};

type ButtonProps = ButtonModeProps | LinkModeProps;

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
    />
  );
}

function composeClasses(variant: Variant, size: BButtonSize, tone: ButtonTone, className: string): string {
  if (B_VARIANTS.has(variant)) {
    return bButtonClass(variant as BButtonVariant, size, className);
  }
  // Deprecated path: the old recipe has no `lg`; fold it to `md`.
  const legacySize = size === "lg" ? "md" : size;
  return buttonClass(variant as ButtonVariant, legacySize, tone, className);
}

/**
 * Decide the `onClick` (if any) handed to the link-mode <Link>.
 *
 * This is what keeps `<Button href>` SERVER-SAFE. Button.tsx has no
 * `"use client"`, so it can be rendered from a server component — which means
 * it must NEVER fabricate a function and hand it to the client <Link>. Doing so
 * serializes a function across the RSC boundary and throws "Event handlers
 * cannot be passed to Client Component props" at request time (the bug that
 * 500'd /subscriptions). So we forward a handler ONLY when the caller actually
 * passed an `onClick`:
 *   • no `onClick` → `undefined` → nothing crosses the boundary. A plain nav
 *     `<Button href>` (the common case) renders from a server component.
 *   • `onClick` set → the caller is necessarily a client component already, and
 *     we wrap the callback so the disabled state still blocks it for EVERY
 *     variant (the deprecated recipe lacks `aria-disabled:pointer-events-none`).
 */
export function resolveLinkClickHandler(
  onClick: (() => void) | undefined,
  isDisabled: boolean,
): ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined {
  if (onClick === undefined) return undefined;
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (isDisabled) {
      event.preventDefault();
      return;
    }
    onClick();
  };
}

export function Button(props: ButtonProps) {
  const {
    // Default stays the legacy "outline" so the not-yet-migrated failed-pushes
    // screen (whose 4 no-variant <Button>s rely on this default) renders
    // byte-for-byte unchanged. New callers pass an explicit Direction-B variant.
    variant = "outline",
    size = "md",
    tone = "strong",
    className = "",
    children,
    leadingIcon,
    loading = false,
    disabled = false,
    title,
  } = props;

  const isDisabled = disabled || loading;
  const classes = composeClasses(variant, size, tone, className);
  const inner = (
    <>
      {loading ? <Spinner /> : leadingIcon}
      {children}
    </>
  );

  if (props.href !== undefined) {
    // Forward a click handler ONLY when the caller passed one (see
    // resolveLinkClickHandler) — a server-rendered <Button href> must not hand
    // a fabricated function to the client <Link>. Disabled inertness is carried
    // by aria-disabled (the B recipe maps it to pointer-events-none) plus
    // tabIndex=-1, so a plain disabled nav link needs no client handler.
    return (
      <Link
        href={props.href}
        className={classes}
        title={title}
        aria-disabled={isDisabled || undefined}
        aria-busy={loading || undefined}
        tabIndex={isDisabled ? -1 : undefined}
        onClick={resolveLinkClickHandler(props.onClick, isDisabled)}
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      title={title}
      className={classes}
    >
      {inner}
    </button>
  );
}

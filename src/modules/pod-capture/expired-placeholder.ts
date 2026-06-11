// H3 — POD "expired at vendor" styled placeholder (Tier-2 ruling memo
// item H3, Love-assigned to the Day-53 EVE durable-POD lane).
//
// Served by the POD proxy route INSTEAD of the bare 410 when the
// vendor URL is past its 7-day TTL and no captured copy exists. An
// <img> ignores a 410's body and renders the browser's broken-image
// icon; serving a styled SVG with 200 turns the dead state into an
// honest, branded message on EVERY consumer surface with zero UI-file
// changes (the tasks-page POD cell is fenced to Session B's R6 lane).
// Machine consumers distinguish the state via the
// `X-Planner-Pod-State: expired-at-vendor` response header the route
// attaches — the run sheet's expired-state line is updated in the same
// PR (the 410 was a proven observable; the change is Love-ruled).
//
// Pure + dependency-free; brand colors inlined from the app palette
// (navy text on ivory surface) since tokens.css cannot reach an SVG
// response body.

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480" role="img" aria-label="Photo expired at the delivery vendor">
  <rect width="640" height="480" fill="#F4F1EA"/>
  <rect x="24" y="24" width="592" height="432" fill="none" stroke="#252D60" stroke-opacity="0.18" stroke-width="2" stroke-dasharray="8 8"/>
  <g transform="translate(320 200)" stroke="#252D60" stroke-opacity="0.45" stroke-width="3" fill="none">
    <rect x="-44" y="-32" width="88" height="64" rx="6"/>
    <circle cx="0" cy="0" r="16"/>
    <line x1="-58" y1="46" x2="58" y2="-46"/>
  </g>
  <text x="320" y="296" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="22" fill="#252D60">Photo expired at the delivery vendor</text>
  <text x="320" y="328" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="14" fill="#252D60" fill-opacity="0.6">Delivery photos are only available for 7 days unless captured</text>
</svg>`;

/** The H3 expired-state image body. Stable output — pinned by tests. */
export function podExpiredPlaceholderSvg(): string {
  return SVG;
}

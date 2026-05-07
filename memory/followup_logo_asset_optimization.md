---
name: Logo asset optimization — Day-18 polish task
description: Hi-res transcorp-logo.png at public/brand/ committed Day-17 morning is the corporate-aligned master (882KB PNG, 3840×3840 square). For production rendering at typical app-shell display size (~120-200px wide), this file is ~17× larger than necessary. Day-18 brand pass should compress + use Next.js Image OR generate sized variants for the actual rendering contexts. Filing this Day-17 morning so it's not lost in brand-pass scope.
type: project
---

# Logo asset optimization

**Surfaced:** Day-17 morning (T1 logo asset commit PR).

## §1 Current state

`public/brand/transcorp-logo.png` is the corporate-aligned master:
- 882KB file size (real PNG with alpha channel, RGBA)
- 3840×3840 square dimensions (export-master scale; print-master would typically be 10-50MB so this is already partially optimized)
- Transparent background

## §2 Production rendering context

App-shell logo placement per brief §3.3.11 + Day-17 app-shell T2 PR:
- Top-left of app shell on desktop: ~120-180px wide
- Top-left of app shell on mobile: ~80-120px wide
- 1x and 2x display density variants needed for retina rendering

A ~120px-wide PNG at 2x is ~240×~320 pixels. Optimized this is typically <50KB.

## §3 Day-18 brand pass tasks

1. **Compression / responsive variants**: 882KB at 3840×3840 is ~17× over what an optimized app-shell render needs (~50KB at 240×320 for 2x retina). Either (a) compress the master file and serve as-is, or (b) use Next.js Image component with srcset to auto-generate sized variants. Default: (b) — Next.js Image handles this automatically given a single high-resolution source; no compression of the master needed.
2. **Sized variants** (optional, post-compression): generate logo-120.png, logo-240.png (2x), logo-360.png (3x); use Next.js Image component for automatic srcset.
3. **Decision**: keep one master file + Next.js Image OR ship pre-sized variants. Default: Next.js Image — Next.js handles srcset/sizing automatically given a single source.
4. **Phase 2**: navy-background reverse variant + mark-only crop if/when needed.

## §4 Why deferring is correct

App-shell PR ships rendering with the master file as-is. At 882KB, browser handles the rendering at display size; first-load cost is modest and cached. Demo-day impact: imperceptible on any modern connection. Production-grade impact: minor first-load efficiency gain available, polish-tier work.

Compression + Next.js Image migration is mechanical work better batched with Day-18 polish than blocked-on for app-shell PR.

## §5 Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` v1.4 §3.3.11 — logo asset reference + placement
- Day-17 app-shell T2 PR (forthcoming) — first consumer of the asset
- Day-18 brand pass per brief §6 day-by-day plan

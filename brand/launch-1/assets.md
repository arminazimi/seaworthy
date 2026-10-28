# Assets

Which brand asset goes on which surface. Every path is relative to this folder. Nothing here is
copied: the files live in [`../assets`](../assets), [`../exports`](../exports), and
[`../favicon`](../favicon), and the kit only points at them.

## Surfaces

| Surface | Asset | Size | Notes |
| --- | --- | ---: | --- |
| Social preview: the first image on a post, a card, or a launch thread | [`social-preview-dark.png`](../exports/social-preview-dark.png) | 1280 × 640 | The default. Dark canvas, mark, wordmark, tagline, and the command |
| Same, on a light background | [`social-preview-light.png`](../exports/social-preview-light.png) | 1280 × 640 | Only where the platform forces a light theme |
| Banner: README header, docs page, newsletter header | [`banner-dark.png`](../exports/banner-dark.png) | 1500 × 500 | Carries the secondary line, "Verified before it sails." |
| Same, on a light background | [`banner-light.png`](../exports/banner-light.png) | 1500 × 500 | |
| Avatar: profile picture, organization icon | [`avatar-dark.png`](../exports/avatar-dark.png) | 512 × 512 | The mark alone, no wordmark |
| Same, on a light background | [`avatar-light.png`](../exports/avatar-light.png) | 512 × 512 | |
| Product Hunt gallery image, Marketplace logo | [`marketplace-logo-dark.png`](../exports/marketplace-logo-dark.png) | 512 × 512 | Transparent background, so it sits on the platform's own surface |
| Same, on a light surface | [`marketplace-logo-light.png`](../exports/marketplace-logo-light.png) | 512 × 512 | Transparent |
| Marketplace feature-card background | [`marketplace-feature-dark.png`](../exports/marketplace-feature-dark.png) | 965 × 482 | GitHub overlays the listing name and logo on it |
| The mark alone, inline in a post or a README | [`seaworthy-mark-dark.svg`](../assets/seaworthy-mark-dark.svg) | vector | Also [`.png`](../assets/seaworthy-mark-dark.png), and the `light`, `mono`, and `mono-light` variants |
| Status badge, on a verified repository's README | [`badge-passing.svg`](../assets/badge-passing.svg) | vector | Static examples until the Action serves a live badge; see [`../../docs/badge.md`](../../docs/badge.md) |
| Browser tab, app icon, anything from 16 to 48 px | [`favicon.svg`](../favicon/favicon.svg) | scalable | The simplified mark; also `favicon.ico` and the PNG fallbacks in [`../favicon`](../favicon) |
| Review sheet: every variant on one page | [`seaworthy-logo-sheet.png`](../exports/seaworthy-logo-sheet.png) | — | For reviewing a layout, not for publishing |

Editable sources live in [`../templates`](../templates); the PNGs are rendered from them.

## Rules that come with them

- **Dark first.** Use the dark variant unless the surface is light. The mark has a dark and a light
  variant for exactly this reason.
- **Minimum size.** The full mark needs 32 px on screen and 8 mm in print; the one-color mark 24 px
  and 6 mm. Below 24 px, use the favicon mark.
- **Clear space.** Keep one eighth of the mark width (12.5%) free on every side.
- **Never recolor.** Do not recolor part of the mark, fill the rings, close the openings, or move the
  waterline. Do not put the color mark on photography or a low-contrast background.
- **Status colors stay status.** Sea Teal, Signal Amber, and Alert Red mean passing, warnings, and
  errors. They are never decoration, and the badge always carries a word.
- **The full rules are in [`../BRAND_GUIDE.md`](../BRAND_GUIDE.md).** This table is the short version
  for launch day.

## Regenerating them

The PNGs come from the SVG sources:

```bash
npm run build:brand     # the SVGs, tokens.css, and the export presets
npm run export:brand    # the PNGs (needs Chrome or Chromium)
```

`npm run check` fails when a generated file drifts from its source, so a launch asset is never stale
by accident.

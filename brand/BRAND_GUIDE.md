# Seaworthy brand guide

Version `1.0.0` · English-only · Dark-first

This guide turns the Seaworthy identity into reusable rules for the product, documentation, repository, social, and marketplace surfaces. Every SVG and PNG here is generated; see [Generated files](#generated-files).

## Core identity

**Product name:** Seaworthy  
**Tagline:** Ship sites agents can trust.  
**Secondary line:** Verified before it sails.  
**Descriptor:** Verifies websites for agents.

Use the tagline everywhere a single line is needed. Use the secondary line on banners and launch art, never in place of the tagline. Use the descriptor when category clarity matters. Do not rename the product `Seaworthy AI`, `Seaworthy Scanner`, or any other variant.

The name comes from maritime inspection: a ship is *seaworthy* when it has been checked and is fit to sail. A site that passes Seaworthy is fit to ship.

## Logo system

The `Load Line` mark is two concentric rings crossed by a waterline. It borrows from the Plimsoll mark painted on inspected ships.

- The **outer ring** stands for static checks (HTML and files).
- The **inner ring** stands for rendered checks (a real browser).
- The **waterline** is the verdict: a site passes when it sits safely on the right side of the line.
- The rings **open where the line passes through**, so the line and the rings read as one object, and nothing is closed off.

### Approved variants

| Context | Asset |
| --- | --- |
| Dark brand surface | `assets/seaworthy-mark-dark.svg` |
| Light brand surface | `assets/seaworthy-mark-light.svg` |
| One-color, dark surface | `assets/seaworthy-mark-mono.svg` |
| One-color, light surface | `assets/seaworthy-mark-mono-light.svg` |

Use SVG for anything scalable or editable. Use the PNG next to each SVG, or the files in `exports/`, where a platform needs a raster image.

### Clear space

Keep clear space equal to one eighth of the mark width (12.5%) on every side. For a 256 px mark that is 32 px. No text, frame, crop, or unrelated graphic may enter that area.

### Minimum size

- Full-color mark: 32 px wide on screen, 8 mm in print.
- One-color mark: 24 px wide on screen, 6 mm in print.
- Wordmark lockup: 140 px wide on screen, 35 mm in print.
- Do not use the mark below 24 px. Its thin rings do not hold at 16 px, so favicons wait for a simplified variant (task `brand.favicon`).

### Correct use

- Preserve the exact geometry, proportions, openings, and waterline.
- Use an approved variant with enough contrast.
- Scale uniformly from the center.
- Use the mark alone for avatars, badges, and small UI. Use the lockup (mark, wordmark, tagline) for banners and headers.

### Incorrect use

- Do not rotate, skew, stretch, crop, outline, or add shadows or gradients.
- Do not close the openings, fill the rings, remove a ring, or move the waterline.
- Do not recolor individual parts outside the approved variants.
- Do not animate the mark as a loading spinner.
- Do not place the color mark on photography, gradients, or low-contrast colors.
- Do not use an anchor, ship, wave, checkmark, shield, or generic AI sparkle as an alternate Seaworthy symbol.

## Color

The canonical values are in [`tokens.json`](tokens.json), with CSS custom properties in [`tokens.css`](tokens.css).

| Token | Value | Role |
| --- | --- | --- |
| Abyss | `#15101A` | Primary dark canvas |
| Ink | `#2A1F2D` | Elevated dark surface; dark mark on light surfaces |
| Desert Rose | `#C47A74` | Waterline and warm accent on dark surfaces |
| Rose Deep | `#A9514D` | Rose on light surfaces |
| Rose Light | `#E3B0AA` | Inner ring and accent text on dark surfaces |
| Sand | `#F6EEE9` | Primary light canvas and dark-mode text |
| Mist | `#9A8F98` | Secondary text on dark surfaces |
| Sea Teal | `#2F6F73` | Functional: passing |
| Signal Amber | `#8A5A00` | Functional: warnings |
| Alert Red | `#B3261E` | Functional: errors |

Sea Teal, Signal Amber, and Alert Red are **status colors**. They mean passing, warnings, and errors, and nothing else. Never use them as decoration. The mark has no green element for the same reason: green is reserved for the verdict, not the logo.

### Accessible color pairs

Ratios use WCAG relative luminance. Normal text needs 4.5:1; large text and meaningful graphics need 3:1.

| Foreground | Background | Ratio | Approved use |
| --- | --- | ---: | --- |
| Sand | Abyss | 16.35:1 | Text and UI |
| Sand | Ink | 13.75:1 | Text and UI |
| Ink | Sand | 13.75:1 | Text and UI |
| Rose Light | Abyss | 9.86:1 | Text and UI |
| Rose Light | Ink | 8.30:1 | Text and UI |
| Desert Rose | Abyss | 5.69:1 | Text and UI |
| Desert Rose | Ink | 4.79:1 | Text and UI |
| Mist | Abyss | 6.03:1 | Secondary text |
| Mist | Ink | 5.07:1 | Secondary text |
| Rose Deep | Sand | 4.61:1 | Text and UI |
| Sand | Sea Teal | 5.03:1 | Passing badge |
| Sand | Signal Amber | 5.17:1 | Warnings badge |
| Sand | Alert Red | 5.70:1 | Errors badge |

**Not approved:** Desert Rose on Sand (2.87:1) and Rose Deep on Abyss (3.54:1) fall below 4.5:1 for text. Use Rose Deep on light surfaces and Desert Rose on dark ones. Never communicate status with color alone; the badge always carries a word.

## Typography

Use **Inter** (variable, weights 400 to 700) for the wordmark, headings, body copy, and UI. The wordmark is uppercase, weight 700, with about `0.14em` of positive tracking.

Use **IBM Plex Mono** (weights 400 and 500) for commands, paths, check IDs, versions, and the tagline in brand art. Do not use monospace for long body copy.

The generated templates use common fallbacks so the sources stay editable without bundled fonts. PNG exports in `exports/` are the rendered result on the machine that exported them; re-export on a machine with Inter and IBM Plex Mono installed for the final look.

## Status badge

The badge is the main growth loop: every verified repository advertises Seaworthy. It has an Ink left segment with the one-color mark and the word `seaworthy`, and a right segment in the status color with a word and, for warnings and errors, a count.

| State | Right segment | Example |
| --- | --- | --- |
| Passing | Sea Teal | `assets/badge-passing.svg` |
| Warnings | Signal Amber | `assets/badge-warnings.svg` |
| Errors | Alert Red | `assets/badge-failing.svg` |

Until the GitHub Action serves a live badge (task `action.badge`), these are static examples. Badge construction lives in `tools/brand/badge.mjs` so the Action can import it.

```markdown
![seaworthy: passing](https://raw.githubusercontent.com/arminazimi/seaworthy/main/brand/assets/badge-passing.svg)
```

## Voice

Plain, specific, and checkable. Say what Seaworthy found and what to change.

- Lead with the command or the result, not the pitch: `npx seaworthy verify ./dist`.
- Verify, don't advise. Never write "looks good". Write a count, a location, or a pass.
- No hype words: skip "AI-powered", "seamless", "unlock", "supercharge".
- Sentence case for headings and buttons. Uppercase only in the wordmark and brand-art taglines.

## Spacing and shape

Use the 4 px base scale from `tokens.json`; prefer 16, 24, 32, 48, and 64 px. Use 8 px radius for compact UI, 16 px for cards, and 24 px for presentation panels. The mark itself never gets a container shape unless a platform requires an avatar crop.

## Templates and exports

Editable sources are in [`templates/`](templates/) and PNG exports are in [`exports/`](exports/). Dimensions and source mappings are in [`export-presets.json`](export-presets.json).

| Template | Dimensions | Purpose |
| --- | ---: | --- |
| Social preview | 1280 × 640 | GitHub repository and social sharing |
| Avatar | 512 × 512 | Organization, repository, and profile icon |
| Banner | 1500 × 500 | README, docs, and launch headers (uses the secondary line) |
| Marketplace feature | 965 × 482 | GitHub Marketplace feature-card background |
| Marketplace logo | 512 × 512 | Transparent square logo |

Marketplace feature art has no wordmark or tagline because GitHub overlays the listing name and logo.

## Generated files

Do not edit these by hand. They come from `tools/brand/` and `tokens.json`.

| Output | Regenerate with |
| --- | --- |
| `assets/*.svg`, `templates/*.svg`, `seaworthy-logo-sheet.svg`, `tokens.css`, `export-presets.json` | `npm run build:brand` |
| `assets/*.png`, `exports/*.png` | `npm run export:brand` (needs Chrome or Chromium) |

`npm run check` fails when the SVG sources are out of date or a PNG export is missing. The mark's geometry lives in `tools/brand/mark.mjs`.

## Asset rights

Seaworthy code is available under the Apache License 2.0. Section 6 of that license grants no rights to use the project's name, logo, or other trademarks, so the name and brand assets are not licensed for use that suggests endorsement. A fuller brand-use policy is tracked in task `brand.policy`.

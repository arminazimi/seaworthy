# 0005. Rendered checks are opt-in and use playwright-core with a browser the user already has

**Status:** Accepted (2026-10-17)

## Context

Some checks need a real browser: accessibility rules that depend on layout and color (`color-contrast`), and Lighthouse. Browsers are large, slow to start, and missing on some machines, while ADR 0004 sets a first-run budget (cold `npx` under 3 seconds). We need to decide how rendered checks get a browser, and what Seaworthy does when there is none.

## Method

A synthetic 20-page site with six kinds of accessibility problems per page (missing alt text, unlabeled input, empty button, skipped heading level, low-contrast text, missing `lang`). Each engine ran axe-core 4.14 over all 20 pages. CI runs used GitHub-hosted runners (Linux, macOS arm64, Windows) with Node 24; raw logs: [run 39051865735](https://github.com/arminazimi/seaworthy/actions/runs/39051865735). Install sizes were measured locally with `npm install` in an empty folder. The measurement scripts were throwaway and are not in the repository.

## Results

### Install cost (npm, local)

| Package | Size | Top-level packages | License |
| --- | ---: | ---: | --- |
| `playwright-core` | 13.6 MB | 1 | Apache-2.0 |
| `puppeteer-core` | 32.6 MB | 23 | Apache-2.0 |
| `jsdom` | 25.7 MB | 30 | MIT |
| `axe-core` | 3.4 MB | 1 | MPL-2.0 |
| `parse5` | 0.9 MB | 2 | MIT |
| `lighthouse` | 178.8 MB | 85 | Apache-2.0 |

### axe-core over 20 pages (CI)

| Engine | OS | Total | Browser launch | Per page | Rules that fired |
| --- | --- | ---: | ---: | ---: | --- |
| jsdom (no browser) | Linux | 2.9 s | none | 145 ms | 5 of 6; `color-contrast` incomplete |
| jsdom (no browser) | macOS | 2.3 s | none | 116 ms | 5 of 6; `color-contrast` incomplete |
| jsdom (no browser) | Windows | 3.6 s | none | 182 ms | 5 of 6; `color-contrast` incomplete |
| Preinstalled Chrome | Linux | 10.6 s | 0.7 s | 495 ms | all 6 |
| Preinstalled Chrome | macOS | 17.6 s | 3.2 s | 718 ms | all 6 |
| Preinstalled Chrome | Windows | 18.9 s | 5.2 s | 684 ms | all 6 |
| Playwright-managed Chromium | Linux | 6.7 s | 0.1 s | 329 ms | all 6 |
| Playwright-managed Chromium | macOS | 5.8 s | 0.2 s | 277 ms | all 6 |
| Playwright-managed Chromium | Windows | 7.8 s | 0.1 s | 387 ms | all 6 |

Downloading Playwright-managed Chromium (`playwright-core install chromium`) took 9 to 17 seconds and used 600 to 736 MB on disk. Every browser mode reported the same six rule IDs and 412 passing rules.

### Lighthouse 13.5 (local, macOS, system Chrome)

About 10.3 to 11.3 seconds per page. Lighthouse rejects `file://` URLs (`INVALID_URL`), so the site must be served over HTTP first.

## Decision

1. **Static checks are the default and need no browser.** They parse HTML with `parse5` and cover image alt (`check.images`), `lang` (`check.meta`), heading order (`check.headings`), and form labels and accessible names (`check.names`, a new task) without launching anything.
2. **Rendered checks are opt-in** (`--rendered`, or `rendered: true` in config) and use `playwright-core` and `axe-core`, loaded lazily. Both are optional peer dependencies of `@seaworthy/verify`, so the default install stays small and fast. We do not use Puppeteer (2.4× the size and 23 packages for no gain) and we do not add jsdom (below).
3. **Find a browser in this order:** `--browser-path` or `SEAWORTHY_BROWSER`, then an installed Chrome, Chromium, or Edge through Playwright's `channel` option. Seaworthy never downloads a browser on its own. `seaworthy browser install` is an explicit command that wraps `playwright-core install chromium`.
4. **Missing pieces are reported as skipped, never as passed.** When rendered checks are on but no browser or no `playwright-core` is found, the report lists each affected check under `skipped` with a reason and an install hint, and the exit code is unchanged unless `--require-rendered` is set. See the sample below; it feeds `verify.report-schema`.
5. **jsdom plus axe is rejected as a fallback.** It adds 25.7 MB and 30 packages and runs about 2 to 8 times faster than the browser modes, but it cannot decide `color-contrast` (it returns `incomplete`). The five rules it can decide are cheap to implement directly on the parsed HTML, so a second engine is not worth its weight.
6. **Lighthouse is a separate opt-in check** (`check.lighthouse`). It installs 179 MB and runs about 10 seconds per page, so it runs on a sample of pages (home plus a few more, configurable) against a loopback HTTP server that Seaworthy starts and stops. It is never part of the default run or the `--changed` fast loop.
7. **License note.** `axe-core` is MPL-2.0, a file-level copyleft license. Using it unmodified as a dependency does not change Seaworthy's Apache-2.0 license; do not copy its files into this repository, and list it in a `NOTICE` file when `check.a11y` ships.

```json
{
  "skipped": [
    {
      "check": "a11y.contrast",
      "reason": "browser-unavailable",
      "hint": "Install Chrome or Chromium, or run `seaworthy browser install`, then run again with --rendered."
    }
  ]
}
```

## Consequences

- **GitHub Action:** it uses the Chrome already on GitHub-hosted runners and avoids the 9 to 17 second, 600 MB download. The cost is slower pages (about 500 to 720 ms against 280 to 390 ms with managed Chromium); the Action should expose the choice.
- **Agents see the gap.** A skipped rendered check is visible in the report, so an agent knows contrast was not checked instead of assuming it passed.
- **Limits of this measurement.** The fixture is 20 near-identical pages; real sites vary. Each page injects the 500 KB axe script again, which a real implementation should do once per context. Parallel pages, Playwright's `--only-shell` install (smaller than the 600 to 736 MB measured), and the first-run variance on macOS and Windows (3.2 and 5.2 second launches with preinstalled Chrome) are not measured. Lighthouse timing is a single machine.
- **Follow-up tasks:** `check.a11y` and `check.lighthouse` implement this; `verify.report-schema` adds `skipped`; `check.a11y` adds a CI job that runs the rendered checks against a preinstalled browser; `check.names` is added to the roadmap for the static replacements of the rules jsdom could decide.

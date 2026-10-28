// a11y.axe: rendered accessibility with axe-core, opt-in under --rendered (ADR 0005).
// It complements the static a11y.* checks with the rules a real browser decides and a parser cannot:
// computed contrast and target size, DOM order after scripts, and rules over live shadow DOM.
//
// Everything is local: pages load from file:// URLs, the axe script comes from this package's own
// node_modules, and requests to remote http(s) resources are aborted so a run stays offline even
// for a site that references CDN scripts. Site contents are untrusted input: the browser measures
// them, they are never evaluated as our instructions, and every axe result is read as plain JSON.

import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Check, CheckContext, FindingDraft, Location, ProbeSkip, Severity } from "../types.js";
import { findBrowser } from "../browser.js";
import { meta, pagesOf } from "./helpers.js";

/** axe impact → Seaworthy severity. Absent impact (axe could not decide) stays at `note`. */
const IMPACT_SEVERITY: Record<string, Severity> = {
  critical: "error",
  serious: "error",
  moderate: "warning",
  minor: "note",
};

// Rules the static checks already report, disabled here so one problem is never named twice.
// The docs page lists the mapping: rule → Seaworthy check. If a static check is retired, move its rules back to the rendered engine.
const STATICALLY_COVERED: readonly [axeRule: string, by: string][] = [
  ["area-alt", "images.alt"],
  ["aria-allowed-role", "a11y.aria-roles"],
  ["aria-hidden-body", "a11y.hidden-focusable"],
  ["aria-hidden-focus", "a11y.hidden-focusable"],
  ["aria-prohibited-attr", "a11y.aria-roles"],
  ["aria-required-attr", "a11y.aria-attributes"],
  ["aria-roles", "a11y.aria-roles"],
  ["aria-valid-attr", "a11y.aria-attributes"],
  ["aria-valid-attr-value", "a11y.aria-attributes"],
  ["autocomplete-valid", "a11y.autocomplete"],
  ["button-name", "names.button"],
  ["duplicate-id", "a11y.duplicate-id"],
  ["duplicate-id-active", "a11y.duplicate-id"],
  ["duplicate-id-aria", "a11y.duplicate-id"],
  ["empty-heading", "a11y.empty-headings"],
  ["frame-title", "a11y.iframe-title"],
  ["heading-order", "headings.order"],
  ["html-has-lang", "meta.lang"],
  ["html-lang-valid", "meta.lang"],
  ["image-alt", "images.alt"],
  ["input-image-alt", "images.alt"],
  ["label", "names.label"],
  ["link-name", "names.link"],
  ["meta-viewport", "meta.viewport"],
  ["nested-interactive", "html.nesting"],
  ["no-autoplay-audio", "a11y.media-captions"],
  ["page-has-heading-one", "headings.h1"],
  ["region", "a11y.landmarks"],
  ["skip-link", "a11y.skip-link"],
  ["tabindex", "a11y.tabindex"],
  ["td-has-header", "a11y.table-headers"],
  ["td-headers-attr", "a11y.table-headers"],
  ["th-has-data-cells", "a11y.table-headers"],
  ["valid-lang", "a11y.lang-parts"],
  ["video-caption", "a11y.media-captions"],
];

interface AxeNode {
  /** CSS selector of the offending element; a chain of ancestors when it sits inside a frame. */
  readonly target: readonly string[];
  /** Outer HTML of the offending element, as axe serialized it. */
  readonly html: string;
}

interface AxeViolation {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly failureSummary: string | null;
  readonly nodes: readonly AxeNode[];
}

interface AxeResults {
  readonly violations: readonly AxeViolation[];
}

interface PlaywrightLike {
  chromium: {
    launch(options: { executablePath?: string; headless?: boolean }): Promise<PlaywrightBrowser>;
  };
}

interface PlaywrightBrowser {
  newContext(): Promise<PlaywrightContext>;
  close(): Promise<void>;
}

interface PlaywrightContext {
  /** Aborts every request through a URL pattern. */
  route(url: string, handler: (route: { abort(): Promise<void> }) => Promise<void>): Promise<void>;
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightPage {
  goto(url: string, options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit" }): Promise<unknown>;
  addScriptTag(options: { path: string }): Promise<unknown>;
  evaluate<R>(script: (arg: never) => unknown, arg: unknown): Promise<R>;
  close(): Promise<void>;
}

let playwrightModule: Promise<PlaywrightLike | undefined> | undefined;

/** playwright-core stays an optional peer (ADR 0005): loaded once, lazily, and missing installs are fine. */
function loadPlaywright(): Promise<PlaywrightLike | undefined> {
  playwrightModule ??= import("playwright-core").then(
    (module) => module as unknown as PlaywrightLike,
    () => undefined,
  );
  return playwrightModule;
}

let axeScriptPath: string | undefined;
function axeScript(): string {
  axeScriptPath ??= createRequire(import.meta.url).resolve("axe-core/axe.min.js");
  return axeScriptPath;
}

/** axe option block that turns the statically covered rules off. Pure, so the engine's options stay out of it. */
export function axeRuleOptions(): { rules: Record<string, { enabled: boolean }> } {
  return { rules: Object.fromEntries(STATICALLY_COVERED.map(([rule]) => [rule, { enabled: false }])) };
}

async function probe(context: CheckContext): Promise<ProbeSkip | undefined> {
  if ((await loadPlaywright()) === undefined) {
    return {
      reason: "playwright-core-missing",
      hint: "Install playwright-core (npm install --no-save playwright-core), then run again with --rendered. Seaworthy never downloads a browser.",
    };
  }
  try {
    if (findBrowser(context.browser?.path) === undefined) {
      return {
        reason: "browser-unavailable",
        hint: "Install Chrome, Chromium, or Edge, or set SEAWORTHY_BROWSER to a browser executable, then run again with --rendered.",
      };
    }
  } catch (error) {
    return { reason: "browser-unavailable", hint: `${error instanceof Error ? error.message : String(error)}. Fix it, then run again with --rendered.` };
  }
  return undefined;
}

/** One line an agent can act on: what axe found, then the source-level instruction. */
function fixSummary(violation: AxeViolation): string {
  const summary = (violation.failureSummary ?? violation.help).replace(/\s+/g, " ").trim();
  const body = summary.replace(/^Fix (any|all|ax[ey]) of the following:?/i, "").trim();
  return `${body} Fix the page's source, not this built file; see the axe rule "${violation.id}"`.trim();
}

/** Axe node when it sits in a frame, its target is a chain from the top document down. */
function selectorOf(node: AxeNode): string {
  return node.target.join(" >> ");
}

/** The offending element's HTML, whitespace-collapsed and cut at 200 characters so a report stays readable. */
function snippetOf(node: AxeNode): string | undefined {
  const html = node.html.replace(/\s+/g, " ").trim();
  return html === "" ? undefined : html.length <= 200 ? html : `${html.slice(0, 200)}…`;
}

export const a11yAxe: Check = {
  meta: meta("a11y.axe", "axe-core reports an accessibility problem in the rendered page", "error", ["WCAG 1.4.3", "WCAG 2.5.8", "WCAG 4.1.2"], ["html", "browser"]),
  probe,
  async *run(context) {
    const playwright = await loadPlaywright();
    // The engine probes first, so by the time run is called both playwright-core and a browser exist.
    if (playwright === undefined) throw new Error("playwright-core is required for a11y.axe but is not installed");
    const found = findBrowser(context.browser?.path); // throws when the user asked for a missing browser
    if (found === undefined) throw new Error("a11y.axe found no browser to launch; next time the engine's probe would skip it");
    const pwBrowser = await playwright.chromium.launch({ executablePath: found.path, headless: true });
    try {
      const pwContext = await pwBrowser.newContext();
      try {
        // Built pages may reference CDN scripts; aborting those keeps the run offline and deterministic.
        await pwContext.route("http*", (route) => route.abort());
        for (const page of pagesOf(context)) {
          if (context.signal.aborted) break;
          const pwPage = await pwContext.newPage();
          try {
            await pwPage.goto(pathToFileURL(join(context.site.root, page.file)).href, { waitUntil: "load" });
            await pwPage.addScriptTag({ path: axeScript() });
            const results = await pwPage.evaluate<AxeResults>((setup: { options: unknown }) => {
              return new Promise<AxeResults>((resolve, reject) => {
                const axeGlobal = (globalThis as unknown as { axe?: { run(options: unknown, done: (error: unknown, raw: AxeResults) => void): void } }).axe;
                if (axeGlobal === undefined) {
                  reject(new Error("the axe script did not load into the page"));
                  return;
                }
                axeGlobal.run(setup.options, (error, raw) => {
                  if (error) reject(new Error(String(error)));
                  else resolve(raw);
                });
              });
            }, { options: axeRuleOptions() });
            for (const violation of results.violations) {
              for (const node of violation.nodes) {
                const selector = selectorOf(node);
                const snippet = snippetOf(node);
                const location: Location = { file: page.file, selector, ...(snippet === undefined ? {} : { snippet }) };
                yield {
                  message: `axe ${violation.id}: ${violation.help}.`,
                  location,
                  severity: IMPACT_SEVERITY[violation.impact ?? ""] ?? "note",
                  fix: { kind: "manual", summary: fixSummary(violation), edits: [] },
                  key: `${violation.id}:${selector}`,
                };
              }
            }
          } finally {
            await pwPage.close().catch(() => {});
          }
        }
      } finally {
        await pwContext.close().catch(() => {});
      }
    } finally {
      await pwBrowser.close().catch(() => {});
    }
  },
};

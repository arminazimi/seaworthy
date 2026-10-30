// a11y.axe: rendered accessibility with axe-core, opt-in under --rendered (ADR 0005).
// It complements the static a11y.* checks with the rules a real browser decides and a parser cannot:
// computed contrast and target size, DOM order after scripts, and rules over live shadow DOM.
//
// Every page is measured at each width in turn (phone, tablet, desktop), because a page that
// breaks on a phone looks fine at desktop width. The same rule on the same element fires at every
// width, so one problem is one finding: a rule and element are merged, and the finding names the
// widths the problem was seen at.
//
// Under --evidence, the first width a problem is seen at also yields its proof: a PNG crop of the
// viewport around the offending element, saved in the run's evidence folder and named by the
// finding's fingerprint, and the finding gains an `evidence` field pointing at it. A crop that
// cannot be taken is not an error — the finding stands on its message alone.
//
// Everything is local: pages load from file:// URLs, the axe script comes from this package's own
// node_modules, and requests to remote http(s) resources are aborted so a run stays offline even
// for a site that references CDN scripts. Site contents are untrusted input: the browser measures
// them, they are never evaluated as our instructions, and every axe result is read as plain JSON.

import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Check, FindingDraft, Location, Severity } from "../types.js";
import { findBrowser } from "../browser.js";
import { saveCrop } from "../evidence.js";
import { fingerprint } from "../engine.js";
import { cropElement, launchBrowser, openContext, probeRendered, VIEWPORTS, viewportLabel, type Viewport } from "../render.js";
import { meta, pagesOf } from "./helpers.js";

/** axe impact → Seaworthy severity. Absent impact (axe could not decide) stays at `note`. */
const IMPACT_SEVERITY: Record<string, Severity> = {
  critical: "error",
  serious: "error",
  moderate: "warning",
  minor: "note",
};

/** Severity order, most severe first: a problem keeps the worst impact it had at any width. */
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, note: 2 };

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

export interface AxeViolation {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly failureSummary: string | null;
  readonly nodes: readonly AxeNode[];
}

interface AxeResults {
  readonly violations: readonly AxeViolation[];
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

/** The severity one axe violation maps to. */
function severityOf(violation: AxeViolation): Severity {
  return IMPACT_SEVERITY[violation.impact ?? ""] ?? "note";
}

/** One axe result: a rule on an element, on one page, at one width. */
export interface SeenViolation {
  readonly file: string;
  readonly violation: AxeViolation;
  readonly selector: string;
  readonly snippet: string | undefined;
  readonly viewport: Viewport;
  /** The report-relative crop saved for it, when the run opted into evidence and this sighting is the first. */
  readonly image?: string;
}

/** One problem, seen at one or more widths. */
export interface MergedViolation {
  /** The page the problem is on, relative to the site root. */
  readonly file: string;
  /** The axe violation, replaced when a later width reports it more severely. */
  violation: AxeViolation;
  readonly selector: string;
  readonly snippet: string | undefined;
  /** The widths it was seen at, in the order the widths run. */
  widths: Viewport[];
  severity: Severity;
  /** The crop saved at the width it was first seen at, or undefined when there is none. */
  readonly image: string | undefined;
}

/** The identity one problem keeps across widths: same page, same rule, same element. */
export function mergedId(file: string, violationId: string, selector: string): string {
  return JSON.stringify([file, violationId, selector]);
}

/** The finding's stable identity: the axe rule and the element it fired on. */
function findingKey(violationId: string, selector: string): string {
  return `${violationId}:${selector}`;
}

/**
 * Adds one axe result to the problems seen so far. The same rule on the same element at another
 * width is the same problem, so it is merged into one finding that names the widths it was seen at.
 */
export function addViolation(problems: Map<string, MergedViolation>, seen: SeenViolation): void {
  const id = mergedId(seen.file, seen.violation.id, seen.selector);
  const severity = severityOf(seen.violation);
  const known = problems.get(id);
  if (known === undefined) {
    problems.set(id, { file: seen.file, violation: seen.violation, selector: seen.selector, snippet: seen.snippet, widths: [seen.viewport], severity, image: seen.image });
    return;
  }
  known.widths.push(seen.viewport);
  // The problem keeps the worst severity it had at any width.
  if (SEVERITY_RANK[severity] < SEVERITY_RANK[known.severity]) {
    known.violation = seen.violation;
    known.severity = severity;
  }
}

export const a11yAxe: Check = {
  meta: meta("a11y.axe", "axe-core reports an accessibility problem in the rendered page", "error", ["WCAG 1.4.3", "WCAG 2.5.8", "WCAG 4.1.2"], ["html", "browser"]),
  probe: probeRendered,
  async *run(context) {
    // The engine probes first, so by the time run is called both playwright-core and a browser exist.
    const found = findBrowser(context.browser?.path); // throws when the user asked for a missing browser
    if (found === undefined) throw new Error("a11y.axe found no browser to launch; next time the engine's probe would skip it");
    const browser = await launchBrowser(found.path);
    const evidence = context.evidence;
    // One entry per problem, not per width: the same rule on the same element fires at every width.
    const merged = new Map<string, MergedViolation>();
    try {
      for (const viewport of VIEWPORTS) {
        const pwContext = await openContext(browser, viewport);
        try {
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
                  // The crop is the proof of the sighting, so it comes from the width the problem was
                  // first seen at — the narrowest — and later, identical sightings add nothing.
                  const id = mergedId(page.file, violation.id, selector);
                  let image: string | undefined;
                  if (evidence !== undefined && !merged.has(id)) {
                    const png = await cropElement(pwPage, selector, viewport);
                    if (png !== undefined) image = saveCrop(evidence, `${fingerprint("a11y.axe", page.file, findingKey(violation.id, selector))}.png`, png);
                  }
                  addViolation(merged, { file: page.file, violation, selector, snippet: snippetOf(node), viewport, ...(image === undefined ? {} : { image }) });
                }
              }
            } finally {
              await pwPage.close().catch(() => {});
            }
          }
        } finally {
          await pwContext.close().catch(() => {});
        }
        if (context.signal.aborted) break;
      }
    } finally {
      await browser.close().catch(() => {});
    }
    for (const { file, violation, selector, snippet, widths, severity, image } of merged.values()) {
      const location: Location = { file, selector, ...(snippet === undefined ? {} : { snippet }) };
      yield {
        message: `axe ${violation.id}: ${violation.help}. Seen at ${viewportLabel(widths)}.`,
        location,
        severity,
        fix: { kind: "manual", summary: fixSummary(violation), edits: [] },
        key: findingKey(violation.id, selector),
        ...(image === undefined ? {} : { evidence: { image, viewport: widths[0]!.name } }),
      } satisfies FindingDraft;
    }
  },
};

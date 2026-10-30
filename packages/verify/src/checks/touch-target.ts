// layout.target-size: rendered touch targets smaller than the 24×24 CSS px minimum of WCAG 2.5.8,
// opt-in under --rendered (ADR 0005).
//
// Target size is a layout fact, not a markup fact: the parser cannot tell whether the CSS makes a
// control 20 px or 44 px, so every page is measured in a real browser at each shared width, the
// way a11y.axe measures the page itself. The same element under the minimum at several widths is
// one problem, one finding, naming the widths it was seen at.
//
// One problem stays one finding across the two rendered checks: axe ships its own `target-size`
// rule, so that rule is switched off in a11y-axe.ts's covered-rule table and this check owns
// touch-target size. axe keeps `target-offset`, the 2.5.8 spacing rule, which measures a different
// problem (targets that crowd each other, not targets that are too small).
//
// Site contents are untrusted input: the browser lays them out and the measurement script reads
// geometry back as plain JSON. Nothing in the page is evaluated as our instructions, and requests
// to remote http(s) resources are aborted by the shared context so the run stays offline.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Check, FindingDraft, Location } from "../types.js";
import { findBrowser } from "../browser.js";
import { launchBrowser, openContext, probeRendered, VIEWPORTS, viewportLabel, type Viewport } from "../render.js";
import { meta, pagesOf } from "./helpers.js";

/** WCAG 2.5.8 (AA): the minimum rendered touch target, in CSS pixels. */
const MIN_TARGET_PX = 24;

/** Every element a person can tap or click. Mirrors the interactive content axe treats as a target. */
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
].join(", ");

/** What the in-page script reads back: one interactive element under the minimum and its rendered box. */
export interface MeasuredTarget {
  /** CSS path of the element from the document root; the finding's stable identity. */
  readonly selector: string;
  /** Outer HTML of the element, as the browser serialized it. */
  readonly html: string;
  /** Rendered width in CSS pixels. */
  readonly width: number;
  /** Rendered height in CSS pixels. */
  readonly height: number;
}

/** The offending element's HTML, whitespace-collapsed and cut at 200 characters so a report stays readable. */
function snippetOf(html: string): string | undefined {
  const snippet = html.replace(/\s+/g, " ").trim();
  return snippet === "" ? undefined : snippet.length <= 200 ? snippet : `${snippet.slice(0, 200)}…`;
}

/** One small target, on one page, at one width. */
export interface SeenTarget {
  readonly file: string;
  readonly target: MeasuredTarget;
  readonly viewport: Viewport;
}

/** One small target, seen at one or more widths. */
export interface TargetProblem {
  /** The page the target is on, relative to the site root. */
  readonly file: string;
  readonly selector: string;
  readonly snippet: string | undefined;
  /** The widths it was under the minimum at, in the order the widths run. */
  widths: Viewport[];
  /** The smallest rendered box seen at any width: the worst case is what a person taps. */
  width: number;
  height: number;
}

/**
 * Adds one measured target to the problems seen so far. The same element under the minimum at
 * another width is the same problem, so it stays one finding that names every width it was seen at
 * and keeps the smallest box.
 */
export function addTarget(problems: Map<string, TargetProblem>, seen: SeenTarget): void {
  const id = JSON.stringify([seen.file, seen.target.selector]);
  const known = problems.get(id);
  if (known === undefined) {
    problems.set(id, {
      file: seen.file,
      selector: seen.target.selector,
      snippet: snippetOf(seen.target.html),
      widths: [seen.viewport],
      width: seen.target.width,
      height: seen.target.height,
    });
    return;
  }
  known.widths.push(seen.viewport);
  known.width = Math.min(known.width, seen.target.width);
  known.height = Math.min(known.height, seen.target.height);
}

/** A measured size for the message: "20", "23.98" — trailing zeros never show. */
function pxSize(px: number): string {
  return px.toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export const layoutTargetSize: Check = {
  meta: meta("layout.target-size", "Touch target is smaller than the 24×24 CSS px minimum", "warning", ["WCAG 2.5.8"], ["html", "browser"]),
  probe: probeRendered,
  async *run(context) {
    // The engine probes first, so by the time run is called both playwright-core and a browser exist.
    const found = findBrowser(context.browser?.path); // throws when the user asked for a missing browser
    if (found === undefined) throw new Error("layout.target-size found no browser to launch; next time the engine's probe would skip it");
    const browser = await launchBrowser(found.path);
    // One entry per element, not per width: the same small target measures under the minimum at every width.
    const problems = new Map<string, TargetProblem>();
    try {
      for (const viewport of VIEWPORTS) {
        const pwContext = await openContext(browser, viewport);
        try {
          for (const page of pagesOf(context)) {
            if (context.signal.aborted) break;
            const pwPage = await pwContext.newPage();
            try {
              await pwPage.goto(pathToFileURL(join(context.site.root, page.file)).href, { waitUntil: "load" });
              const targets = await pwPage.evaluate<MeasuredTarget[]>((setup: { min: number; selector: string }) => {
                // Runs in the page: self-contained, reading only geometry, returning plain data.
                interface ElementShape {
                  readonly tagName: string;
                  readonly id: string;
                  readonly outerHTML: string;
                  readonly textContent: string | null;
                  readonly parentElement: ElementShape | null;
                  readonly children: ElementShape[];
                  readonly disabled?: boolean;
                  getBoundingClientRect(): { width: number; height: number; left: number; top: number; right: number; bottom: number };
                }
                const host = globalThis as unknown as {
                  document: { readonly documentElement: ElementShape | null; querySelectorAll(selector: string): ElementShape[] };
                  getComputedStyle(element: ElementShape): { display: string; visibility: string };
                  innerWidth: number;
                  innerHeight: number;
                };
                const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();
                const escapeId = (id: string): string => {
                  const css = (globalThis as unknown as { CSS?: { escape?(value: string): string } }).CSS;
                  return css?.escape ? css.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
                };
                const nthOfType = (parent: ElementShape, tag: string, wanted: ElementShape): number => {
                  let seen = 0;
                  for (let i = 0; i < parent.children.length; i++) {
                    const child = parent.children[i]!;
                    if (child.tagName !== tag) continue;
                    if (child === wanted) return seen;
                    seen++;
                  }
                  return 0;
                };
                const pathOf = (element: ElementShape): string => {
                  const parts: string[] = [];
                  let node: ElementShape | null = element;
                  while (node !== null && node !== host.document.documentElement) {
                    if (node.id !== "") {
                      parts.unshift(`#${escapeId(node.id)}`);
                      break;
                    }
                    const tag = node.tagName.toLowerCase();
                    const parent: ElementShape | null = node.parentElement;
                    if (parent === null) {
                      parts.unshift(tag);
                      break;
                    }
                    let sameTag = 0;
                    for (let i = 0; i < parent.children.length; i++) if (parent.children[i]!.tagName === node!.tagName) sameTag++;
                    parts.unshift(sameTag > 1 ? `${tag}:nth-of-type(${nthOfType(parent, node.tagName, node) + 1})` : tag);
                    node = parent;
                  }
                  return parts.join(" > ");
                };
                // WCAG 2.5.8's inline exception: a target that is part of a sentence of text is exempt.
                // The nearest block-level ancestor holding prose around the element's own words is the
                // test; a standalone link with no words beside it is a control, not a sentence.
                const isInSentence = (element: ElementShape): boolean => {
                  const own = collapse(element.textContent ?? "");
                  let parent: ElementShape | null = element.parentElement;
                  while (parent !== null) {
                    if (collapse(parent.textContent ?? "").length > own.length) return true;
                    if (!host.getComputedStyle(parent).display.startsWith("inline")) return false;
                    parent = parent.parentElement;
                  }
                  return false;
                };
                const found: MeasuredTarget[] = [];
                const nodes = host.document.querySelectorAll(setup.selector);
                for (let index = 0; index < nodes.length; index++) {
                  const element = nodes[index]!;
                  if (element.disabled === true) continue;
                  const style = host.getComputedStyle(element);
                  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") continue;
                  const rect = element.getBoundingClientRect();
                  if (rect.width === 0 || rect.height === 0) continue;
                  // Out of the viewport on every axis: a person never taps it there.
                  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= host.innerWidth || rect.top >= host.innerHeight) continue;
                  if (style.display === "inline" && isInSentence(element)) continue;
                  if (rect.width < setup.min || rect.height < setup.min) {
                    found.push({ selector: pathOf(element), html: element.outerHTML.slice(0, 512), width: rect.width, height: rect.height });
                  }
                }
                return found;
              }, { min: MIN_TARGET_PX, selector: INTERACTIVE_SELECTOR });
              for (const target of targets) addTarget(problems, { file: page.file, target, viewport });
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
    for (const { file, selector, snippet, widths, width, height } of problems.values()) {
      const location: Location = { file, selector, ...(snippet === undefined ? {} : { snippet }) };
      const size = `${pxSize(width)}×${pxSize(height)}`;
      const minimum = `${MIN_TARGET_PX}×${MIN_TARGET_PX}`;
      yield {
        message: `The rendered touch target is ${size} CSS px, smaller than the ${minimum} px minimum (WCAG 2.5.8). Seen at ${viewportLabel(widths)}.`,
        location,
        fix: {
          kind: "manual",
          summary: `Give the element a rendered box of at least ${minimum} CSS px — padding, min-width and min-height, or a larger hit area. Fix the page's source, not this built file; see WCAG 2.5.8 Target Size (Minimum).`,
          edits: [],
        },
        key: selector,
      } satisfies FindingDraft;
    }
  },
};

// layout.horizontal-overflow: does the document scroll sideways at a phone viewport (opt-in under
// --rendered, ADR 0005). The reader has to pan the whole page left and right to read it.
//
// One question keeps this check apart from the reflow check (`layout.reflow`, WCAG 1.4.10 at
// 320 CSS px): this one asks whether the page can be read at a real phone width without panning the
// document. The reflow check asks whether content still reflows at the narrower spec width, so the
// two measure different widths and the docs pages cross-reference each other.
//
// Content wider than the viewport that cannot be panned to is reported too: a page that hides its
// sideways overflow with `overflow-x: hidden`/`clip`, or pins an element past the edge, does not
// fit the phone — it only removes the one way to reach the content.
//
// Everything is local: pages load from file:// URLs and remote http(s) requests are aborted, exactly
// like a11y.axe. Site contents are untrusted input: the browser measures them, they are never
// evaluated as our instructions, and the probe returns plain JSON numbers and strings.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Check, FindingDraft, Location } from "../types.js";
import { findBrowser } from "../browser.js";
import { launchBrowser, openContext, probeRendered, VIEWPORTS, viewportLabel, type Viewport } from "../render.js";
import { meta, pagesOf } from "./helpers.js";

/** The one width this check measures at: readers pan sideways on a phone first. */
const PHONE: Viewport = VIEWPORTS.find((viewport) => viewport.name === "phone") ?? { name: "phone", width: 375, height: 667 };

/** What the browser measured on one page at the phone width. */
export interface PageMeasurement {
  /** `<html>`'s scrollWidth in CSS px: wider than the viewport means the content overflows sideways. */
  readonly scrollWidth: number;
  /** True when `<html>` or `<body>` hides the sideways overflow with `overflow-x: hidden` or `clip`. */
  readonly clipsOverflow: boolean;
  /** The widest element reaching past the viewport that no viewport-fitting scrollable region contains. */
  readonly culprit?: { readonly selector: string; readonly right: number };
}

// ---- the in-browser probe ---------------------------------------------------------------------------------
// Only the pieces of the DOM the probe touches; what it reads stays data that comes back as JSON.

interface DomRect {
  readonly right: number;
  readonly width: number;
}

interface DomStyle {
  readonly display: string;
  readonly visibility: string;
  readonly overflowX: string;
}

interface DomElement {
  readonly id: string;
  readonly tagName: string;
  readonly parentElement: DomElement | null;
  readonly children: ArrayLike<DomElement>;
  readonly scrollWidth: number;
  getBoundingClientRect(): DomRect;
}

/**
 * Runs inside the browser: reads the document's sideways size and the widest element past the
 * viewport. Playwright serializes this function alone, so it touches nothing outside itself.
 * Elements overflowing inside a region that itself fits the viewport and owns its sideways scroll
 * are a widget's business (WCAG 1.4.10 allows two-dimensional scrolling inside a component), so
 * they are contained and never named.
 */
function measureDocument(setup: { viewportWidth: number }): PageMeasurement {
  const dom = globalThis as unknown as {
    document: {
      readonly documentElement: DomElement;
      readonly body: DomElement | null;
      querySelectorAll(selector: string): ArrayLike<DomElement>;
    };
    getComputedStyle: (element: DomElement) => DomStyle;
    CSS: { escape: (value: string) => string };
  };
  const width = setup.viewportWidth;
  // Element boxes are fractional; a hair over the edge is rounding, not a problem a reader can see.
  const TOLERANCE = 1;
  const styleOf = (element: DomElement): DomStyle => dom.getComputedStyle(element);
  const clipsSideways = (element: DomElement): boolean => {
    const overflow = styleOf(element).overflowX;
    return overflow === "hidden" || overflow === "clip";
  };
  const selectorOf = (element: DomElement): string => {
    if (element.id !== "") return `#${dom.CSS.escape(element.id)}`;
    const parts: string[] = [];
    const body = dom.document.body;
    for (let node: DomElement | null = element; node !== null && node !== body; node = node.parentElement) {
      const parent: DomElement | null = node.parentElement;
      if (parent === null) {
        parts.unshift(node.tagName.toLowerCase());
        break;
      }
      let sameTag = 0;
      let position = 0;
      for (let i = 0; i < parent.children.length; i++) {
        const sibling: DomElement = parent.children[i]!;
        if (sibling.tagName !== node.tagName) continue;
        sameTag += 1;
        if (sibling === node) position = sameTag;
      }
      parts.unshift(sameTag > 1 ? `${node.tagName.toLowerCase()}:nth-of-type(${position})` : node.tagName.toLowerCase());
    }
    return parts.join(" > ");
  };
  const containedInWidget = (element: DomElement): boolean => {
    const body = dom.document.body;
    for (let ancestor = element.parentElement; ancestor !== null && ancestor !== body; ancestor = ancestor.parentElement) {
      if (styleOf(ancestor).overflowX === "visible") continue;
      if (ancestor.getBoundingClientRect().right <= width + TOLERANCE) return true;
    }
    return false;
  };
  const html = dom.document.documentElement;
  const body = dom.document.body;
  let culprit: { selector: string; right: number } | undefined;
  const nodes = dom.document.querySelectorAll("body *");
  for (let i = 0; i < nodes.length; i++) {
    const element = nodes[i]!;
    const style = styleOf(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.right <= width + TOLERANCE) continue;
    if (containedInWidget(element)) continue;
    if (culprit === undefined || rect.right > culprit.right) culprit = { selector: selectorOf(element), right: rect.right };
  }
  return {
    scrollWidth: html.scrollWidth,
    clipsOverflow: clipsSideways(html) || (body !== null && clipsSideways(body)),
    ...(culprit === undefined ? {} : { culprit }),
  };
}

// ---- the decision ------------------------------------------------------------------------------------------

const culpritSuffix = (selector: string | undefined): string =>
  selector === undefined ? "" : ` Widest element past the viewport: ${selector}.`;

/**
 * The finding for one measured page, or undefined when the page fits the viewport. A pure function
 * of the measurement, so the report-and-non-report cases are all testable offline.
 */
export function horizontalOverflow(file: string, measured: PageMeasurement, viewport: Viewport): FindingDraft | undefined {
  const scrollOver = measured.scrollWidth - viewport.width;
  const edgeOver = measured.culprit === undefined ? 0 : Math.round(measured.culprit.right - viewport.width);
  const overhang = Math.max(scrollOver, edgeOver);
  if (overhang <= 0) return undefined;
  const selector = measured.culprit?.selector;
  const scrolls = scrollOver > 0 && !measured.clipsOverflow;
  const label = viewportLabel([viewport]);
  const message = scrolls
    ? `Page scrolls sideways on a phone: at ${label} the document is ${measured.scrollWidth} CSS px wide, so readers must pan ${scrollOver} CSS px to reach the end.${culpritSuffix(selector)}`
    : `Page content reaches ${overhang} CSS px past the ${label} viewport and no sideways scroll can bring it into view, so it is out of reach.${culpritSuffix(selector)}`;
  const summary = scrolls
    ? `${selector === undefined ? "The page" : `The element ${selector}`} is wider than the ${viewport.width} CSS px viewport. Make the layout fit: replace fixed widths and min-widths with max-width: 100% or fluid units, put wide <table> and <pre> blocks in a container of their own with overflow-x: auto so only that region pans, and give flex and grid children min-width: 0 so long words wrap. Fix the page's source, not this built file.`
    : `The page hides or outruns its ${viewport.width} CSS px viewport, so ${selector ?? "the widest element"} past the edge cannot be reached. Drop the sideways overflow-x: hidden/clip that hides the problem and make the content fit, or give it a container of its own with overflow-x: auto. Fix the page's source, not this built file.`;
  const location: Location = { file, ...(selector === undefined ? {} : { selector }) };
  return { message, location, fix: { kind: "manual", summary, edits: [] }, key: "document" } satisfies FindingDraft;
}

export const layoutHorizontalOverflow: Check = {
  meta: meta("layout.horizontal-overflow", "Page scrolls sideways on a phone", "error", ["WCAG 1.4.10"], ["html", "browser"]),
  probe: probeRendered,
  async *run(context) {
    // The engine probes first, so by the time run is called both playwright-core and a browser exist.
    const found = findBrowser(context.browser?.path); // throws when the user asked for a missing browser
    if (found === undefined) throw new Error("layout.horizontal-overflow found no browser to launch; next time the engine's probe would skip it");
    const browser = await launchBrowser(found.path);
    try {
      const pwContext = await openContext(browser, PHONE);
      try {
        for (const page of pagesOf(context)) {
          if (context.signal.aborted) break;
          const pwPage = await pwContext.newPage();
          try {
            await pwPage.goto(pathToFileURL(join(context.site.root, page.file)).href, { waitUntil: "load" });
            const measured = await pwPage.evaluate<PageMeasurement>(measureDocument, { viewportWidth: PHONE.width });
            const finding = horizontalOverflow(page.file, measured, PHONE);
            if (finding !== undefined) yield finding;
          } finally {
            await pwPage.close().catch(() => {});
          }
        }
      } finally {
        await pwContext.close().catch(() => {});
      }
    } finally {
      await browser.close().catch(() => {});
    }
  },
};

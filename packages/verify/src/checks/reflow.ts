// layout.reflow: content that does not reflow at a 320 CSS px viewport (WCAG 1.4.10),
// opt-in under --rendered (ADR 0005). The success criterion accepts two shapes: a single
// column that reflows to fit, or content legitimately two-dimensional as part of the content
// (a map, a game, a table or spreadsheet presented as such). This check reports the page-level
// failure — a box that keeps a width wider than the viewport instead of shrinking, so the
// document itself must be panned sideways as well as scrolled — and names that box.
//
// Sibling boundaries keep one problem one finding: layout.horizontal-overflow reports the
// document scrolling sideways (a long unbreakable word pans the page without any fixed-size
// box, and that is its finding, not this one's), and layout.text-clipped reports an element
// whose own text is cut off (content absorbed by an overflow clip does not pan the document).
// The exceptions implemented here are the criterion's own: a `<table>` passes as tabular data,
// and anything inside its own non-root scroll container passes as two-dimensional content.
// Maps and games cannot be told from photos that should simply scale, so an author who wants
// the exception wraps the content in an explicit scroll container, which this check honours.
//
// 320 CSS px is what the criterion fixes and render.ts's shared VIEWPORTS phone width is 375,
// so this module opens its own width rather than measuring where the failure would hide.
// The criterion also speaks of a 256 CSS px height; it is not measured, because a page that
// pans sideways fails whatever its height is, and vertical scrolling is not the finding.
//
// Everything is local, like a11y.axe: pages load from file:// URLs and requests to remote
// http(s) resources are aborted by the shared context. Site contents are untrusted input:
// the browser lays them out, they are never instructions this process follows, and every
// measurement is read back as plain JSON.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Check, FindingDraft, Location } from "../types.js";
import { findBrowser } from "../browser.js";
import { launchBrowser, openContext, probeRendered, viewportLabel, type Viewport } from "../render.js";
import { meta, pagesOf } from "./helpers.js";

/**
 * WCAG 1.4.10 fixes 320 CSS px; the shared phone viewport is 375, which lets a box between
 * the two pan a real small phone untouched. Height 568 is just a portrait canvas — nothing
 * here measures height.
 */
export const REFLOW_VIEWPORT: Viewport = { name: "small phone", width: 320, height: 568 };

/** Sub-pixel slack: browsers report fractional layout numbers, and a 1 px pan is not a finding. */
const TOLERANCE_PX = 1;

/** One fixed-size box the rendered page handed back. */
interface WideElement {
  /** Lowercase tag name, for the message. */
  readonly tag: string;
  /** CSS selector from `body` down, the finding's stable identity. */
  readonly selector: string;
  /** Used width of the box's border edge, rounded to whole CSS px. */
  readonly width: number;
  /** Opening markup of the element, cut short here because a whole page can be one box. */
  readonly markup: string;
}

/**
 * The structural slice of a rendered document this check reads. The package compiles without
 * the DOM lib, and the function below is serialized into the page, so these shapes describe
 * what the browser really hands back.
 */
interface RenderedElement {
  readonly tagName: string;
  readonly id: string;
  readonly parentElement: RenderedElement | null;
  readonly children: RenderedElement[];
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly outerHTML: string;
  getBoundingClientRect(): { width: number };
  querySelectorAll(selectors: string): RenderedElement[];
  contains(other: RenderedElement | null): boolean;
}

/** The opening markup an agent can recognise, collapsed and cut short so a report stays readable. */
function snippetOf(markup: string): string | undefined {
  const html = markup.replace(/\s+/g, " ").trim();
  if (html === "") return undefined;
  const start = html.indexOf(">");
  const opening = start > 0 && start < 200 ? html.slice(0, start + 1) : html;
  return opening.length <= 200 ? opening : `${opening.slice(0, 200)}…`;
}

export const layoutReflow: Check = {
  meta: meta("layout.reflow", "Content does not reflow at a 320 CSS px viewport", "warning", ["WCAG 1.4.10"], ["html", "browser"]),
  probe: probeRendered,
  async *run(context) {
    // The engine probes first, so by the time run is called both playwright-core and a browser exist.
    const found = findBrowser(context.browser?.path); // throws when the user asked for a missing browser
    if (found === undefined) throw new Error("layout.reflow found no browser to launch; next time the engine's probe would skip it");
    const browser = await launchBrowser(found.path);
    const seen: { file: string; element: WideElement }[] = [];
    try {
      const pwContext = await openContext(browser, REFLOW_VIEWPORT);
      try {
        for (const page of pagesOf(context)) {
          if (context.signal.aborted) break;
          const pwPage = await pwContext.newPage();
          try {
            await pwPage.goto(pathToFileURL(join(context.site.root, page.file)).href, { waitUntil: "load" });
            const measurements = await pwPage.evaluate<WideElement[]>((setup: { width: number; tolerance: number }) => {
              const win = globalThis as unknown as {
                document: { readonly documentElement: RenderedElement; readonly body: RenderedElement | null; querySelectorAll(selectors: string): RenderedElement[] };
                getComputedStyle(element: RenderedElement): { overflowX: string; display: string };
                CSS?: { escape(value: string): string };
              };
              const html = win.document.documentElement;
              const body = win.document.body;
              const out: WideElement[] = [];
              // The finding exists only when the document itself pans: a page that fits at this
              // width reflows, whatever a stray sub-pixel scroll says.
              if (body === null || html.scrollWidth <= html.clientWidth + setup.tolerance) return out;

              // Chromium always ships CSS.escape; the bare fallback keeps the types honest elsewhere.
              const escapeId = (value: string): string => (win.CSS === undefined ? value : win.CSS.escape(value));

              /** A selector from `body` down: ids where they exist, nth-of-type chains otherwise. */
              const selectorOf = (el: RenderedElement): string => {
                if (el === html) return "html";
                const parts: string[] = [];
                for (let node: RenderedElement | null = el; node !== null && node !== html; node = node.parentElement) {
                  if (node.id !== "") {
                    parts.unshift(`#${escapeId(node.id)}`);
                    break;
                  }
                  let index = 1;
                  const parent: RenderedElement | null = node.parentElement;
                  if (parent !== null) for (const sibling of parent.children) {
                    if (sibling === node) break;
                    if (sibling.tagName === node.tagName) index += 1;
                  }
                  parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
                  if (parent === null) break;
                }
                return parts.join(" > ");
              };

              /** True when a non-root box between the element and the document absorbs the overflow. */
              const absorbed = (el: RenderedElement): boolean => {
                for (let node = el.parentElement; node !== null; node = node.parentElement) {
                  // html and body scrolling IS the document panning: not an escape hatch.
                  if (node === html || node === body) return false;
                  // Inside a table, every box is part of the tabular data the criterion exempts.
                  if (node.tagName === "TABLE") return true;
                  if (win.getComputedStyle(node).overflowX !== "visible") return true;
                }
                return false;
              };

              /** The criterion's own exception: tabular data presented as such may keep two dimensions. */
              const twoDimensional = (el: RenderedElement): boolean => {
                if (el.tagName === "TABLE") return true;
                for (const node of el.querySelectorAll("table")) if (node.getBoundingClientRect().width > setup.width + setup.tolerance) return true;
                return false;
              };

              const picked: RenderedElement[] = [];
              for (const el of win.document.querySelectorAll("body *")) {
                const width = el.getBoundingClientRect().width;
                if (width <= setup.width + setup.tolerance) continue;
                if (win.getComputedStyle(el).display === "none") continue;
                if (absorbed(el) || twoDimensional(el)) continue;
                // The outermost fixed box is the one the author sized; inner wide boxes are its finding.
                if (picked.some((ancestor) => ancestor.contains(el))) continue;
                picked.push(el);
                out.push({ tag: el.tagName.toLowerCase(), selector: selectorOf(el), width: Math.round(width), markup: el.outerHTML.slice(0, 2000) });
              }
              return out;
            }, { width: REFLOW_VIEWPORT.width, tolerance: TOLERANCE_PX });
            for (const element of measurements) seen.push({ file: page.file, element });
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
    for (const { file, element } of seen) {
      const snippet = snippetOf(element.markup);
      const location: Location = { file, selector: element.selector, ...(snippet === undefined ? {} : { snippet }) };
      yield {
        message: `Content does not reflow: <${element.tag}> stays ${element.width} CSS px wide at the ${REFLOW_VIEWPORT.width} px viewport, so the document must be panned sideways as well as scrolled. Seen at ${viewportLabel([REFLOW_VIEWPORT])}.`,
        location,
        fix: {
          kind: "manual",
          summary: "Let this element fit a 320 CSS px viewport (width:auto with max-width:100% usually does it), or, when the content is genuinely two-dimensional (a map, a game, a wide table), put it inside its own scroll container so the document stops panning. Fix the page's source, not this built file.",
          edits: [],
        },
        key: element.selector,
      } satisfies FindingDraft;
    }
  },
};

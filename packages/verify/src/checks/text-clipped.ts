// layout.text-clipped: rendered text whose own box is smaller than the text inside it, so characters
// are cut off with no way to reach them — opt-in under --rendered (ADR 0005), like a11y.axe.
//
// A parser cannot decide this: only a browser lays words out. So the probe in the page measures every
// box that hides what does not fit — `overflow: hidden` or `clip` on a fixed width or height — and
// reports the numbers. What counts as a defect and what is a design choice is decided from those
// numbers here, in Node, so the decision stays testable on a machine without a browser.
//
// The unit of reporting is the clipped element. A page that scrolls sideways and content that does not
// reflow at 320 CSS px belong to `layout.horizontal-overflow` and `layout.reflow`, so this check never
// reports `html` or `body`, and a box whose own overflow is visible is never a finding even when the
// page around it scrolls.
//
// Everything is local and read-only: pages load from file:// URLs, requests to remote http(s) resources
// are aborted, and the browser's measurements come back as plain JSON. Site contents are untrusted
// input: the site's scripts run only inside the browser, never in this process, and the probe reads the
// layout the browser produced rather than evaluating anything the page contains.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Check, FindingDraft, Location } from "../types.js";
import { findBrowser } from "../browser.js";
import { launchBrowser, openContext, probeRendered, VIEWPORTS, viewportLabel, type Viewport } from "../render.js";
import { meta, pagesOf } from "./helpers.js";

/** Which axis of a box cuts its text off. */
export type ClipAxis = "horizontally" | "vertically";

/**
 * One box the browser measured: numbers only, no decisions. The probe builds these in the page;
 * `clippedAxes` decides from them.
 */
export interface BoxMeasurement {
  /** CSS selector of the box that holds the text. */
  readonly selector: string;
  /** The box's own markup, whitespace-collapsed and cut short, as the browser serialized it. */
  readonly snippet: string;
  /** True for `html` and `body`: the page itself, which the page-level layout checks own. */
  readonly isPageBox: boolean;
  /** The computed overflow on each axis, the way the browser resolved it. */
  readonly overflowX: string;
  readonly overflowY: string;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  /** CSS px of the box's own text that sits outside it, per axis; 0 when the text stays inside. */
  readonly pastWidth: number;
  readonly pastHeight: number;
  /** True when the author asked for a truncation indicator that renders: a design choice, not a defect. */
  readonly ellipsis: boolean;
}

/** One axis of one box that cuts its own text off. */
export interface Clip {
  readonly axis: ClipAxis;
  /** CSS px of text outside the box. */
  readonly pixels: number;
  /** The box's own client size on that axis, so the message can say what it is cut inside of. */
  readonly box: number;
  /** The computed overflow value that hides the excess. */
  readonly overflow: string;
}

/** The least number of cut-off CSS pixels a finding needs, unless `options.minPixels` says otherwise. */
const DEFAULT_MIN_PIXELS = 3;

/**
 * A box this small below its own content is measurement noise, not clipping: `scrollWidth` and
 * `clientWidth` are rounded to whole pixels, so a 1 px difference says nothing. The probe applies it,
 * which is why a `minPixels` below 2 finds no more than 2 does.
 */
const PROBE_TOLERANCE = 1;

/** An overflow value that hides content instead of letting people reach it. */
const hides = (value: string): boolean => value === "hidden" || value === "clip";

/**
 * Which axes of a measured box cut its text off, and by how much.
 *
 * Refuses to decide, and stays silent:
 * - `html` and `body` — the page scrolling is `layout.horizontal-overflow`'s and `layout.reflow`'s finding;
 * - a box whose overflow lets people scroll to the text (`auto`, `scroll`) — the content stays reachable;
 * - a box that shows a truncation indicator the author asked for (`text-overflow: ellipsis` with a single
 *   line or a line clamp) — half a title with an ellipsis is a design choice;
 * - text that fits, by fewer pixels than `minPixels`, on either the overflow test or the text test.
 */
export function clippedAxes(measurement: BoxMeasurement, minPixels: number): Clip[] {
  if (measurement.isPageBox || measurement.ellipsis) return [];
  const clips: Clip[] = [];
  const axis = (clipAxis: ClipAxis, overflow: string, past: number, box: number, scroll: number): void => {
    // Both tests must agree: the box hides what does not fit, and what does not fit is its text.
    if (!hides(overflow) || past < minPixels || scroll - box < minPixels) return;
    clips.push({ axis: clipAxis, pixels: Math.round(past), box, overflow });
  };
  axis("horizontally", measurement.overflowX, measurement.pastWidth, measurement.clientWidth, measurement.scrollWidth);
  axis("vertically", measurement.overflowY, measurement.pastHeight, measurement.clientHeight, measurement.scrollHeight);
  return clips;
}

/** One box, seen on one axis, at one width. */
export interface SeenClip {
  readonly file: string;
  readonly clip: Clip;
  readonly selector: string;
  readonly snippet: string;
  readonly viewport: Viewport;
}

/** One clipped box, seen at one or more widths. */
export interface MergedClip {
  /** The page the box is on, relative to the site root. */
  readonly file: string;
  readonly selector: string;
  readonly snippet: string;
  readonly axis: ClipAxis;
  readonly overflow: string;
  readonly box: number;
  /** The deepest cut seen at any width. */
  pixels: number;
  /** The widths it was cut at, in the order the widths run. */
  widths: Viewport[];
}

/**
 * Adds one clipped axis to the boxes seen so far. A box cut off at several widths is one problem, so it
 * is merged into one finding that names the widths and keeps the deepest cut.
 */
export function addClip(problems: Map<string, MergedClip>, seen: SeenClip): void {
  const id = JSON.stringify([seen.file, seen.selector, seen.clip.axis]);
  const known = problems.get(id);
  if (known === undefined) {
    problems.set(id, { file: seen.file, selector: seen.selector, snippet: seen.snippet, axis: seen.clip.axis, overflow: seen.clip.overflow, box: seen.clip.box, pixels: seen.clip.pixels, widths: [seen.viewport] });
    return;
  }
  known.widths.push(seen.viewport);
  if (seen.clip.pixels > known.pixels) known.pixels = seen.clip.pixels;
}

/** What a person or agent does about one clipped axis, in the source stylesheet rather than the built file. */
const FIXES: Record<ClipAxis, string> = {
  horizontally: "Give the text room in the stylesheet the site builds from, not in this built file: drop the fixed width or let the box size to its content, let the words wrap (white-space: normal with a usable min-width), or make the box scroll (overflow-x: auto) so people can reach the rest.",
  vertically: "Let the box grow with its text in the stylesheet the site builds from, not in this built file: drop the fixed height or use min-height, shorten the copy, or make the box scroll (overflow-y: auto) so the lines below stay reachable.",
};

function messageOf(clip: MergedClip): string {
  const property = clip.axis === "horizontally" ? "overflow-x" : "overflow-y";
  return `${clip.selector} cuts its own text off ${clip.axis}: ${clip.pixels} CSS px of it sits outside the ${clip.box} px box, which hides the rest (${property}: ${clip.overflow}). Seen at ${viewportLabel(clip.widths)}.`;
}

/** An integer `minPixels` of at least 0, or the default, the way `quality.font-count` reads its `max`. */
export function minPixelsOf(options: Readonly<Record<string, unknown>>): number {
  const value = options["minPixels"];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : DEFAULT_MIN_PIXELS;
}

// ---- the in-page probe -----------------------------------------------------------------------------
//
// The DOM the probe touches, typed by hand: this package compiles without the DOM lib (see
// tsconfig.base.json), so only the members the probe reads are declared.

interface ProbeRect { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number; }
interface ProbeStyle {
  readonly display: string;
  readonly visibility: string;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly textOverflow: string;
  readonly whiteSpace: string;
  readonly borderTopWidth: string;
  readonly borderRightWidth: string;
  readonly borderBottomWidth: string;
  readonly borderLeftWidth: string;
  getPropertyValue(name: string): string;
}
interface ProbeNode {
  readonly nodeType: number;
  readonly textContent: string | null;
  readonly firstChild: ProbeNode | null;
  readonly nextSibling: ProbeNode | null;
}
interface ProbeElement extends ProbeNode {
  readonly tagName: string;
  readonly id: string;
  readonly namespaceURI: string;
  readonly outerHTML: string;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly parentElement: ProbeElement | null;
  readonly firstElementChild: ProbeElement | null;
  readonly previousElementSibling: ProbeElement | null;
  readonly nextElementSibling: ProbeElement | null;
  getBoundingClientRect(): ProbeRect;
}
interface ProbeRange { selectNodeContents(node: ProbeNode): void; getClientRects(): ArrayLike<ProbeRect>; }
interface ProbeDocument {
  readonly documentElement: ProbeElement;
  readonly body: ProbeElement | null;
  readonly defaultView: { getComputedStyle(element: ProbeElement): ProbeStyle };
  createRange(): ProbeRange;
}

/**
 * The probe that runs inside the browser. playwright serializes this function alone, so it closes over
 * nothing from this module and takes what it needs as its argument. It measures; it does not decide.
 */
export function measureBoxes(options: { tolerance: number }): BoxMeasurement[] {
  const doc = (globalThis as unknown as { document: ProbeDocument }).document;
  const escapeId = (value: string): string => (globalThis as unknown as { CSS: { escape(value: string): string } }).CSS.escape(value);
  const view = doc.defaultView;
  const XHTML = "http://www.w3.org/1999/xhtml";

  // A replaced element, a form control, or markup nobody reads: its text is not this box's to clip,
  // and a control such as a textarea scrolls to its own text by design.
  const SKIP = ["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "HEAD", "TITLE", "META", "LINK", "SVG", "IFRAME", "CANVAS", "VIDEO", "AUDIO", "OBJECT", "EMBED", "SOURCE", "TRACK", "PICTURE", "SELECT", "OPTGROUP", "OPTION", "TEXTAREA", "INPUT", "PROGRESS", "METER", "SLOT"];
  const skipped = (element: ProbeElement): boolean => element.namespaceURI !== XHTML || SKIP.includes(element.tagName);
  const notShown = (style: ProbeStyle): boolean => style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse";

  /** A stable path from the root: `#id` when the box has one, else the tag chain with positional steps. */
  const pathOf = (element: ProbeElement): string => {
    if (element.id !== "") return `#${escapeId(element.id)}`;
    if (element.tagName === "HTML") return "html";
    const parts: string[] = [];
    let node: ProbeElement | null = element;
    while (node !== null && node.tagName !== "HTML") {
      const tag = node.tagName.toLowerCase();
      let index = 1;
      let followed = false;
      let before = node.previousElementSibling;
      while (before !== null) {
        if (before.tagName === node.tagName) index += 1;
        before = before.previousElementSibling;
      }
      let after = node.nextElementSibling;
      while (after !== null) {
        if (after.tagName === node.tagName) followed = true;
        after = after.nextElementSibling;
      }
      parts.unshift(index > 1 || followed ? `${tag}:nth-of-type(${index})` : tag);
      node = node.parentElement;
    }
    return parts.join(" > ");
  };

  /** The box's client box: its border box without its borders, since hidden overflow cuts at the padding edge. */
  const clientBoxOf = (element: ProbeElement, style: ProbeStyle): ProbeRect => {
    const pixels = (value: string): number => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const rect = element.getBoundingClientRect();
    return { left: rect.left + pixels(style.borderLeftWidth), right: rect.right - pixels(style.borderRightWidth), top: rect.top + pixels(style.borderTopWidth), bottom: rect.bottom - pixels(style.borderBottomWidth) };
  };

  /**
   * How far the text inside the box reaches past the box, per axis, or undefined when the box holds no
   * text at all: a picture cut off by its thumbnail is not a clipped sentence.
   */
  const textExtentOf = (element: ProbeElement, box: ProbeRect): { pastWidth: number; pastHeight: number } | undefined => {
    let pastWidth = 0;
    let pastHeight = 0;
    let seenText = false;
    const account = (rect: ProbeRect): void => {
      seenText = true;
      pastWidth = Math.max(pastWidth, rect.right - box.right, box.left - rect.left);
      pastHeight = Math.max(pastHeight, rect.bottom - box.bottom, box.top - rect.top);
    };
    const walk = (node: ProbeNode): void => {
      let child = node.firstChild;
      while (child !== null) {
        const current = child;
        child = current.nextSibling;
        if (current.nodeType === 3) {
          if ((current.textContent ?? "").trim() === "") continue;
          const range = doc.createRange();
          range.selectNodeContents(current);
          const rects = range.getClientRects();
          for (let i = 0; i < rects.length; i += 1) {
            const rect = rects[i];
            if (rect !== undefined) account(rect);
          }
          continue;
        }
        if (current.nodeType !== 1) continue;
        const inner = current as ProbeElement;
        if (skipped(inner)) continue;
        const style = view.getComputedStyle(inner);
        if (notShown(style)) continue;
        // A box that hides or scrolls its own content is measured on its own; this box only sees its frame.
        if (style.overflowX !== "visible" || style.overflowY !== "visible") {
          account(inner.getBoundingClientRect());
          continue;
        }
        walk(inner);
      }
    };
    walk(element);
    return seenText ? { pastWidth: Math.max(0, pastWidth), pastHeight: Math.max(0, pastHeight) } : undefined;
  };

  /**
   * True when a truncation indicator really renders. `text-overflow` only draws on a line that cannot
   * wrap: one `nowrap`/`pre` line, or the last line of a `-webkit-line-clamp` box.
   */
  const showsIndicator = (style: ProbeStyle): boolean => {
    if (style.textOverflow === "clip" || style.textOverflow === "") return false;
    return style.whiteSpace === "nowrap" || style.whiteSpace === "pre" || style.getPropertyValue("-webkit-line-clamp") !== "none";
  };

  const out: BoxMeasurement[] = [];

  const boxes = (element: ProbeElement): void => {
    const isPageBox = element === doc.documentElement || element === doc.body;
    if (!skipped(element) && element.clientWidth > 0 && element.clientHeight > 0) {
      const style = view.getComputedStyle(element);
      // Inlined rather than calling the module's `hides`: only this function's own source reaches the page.
      const overWidth = (style.overflowX === "hidden" || style.overflowX === "clip") && element.scrollWidth - element.clientWidth > options.tolerance;
      const overHeight = (style.overflowY === "hidden" || style.overflowY === "clip") && element.scrollHeight - element.clientHeight > options.tolerance;
      if (!notShown(style) && (overWidth || overHeight) && (element.textContent ?? "").trim() !== "") {
        const extent = textExtentOf(element, clientBoxOf(element, style));
        if (extent !== undefined) {
          const markup = element.outerHTML.replace(/\s+/g, " ").trim();
          out.push({
            selector: pathOf(element),
            snippet: markup.length <= 200 ? markup : `${markup.slice(0, 200)}…`,
            isPageBox,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
            pastWidth: extent.pastWidth,
            pastHeight: extent.pastHeight,
            ellipsis: showsIndicator(style),
          });
        }
      }
    }
    let child = element.firstElementChild;
    while (child !== null) {
      const current = child;
      child = current.nextElementSibling;
      boxes(current);
    }
  };
  boxes(doc.documentElement);
  return out;
}

export const layoutTextClipped: Check = {
  meta: meta("layout.text-clipped", "Text cut off by its container", "warning", ["WCAG 1.4.10", "WCAG 1.4.4"], ["html", "browser"]),
  probe: probeRendered,
  async *run(context) {
    // The engine probes first, so by the time run is called both playwright-core and a browser exist.
    const found = findBrowser(context.browser?.path); // throws when the user asked for a missing browser
    if (found === undefined) throw new Error("layout.text-clipped found no browser to launch; next time the engine's probe would skip it");
    const minPixels = minPixelsOf(context.options);
    const browser = await launchBrowser(found.path);
    // One entry per clipped box and axis, not per width: a box cut off at 375 px is cut off at 1280 px too.
    const merged = new Map<string, MergedClip>();
    try {
      for (const viewport of VIEWPORTS) {
        const pwContext = await openContext(browser, viewport);
        try {
          for (const page of pagesOf(context)) {
            if (context.signal.aborted) break;
            const pwPage = await pwContext.newPage();
            try {
              await pwPage.goto(pathToFileURL(join(context.site.root, page.file)).href, { waitUntil: "load" });
              for (const box of await pwPage.evaluate<readonly BoxMeasurement[]>(measureBoxes, { tolerance: PROBE_TOLERANCE })) {
                for (const clip of clippedAxes(box, minPixels)) {
                  addClip(merged, { file: page.file, clip, selector: box.selector, snippet: box.snippet, viewport });
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
    const order = (a: MergedClip, b: MergedClip): number => a.file.localeCompare(b.file) || a.selector.localeCompare(b.selector) || a.axis.localeCompare(b.axis);
    for (const clip of [...merged.values()].sort(order)) {
      const location: Location = { file: clip.file, selector: clip.selector, snippet: clip.snippet };
      yield {
        message: messageOf(clip),
        location,
        fix: { kind: "manual", summary: FIXES[clip.axis], edits: [] },
        key: `${clip.selector}:${clip.axis}`,
      } satisfies FindingDraft;
    }
  },
};

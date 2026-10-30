// layout.focus-visible: a keyboard-focused element that shows no visible focus indicator (WCAG 2.4.7).
//
// The success criterion is about what a person sees, so the check measures that. In a real browser it
// presses Tab through the page and compares the computed appearance of everything a focus change could
// repaint — the element, its ancestors, its siblings, its descendants, and their `::before` and `::after`
// — with the appearance captured before anything had focus. A ring, a colour change, a shadow, a bolder
// word: any of them passes, because the check judges the result and not the technique. That is what keeps
// `outline: none` with a replacement — the pattern WCAG itself recommends — from becoming a finding.
//
// What the check refuses to guess: an indicator it cannot see is not evidence of its absence, so shapes
// the browser hides from a style read are skipped instead of reported. Elements a shadow root renders
// (custom elements and shadow hosts), elements only a script focuses (a negative `tabindex`), and elements
// inside `aria-hidden` or `inert` content — which `a11y.hidden-focusable` already reports — are left alone.
// A page whose stylesheets come from a CDN is skipped whole: this run is offline (remote requests are
// refused), so what the browser measured would not be what a person sees.
//
// Everything is local, like a11y.axe: pages load from `file://` URLs, remote requests are refused by
// `openContext`, and the browser is the machine's own. Site contents stay untrusted input — the browser
// renders them, they are never evaluated as our instructions, and every value comes back as plain data.
//
// Judgement follows the host browser's own default focus ring, so it assumes a Chromium browser: the ring
// it applies is read as the computed `outline` the UA sheet puts on a `:focus-visible` element.
//
// The widths are the shared rendered ones (phone, tablet, desktop): an indicator can exist at one width
// and not another, so one element is one finding naming the widths it was seen at.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Check, CheckContext, FindingDraft, Location } from "../types.js";
import { findBrowser } from "../browser.js";
import { launchBrowser, openContext, probeRendered, VIEWPORTS, viewportLabel, type PlaywrightPage, type Viewport } from "../render.js";
import { meta, pagesOf } from "./helpers.js";

/**
 * The computed properties a focus indicator is made of, as the browser reports them.
 *
 * `outline-offset` is deliberately absent: Chromium changes it when an element takes keyboard focus even
 * when the ring itself is suppressed, so comparing it would hide every failure this check exists to find.
 */
const INDICATOR_PROPERTIES = [
  "outlineStyle",
  "outlineWidth",
  "outlineColor",
  "boxShadow",
  "borderTopStyle",
  "borderTopWidth",
  "borderTopColor",
  "borderRightStyle",
  "borderRightWidth",
  "borderRightColor",
  "borderBottomStyle",
  "borderBottomWidth",
  "borderBottomColor",
  "borderLeftStyle",
  "borderLeftWidth",
  "borderLeftColor",
  "backgroundColor",
  "backgroundImage",
  "color",
  "textDecorationLine",
  "textDecorationColor",
  "textDecorationThickness",
  "fontWeight",
  "opacity",
  "filter",
  "transform",
  "translate",
  "rotate",
  "scale",
  "width",
  "height",
  "display",
  "visibility",
  "content",
] as const;

/** Where the probe keeps its state inside the page. Only this check reads it, only between its own calls. */
const PROBE_KEY = "__seaworthyFocusVisible";

/** How far the Tab walk goes at most, whatever the page contains. */
const MAX_TAB_STOPS = 400;

/** Key presses that reach no element of the page's own before the walk is called finished. */
const MAX_IDLE_PRESSES = 8;

// ---- the page-side DOM, as far as this probe uses it -----------------------------------------------------
// The package is compiled without a DOM lib, and the objects below only ever exist inside the browser.

interface PageElement {
  readonly tagName: string;
  readonly parentElement: PageElement | null;
  readonly children: readonly PageElement[];
  readonly textContent: string | null;
  readonly outerHTML: string;
  readonly shadowRoot: PageElement | null;
  getAttribute(name: string): string | null;
  closest(selector: string): PageElement | null;
  querySelectorAll(selector: string): readonly PageElement[];
}

interface PageDocument {
  readonly activeElement: PageElement | null;
  readonly body: PageElement | null;
  readonly documentElement: PageElement | null;
  querySelectorAll(selector: string): readonly PageElement[];
  getAnimations(): readonly PageAnimation[];
}

interface PageStyle {
  readonly [property: string]: string;
}

interface PageResource {
  readonly name: string;
  readonly initiatorType: string;
}

interface PageAnimationEffect {
  readonly target: PageElement | null;
  getComputedTiming(): { iterations: number | string };
}

interface PageAnimation {
  readonly effect: PageAnimationEffect | null;
}

/** The browser globals the probe reads, reached through `globalThis` because our process never has them. */
interface PageGlobals {
  [key: string]: unknown;
  readonly document: PageDocument;
  readonly performance: { getEntriesByType(kind: string): readonly PageResource[] };
  readonly getComputedStyle: (element: PageElement, pseudo?: string) => PageStyle;
}

/** What the probe leaves in the page between its calls: the unfocused appearance, and the walk so far. */
interface ProbeState {
  readonly els: readonly PageElement[];
  readonly index: Map<PageElement, number>;
  readonly own: readonly string[];
  readonly pseudos: readonly string[];
  readonly selfChanging: ReadonlySet<PageElement>;
  readonly signature: (node: PageElement, pseudo: string) => string;
  readonly path: (node: PageElement) => string;
  readonly snippet: (node: PageElement) => string;
  readonly visited: Set<number>;
  first: number;
  idle: number;
  done: boolean;
}

// ---- what comes back to this process ---------------------------------------------------------------------

/** One tab stop as the browser saw it. The page returns facts; the decisions about them are made here. */
export interface TabStop {
  /** What the key press did: landed on an element, reached nothing measurable, or came back around. */
  readonly state: "stop" | "outside" | "cycle" | "gone";
  /** The element holding focus, when the press landed on one of the page's own elements. */
  readonly element?: StopElement | undefined;
  /** True when nothing the focus could have repainted looks different from before it arrived. */
  readonly unchanged?: boolean | undefined;
}

export interface StopElement {
  /** The tag name, uppercase, as the DOM reports it. */
  readonly tag: string;
  /** The element's unique path from `html`, for the finding's location. */
  readonly selector: string;
  /** The element as the browser serialises it, collapsed and cut to 200 characters. */
  readonly snippet: string;
  /** The words on the element, collapsed and cut short, for the message. */
  readonly name: string;
  /** Its `tabindex`, when it carries one. */
  readonly tabindex?: string | undefined;
  /** True when the element hosts a shadow root the probe cannot read inside. */
  readonly shadowHost: boolean;
  /** True when an ancestor is `aria-hidden="true"` or `inert`. */
  readonly hiddenFromAssistiveTech: boolean;
  /** True when the element repaints on a loop of its own, so its appearance says nothing about focus. */
  readonly animating: boolean;
}

interface InstalledProbe {
  /** Every element on the page in document order, as this width rendered it. */
  readonly elements: number;
  /** False when the page cannot be judged: this run is offline, and some of its CSS never arrived. */
  readonly judgeable: boolean;
}

/** Why a tab stop is not judged, or undefined when it is. Pure, so the boundary is testable without a browser. */
export function skipReason(element: StopElement): string | undefined {
  // A negative tabindex means only a script moves focus here, so Tab shows no ring on it for a person.
  const tabindex = Number(element.tabindex);
  if (element.tabindex !== undefined && element.tabindex.trim() !== "" && Number.isFinite(tabindex) && tabindex < 0) return "script-focused";
  // What a custom element or a shadow host paints inside is not readable from the main document's styles.
  if (element.tag.includes("-") || element.shadowHost) return "shadow-dom";
  // Focus reaching content hidden from assistive tech is a11y.hidden-focusable's finding: one problem, one finding.
  if (element.hiddenFromAssistiveTech) return "hidden-from-assistive-tech";
  // An element that spins or pulses on its own looks different from its baseline whatever focus does.
  if (element.animating) return "self-animating";
  return undefined;
}

/** One problem, seen at one or more widths: the same element measured again at another width stays one finding. */
export interface UncoveredElement {
  readonly file: string;
  readonly element: StopElement;
  readonly selector: string;
  readonly widths: Viewport[];
}

/** Adds one tab stop to the problems seen so far. Stops where an indicator was seen add nothing. */
export function addStop(problems: Map<string, UncoveredElement>, seen: { file: string; element: StopElement; viewport: Viewport; unchanged: boolean }): void {
  if (!seen.unchanged) return;
  const id = JSON.stringify([seen.file, seen.element.selector]);
  const known = problems.get(id);
  if (known === undefined) problems.set(id, { file: seen.file, element: seen.element, selector: seen.element.selector, widths: [seen.viewport] });
  else known.widths.push(seen.viewport);
}

/** The words a finding uses for the element: what it is, and what a person reads on it. */
function describe(element: StopElement): string {
  return `<${element.tag.toLowerCase()}>${element.name === "" ? "" : ` "${element.name}"`}`;
}

/**
 * Captures the page's unfocused appearance once, so every later key press has something to compare with.
 * Runs inside the page, so it is written against the DOM types above and touches nothing outside itself.
 */
const installProbe = (setup: { key: string; props: readonly string[] }): InstalledProbe => {
  const host = globalThis as unknown as PageGlobals;
  delete host[setup.key];

  const elements: PageElement[] = [...host.document.querySelectorAll("html, body, body *")];

  // An outline nobody can see — no style, no width, or a fully transparent colour — is recorded as no
  // outline at all, so `outline: 2px solid transparent` on focus cannot be mistaken for an indicator.
  const transparent = (color: string): boolean => color.startsWith("rgba(") && /,\s*0\s*\)$/.test(color);
  const signature = (node: PageElement, pseudo: string): string => {
    const style = host.getComputedStyle(node, pseudo === "" ? undefined : pseudo);
    const noOutline = style["outlineStyle"] === "none" || style["outlineWidth"] === "0px" || transparent(style["outlineColor"] ?? "");
    const parts: string[] = [];
    for (const property of setup.props) {
      if (noOutline && property.startsWith("outline")) parts.push("none");
      else parts.push(style[property] ?? "");
    }
    return parts.join("|");
  };
  const positionAmongSiblings = (node: PageElement): number => {
    const parent = node.parentElement;
    if (parent === null) return 0;
    const same = [...parent.children].filter((child) => child.tagName === node.tagName);
    return same.length > 1 ? same.indexOf(node) + 1 : 0;
  };
  // A path no other element shares: every step names its tag and, when a sibling repeats it, its number.
  const path = (node: PageElement): string => {
    const steps: string[] = [];
    for (let current: PageElement | null = node; current !== null; current = current.parentElement) {
      const position = positionAmongSiblings(current);
      steps.unshift(current.tagName.toLowerCase() + (position === 0 ? "" : `:nth-of-type(${position})`));
      if (current.parentElement === null) break;
    }
    return steps.join(" > ");
  };
  const snippet = (node: PageElement): string => {
    const html = node.outerHTML.replace(/\s+/g, " ").trim();
    return html.length <= 200 ? html : `${html.slice(0, 200)}…`;
  };

  // An element on a looping animation repaints whether or not anything holds focus, so a difference in it
  // is not evidence about focus and it is left out of every comparison. Transitions are not looped and stay
  // in: an indicator that fades in on focus is an indicator a person sees.
  const selfChanging = new Set<PageElement>();
  for (const animation of host.document.getAnimations()) {
    const effect = animation.effect;
    if (effect === null || effect.target === null) continue;
    const iterations = effect.getComputedTiming().iterations;
    if (iterations === Infinity || iterations === "infinite") selfChanging.add(effect.target);
  }

  const probe: ProbeState = {
    els: elements,
    index: new Map(elements.map((node, i): [PageElement, number] => [node, i])),
    own: elements.map((node) => signature(node, "")),
    pseudos: elements.map((node) => signature(node, "::before") + signature(node, "::after")),
    selfChanging,
    signature,
    path,
    snippet,
    visited: new Set<number>(),
    first: -1,
    idle: 0,
    done: false,
  };
  host[setup.key] = probe;

  // A refused run never fetched a stylesheet that lives on a CDN, whether the page links it or `@import`s
  // it, so the appearance the browser measured is not the one a person sees. Such pages are not judged.
  const sources = [
    ...[...host.document.querySelectorAll("link[rel=stylesheet]")].map((link) => link.getAttribute("href") ?? ""),
    ...host.performance.getEntriesByType("resource").filter((entry) => entry.initiatorType === "css" || entry.initiatorType === "link").map((entry) => entry.name),
  ];
  return { elements: elements.length, judgeable: sources.every((source) => !/^(?:https?:)?\/\//i.test(source)) };
};

/** Reads the element focus just landed on and whether anything a focus could repaint now looks different. */
const readStop = (setup: { key: string; idleLimit: number }): TabStop => {
  const host = globalThis as unknown as PageGlobals;
  const probe = host[setup.key] as ProbeState | undefined;
  if (probe === undefined || probe.done) return { state: "gone" };

  const active = host.document.activeElement;
  const index = active === null ? undefined : probe.index.get(active);
  // The document itself takes focus when the tab order wraps; it is not an element a page author styles.
  if (active === null || index === undefined || active === host.document.body || active === host.document.documentElement) {
    probe.idle += 1;
    if (probe.idle >= setup.idleLimit) probe.done = true;
    return { state: "outside" };
  }
  if (probe.visited.has(index)) {
    // Back at the stop the walk started from: the tab order is a circle and it is now walked once.
    if (index === probe.first) probe.done = true;
    return { state: "cycle" };
  }
  probe.visited.add(index);
  if (probe.first < 0) probe.first = index;
  probe.idle = 0;

  // Everything a focus change could repaint: the element, its ancestors, its siblings, its descendants,
  // and their `::before` and `::after`. None of them differing is the failure the criterion is about.
  const repaints = (node: PageElement): PageElement[] => {
    const scope: PageElement[] = [];
    for (let current: PageElement | null = node; current !== null; current = current.parentElement) scope.push(current);
    for (let parent: PageElement | null = node.parentElement; parent !== null; parent = parent.parentElement) scope.push(...parent.children);
    for (const descendant of node.querySelectorAll("*")) scope.push(descendant);
    return scope;
  };
  let unchanged = true;
  for (const node of repaints(active)) {
    const at = probe.index.get(node);
    if (at === undefined || probe.selfChanging.has(node)) continue;
    if (probe.signature(node, "") !== probe.own[at] || probe.signature(node, "::before") + probe.signature(node, "::after") !== probe.pseudos[at]) {
      unchanged = false;
      break;
    }
  }
  // Nothing in scope changed. Before calling that a missing indicator, look at the whole page: a signal
  // drawn somewhere we cannot attribute to this focus is not evidence of failure, so the element is skipped.
  if (unchanged) {
    for (const node of probe.els) {
      if (probe.selfChanging.has(node)) continue;
      const at = probe.index.get(node);
      if (at !== undefined && probe.signature(node, "") !== probe.own[at]) {
        unchanged = false;
        break;
      }
    }
  }

  const tabindex = active.getAttribute("tabindex");
  return {
    state: "stop",
    element: {
      tag: active.tagName,
      selector: probe.path(active),
      snippet: probe.snippet(active),
      name: (active.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
      ...(tabindex === null ? {} : { tabindex }),
      shadowHost: active.shadowRoot !== null,
      hiddenFromAssistiveTech: active.closest('[aria-hidden="true"], [inert]') !== null,
      animating: probe.selfChanging.has(active),
    },
    unchanged,
  };
};

/** The page methods a rendered probe needs beyond the surface `../render.js` types: one real key press. */
interface KeyboardPage extends PlaywrightPage {
  readonly keyboard: { press(key: string): Promise<void> };
}

export const layoutFocusVisible: Check = {
  meta: meta("layout.focus-visible", "Keyboard focus reaches an element that shows no visible indicator", "error", ["WCAG 2.4.7"], ["html", "browser"]),
  probe: probeRendered,
  async *run(context: CheckContext) {
    // The engine probes first, so by the time run is called both playwright-core and a browser exist.
    const found = findBrowser(context.browser?.path);
    if (found === undefined) throw new Error("layout.focus-visible found no browser to launch; next time the engine's probe would skip it");
    const browser = await launchBrowser(found.path);
    // One entry per element, not per width: an element that shows nothing usually shows nothing everywhere.
    const merged = new Map<string, UncoveredElement>();
    try {
      for (const viewport of VIEWPORTS) {
        const pwContext = await openContext(browser, viewport);
        try {
          for (const page of pagesOf(context)) {
            if (context.signal.aborted) break;
            const pwPage = (await pwContext.newPage()) as KeyboardPage;
            try {
              await pwPage.goto(pathToFileURL(join(context.site.root, page.file)).href, { waitUntil: "load" });
              const installed = await pwPage.evaluate<InstalledProbe>(installProbe, { key: PROBE_KEY, props: INDICATOR_PROPERTIES });
              if (!installed.judgeable) continue;
              const presses = Math.min(installed.elements + MAX_IDLE_PRESSES, MAX_TAB_STOPS);
              for (let press = 0; press < presses; press += 1) {
                await pwPage.keyboard.press("Tab");
                const stop = await pwPage.evaluate<TabStop>(readStop, { key: PROBE_KEY, idleLimit: MAX_IDLE_PRESSES });
                if (stop.state === "gone") break;
                if (stop.state === "cycle") continue;
                if (stop.state !== "stop" || stop.element === undefined || stop.unchanged === undefined) continue;
                if (skipReason(stop.element) !== undefined) continue;
                addStop(merged, { file: page.file, element: stop.element, viewport, unchanged: stop.unchanged });
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
    for (const { file, element, selector, widths } of merged.values()) {
      const location: Location = { file, selector, snippet: element.snippet };
      yield {
        message: `${describe(element)} takes keyboard focus and nothing about it changes: no ring, no colour, no shadow, no shape. A keyboard user cannot see where they are. Seen at ${viewportLabel(widths)}.`,
        location,
        fix: {
          kind: "manual",
          summary: `Give ${describe(element)} a focus indicator that is clearly visible against the page, for example a:focus-visible { outline: 3px solid currentColor; outline-offset: 2px }, or a change of background colour, border, or box-shadow. Keep any outline you remove (outline: none) paired with its replacement, and style :focus-visible rather than :focus. Fix the page's source, not this built file.`,
          edits: [],
        },
        key: selector,
      } satisfies FindingDraft;
    }
  },
};

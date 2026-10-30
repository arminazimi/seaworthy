// Rendered checks: the widths they measure at, and the browser they drive.
//
// A page that breaks on a phone is invisible at desktop width, and one that only breaks on a wide
// screen is invisible on a phone, so a rendered check measures every page at each width in turn.
// The widths are fixed (phone, tablet, desktop) and shared, so every rendered check and every
// finding names the same set.
//
// playwright-core stays an optional peer (ADR 0005): it is loaded once, lazily, and a machine
// without it skips the rendered checks instead of failing the run. The browser is never
// downloaded: the one on the machine is found (see ./browser.ts) and launched.

import { findBrowser } from "./browser.js";
import type { CheckContext, ProbeSkip } from "./types.js";

/** A width and height a rendered page is measured at. */
export interface Viewport {
  /** The name a finding uses to say where the problem was seen. */
  readonly name: string;
  /** CSS pixels wide. */
  readonly width: number;
  /** CSS pixels high. */
  readonly height: number;
}

/** Phone, tablet, desktop: the widths every rendered check measures at, narrowest first. */
export const VIEWPORTS: readonly Viewport[] = [
  { name: "phone", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

/** How a finding names the widths it was seen at: "phone (375 px), tablet (768 px)". */
export function viewportLabel(viewports: readonly Viewport[]): string {
  return viewports.map((viewport) => `${viewport.name} (${viewport.width} px)`).join(", ");
}

export interface PlaywrightPage {
  goto(url: string, options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit" }): Promise<unknown>;
  addScriptTag(options: { path: string }): Promise<unknown>;
  evaluate<R>(script: (arg: never) => unknown, arg: unknown): Promise<R>;
  locator(selector: string): PlaywrightLocator;
  screenshot(options: { clip: ElementBox }): Promise<Buffer>;
  close(): Promise<void>;
}

export interface PlaywrightLocator {
  /** The element's box in viewport coordinates, or null when it has no box (hidden or gone). */
  boundingBox(): Promise<ElementBox | null>;
  scrollIntoViewIfNeeded(): Promise<void>;
}

export interface PlaywrightContext {
  /** Aborts every request through a URL pattern. */
  route(url: string, handler: (route: { abort(): Promise<void> }) => Promise<void>): Promise<void>;
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

export interface PlaywrightBrowser {
  newContext(options?: { viewport?: { width: number; height: number } }): Promise<PlaywrightContext>;
  close(): Promise<void>;
}

export interface PlaywrightLike {
  chromium: {
    launch(options: { executablePath?: string; headless?: boolean }): Promise<PlaywrightBrowser>;
  };
}

let playwrightModule: Promise<PlaywrightLike | undefined> | undefined;

/** playwright-core stays an optional peer (ADR 0005): loaded once, lazily, and missing installs are fine. */
export function loadPlaywright(): Promise<PlaywrightLike | undefined> {
  playwrightModule ??= import("playwright-core").then(
    (module) => module as unknown as PlaywrightLike,
    () => undefined,
  );
  return playwrightModule;
}

/**
 * Why a rendered check cannot run on this machine, or undefined when it can. The engine turns this
 * into a skip with a hint, so a machine without a browser never fails a run over it.
 */
export async function probeRendered(context: CheckContext): Promise<ProbeSkip | undefined> {
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

/** Launches the browser a rendered check drives. */
export async function launchBrowser(path: string): Promise<PlaywrightBrowser> {
  const playwright = await loadPlaywright();
  if (playwright === undefined) throw new Error("playwright-core is required for rendered checks but is not installed");
  return await playwright.chromium.launch({ executablePath: path, headless: true });
}

/**
 * A context at one width. Remote requests are aborted: a built page may point at a CDN, and a run
 * stays offline and deterministic even then.
 */
export async function openContext(browser: PlaywrightBrowser, viewport: Viewport): Promise<PlaywrightContext> {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  await context.route("http*", (route) => route.abort());
  return context;
}

/** A rectangle in CSS pixels: an element's box or a screenshot clip, both in viewport coordinates. */
export interface ElementBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** CSS pixels of page context a crop keeps around the element, so the finding is visible in its surroundings. */
export const EVIDENCE_PADDING = 24;

/**
 * The clip for a crop of one element: its box plus `EVIDENCE_PADDING` on every side, clamped to
 * the viewport (a crop of pixels that exist), or undefined when the box leaves no visible area.
 * Pure, so the arithmetic is testable without a browser.
 */
export function cropClip(box: ElementBox, viewport: Viewport): ElementBox | undefined {
  if (!(box.width > 0) || !(box.height > 0)) return undefined;
  const x = Math.min(Math.max(0, Math.floor(box.x - EVIDENCE_PADDING)), viewport.width);
  const y = Math.min(Math.max(0, Math.floor(box.y - EVIDENCE_PADDING)), viewport.height);
  const right = Math.min(Math.max(0, Math.ceil(box.x + box.width + EVIDENCE_PADDING)), viewport.width);
  const bottom = Math.min(Math.max(0, Math.ceil(box.y + box.height + EVIDENCE_PADDING)), viewport.height);
  if (right - x < 1 || bottom - y < 1) return undefined;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * A PNG crop of the viewport around one element: the pixels that prove a rendered finding.
 * Best-effort — a selector that matches nothing, a box that is gone, or a browser that refuses
 * yields undefined, and the finding stands on its message alone. Evidence never fails a run.
 */
export async function cropElement(page: PlaywrightPage, selector: string, viewport: Viewport): Promise<Buffer | undefined> {
  try {
    const locator = page.locator(selector);
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (box === null) return undefined;
    const clip = cropClip(box, viewport);
    if (clip === undefined) return undefined;
    return await page.screenshot({ clip });
  } catch {
    return undefined;
  }
}

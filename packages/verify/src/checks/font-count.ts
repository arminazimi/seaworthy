// quality.font-count: one page pulls in more distinct font files than it should.
// Enumeration of font URLs lives here, not in quality.page-weight: that check sums font bytes,
// this one counts font files. No browser, no network: it reads the page's stylesheets from the build.

import { type HtmlElement, type Page, type SiteGraph, attr } from "../site.js";
import type { FindingDraft, Location } from "../types.js";
import { check, documentLocation, locate, meta, pagesOf, readSiteFile } from "./helpers.js";

/** The font file extensions, the same set quality.page-weight sums under its `fonts` bucket. */
const FONT_EXTENSION = /\.(woff2?|ttf|otf|eot)$/i;
/** A `url(...)` in CSS text; the quote, when there is one, is captured so it must close. */
const CSS_URL = /url\(\s*(['"]?)([^'()]+)\1\s*\)/g;

/**
 * Distinct font files one page may pull in when the options set no `max`: about two families
 * across a handful of weights. A value that is not an integer of at least 1 falls back to it,
 * the same way `images.size`'s `maxBytes` and `quality.page-weight`'s budgets fall back.
 */
const DEFAULT_MAX = 6;

/** The site paths of the font files a CSS text pulls in, resolved against the CSS file's own path; a URL is dropped when it is not a font file the build serves. */
function fontFilesIn(css: string, fromUrl: string, site: SiteGraph): string[] {
  const out: string[] = [];
  for (const match of css.matchAll(CSS_URL)) {
    const url = match[2] ?? "";
    if (/^data:/i.test(url)) continue; // a data URI is not a file in the built site
    if (!FONT_EXTENSION.test(url.split(/[?#]/)[0] ?? "")) continue;
    const target = site.resolveLink(fromUrl, url);
    // An external URL is not the build's font, and a missing file is assets.missing's finding, not this one's.
    if (target.kind === "internal" && target.file !== undefined) out.push(target.file);
  }
  return out;
}

/** The text of one `<style>` element as written in the page; parse5 keeps raw-text elements verbatim. */
function styleText(element: HtmlElement): string {
  let css = "";
  for (const child of element.childNodes as unknown as { nodeName: string; value?: string }[]) if (child.nodeName === "#text" && child.value) css += child.value;
  return css;
}

export const qualityFontCount = check(meta("quality.font-count", "A page pulls in too many font files", "warning", [], ["html", "files"]), (ctx) => {
  const max = typeof ctx.options.max === "number" && Number.isInteger(ctx.options.max) && ctx.options.max >= 1 ? ctx.options.max : DEFAULT_MAX;
  const { site } = ctx;
  const out: FindingDraft[] = [];

  for (const page of pagesOf(ctx)) {
    // Distinct font files, keyed by resolved site path: the same file two stylesheets load counts once.
    const fonts = new Set<string>();
    let fromLinked = false;
    let inlineElement: HtmlElement | undefined;

    for (const element of page.elements) {
      if (element.tagName === "link") {
        const href = attr(element, "href");
        if (!href) continue;
        if (!(attr(element, "rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet")) continue;
        const target = site.resolveLink(page.url, href);
        if (target.kind !== "internal" || target.file === undefined) continue;
        const css = readSiteFile(site, target.file)?.bytes.toString("utf8");
        if (css === undefined) continue; // a stylesheet the build does not serve is assets.missing's subject
        const files = fontFilesIn(css, target.file, site);
        if (files.length > 0) fromLinked = true;
        for (const file of files) fonts.add(file);
      } else if (element.tagName === "style") {
        const files = fontFilesIn(styleText(element), page.url, site);
        if (files.length === 0) continue;
        if (inlineElement === undefined) inlineElement = element;
        for (const file of files) fonts.add(file);
      }
    }

    if (fonts.size <= max) continue;
    const paths = [...fonts].sort();
    // Where to point: the count comes through the <head>'s stylesheets, or through the inline <style> when only it carries fonts.
    const location: Location = fromLinked || inlineElement === undefined ? documentLocation(page) : locate(page, inlineElement);
    out.push({
      message: `${page.file} pulls in ${paths.length} distinct font files, over the maximum of ${max}: ${paths.join(", ")}.`,
      location,
      fix: {
        kind: "manual",
        summary: "Cut the font files the page ships: drop weights and families no text on the page uses, subset each font to the glyphs the page needs, or replace several static weights with one self-hosted variable font. Every font is listed in the finding, so fix this where the @font-face rules are written (the CSS source), not by deleting CSS at random.",
        edits: [],
      },
      key: page.url,
    });
  }
  return out;
});

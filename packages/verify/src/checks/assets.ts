// assets.missing: files a page loads (images, scripts, stylesheets, media) that are not in the built site.

import { posix } from "node:path";

import { type HtmlElement, type Page, attr } from "../site.js";
import { closest } from "../text.js";
import type { FindingDraft } from "../types.js";
import { check, locate, meta, pagesOf, replaceAttribute } from "./helpers.js";

/** Which attributes load a file, per element. `link` is handled separately because only some rels load one. */
const LOADING: Record<string, readonly string[]> = {
  img: ["src", "srcset"],
  source: ["src", "srcset"],
  script: ["src"],
  video: ["src", "poster"],
  audio: ["src"],
  track: ["src"],
  embed: ["src"],
  object: ["data"],
  iframe: ["src"],
  input: ["src"], // only type=image
};
const LOADING_RELS = new Set(["stylesheet", "icon", "apple-touch-icon", "apple-touch-icon-precomposed", "mask-icon", "shortcut", "manifest", "preload", "modulepreload", "prefetch"]);

/**
 * The URLs in a `srcset`, following the HTML parsing rules: a URL is a run of non-space characters and may contain commas
 * (a data: URI does); commas that end the URL, and the descriptors after it, are separators.
 */
export function srcsetUrls(value: string): string[] {
  const urls: string[] = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i] as string)) i++;
    let start = i;
    while (i < value.length && !/\s/.test(value[i] as string)) i++;
    let url = value.slice(start, i);
    if (url === "") break;
    if (url.endsWith(",")) url = url.replace(/,+$/, "");
    else {
      // Descriptors (such as `2x` or `480w`) run to the next comma outside parentheses.
      let depth = 0;
      for (; i < value.length; i++) {
        const c = value[i] as string;
        if (c === "(") depth++;
        else if (c === ")") depth = Math.max(0, depth - 1);
        else if (c === "," && depth === 0) break;
      }
    }
    if (url !== "") urls.push(url);
    start = i;
  }
  return urls;
}

function urlsOf(element: HtmlElement, attribute: string): string[] {
  const value = attr(element, attribute);
  if (value === undefined) return [];
  return attribute === "srcset" ? srcsetUrls(value) : [value];
}

function* assets(page: Page): Generator<{ element: HtmlElement; attribute: string; url: string }> {
  for (const element of page.elements) {
    let attributes = LOADING[element.tagName];
    if (element.tagName === "link") {
      const rels = (attr(element, "rel") ?? "").toLowerCase().split(/\s+/);
      attributes = rels.some((rel) => LOADING_RELS.has(rel)) ? ["href"] : undefined;
    }
    if (element.tagName === "input" && attr(element, "type")?.toLowerCase() !== "image") attributes = undefined;
    for (const attribute of attributes ?? []) for (const url of urlsOf(element, attribute)) yield { element, attribute, url };
  }
}

export const assetsMissing = check(meta("assets.missing", "A page loads a file that is not in the built site", "error"), (ctx) => {
  const out: FindingDraft[] = [];
  const files = [...ctx.site.files];
  for (const page of pagesOf(ctx)) {
    for (const { element, attribute, url } of assets(page)) {
      const target = ctx.site.resolveLink(page.url, url);
      if (target.kind !== "internal" || target.file !== undefined) continue;
      const location = locate(page, element, attribute);
      const extension = posix.extname(target.path);
      // Prefer a file of the same type; fall back to any file when the typo is in the extension itself.
      const near = closest(target.path, files.filter((f) => posix.extname(f) === extension)) ?? closest(target.path, files);
      const suggestion = near === undefined ? undefined : ctx.site.basePath !== "/" && url.startsWith("/") ? `${ctx.site.basePath.slice(0, -1)}${near}` : url.startsWith("/") ? near : posix.relative(posix.dirname(page.url), near);
      const whole = attr(element, attribute) ?? "";
      const edit = suggestion === undefined ? undefined : replaceAttribute(page, element, attribute, whole.replace(url, () => suggestion));
      out.push({
        message: `<${element.tagName}> loads ${url}, which is not in the built site.`,
        location,
        fix: {
          kind: edit ? "edit" : "manual",
          summary: near ? `Point ${attribute} at an existing file (closest match: ${near}), or add the missing file to the build.` : `Add ${target.path} to the build, or point ${attribute} at a file that exists.`,
          edits: edit ? [edit] : [],
        },
        key: url,
      });
    }
  }
  return out;
});

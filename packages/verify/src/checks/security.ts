// security.*: links and resources that weaken the page's safety.

import { type HtmlElement, type Page, attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { srcsetUrls } from "./assets.js";
import { addAttributes, check, locate, meta, pagesOf, replaceAttribute } from "./helpers.js";

const EXTERNAL = /^(https?:)?\/\//i;

export const securityTargetBlank = check(meta("security.target-blank", "External link opens a new tab without rel=noopener", "note"), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      if (element.tagName !== "a" || attr(element, "target")?.toLowerCase() !== "_blank") continue;
      const href = attr(element, "href")?.trim() ?? "";
      if (!EXTERNAL.test(href)) continue; // links within the site cannot be used to attack it
      const rel = (attr(element, "rel") ?? "").toLowerCase().split(/\s+/);
      if (rel.includes("noopener") || rel.includes("noreferrer")) continue;
      const existing = attr(element, "rel");
      const edit = existing === undefined ? addAttributes(page, element, { rel: "noopener noreferrer" }) : replaceAttribute(page, element, "rel", `${existing.trim()} noopener noreferrer`.trim());
      out.push({
        message: `The link to ${href} opens in a new tab without rel="noopener".`,
        location: locate(page, element, "target"),
        fix: { kind: edit ? "edit" : "manual", summary: 'Add rel="noopener noreferrer". Without it, older browsers let the opened page control this one through window.opener. Current browsers already do this by default, hence a note.', edits: edit ? [edit] : [] },
        key: href,
      });
    }
  }
  return out;
});

/** Resource-loading attributes: where an http:// address is mixed content on an https:// page. */
const LOADING: Record<string, readonly string[]> = { img: ["src", "srcset"], script: ["src"], iframe: ["src"], video: ["src", "poster"], audio: ["src"], source: ["src", "srcset"], embed: ["src"], object: ["data"], form: ["action"], track: ["src"] };
const LOADING_RELS = new Set(["stylesheet", "icon", "apple-touch-icon", "preload", "modulepreload", "manifest", "prefetch"]);
const PLAIN_HTTP = /^http:\/\/(?!localhost\b|127\.0\.0\.1\b|\[::1\])/i;

function* insecure(page: Page): Generator<{ element: HtmlElement; attribute: string; url: string }> {
  for (const element of page.elements) {
    let attributes = LOADING[element.tagName];
    if (element.tagName === "link") attributes = (attr(element, "rel") ?? "").toLowerCase().split(/\s+/).some((r) => LOADING_RELS.has(r)) ? ["href"] : undefined;
    for (const attribute of attributes ?? []) {
      const value = attr(element, attribute);
      if (value === undefined) continue;
      const urls = attribute === "srcset" ? srcsetUrls(value) : [value.trim()];
      for (const url of urls) if (PLAIN_HTTP.test(url)) yield { element, attribute, url };
    }
  }
}

export const securityMixedContent = check(meta("security.mixed-content", "Page loads a resource over plain HTTP", "warning"), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const { element, attribute, url } of insecure(page)) {
      const secure = url.replace(/^http:/i, "https:");
      const whole = attr(element, attribute) ?? "";
      const edit = replaceAttribute(page, element, attribute, whole.replace(url, () => secure));
      out.push({
        message: `<${element.tagName}> loads ${url} over plain HTTP.`,
        location: locate(page, element, attribute),
        fix: { kind: edit ? "edit" : "manual", summary: `Use ${secure} instead, after checking the server supports HTTPS. Browsers block or warn about plain-HTTP resources on HTTPS pages, and attackers can alter them in transit.`, edits: edit ? [edit] : [] },
        key: url,
      });
    }
  }
  return out;
});

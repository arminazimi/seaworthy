// social.*: the tags that decide how a page looks when its link is shared.

import { type Page, attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { check, documentLocation, insertInHead, isRedirectStub, locate, meta, metaTags, pagesOf } from "./helpers.js";

const REQUIRED = ["og:title", "og:description", "og:image"] as const;

export const socialOpenGraph = check(meta("social.open-graph", "Page is missing Open Graph tags for link previews", "warning"), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const tags = metaTags(page);
    const missing = REQUIRED.filter((name) => (tags.get(name)?.content ?? "") === "");
    if (missing.length === 0) continue;
    const hasAny = [...tags.keys()].some((k) => k.startsWith("og:"));
    const snippet = missing.map((name) => `<meta property="${name}" content="...">`).join("\n");
    const edit = insertInHead(page, missing.map((name) => `<meta property="${name}" content="...">`).join(""));
    out.push({
      message: `${hasAny ? "The Open Graph tags are incomplete" : "The page has no Open Graph tags"}: missing ${missing.join(", ")}.`,
      location: documentLocation(page),
      // A page with some tags but not all is inconsistent; a page with none just has bare previews.
      severity: hasAny ? "warning" : "note",
      fix: { kind: edit ? "edit" : "manual", summary: `Add these to <head>, with real values:\n${snippet}`, edits: edit ? [edit] : [] },
      key: missing.join(","),
    });
  }
  return out;
});

export const socialImageUrl = check(meta("social.image-url", "Social preview image is not an absolute HTTPS URL", "warning"), (ctx) => {
  const out: FindingDraft[] = [];
  const reported = (page: Page, name: string) => metaTags(page).get(name);
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    for (const name of ["og:image", "twitter:image"]) {
      const tag = reported(page, name);
      if (!tag || tag.content === "") continue;
      if (/^https:\/\//i.test(tag.content)) continue;
      out.push({
        message: /^http:\/\//i.test(tag.content) ? `${name} uses plain HTTP: ${tag.content}.` : `${name} is not an absolute URL: ${tag.content}.`,
        location: locate(page, tag.element, "content"),
        fix: { kind: "manual", summary: `Use the image's full public address starting with https://. Sites that show link previews do not resolve relative paths, and many refuse plain HTTP.`, edits: [] },
        key: `${name}:${attr(tag.element, "content") ?? ""}`,
      });
    }
  }
  return out;
});

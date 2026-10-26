// social.*: the tags that decide how a page looks when its link is shared.

import { imageSize } from "../image-size.js";
import { type Page, type SiteGraph, attr } from "../site.js";
import type { Edit, FindingDraft } from "../types.js";
import { check, documentLocation, insertInHead, isRedirectStub, locate, meta, metaTags, pagesOf, readSiteFile, replaceAttribute } from "./helpers.js";

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

const CARD_TYPES = new Set(["summary", "summary_large_image", "app", "player"]);

export const socialTwitterCard = check(meta("social.twitter-card", "Page has no usable Twitter card", "note", ["X Cards"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const tags = metaTags(page);
    const card = tags.get("twitter:card");
    if (!card || card.content === "") {
      const hasImage = (tags.get("twitter:image")?.content ?? "") !== "" || (tags.get("og:image")?.content ?? "") !== "";
      // The card type is safe to add automatically; an image needs a real address, so it stays manual.
      const cardEdit = hasImage ? (card ? replaceAttribute(page, card.element, "content", "summary_large_image") : insertInHead(page, '<meta name="twitter:card" content="summary_large_image">')) : undefined;
      const edits: Edit[] = cardEdit ? [cardEdit] : [];
      const hasOtherTags = [...tags.keys()].some((key) => key.startsWith("twitter:") && key !== "twitter:card");
      out.push({
        message: hasOtherTags ? "The page has other Twitter tags but no twitter:card, so X ignores them." : "The page has no twitter:card, so X uses its default summary card.",
        location: documentLocation(page),
        severity: hasOtherTags ? "warning" : "note",
        fix: {
          kind: edits.length > 0 ? "edit" : "manual",
          summary: hasImage
            ? card
              ? 'Set twitter:card to "summary_large_image" for a wide preview, or "summary" for a square one.'
              : 'Add <meta name="twitter:card" content="summary_large_image"> for a wide preview, or content="summary" for a square one.'
            : 'Add a card type and an image: <meta name="twitter:card" content="summary_large_image"> and <meta name="twitter:image" content="FULL_IMAGE_URL">, with the image\'s full public address in place of FULL_IMAGE_URL.',
          edits,
        },
        key: "twitter:card",
      });
      continue;
    }
    const type = card.content.toLowerCase();
    if (!CARD_TYPES.has(type)) {
      const edit = replaceAttribute(page, card.element, "content", "summary_large_image");
      out.push({
        message: `twitter:card is "${card.content}", which is not a card type X knows.`,
        location: locate(page, card.element, "content"),
        severity: "warning",
        fix: { kind: edit ? "edit" : "manual", summary: 'Use "summary", "summary_large_image", "app", or "player".', edits: edit ? [edit] : [] },
        key: `twitter:card:${card.content}`,
      });
      continue;
    }
    const hasImage = (tags.get("twitter:image")?.content ?? "") !== "" || (tags.get("og:image")?.content ?? "") !== "";
    if ((type === "summary" || type === "summary_large_image") && !hasImage) {
      out.push({
        message: `The ${type} card has no image: add twitter:image, or og:image for X to fall back to.`,
        location: locate(page, card.element, "content"),
        severity: "warning",
        fix: { kind: "manual", summary: 'Add <meta name="twitter:image" content="FULL_IMAGE_URL"> with the image\'s full public address in place of FULL_IMAGE_URL.', edits: [] },
        key: `twitter:card:image:${type}`,
      });
    }
  }
  return out;
});

const LARGE_MIN = { width: 600, height: 315 } as const;
const TWITTER_LARGE_MIN = { width: 300, height: 157 } as const;
const TWITTER_SUMMARY_MIN = { width: 144, height: 144 } as const;
const SOCIAL_MAX_BYTES = 5_000_000;

const kb = (bytes: number): string => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`);

/** The site's own origin, from og:url or a canonical link, so absolute image URLs can be matched to local files. */
function siteOrigin(page: Page, tags: ReturnType<typeof metaTags>): string | undefined {
  const canonical = page.elements.map((element) => (element.tagName === "link" && (attr(element, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical") ? attr(element, "href") : undefined)).find((href) => href !== undefined);
  for (const value of [tags.get("og:url")?.content, canonical]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // Not an absolute URL; try the next source.
    }
  }
  return undefined;
}

/** The bytes of an image that lives in the built site, whether it is linked relatively or by an absolute same-origin URL. */
function localImage(site: SiteGraph, page: Page, src: string, origin: string | undefined): { bytes: Buffer; size: number } | undefined {
  const direct = site.resolveLink(page.url, src);
  if (direct.kind === "internal" && direct.file) return readSiteFile(site, direct.file);
  if (!origin) return undefined;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return undefined;
  }
  if (url.origin !== origin) return undefined;
  const target = site.resolveLink(page.url, `${url.pathname}${url.search}`);
  return target.kind === "internal" && target.file ? readSiteFile(site, target.file) : undefined;
}

interface ImageTarget {
  name: string;
  min: { width: number; height: number };
  label: string;
  recommended?: string;
}

export const socialImageSize = check(meta("social.image-size", "Social preview image is too small or too heavy", "warning", ["Open Graph protocol", "X Cards"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const tags = metaTags(page);
    const card = (tags.get("twitter:card")?.content ?? "").toLowerCase();
    const origin = siteOrigin(page, tags);
    const targets: ImageTarget[] = [{ name: "og:image", min: LARGE_MIN, label: "a large link preview", recommended: "1200×630" }];
    if (card === "summary") targets.push({ name: "twitter:image", min: TWITTER_SUMMARY_MIN, label: "a summary card" });
    else if (card === "summary_large_image") targets.push({ name: "twitter:image", min: TWITTER_LARGE_MIN, label: "a summary_large_image card", recommended: "1200×628" });
    for (const { name, min, label, recommended } of targets) {
      const tag = tags.get(name);
      if (!tag || tag.content === "") continue;
      const file = localImage(ctx.site, page, tag.content, origin);
      const size = file ? imageSize(file.bytes) : undefined;
      if (!file || !size) continue;
      const location = locate(page, tag.element, "content");
      const key = `${name}:${tag.content}`;
      if (size.width < min.width || size.height < min.height) {
        out.push({
          message: `${name} is ${size.width}×${size.height}, smaller than the ${min.width}×${min.height} minimum for ${label}.`,
          location,
          fix: { kind: "manual", summary: `Use an image at least ${min.width}×${min.height}${recommended ? `; ${recommended} is the recommended size` : ""}. Platforms scale large images down but may show nothing useful for a small one.`, edits: [] },
          key,
        });
      } else if (file.size > SOCIAL_MAX_BYTES) {
        out.push({
          message: `${name} is ${kb(file.size)}, over the 5 MB limit X accepts for card images.`,
          location,
          fix: { kind: "manual", summary: "Compress the image under 5 MB, or serve a smaller modern format such as WebP.", edits: [] },
          key,
        });
      }
    }
  }
  return out;
});

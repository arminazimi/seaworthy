// images.*: alternative text, reserved space, and weight.

import { type HtmlElement, type Page, attr } from "../site.js";
import { imageSize } from "../image-size.js";
import type { FindingDraft } from "../types.js";
import { addAttributes, check, locate, meta, pagesOf, readSiteFile } from "./helpers.js";

const hasText = (value: string | undefined): boolean => value !== undefined && value.trim() !== "";
const images = (page: Page): HtmlElement[] => page.elements.filter((e) => e.tagName === "img");

/** An image that a screen reader is told to skip, or that is named some other way, needs no alt attribute. */
function exempt(img: HtmlElement): boolean {
  const role = attr(img, "role")?.toLowerCase();
  return role === "presentation" || role === "none" || attr(img, "aria-hidden")?.toLowerCase() === "true" || hasText(attr(img, "aria-label")) || hasText(attr(img, "aria-labelledby"));
}

export const imagesAlt = check(meta("images.alt", "Image has no alt attribute", "error", ["WCAG 1.1.1"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const img of images(page)) {
      if (attr(img, "alt") !== undefined || exempt(img)) continue;
      const location = locate(page, img);
      const edit = addAttributes(page, img, { alt: "<describe the image>" }, true);
      const src = attr(img, "src") ?? "";
      out.push({
        message: `<img${src ? ` src="${src}"` : ""}> has no alt attribute.`,
        location,
        fix: { kind: edit ? "edit" : "manual", summary: 'Add alt text that describes what the image shows, or alt="" if it is purely decorative. Without the attribute, screen readers read out the file name.', edits: edit ? [edit] : [] },
        key: src || "img",
      });
    }
  }
  return out;
});

const positive = (value: string | undefined): boolean => value !== undefined && /^\d+(\.\d+)?(px)?$/.test(value.trim()) && parseFloat(value) > 0;

export const imagesDimensions = check(meta("images.dimensions", "Image has no width and height, so the page jumps as it loads", "warning"), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const img of images(page)) {
      const src = attr(img, "src") ?? "";
      if (src === "" || src.startsWith("data:")) continue;
      const hasWidth = positive(attr(img, "width"));
      const hasHeight = positive(attr(img, "height"));
      const style = (attr(img, "style") ?? "").toLowerCase();
      if ((hasWidth && hasHeight) || style.includes("aspect-ratio") || (style.includes("width") && style.includes("height"))) continue;

      const location = locate(page, img);
      const target = ctx.site.resolveLink(page.url, src);
      const file = target.kind === "internal" && target.file ? readSiteFile(ctx.site, target.file) : undefined;
      const natural = file ? imageSize(file.bytes) : undefined;
      let edit;
      let hint = "Add width and height attributes with the image's real pixel size; the browser then reserves the space before the image loads.";
      if (natural) {
        const width = hasWidth ? parseFloat(attr(img, "width") as string) : hasHeight ? Math.round((parseFloat(attr(img, "height") as string) * natural.width) / natural.height) : natural.width;
        const height = hasHeight ? parseFloat(attr(img, "height") as string) : Math.round((width * natural.height) / natural.width);
        edit = addAttributes(page, img, { ...(hasWidth ? {} : { width: String(width) }), ...(hasHeight ? {} : { height: String(height) }) });
        hint = `Add width="${width}" height="${height}" (the image is ${natural.width}×${natural.height}); the browser then reserves the space before the image loads.`;
      }
      out.push({
        message: `<img src="${src}"> is missing ${!hasWidth && !hasHeight ? "width and height" : !hasWidth ? "width" : "height"}.`,
        location,
        fix: { kind: edit ? "edit" : "manual", summary: hint, edits: edit ? [edit] : [] },
        key: src,
      });
    }
  }
  return out;
});

const DEFAULT_MAX_BYTES = 512_000;
const kb = (bytes: number): string => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`);

export const imagesSize = check(meta("images.size", "Image file is larger than the budget", "warning"), (ctx) => {
  const out: FindingDraft[] = [];
  const maxBytes = typeof ctx.options.maxBytes === "number" ? ctx.options.maxBytes : DEFAULT_MAX_BYTES;
  for (const page of pagesOf(ctx)) {
    for (const img of images(page)) {
      const src = attr(img, "src") ?? "";
      if (src === "" || src.startsWith("data:")) continue;
      const target = ctx.site.resolveLink(page.url, src);
      if (target.kind !== "internal" || !target.file) continue;
      const file = readSiteFile(ctx.site, target.file);
      if (!file || file.size <= maxBytes) continue;
      out.push({
        message: `${src} is ${kb(file.size)}, over the ${kb(maxBytes)} budget.`,
        location: locate(page, img, "src"),
        fix: { kind: "manual", summary: "Resize the image to the largest size it is shown at, compress it, or serve a modern format such as WebP or AVIF. Large images are the most common reason pages load slowly.", edits: [] },
        key: src,
      });
    }
  }
  return out;
});

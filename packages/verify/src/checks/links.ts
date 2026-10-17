// links.internal and links.base-url: links between pages of the built site.

import { posix } from "node:path";

import { type HtmlElement, type Page, type SiteGraph, attr } from "../site.js";
import { closest } from "../text.js";
import type { FindingDraft } from "../types.js";
import { check, locate, meta, pagesOf, replaceAttribute } from "./helpers.js";

const LINKING = new Set(["a", "area"]);

function* links(page: Page): Generator<{ element: HtmlElement; href: string }> {
  for (const element of page.elements) {
    if (!LINKING.has(element.tagName)) continue;
    const href = attr(element, "href");
    if (href !== undefined) yield { element, href };
  }
}

/** The href to suggest for a page, in the same style (relative or root-absolute) as the broken one. */
function hrefFor(site: SiteGraph, from: Page, original: string, target: string): string {
  const suffix = /[?#].*$/.exec(original)?.[0] ?? "";
  if (original.startsWith("/")) return `${site.basePath === "/" ? "" : site.basePath.slice(0, -1)}${target}${suffix}`;
  const relative = posix.relative(posix.dirname(from.url), target);
  return `${relative === "" ? posix.basename(target) : relative}${suffix}`;
}

export const linksInternal = check(meta("links.internal", "Internal link points to a missing page or anchor", "error"), (ctx) => {
  const out: FindingDraft[] = [];
  const pageUrls = [...ctx.site.pages.keys()];
  for (const page of pagesOf(ctx)) {
    for (const { element, href } of links(page)) {
      const target = ctx.site.resolveLink(page.url, href);
      if (target.kind !== "internal") continue;
      const location = locate(page, element, "href");

      if (target.file === undefined) {
        const near = closest(target.path, pageUrls);
        const edit = near === undefined ? undefined : replaceAttribute(page, element, "href", hrefFor(ctx.site, page, href, near));
        out.push({
          message: `Link to ${href} points to a page that does not exist in the built site.`,
          location,
          fix: {
            kind: edit ? "edit" : "manual",
            summary: near ? `Point the link at an existing page (closest match: ${near}), or add the missing page.` : "Point the link at an existing page, or add the missing page.",
            edits: edit ? [edit] : [],
          },
          key: href,
        });
        continue;
      }

      const fragment = target.fragment;
      const destination = ctx.site.pages.get(target.file);
      if (fragment === undefined || fragment === "" || fragment.toLowerCase() === "top" || !destination || destination.ids.has(fragment)) continue;
      const near = closest(fragment, destination.ids, 2);
      const edit = near === undefined ? undefined : replaceAttribute(page, element, "href", `${href.slice(0, href.indexOf("#"))}#${near}`);
      out.push({
        message: `Link to ${href} points to #${fragment}, but ${destination.url} has no element with that id.`,
        location,
        fix: {
          kind: edit ? "edit" : "manual",
          summary: near ? `Change the fragment to #${near}, or add id="${fragment}" to the intended heading in ${destination.url}.` : `Add id="${fragment}" to the intended heading in ${destination.url}, or fix the fragment.`,
          edits: edit ? [edit] : [],
        },
        key: href,
      });
    }
  }
  return out;
});

/** The first path segment of a root-absolute URL, or undefined. */
const firstSegment = (path: string): string | undefined => /^\/([^/?#]+)\//.exec(path)?.[1];

export const linksBaseUrl = check(meta("links.base-url", "Links do not match the base path the site is deployed under", "warning"), (ctx) => {
  const { site } = ctx;
  const out: FindingDraft[] = [];

  if (site.basePath !== "/") {
    // Deployed under /repo/: a root-absolute link that does not start with it leaves the site.
    for (const page of pagesOf(ctx)) {
      for (const { element, href } of links(page)) {
        if (!href.startsWith("/") || href.startsWith("//")) continue;
        if (href.startsWith(site.basePath) || `${href}/` === site.basePath) continue;
        const location = locate(page, element, "href");
        const fixed = `${site.basePath.slice(0, -1)}${href}`;
        const edit = replaceAttribute(page, element, "href", fixed);
        out.push({
          message: `Link to ${href} starts at the domain root, but the site is deployed under ${site.basePath}, so it will not find this site's pages.`,
          location,
          fix: { kind: edit ? "edit" : "manual", summary: `Start the link with the base path: ${fixed}.`, edits: edit ? [edit] : [] },
          key: href,
        });
      }
    }
    return out;
  }

  // No base path configured: look for the classic project-page mistake. Many root-absolute links that do not
  // resolve, but do once their first segment is removed, mean the site was built for a /repo/ deployment.
  const broken: { page: Page; element: HtmlElement; href: string; segment: string; resolvesWithoutIt: boolean }[] = [];
  for (const page of pagesOf(ctx)) {
    for (const { element, href } of links(page)) {
      if (!href.startsWith("/") || href.startsWith("//")) continue;
      const target = site.resolveLink(page.url, href);
      if (target.kind !== "internal" || target.file !== undefined) continue;
      const segment = firstSegment(target.path);
      if (segment === undefined) continue;
      const without = site.resolveLink(page.url, href.slice(segment.length + 1));
      broken.push({ page, element, href, segment, resolvesWithoutIt: without.kind === "internal" && without.file !== undefined });
    }
  }
  const counts = new Map<string, { total: number; resolving: number }>();
  for (const b of broken) {
    const c = counts.get(b.segment) ?? { total: 0, resolving: 0 };
    c.total++;
    if (b.resolvesWithoutIt) c.resolving++;
    counts.set(b.segment, c);
  }
  const [prefix, stats] = [...counts.entries()].sort((a, b) => b[1].resolving - a[1].resolving || (a[0] < b[0] ? -1 : 1))[0] ?? [];
  if (prefix === undefined || stats === undefined || stats.resolving < 2 || stats.resolving / stats.total < 0.8) return out;

  const first = broken.find((b) => b.segment === prefix && b.resolvesWithoutIt)!;
  out.push({
    message: `${stats.total} links start with /${prefix}/, but the built site has no /${prefix}/ folder, and they resolve once that prefix is removed.`,
    location: locate(first.page, first.element, "href"),
    fix: {
      kind: "manual",
      summary: `If the site is deployed under /${prefix}/ (a GitHub project page), set "basePath": "/${prefix}/" in seaworthy.config.json so links are checked against it. If it is deployed at the domain root, remove the /${prefix}/ prefix from the links.`,
      edits: [],
    },
    key: prefix,
  });
  return out;
});

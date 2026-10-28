// quality.orphans: pages of the built site that no other page links to.

import { type SiteGraph, attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { check, documentLocation, meta, pagesOf } from "./helpers.js";
import { sitemapListedFiles } from "./sitemap.js";

const LINKING = new Set(["a", "area"]);

/** Pages that are reachable without an inbound link, so they never count as orphans. */
function reachableWithoutLinks(site: SiteGraph): ReadonlySet<string> {
  const reachable = new Set<string>();
  for (const url of site.pages.keys()) {
    if (url.endsWith("/index.html") || url === "/404.html") reachable.add(url);
  }
  for (const file of sitemapListedFiles(site)) reachable.add(file);
  return reachable;
}

export const qualityOrphans = check(meta("quality.orphans", "Page that no other page links to", "warning"), (ctx) => {
  const { site } = ctx;
  const linked = new Set<string>();
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      if (!LINKING.has(element.tagName)) continue;
      const href = attr(element, "href");
      if (href === undefined) continue;
      const target = site.resolveLink(page.url, href);
      // A page linking to itself (for example href="#top") does not make itself reachable.
      if (target.kind === "internal" && target.file !== undefined && target.file !== page.url) linked.add(target.file);
    }
  }

  const exempt = reachableWithoutLinks(site);
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (linked.has(page.url) || exempt.has(page.url)) continue;
    out.push({
      message: `No other page links to ${page.url}, so people and agents can only reach it by guessing the URL.`,
      location: documentLocation(page),
      fix: {
        kind: "manual",
        summary: `Add a link to ${page.url} from a page people already visit (navigation, an index, or inline text), or delete the page if it is no longer needed.`,
        edits: [],
      },
      key: page.url,
    });
  }
  return out;
});

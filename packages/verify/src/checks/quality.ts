// quality.*: the HTML itself is sound; what remains is how the site was put together.

import type { Page, SiteGraph } from "../site.js";
import type { FindingDraft } from "../types.js";
import { check, documentLocation, firstElement, isRedirectStub, meta, visibleTextOf } from "./helpers.js";

/** Root-relative paths a static build may use for its not-found page, tried in this order. */
const NOT_FOUND_PATHS = ["/404.html", "/404/index.html"];

export const qualityNotFoundPage = check(meta("quality.not-found-page", "The 404 page is missing or is not a real page", "warning"), (ctx) => {
  const out: FindingDraft[] = [];
  const page = notFoundPage(ctx.site);
  if (page === undefined) {
    out.push({
      message: "The build has no 404 page, so a broken address shows the host's default error page, and agents reading the site see a soft 404.",
      location: { file: "404.html" },
      fix: {
        kind: "manual",
        summary: 'Add a not-found page at the site root as 404.html (or 404/index.html). It should say the address was not found and link to the home page and other key pages. Most static generators have a "not found" template. Make it a real page, not a redirect.',
        edits: [],
      },
      key: "missing",
    });
    return out;
  }
  const body = firstElement(page, "body");
  if (isRedirectStub(page)) {
    out.push({
      message: "The 404 page only redirects elsewhere instead of showing a not-found message. Hosts serve it with a 404 status, so a redirect there can loop, and a visitor never learns that the address does not exist.",
      location: documentLocation(page),
      fix: {
        kind: "manual",
        summary: "Replace the redirect with a real page: say the address was not found, and link to the home page and key pages. Keep the site layout so navigation still works.",
        edits: [],
      },
      key: "redirect-stub",
    });
  } else if (body === undefined || visibleTextOf(body) === "") {
    out.push({
      message: "The 404 page has no visible content. A visitor (or an agent) that follows a broken address lands on a blank page with nothing to do.",
      location: documentLocation(page),
      fix: {
        kind: "manual",
        summary: 'Write the not-found message into the page: a heading that says the page does not exist, a short explanation, and links to the home page and key pages.',
        edits: [],
      },
      key: "empty",
    });
  }
  return out;
});

/** The site's not-found page, if the build includes one under a path static hosts and generators use. */
function notFoundPage(site: SiteGraph): Page | undefined {
  for (const path of NOT_FOUND_PATHS) {
    if (!site.files.has(path)) continue;
    const page = site.pages.get(path);
    if (page) return page;
  }
  return undefined;
}

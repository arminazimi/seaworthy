// sitemap.entries, robots.blocks-all, robots.sitemap: sitemap.xml and robots.txt must be valid and agree with the site.

import type { SiteGraph } from "../site.js";
import type { FindingDraft } from "../types.js";
import { check, meta, readSiteFile } from "./helpers.js";

const decodeXml = (text: string): string => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function textOf(site: SiteGraph, path: string): string | undefined {
  return readSiteFile(site, path)?.bytes.toString("utf8");
}

/** Where in a file a match starts, as 1-based line and column. */
function position(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  return { line, column: index - (before.lastIndexOf("\n") + 1) + 1 };
}

/** Whether an absolute URL from a sitemap or robots.txt names something in the built site (honoring the base path). */
function servedByThisSite(site: SiteGraph, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const target = site.resolveLink("/", `${parsed.pathname}${parsed.search}`);
  return target.kind === "internal" && target.file !== undefined;
}

export const sitemapEntries = check(meta("sitemap.entries", "Sitemap lists a page that is not in the built site", "error"), (ctx) => {
  const out: FindingDraft[] = [];
  const visited = new Set<string>();
  const queue = ["/sitemap.xml"];
  while (queue.length > 0) {
    const path = queue.shift() as string;
    if (visited.has(path)) continue;
    visited.add(path);
    const text = textOf(ctx.site, path);
    if (text === undefined) continue;
    const file = path.slice(1);
    const isIndex = /<sitemapindex[\s>]/.test(text);
    if (!isIndex && !/<urlset[\s>]/.test(text)) {
      out.push({ message: `${path} is not a sitemap: it has no <urlset> or <sitemapindex> element.`, location: { file }, fix: { kind: "manual", summary: "A sitemap is an XML file whose root element is <urlset> (a list of pages) or <sitemapindex> (a list of sitemaps). See sitemaps.org/protocol.html.", edits: [] }, key: "not-a-sitemap" });
      continue;
    }
    for (const match of text.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/g)) {
      const url = decodeXml(match[1] ?? "").trim();
      const at = position(text, match.index ?? 0);
      const location = { file, line: at.line, column: at.column };
      if (!/^https?:\/\//i.test(url)) {
        out.push({ message: `The sitemap entry "${url}" is not an absolute URL.`, location, fix: { kind: "manual", summary: "Sitemap entries must be full URLs starting with https://, including the domain.", edits: [] }, key: `relative:${url}` });
        continue;
      }
      if (!servedByThisSite(ctx.site, url)) {
        out.push({ message: `The sitemap lists ${url}, but the built site has no such page.`, location, fix: { kind: "manual", summary: "Remove the entry, or build the page it points to. Search engines treat missing pages in a sitemap as errors and may distrust the whole file.", edits: [] }, key: url });
      } else if (isIndex) {
        queue.push(new URL(url).pathname);
      }
    }
  }
  return out;
});

/** Groups of robots.txt: the user agents and the directives under them, with line numbers. */
function robotsGroups(text: string): { agents: string[]; rules: { type: "allow" | "disallow"; value: string; line: number }[] }[] {
  const groups: { agents: string[]; rules: { type: "allow" | "disallow"; value: string; line: number }[] }[] = [];
  let current: (typeof groups)[number] | undefined;
  let lastWasAgent = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) return;
    const field = (match[1] as string).toLowerCase();
    const value = (match[2] as string).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      return;
    }
    lastWasAgent = false;
    if (current && (field === "allow" || field === "disallow")) current.rules.push({ type: field, value, line: i + 1 });
  });
  return groups;
}

export const robotsBlocksAll = check(meta("robots.blocks-all", "robots.txt blocks every search engine from the whole site", "warning"), (ctx) => {
  const text = textOf(ctx.site, "/robots.txt");
  if (text === undefined) return [];
  const out: FindingDraft[] = [];
  for (const group of robotsGroups(text)) {
    if (!group.agents.includes("*")) continue;
    const blocks = group.rules.find((r) => r.type === "disallow" && r.value === "/");
    const allows = group.rules.some((r) => r.type === "allow" && r.value !== "");
    if (blocks && !allows) {
      out.push({
        message: "robots.txt tells every crawler not to visit anything (User-agent: * with Disallow: /).",
        location: { file: "robots.txt", line: blocks.line, column: 1 },
        fix: { kind: "manual", summary: "Remove Disallow: / unless the site is meant to be private. This is a common leftover from a staging site and keeps the site out of search results.", edits: [] },
        key: "blocks-all",
      });
    }
  }
  return out;
});

export const robotsSitemap = check(meta("robots.sitemap", "robots.txt Sitemap line is invalid or points to a missing sitemap", "warning"), (ctx) => {
  const text = textOf(ctx.site, "/robots.txt");
  if (text === undefined) return [];
  const out: FindingDraft[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const match = /^\s*sitemap\s*:\s*(\S*)/i.exec(raw);
    if (!match) return;
    const url = match[1] as string;
    const location = { file: "robots.txt", line: i + 1, column: 1 };
    if (!/^https?:\/\//i.test(url)) {
      out.push({ message: url === "" ? "A Sitemap line has no URL." : `The Sitemap line "${url}" is not an absolute URL.`, location, fix: { kind: "manual", summary: "Write the full address, for example: Sitemap: https://example.com/sitemap.xml", edits: [] }, key: `invalid:${url}` });
    } else if (!servedByThisSite(ctx.site, url)) {
      out.push({ message: `robots.txt points to ${url}, which is not in the built site.`, location, fix: { kind: "manual", summary: "Build the sitemap at that address, or fix the Sitemap line.", edits: [] }, key: url });
    }
  });
  return out;
});

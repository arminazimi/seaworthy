// readability.*: can agents and AI search read this site? See spec/agent-readability/v1.md.

import { type HtmlElement, attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { looksLikeHtml, parseJson, positionIn, siteText } from "./files.js";
import { nearest } from "./aria-data.js";
import { check, descendants, documentLocation, firstElement, isRedirectStub, locate, meta, pagesOf, textOf } from "./helpers.js";
import { robotsGroups } from "./sitemap.js";

const MARKDOWN_LINK = /^\s*[-*+]\s+\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)(?::\s.*|\s*)$/;

export const readabilityLlmsTxt = check(meta("readability.llms-txt", "llms.txt is missing or does not follow the proposal", "warning", ["llmstxt.org"], ["files"]), (ctx) => {
  const out: FindingDraft[] = [];
  const text = siteText(ctx.site, "/llms.txt");
  if (text === undefined) {
    out.push({
      message: "The site has no llms.txt. It is optional; where present, AI tools use it as a short guide to the site's pages.",
      location: { file: "llms.txt" },
      severity: "note",
      fix: { kind: "manual", summary: "Add /llms.txt: an H1 with the site name, a one-line blockquote summary, and H2 sections with lists of links to your key pages, one per line as: - [Page title](/page.md): what it covers. See llmstxt.org.", edits: [] },
      key: "missing",
    });
  } else {
    const file = "llms.txt";
    if (text.trim() === "") {
      out.push({ message: "llms.txt is empty.", location: { file }, fix: { kind: "manual", summary: "Write the guide, or delete the file. An H1 with the site name is the only required part.", edits: [] }, key: "empty" });
    } else if (looksLikeHtml(text)) {
      out.push({ message: "llms.txt is an HTML page, not Markdown. This usually means a server fallback or an error page was saved under that name.", location: { file, line: 1, column: 1 }, fix: { kind: "manual", summary: "Replace it with Markdown that starts with an H1, or remove the file.", edits: [] }, key: "html" });
    } else {
      const lines = text.split(/\r?\n/);
      const first = lines.findIndex((l) => l.trim() !== "");
      if (!/^#\s+\S/.test(lines[first] ?? "")) {
        out.push({ message: "llms.txt does not start with an H1. The proposal requires the first line to be # followed by the site or project name.", location: { file, line: first + 1, column: 1 }, fix: { kind: "manual", summary: "Make the first line: # Your Site Name", edits: [] }, key: "no-h1" });
      }
      let inSection = false;
      lines.forEach((raw, i) => {
        if (/^##\s+\S/.test(raw)) inSection = true;
        else if (/^#\s/.test(raw) && i !== first) inSection = false;
        else if (inSection && /^\s*[-*+]\s+/.test(raw)) {
          const match = MARKDOWN_LINK.exec(raw);
          if (!match) {
            out.push({ message: `This list item in llms.txt is not a link entry: "${raw.trim()}".`, location: { file, line: i + 1, column: 1 }, fix: { kind: "manual", summary: "Write each entry as - [Title](url) or - [Title](url): notes.", edits: [] }, key: `not-a-link:${raw.trim()}` });
            return;
          }
          const target = ctx.site.resolveLink("/llms.txt", match[2] as string);
          if (target.kind === "internal" && target.file === undefined) {
            out.push({ message: `llms.txt links to ${match[2]}, which is not in the built site.`, location: { file, ...positionIn(text, text.indexOf(raw)) }, fix: { kind: "manual", summary: "Fix the link, or build the page it points to. Agents that follow a broken entry lose their way in the site.", edits: [] }, key: `missing:${match[2]}` });
          }
        }
      });
    }
  }
  const full = siteText(ctx.site, "/llms-full.txt");
  if (full !== undefined && (full.trim() === "" || looksLikeHtml(full))) {
    out.push({ message: full.trim() === "" ? "llms-full.txt is empty." : "llms-full.txt is an HTML page, not Markdown.", location: { file: "llms-full.txt" }, fix: { kind: "manual", summary: "Put the full text of your key pages in it as Markdown, or remove the file.", edits: [] }, key: "full" });
  }
  return out;
});

const SKIPPED_TEXT = new Set(["script", "style", "template", "noscript"]);

/** The words in an element that a reader would see, skipping scripts and styles. */
function visibleText(element: HtmlElement): string {
  const parts: string[] = [];
  const visit = (node: { nodeName: string; childNodes?: unknown[]; value?: string }): void => {
    if (SKIPPED_TEXT.has(node.nodeName)) return;
    if (node.nodeName === "#text" && node.value) parts.push(node.value);
    for (const child of (node.childNodes ?? []) as (typeof node)[]) visit(child);
  };
  visit(element as unknown as Parameters<typeof visit>[0]);
  return parts.join(" ");
}

/** Distinct words of four or more letters or digits, lower-cased: enough to compare two renderings of the same text. */
const wordsOf = (text: string): Set<string> => new Set((text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []));

export const readabilityMdAlternates = check(meta("readability.md-alternates", "Markdown alternate is missing or does not match the page", "warning", ["llmstxt.org"], ["files"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    const links = page.elements.filter((e) => e.tagName === "link" && /(^|\s)alternate(\s|$)/i.test(attr(e, "rel") ?? "") && (attr(e, "type") ?? "").trim().toLowerCase() === "text/markdown");
    for (const link of links) {
      const href = (attr(link, "href") ?? "").trim();
      const location = locate(page, link, "href");
      if (href === "") {
        out.push({ message: "A Markdown alternate link has no href.", location, fix: { kind: "manual", summary: 'Set href to the Markdown copy of this page, for example href="/docs/guide.md".', edits: [] }, key: "empty-href" });
        continue;
      }
      const target = ctx.site.resolveLink(page.url, href);
      if (target.kind !== "internal") continue; // another site's copy is not ours to check
      if (target.file === undefined) {
        out.push({ message: `The page says its Markdown copy is ${href}, but the built site has no such file.`, location, fix: { kind: "manual", summary: "Build the Markdown copy at that address, or remove the link. Agents that follow it get an error instead of the page.", edits: [] }, key: `missing:${href}` });
        continue;
      }
      const markdown = siteText(ctx.site, target.file);
      if (markdown === undefined) continue;
      if (looksLikeHtml(markdown)) {
        out.push({ message: `${href} is an HTML page, not Markdown.`, location, fix: { kind: "manual", summary: "Serve real Markdown at that address.", edits: [] }, key: `html:${href}` });
        continue;
      }
      const container = firstElement(page, "main") ?? firstElement(page, "body");
      const pageWords = container ? wordsOf(visibleText(container)) : new Set<string>();
      if (pageWords.size < 20) continue; // too little text to compare
      const mdWords = wordsOf(markdown);
      let shared = 0;
      for (const word of pageWords) if (mdWords.has(word)) shared++;
      const share = shared / pageWords.size;
      if (share < 0.5) {
        out.push({
          message: `${href} shares only ${Math.round(share * 100)}% of the words on this page, so it looks like a different document.`,
          location,
          fix: { kind: "manual", summary: "Regenerate the Markdown copy from the same source as the page, so an agent that reads it gets the same content.", edits: [] },
          key: `mismatch:${href}`,
        });
      }
    }
  }
  return out;
});

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const present = (value: unknown): boolean => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);

/** The fields consumers need most for each schema.org type that sites commonly publish. */
const RECOMMENDED: Readonly<Record<string, readonly string[]>> = {
  Article: ["headline", "datePublished", "author"],
  NewsArticle: ["headline", "datePublished", "author"],
  BlogPosting: ["headline", "datePublished", "author"],
  TechArticle: ["headline", "datePublished", "author"],
  Organization: ["name", "url"],
  WebSite: ["name", "url"],
  Person: ["name"],
  Product: ["name"],
  SoftwareApplication: ["name"],
  BreadcrumbList: ["itemListElement"],
  FAQPage: ["mainEntity"],
  Event: ["name", "startDate", "location"],
  Course: ["name", "description"],
  HowTo: ["name", "step"],
};
const DATE_FIELDS = ["datePublished", "dateModified", "startDate", "endDate"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Every node of a JSON-LD document: the root, array members, and `@graph` members. */
function nodesOf(value: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(value)) value.forEach((v) => nodesOf(v, out));
  else if (isObject(value)) {
    if (Array.isArray(value["@graph"])) nodesOf(value["@graph"], out);
    const { "@graph": _graph, ...rest } = value;
    if (Object.keys(rest).some((k) => k !== "@context")) out.push(rest);
  }
  return out;
}

export const readabilityJsonld = check(meta("readability.jsonld", "JSON-LD does not parse or lacks fields consumers need", "warning", ["JSON-LD 1.1", "schema.org"], ["files"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const script of page.elements.filter((e) => e.tagName === "script" && (attr(e, "type") ?? "").trim().toLowerCase() === "application/ld+json")) {
      const text = (script.childNodes as { nodeName: string; value?: string; sourceCodeLocation?: { startLine: number; startCol: number } }[]).find((n) => n.nodeName === "#text");
      const location = locate(page, script);
      const body = text?.value ?? "";
      if (body.trim() === "") {
        out.push({ message: "A JSON-LD script is empty.", location, fix: { kind: "manual", summary: "Put the JSON-LD object in the script, or remove it.", edits: [] }, key: "empty" });
        continue;
      }
      const parsed = parseJson(body);
      if (!parsed.ok) {
        const where = text?.sourceCodeLocation && parsed.line ? { file: page.file, line: text.sourceCodeLocation.startLine + parsed.line - 1, column: parsed.line === 1 ? text.sourceCodeLocation.startCol + (parsed.column ?? 1) - 1 : (parsed.column ?? 1) } : location;
        out.push({ message: `The JSON-LD does not parse: ${parsed.message}.`, location: where, fix: { kind: "manual", summary: "Fix the JSON syntax (check commas, quotes, and brackets). Search engines and AI tools discard JSON-LD they cannot parse.", edits: [] }, key: "parse" });
        continue;
      }
      const root = parsed.value;
      const hasContext = (isObject(root) && present(root["@context"])) || (Array.isArray(root) && root.every((n) => isObject(n) && present(n["@context"])));
      if (!hasContext) {
        out.push({ message: 'The JSON-LD has no "@context", so consumers do not know it uses schema.org.', location, fix: { kind: "manual", summary: 'Add "@context": "https://schema.org" at the top level.', edits: [] }, key: "context" });
      }
      for (const node of nodesOf(root)) {
        const types = (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]).filter((t): t is string => typeof t === "string");
        if (types.length === 0) {
          out.push({ message: 'A JSON-LD item has no "@type".', location, fix: { kind: "manual", summary: 'Say what the item is, for example "@type": "Article".', edits: [] }, key: `no-type:${Object.keys(node).slice(0, 3).join(",")}` });
          continue;
        }
        for (const field of DATE_FIELDS) {
          const value = node[field];
          if (typeof value === "string" && !ISO_DATE.test(value.trim())) {
            out.push({ message: `${types[0]} has ${field} "${value}", which is not an ISO 8601 date such as 2026-10-18 or 2026-10-18T09:30:00Z.`, location, fix: { kind: "manual", summary: `Write ${field} as an ISO 8601 date.`, edits: [] }, key: `date:${types[0]}:${field}` });
          }
        }
        const wanted = [...new Set(types.flatMap((t) => RECOMMENDED[t] ?? []))];
        const missing = wanted.filter((field) => !present(node[field]));
        if (missing.length > 0) {
          out.push({ message: `${types.join(", ")} is missing ${missing.join(", ")}. Consumers use ${missing.length === 1 ? "it" : "them"} to describe the page.`, location, severity: "note", fix: { kind: "manual", summary: `Add ${missing.join(", ")} to the ${types[0]} item, or drop the item if you cannot fill ${missing.length === 1 ? "it" : "them"}.`, edits: [] }, key: `missing:${types.join(",")}:${missing.join(",")}` });
        }
      }
    }
  }
  return out;
});

/** Crawlers that fetch pages for AI products, lower-cased as they appear in a User-agent line. */
const TRAINING_BOTS = ["gptbot", "claudebot", "anthropic-ai", "google-extended", "ccbot", "bytespider", "applebot-extended", "meta-externalagent", "cohere-ai", "diffbot", "omgilibot", "ai2bot", "amazonbot", "timpibot", "imagesiftbot"];
/** Crawlers that fetch a page because a person asked an AI tool a question; blocking them removes the site from those answers. */
const RETRIEVAL_BOTS = ["oai-searchbot", "chatgpt-user", "claude-user", "claude-searchbot", "perplexitybot", "perplexity-user", "duckassistbot", "mistralai-user", "meta-externalfetcher"];
const AI_BOTS = new Set([...TRAINING_BOTS, ...RETRIEVAL_BOTS, "claude-web"]);
/** User agents that are real and not AI crawlers, so they are never mistaken for a misspelling of one. */
const OTHER_BOTS = new Set(["*", "googlebot", "googlebot-image", "googlebot-news", "bingbot", "slurp", "duckduckbot", "baiduspider", "yandexbot", "yandex", "applebot", "facebookexternalhit", "twitterbot", "linkedinbot", "semrushbot", "ahrefsbot", "mj12bot", "dotbot", "petalbot", "sogou", "exabot", "ia_archiver", "adsbot-google", "mediapartners-google", "apis-google", "googleother", "msnbot", "seznambot", "naverbot", "pinterestbot", "slackbot", "telegrambot", "whatsapp", "discordbot"]);

type Access = "blocked" | "open";

export const readabilityAiRobots = check(meta("readability.ai-robots", "robots.txt rules for AI crawlers contradict each other or the site", "warning", ["RFC 9309"], ["files"]), (ctx) => {
  const text = siteText(ctx.site, "/robots.txt");
  if (text === undefined) return [];
  const out: FindingDraft[] = [];
  const groups = robotsGroups(text);
  const fullyBlocked = (g: (typeof groups)[number]): boolean => g.rules.some((r) => r.type === "disallow" && r.value === "/") && !g.rules.some((r) => r.type === "allow" && r.value !== "");
  const accessFor = (agent: string): Access => {
    const group = groups.find((g) => g.agents.includes(agent)) ?? groups.find((g) => g.agents.includes("*"));
    return group && fullyBlocked(group) ? "blocked" : "open";
  };
  groups.forEach((group) => {
    const named = group.agents.filter((a) => AI_BOTS.has(a));
    // Contradictory rules in a group that names an AI crawler.
    if (named.length > 0) {
      for (const rule of group.rules.filter((r) => r.type === "disallow")) {
        const clash = group.rules.find((r) => r.type === "allow" && r.value === rule.value && rule.value !== "");
        const emptyAndAll = rule.value === "/" && group.rules.some((r) => r.type === "disallow" && r.value === "");
        if (clash || emptyAndAll) {
          out.push({
            message: `The rules for ${named.join(", ")} say both Disallow: ${rule.value} and ${clash ? `Allow: ${rule.value}` : "an empty Disallow (allow everything)"}. Crawlers settle this differently, so the result is unpredictable.`,
            location: { file: "robots.txt", line: rule.line, column: 1 },
            fix: { kind: "manual", summary: "Keep one. To block these crawlers use only Disallow: /; to allow them use an empty Disallow: or no rule.", edits: [] },
            key: `clash:${named.join(",")}:${rule.value}`,
          });
          break;
        }
      }
    }
    // A user agent that looks like a misspelled AI crawler.
    group.agents.forEach((agent, i) => {
      if (AI_BOTS.has(agent) || OTHER_BOTS.has(agent)) return;
      const guess = nearest(agent, AI_BOTS);
      if (guess) {
        out.push({
          message: `robots.txt names the crawler "${agent}", which is not a known AI crawler. Did you mean "${guess}"? A misspelled name is ignored, so the rules under it do not apply to any crawler.`,
          location: { file: "robots.txt", line: group.agentLines[i] ?? 1, column: 1 },
          fix: { kind: "manual", summary: `Use the name the crawler publishes, for example "${guess}". Names are matched without regard to case.`, edits: [] },
          key: `typo:${agent}`,
        });
      }
    });
  });
  // The site publishes a guide for agents and shuts out the crawlers that read it for people.
  const publishesGuide = siteText(ctx.site, "/llms.txt") !== undefined || siteText(ctx.site, "/llms-full.txt") !== undefined;
  if (publishesGuide && RETRIEVAL_BOTS.every((bot) => accessFor(bot) === "blocked")) {
    const blocker = groups.find((g) => g.agents.includes("*") && fullyBlocked(g));
    const rule = blocker?.rules.find((r) => r.type === "disallow" && r.value === "/");
    out.push({
      message: "The site publishes llms.txt for AI tools, but robots.txt blocks every crawler that fetches pages for them (OAI-SearchBot, ChatGPT-User, PerplexityBot, and the others). They cannot read the guide, or anything else.",
      location: { file: "robots.txt", line: rule?.line ?? 1, column: 1 },
      fix: { kind: "manual", summary: "Allow the retrieval crawlers you want, for example User-agent: OAI-SearchBot with Allow: /, or remove the blanket Disallow: /. You can still block training crawlers such as GPTBot and ClaudeBot.", edits: [] },
      key: "blocked-with-llms-txt",
    });
  }
  return out;
});

const APP_ROOTS = new Set(["root", "app", "__next", "__nuxt", "svelte", "q-app", "outlet", "main-app"]);

export const readabilitySsrContent = check(meta("readability.ssr-content", "Page content only appears after JavaScript runs", "warning", ["agent-readability spec"], ["html"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const body = firstElement(page, "body");
    if (!body) continue;
    const words = wordsOf(visibleText(body)).size;
    if (words >= 10) continue;
    const scripts = page.elements.filter((e) => e.tagName === "script" && ((attr(e, "src") ?? "").trim() !== "" || textOf(e).trim() !== "") && !/json|ld\+json|importmap|speculationrules/i.test(attr(e, "type") ?? ""));
    if (scripts.length === 0) continue; // a short static page is not a rendering problem
    const emptyRoot = page.elements.find((e) => APP_ROOTS.has(attr(e, "id") ?? "") && textOf(e).trim() === "" && !descendants(e).some((d) => ["img", "svg", "picture", "video", "canvas"].includes(d.tagName)));
    const noscript = page.elements.find((e) => e.tagName === "noscript" && /javascript/i.test(textOf(e)));
    const bareBody = !descendants(body).some((e) => !["script", "style", "noscript", "template", "link", "meta"].includes(e.tagName));
    if (!emptyRoot && !noscript && !bareBody) continue; // little text, but something is there: an image page, a canvas, a short note
    const at = emptyRoot ?? noscript;
    out.push({
      message: `The HTML has ${words === 0 ? "no readable text" : `only ${words} words`} but loads ${scripts.length} script${scripts.length === 1 ? "" : "s"}${emptyRoot ? ` and ends with an empty <${emptyRoot.tagName} id="${attr(emptyRoot, "id")}">` : ""}. The content seems to be created in the browser, so agents, crawlers, and link previews that do not run JavaScript see an empty page.`,
      location: at ? locate(page, at) : documentLocation(page),
      fix: {
        kind: "manual",
        summary: "Render the page's content into the HTML at build time (static site generation, or server-side rendering) so the built file contains the text. Client-side code can still take over afterward.",
        edits: [],
      },
      key: "client-rendered",
    });
  }
  return out;
});

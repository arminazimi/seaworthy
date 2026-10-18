// readability.*: can agents and AI search read this site? See spec/agent-readability/v1.md.

import { type HtmlElement, attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { createHash } from "node:crypto";

import { locateJsonString, looksLikeHtml, parseJson, positionIn, siteText } from "./files.js";
import { nearest } from "./aria-data.js";
import { check, descendants, documentLocation, firstElement, isRedirectStub, locate, meta, pagesOf, readSiteFile, textOf } from "./helpers.js";
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

const SIGNALS = ["search", "ai-input", "ai-train"];

export const readabilityContentSignals = check(meta("readability.content-signals", "Content-Signal or Content-Usage line in robots.txt is malformed", "warning", ["Content Signals", "IETF AIPREF (draft)"], ["files"]), (ctx) => {
  const text = siteText(ctx.site, "/robots.txt");
  if (text === undefined) return [];
  const out: FindingDraft[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*/, "").trim();
    const match = /^(content-signal|content-usage)\s*:\s*(.*)$/i.exec(line);
    if (!match) return;
    const location = { file: "robots.txt", line: i + 1, column: 1 };
    const isSignal = (match[1] as string).toLowerCase() === "content-signal";
    const members = (match[2] as string).split(",").map((m) => m.trim()).filter(Boolean);
    if (members.length === 0) {
      out.push({ message: `The ${match[1]} line has no value.`, location, severity: isSignal ? "warning" : "note", fix: { kind: "manual", summary: isSignal ? "Write it as: Content-Signal: search=yes, ai-input=yes, ai-train=no" : "Write it as a list of name=y or name=n pairs, for example: Content-Usage: train-ai=n", edits: [] }, key: `empty:${match[1]}` });
      return;
    }
    const problems: string[] = [];
    const seen = new Set<string>();
    members.forEach((member, index) => {
      // AIPREF allows a leading path before the preferences; a signal never does.
      const pair = !isSignal && index === 0 ? member.replace(/^\/\S*\s+/, "") : member;
      const parts = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(\S*)$/.exec(pair);
      if (!parts) {
        problems.push(`"${member}" is not a name=value pair`);
        return;
      }
      const name = (parts[1] as string).toLowerCase();
      const value = (parts[2] as string).toLowerCase();
      if (seen.has(name)) problems.push(`${name} appears twice`);
      seen.add(name);
      if (isSignal) {
        if (!SIGNALS.includes(name)) problems.push(`"${name}" is not a content signal (use ${SIGNALS.join(", ")})`);
        else if (value !== "yes" && value !== "no") problems.push(`${name} must be yes or no, not "${parts[2]}"`);
      } else if (value !== "y" && value !== "n") {
        problems.push(`${name} must be y or n, not "${parts[2]}"`);
      }
    });
    if (problems.length > 0) {
      out.push({
        message: `The ${match[1]} line is malformed: ${problems.join("; ")}.${isSignal ? "" : " AIPREF is still an Internet-Draft, so this is only a note."}`,
        location,
        severity: isSignal ? "warning" : "note",
        fix: { kind: "manual", summary: isSignal ? "Use: Content-Signal: search=yes, ai-input=yes, ai-train=no (each signal at most once, each value yes or no)." : "Use name=y or name=n pairs, for example: Content-Usage: train-ai=n. Check the current draft before relying on other names.", edits: [] },
        key: `${match[1]}:${problems.join("|")}`,
      });
    }
  });
  return out;
});

const SKILLS_INDEX = "/.well-known/agent-skills/index.json";
const SKILLS_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export const readabilityAgentSkills = check(meta("readability.agent-skills", "Agent Skills index is invalid or lists a skill that is not in the site", "warning", ["Agent Skills Discovery 0.2.0 (draft)"], ["files"]), (ctx) => {
  const text = siteText(ctx.site, SKILLS_INDEX);
  if (text === undefined) return [];
  const file = SKILLS_INDEX.slice(1);
  const out: FindingDraft[] = [];
  const fail = (message: string, location: { file: string; line?: number; column?: number }, summary: string, key: string): void => {
    out.push({ message, location, fix: { kind: "manual", summary, edits: [] }, key });
  };
  const parsed = parseJson(text);
  if (!parsed.ok) {
    fail(`The Agent Skills index does not parse: ${parsed.message}.`, { file, ...(parsed.line ? { line: parsed.line, column: parsed.column ?? 1 } : {}) }, "Fix the JSON syntax.", "parse");
    return out;
  }
  const root = parsed.value;
  if (!isObject(root) || !Array.isArray(root["skills"])) {
    fail('The Agent Skills index must be a JSON object with a "skills" array.', { file, line: 1, column: 1 }, `Use the shape { "$schema": "${SKILLS_SCHEMA}", "skills": [ ... ] }.`, "shape");
    return out;
  }
  if (typeof root["$schema"] !== "string") {
    fail('The index has no "$schema". Clients treat it as the older v0.1.0 format.', { file, line: 1, column: 1 }, `Add "$schema": "${SKILLS_SCHEMA}".`, "no-schema");
  } else if (root["$schema"] !== SKILLS_SCHEMA) {
    fail(`The index names the schema ${root["$schema"]}, which this check does not know (it follows 0.2.0). Clients may refuse to read it.`, locateJsonString(file, text, root["$schema"]), `Use "${SKILLS_SCHEMA}" or update Seaworthy.`, "unknown-schema");
  }
  const seen = new Set<string>();
  let cursor = 0;
  (root["skills"] as unknown[]).forEach((entry, i) => {
    if (!isObject(entry)) {
      fail(`Skill ${i + 1} is not an object.`, { file, line: 1, column: 1 }, "Each skill is an object with name, type, description, url, and digest.", `entry:${i}`);
      return;
    }
    const name = typeof entry["name"] === "string" ? entry["name"] : `#${i + 1}`;
    const where = typeof entry["name"] === "string" ? locateJsonString(file, text, entry["name"], cursor) : { file, line: 1, column: 1 };
    if (typeof entry["name"] === "string") cursor = text.indexOf(JSON.stringify(entry["name"]), cursor) + 1;
    for (const field of ["name", "type", "description", "url", "digest"]) {
      if (typeof entry[field] !== "string" || entry[field] === "") fail(`Skill "${name}" has no ${field}.`, where, `Every skill needs name, type, description, url, and digest.`, `missing:${name}:${field}`);
    }
    if (typeof entry["name"] === "string" && (!SKILL_NAME.test(entry["name"]) || entry["name"].length > 64)) {
      fail(`The skill name "${entry["name"]}" is not valid. Names are 1 to 64 lowercase letters, digits, and single hyphens, with no hyphen at either end.`, where, "Rename it, for example to my-skill.", `name:${name}`);
    }
    if (typeof entry["name"] === "string") {
      if (seen.has(entry["name"])) fail(`The skill name "${entry["name"]}" is listed twice.`, where, "Each skill name appears once.", `dup:${name}`);
      seen.add(entry["name"]);
    }
    if (typeof entry["type"] === "string" && entry["type"] !== "skill-md" && entry["type"] !== "archive") {
      fail(`Skill "${name}" has type "${entry["type"]}". Clients skip anything other than "skill-md" and "archive".`, where, 'Use "skill-md" for a single SKILL.md file or "archive" for a bundle.', `type:${name}`);
    }
    if (typeof entry["description"] === "string" && entry["description"].length > 1024) {
      fail(`The description of skill "${name}" is ${entry["description"].length} characters; the limit is 1024.`, where, "Shorten it.", `description:${name}`);
    }
    if (typeof entry["digest"] === "string" && !DIGEST.test(entry["digest"])) {
      fail(`The digest of skill "${name}" is not "sha256:" followed by 64 lowercase hex digits.`, where, "Write it as sha256:<hex>, computed over the raw bytes of the file.", `digest-format:${name}`);
    }
    if (typeof entry["url"] === "string" && entry["url"] !== "") {
      const target = ctx.site.resolveLink(SKILLS_INDEX, entry["url"]);
      if (target.kind === "internal") {
        if (target.file === undefined) {
          fail(`Skill "${name}" points at ${entry["url"]}, which is not in the built site.`, where, "Publish the skill file at that address, or fix the url.", `missing-file:${name}`);
        } else if (typeof entry["digest"] === "string" && DIGEST.test(entry["digest"])) {
          const bytes = readSiteFile(ctx.site, target.file)?.bytes;
          const actual = bytes ? `sha256:${createHash("sha256").update(bytes).digest("hex")}` : undefined;
          if (actual && actual !== entry["digest"]) {
            fail(`The digest of skill "${name}" does not match ${entry["url"]}: the file is ${actual}. Clients refuse a skill whose bytes differ from its digest.`, where, `Recompute it: shasum -a 256 <file>, and write sha256:<hex> as the digest.`, `digest-mismatch:${name}`);
          }
        }
      }
    }
  });
  return out;
});

const API_CATALOG_PATHS = ["/.well-known/api-catalog", "/.well-known/api-catalog.json"];

export const readabilityApiCatalog = check(meta("readability.api-catalog", "API catalog is not a valid linkset or links to files that are not in the site", "warning", ["RFC 9727", "RFC 9264"], ["files"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const path of API_CATALOG_PATHS) {
    const text = siteText(ctx.site, path);
    if (text === undefined) continue;
    const file = path.slice(1);
    const fail = (message: string, location: { file: string; line?: number; column?: number }, summary: string, key: string): void => {
      out.push({ message, location, fix: { kind: "manual", summary, edits: [] }, key });
    };
    const parsed = parseJson(text);
    if (!parsed.ok) {
      fail(`The API catalog is not JSON: ${parsed.message}. This check reads the JSON form of a linkset (application/linkset+json), not the text form.`, { file, ...(parsed.line ? { line: parsed.line, column: parsed.column ?? 1 } : {}) }, "Serve a linkset in JSON: { \"linkset\": [ { \"anchor\": \"https://example.com/api\", \"service-desc\": [ { \"href\": \"/openapi.json\" } ] } ] }", "parse");
      continue;
    }
    const root = parsed.value;
    if (!isObject(root) || !Array.isArray(root["linkset"])) {
      fail('The API catalog must be a JSON object with a "linkset" array (RFC 9264).', { file, line: 1, column: 1 }, 'Wrap the entries as { "linkset": [ ... ] }.', "shape");
      continue;
    }
    if (root["linkset"].length === 0) fail("The API catalog lists no APIs.", { file, line: 1, column: 1 }, "Add an entry for each public API, or remove the file.", "empty");
    let cursor = 0;
    root["linkset"].forEach((context: unknown, i: number) => {
      if (!isObject(context)) {
        fail(`Entry ${i + 1} of the linkset is not an object.`, { file, line: 1, column: 1 }, "Each entry is an object with an anchor and link relations.", `entry:${i}`);
        return;
      }
      const anchor = typeof context["anchor"] === "string" ? context["anchor"] : undefined;
      const where = anchor ? locateJsonString(file, text, anchor, cursor) : { file, line: 1, column: 1 };
      if (anchor) cursor = text.indexOf(JSON.stringify(anchor), cursor) + 1;
      if (!anchor) fail(`Entry ${i + 1} of the linkset has no anchor, the URL of the API it describes.`, where, 'Add "anchor": "https://example.com/api".', `no-anchor:${i}`);
      for (const [relation, targets] of Object.entries(context)) {
        if (relation === "anchor") continue;
        if (!Array.isArray(targets)) {
          fail(`"${relation}" must be an array of link targets.`, where, `Write "${relation}": [ { "href": "..." } ].`, `not-array:${i}:${relation}`);
          continue;
        }
        for (const target of targets as unknown[]) {
          const href = isObject(target) && typeof target["href"] === "string" ? target["href"] : undefined;
          if (!href) {
            fail(`A "${relation}" target has no href.`, where, 'Every link target needs "href".', `no-href:${i}:${relation}`);
            continue;
          }
          const resolved = ctx.site.resolveLink(`/${path.slice(1)}`, href);
          if (resolved.kind === "internal" && resolved.file === undefined) {
            fail(`The catalog links to ${href}, which is not in the built site.`, locateJsonString(file, text, href, cursor > 0 ? cursor - 1 : 0), "Publish the file at that address, or fix the link.", `missing:${href}`);
          }
        }
      }
    });
  }
  return out;
});

const MCP_CARD_PATHS = ["/.well-known/mcp/server-card.json", "/.well-known/mcp.json", "/.well-known/mcp/server-cards.json"];

/** Whether a card names where the server can be reached: a transport, a list of remotes, or a URL. */
function hasEndpoint(card: Json): boolean {
  const transport = card["transport"];
  const remotes = card["remotes"];
  return (
    (typeof transport === "string" && transport !== "") ||
    (isObject(transport) && ["url", "endpoint"].some((k) => typeof transport[k] === "string" && transport[k] !== "")) ||
    (Array.isArray(remotes) && remotes.some((r) => isObject(r) && typeof r["url"] === "string" && r["url"] !== "")) ||
    (typeof card["url"] === "string" && card["url"] !== "") ||
    (typeof card["endpoint"] === "string" && card["endpoint"] !== "")
  );
}

export const readabilityMcpCard = check(meta("readability.mcp-card", "MCP Server Card is invalid or incomplete", "warning", ["MCP Server Card (draft, SEP-1649 / SEP-2127)"], ["files"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const path of MCP_CARD_PATHS) {
    const text = siteText(ctx.site, path);
    if (text === undefined) continue;
    const file = path.slice(1);
    const fail = (message: string, location: { file: string; line?: number; column?: number }, summary: string, key: string): void => {
      out.push({ message: `${message} (The MCP Server Card is still a draft, so details may change.)`, location, fix: { kind: "manual", summary, edits: [] }, key });
    };
    const parsed = parseJson(text);
    if (!parsed.ok) {
      fail(`The MCP Server Card does not parse: ${parsed.message}.`, { file, ...(parsed.line ? { line: parsed.line, column: parsed.column ?? 1 } : {}) }, "Fix the JSON syntax.", "parse");
      continue;
    }
    const root = parsed.value;
    const cards = Array.isArray(root) ? root : isObject(root) && Array.isArray(root["cards"]) ? (root["cards"] as unknown[]) : isObject(root) && Array.isArray(root["serverCards"]) ? (root["serverCards"] as unknown[]) : [root];
    cards.forEach((card, i) => {
      const label = cards.length > 1 ? ` (card ${i + 1})` : "";
      const where = { file, line: 1, column: 1 };
      if (!isObject(card)) {
        fail(`The MCP Server Card${label} is not a JSON object.`, where, "A card is an object with serverInfo, a transport, and capabilities.", `shape:${i}`);
        return;
      }
      const info = card["serverInfo"];
      const name = isObject(info) ? info["name"] : undefined;
      const version = isObject(info) ? info["version"] : undefined;
      if (!isObject(info) || typeof name !== "string" || name === "" || typeof version !== "string" || version === "") {
        const missing = !isObject(info) ? "serverInfo" : [typeof name !== "string" || name === "" ? "name" : "", typeof version !== "string" || version === "" ? "version" : ""].filter(Boolean).join(" and ");
        fail(`The MCP Server Card${label} has no ${isObject(info) ? `serverInfo.${missing}` : "serverInfo"}.`, where, 'Add "serverInfo": { "name": "my-server", "version": "1.0.0" }.', `serverInfo:${i}`);
      }
      if (!hasEndpoint(card)) {
        fail(`The MCP Server Card${label} does not say where the server can be reached.`, where, 'Add "transport": { "type": "streamable-http", "url": "https://example.com/mcp" }.', `transport:${i}`);
      }
    });
  }
  return out;
});

const A2A_PATH = "/.well-known/agent-card.json";
const A2A_TEXT_FIELDS = ["name", "description", "version"] as const;
const A2A_LIST_FIELDS = ["defaultInputModes", "defaultOutputModes", "skills"] as const;

export const readabilityA2aCard = check(meta("readability.a2a-card", "A2A agent card is invalid or missing required fields", "warning", ["A2A protocol 1.0"], ["files"]), (ctx) => {
  const text = siteText(ctx.site, A2A_PATH);
  if (text === undefined) return [];
  const file = A2A_PATH.slice(1);
  const out: FindingDraft[] = [];
  const fail = (message: string, location: { file: string; line?: number; column?: number }, summary: string, key: string): void => {
    out.push({ message, location, fix: { kind: "manual", summary, edits: [] }, key });
  };
  const parsed = parseJson(text);
  if (!parsed.ok) {
    fail(`The A2A agent card does not parse: ${parsed.message}.`, { file, ...(parsed.line ? { line: parsed.line, column: parsed.column ?? 1 } : {}) }, "Fix the JSON syntax.", "parse");
    return out;
  }
  const card = parsed.value;
  const top = { file, line: 1, column: 1 };
  if (!isObject(card)) {
    fail("The A2A agent card is not a JSON object.", top, "The card is an object with name, description, version, supportedInterfaces, capabilities, input and output modes, and skills.", "shape");
    return out;
  }
  for (const field of A2A_TEXT_FIELDS) {
    if (typeof card[field] !== "string" || card[field] === "") fail(`The A2A agent card has no ${field}.`, top, `Add "${field}" as non-empty text.`, `missing:${field}`);
  }
  // 1.0 lists interfaces; 0.3 used a single url. Accept either.
  const interfaces = card["supportedInterfaces"];
  if (Array.isArray(interfaces)) {
    if (interfaces.length === 0 || !interfaces.every((i) => isObject(i) && typeof i["url"] === "string" && i["url"] !== "")) {
      fail('Every entry of "supportedInterfaces" needs a "url", and the list cannot be empty.', top, 'Write "supportedInterfaces": [ { "url": "https://example.com/a2a", "protocolBinding": "JSONRPC" } ].', "interfaces");
    }
  } else if (typeof card["url"] !== "string" || card["url"] === "") {
    fail('The A2A agent card does not say where the agent is reached: it has neither "supportedInterfaces" nor a "url".', top, 'Add "supportedInterfaces" with at least one interface that has a "url".', "no-endpoint");
  }
  if (!isObject(card["capabilities"])) fail('The A2A agent card has no "capabilities" object.', top, 'Add "capabilities": {}, with streaming and pushNotifications set if you support them.', "missing:capabilities");
  for (const field of A2A_LIST_FIELDS) {
    if (!Array.isArray(card[field])) fail(`The A2A agent card has no "${field}" list.`, top, `Add "${field}" as a list.`, `missing:${field}`);
  }
  if (Array.isArray(card["skills"])) {
    let cursor = 0;
    (card["skills"] as unknown[]).forEach((skill, i) => {
      if (!isObject(skill)) {
        fail(`Skill ${i + 1} is not an object.`, top, "A skill has id, name, description, and tags.", `skill:${i}`);
        return;
      }
      const label = typeof skill["id"] === "string" ? skill["id"] : `#${i + 1}`;
      const where = typeof skill["id"] === "string" ? locateJsonString(file, text, skill["id"], cursor) : top;
      if (typeof skill["id"] === "string") cursor = text.indexOf(JSON.stringify(skill["id"]), cursor) + 1;
      for (const field of ["id", "name", "description"]) {
        if (typeof skill[field] !== "string" || skill[field] === "") fail(`Skill "${label}" has no ${field}.`, where, `Add "${field}" as non-empty text.`, `skill:${label}:${field}`);
      }
      if (!Array.isArray(skill["tags"])) fail(`Skill "${label}" has no "tags" list.`, where, 'Add "tags": [ "keyword" ].', `skill:${label}:tags`);
    });
  }
  return out;
});

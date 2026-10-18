// readability.*: can agents and AI search read this site? See spec/agent-readability/v1.md.

import { type HtmlElement, attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { looksLikeHtml, positionIn, siteText } from "./files.js";
import { check, firstElement, locate, meta, pagesOf } from "./helpers.js";

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

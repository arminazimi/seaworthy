// Builds this repository's Markdown docs into a small static site with an `llms.txt` and a
// Markdown twin per page — the dogfood target for `readability.llms-txt` and
// `readability.md-alternates` (issue #111). Offline, dependency-free, deterministic: the same
// `docs/` tree always produces byte-identical output.
//
// Usage: node tools/docs-site.mjs [outDir]   (default: _site, at the repository root)
// Needs `npm run build` first: heading slugs come from the verify package's own parser.
//
// The output is a built site, not a source of truth: every page's Markdown twin is the verbatim
// `docs/` file, and `llms.txt` is derived from the files that exist. Nothing here edits `docs/`.

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSlugger, headingText } from "../packages/verify/dist/src/markdown.js";

export const SITE_NAME = "Seaworthy";
export const SITE_SUMMARY = "Guides and reference for Seaworthy, which verifies any built static site and returns a versioned, machine-readable report with stable check IDs, locations, and fix hints.";

/** llms.txt sections, keyed by the first path segment under docs/; "" is docs-root files. */
const SECTIONS = [
  ["", "Guides"],
  ["checks", "Check reference"],
  ["adr", "Architecture decisions"],
  ["consumers", "Consumers"],
];

// ---------- Markdown rendering, covering the subset this repository's docs use ----------

const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s) => escapeText(s).replace(/"/g, "&quot;");

/** Built-site URL of the HTML page for a docs-relative path: adr/x.md → /docs/adr/x.html. */
const pageUrl = (rel) => `/docs/${rel.replace(/\.md$/i, ".html")}`;
/** Built-site URL of the Markdown twin: adr/x.md → /docs/adr/x.md. */
const twinUrl = (rel) => `/docs/${rel}`;

/** Rewrite a relative link to a sibling document: guide.md → guide.html, anchors kept as is. */
function rewriteDocHref(href) {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(href)) return href; // external, in-page, or query: leave alone
  return href.replace(/\.md(?=[#?]|$)/i, ".html");
}

/** Inline Markdown to HTML: code spans first (placeholder-guarded), then images, links, emphasis. */
function inline(text) {
  const codes = [];
  let out = escapeText(text);
  out = out.replace(/(`+)([^`]+?)\1/g, (_f, _ticks, body) => {
    codes.push(body);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_m, alt, src) => `<img src="${escapeAttr(rewriteDocHref(src))}" alt="${escapeAttr(alt)}">`);
  out = out.replace(/\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_m, label, href) => `<a href="${escapeAttr(rewriteDocHref(href))}">${label}</a>`);
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^\p{L}\p{N}_])__([^_]+)__(?![\p{L}\p{N}_])/gu, "$1<strong>$2</strong>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>").replace(/(^|[^\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu, "$1<em>$2</em>");
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
}

const isBlank = (line) => /^\s*$/u.test(line);
const indentOf = (line) => line.length - line.replace(/^\s+/u, "").length;
const headingLevel = (line) => {
  const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
  return m ? { level: m[1].length, text: m[2] } : undefined;
};
const isHr = (line) => /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/u.test(line);
const LIST_MARKER = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(.*)$/u;
const isSeparatorRow = (line) => /^[\s|:-]+$/u.test(line) && line.includes("-") && line.includes("|");
const isTableRow = (line) => !isBlank(line) && line.includes("|") && !LIST_MARKER.test(line);

function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "\\" && trimmed[i + 1] === "|") { current += "|"; i++; continue; }
    if (trimmed[i] === "|") { cells.push(current); current = ""; continue; }
    current += trimmed[i];
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** Render a list starting at lines[i] → { html, next }. Nested lists are one level deeper. */
function renderList(lines, start, slugger) {
  const first = LIST_MARKER.exec(lines[start]);
  const base = first[1].length;
  const ordered = /^\s*\d/u.test(lines[start]);
  const items = [];
  let current;
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j++;
      if (j >= lines.length || (!LIST_MARKER.test(lines[j]) && indentOf(lines[j]) <= base)) { i = j; break; }
      if (current) current.rest.push(""); // loose list: keep the blank between items
      i = j;
      continue;
    }
    const m = LIST_MARKER.exec(line);
    if (m && m[1].length === base) {
      current = { text: m[2], rest: [] };
      items.push(current);
      i++;
      continue;
    }
    if (m && m[1].length > base && current) { current.rest.push(line.slice(base + 2)); i++; continue; }
    if (!m && current && indentOf(line) > base) { current.rest.push(line.slice(Math.min(base + 2, indentOf(line)))); i++; continue; }
    break;
  }
  const html = items
    .map((item) => {
      let body = renderBlocks([item.text, ...item.rest], slugger);
      if (!/<\/p>\s*<(p|ul|ol|pre|h[1-6]|blockquote|table)/u.test(body) && !body.includes("<ul") && !body.includes("<ol") && !body.includes("<pre") && !body.includes("<table")) body = body.replace(/^<p>/u, "").replace(/<\/p>$/u, "");
      return `<li>${body}</li>`;
    })
    .join("");
  const tag = ordered ? "ol" : "ul";
  return { html: `<${tag}>${html}</${tag}>`, next: i };
}

/** Render block-level Markdown to HTML. slugger keeps heading ids unique within one page. */
function renderBlocks(lines, slugger) {
  const out = [];
  let paragraph = [];
  let afterBlank = true;
  const flush = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isBlank(line)) { flush(); afterBlank = true; continue; }

    const fence = /^\s{0,3}(`{3,}|~{3,})[ \t]*(\S*)[ \t]*$/u.exec(line);
    if (fence) {
      flush();
      const closerChar = fence[1][0] === "`" ? "`" : "~";
      const closer = new RegExp(`^\\s{0,3}${closerChar}{${fence[1].length},}[ \\t]*$`, "u");
      const body = [];
      i++;
      while (i < lines.length && !closer.test(lines[i])) body.push(lines[i++]);
      out.push(`<pre><code${fence[2] ? ` class="language-${escapeAttr(fence[2])}"` : ""}>${escapeText(body.join("\n"))}\n</code></pre>`);
      afterBlank = true;
      continue;
    }

    if (paragraph.length > 0 && /^\s{0,3}(?:=+|-+)[ \t]*$/u.test(line)) {
      const level = line.trim().startsWith("=") ? 1 : 2;
      const text = paragraph.join(" ");
      paragraph = [];
      out.push(`<h${level} id="${escapeAttr(slugger.slug(headingText(text)))}">${inline(text)}</h${level}>`);
      afterBlank = true;
      continue;
    }

    const h = headingLevel(line);
    if (h) {
      flush();
      out.push(`<h${h.level} id="${escapeAttr(slugger.slug(headingText(h.text)))}">${inline(h.text)}</h${h.level}>`);
      afterBlank = false;
      continue;
    }

    if (isHr(line)) { flush(); out.push("<hr>"); afterBlank = true; continue; }

    if (/^\s{0,3}>/u.test(line)) {
      flush();
      const quoted = [];
      while (i < lines.length && /^\s{0,3}>/u.test(lines[i])) quoted.push(lines[i++].replace(/^\s{0,3}>[ \t]?/u, ""));
      i--;
      out.push(`<blockquote>${renderBlocks(quoted, slugger)}</blockquote>`);
      afterBlank = true;
      continue;
    }

    if (/^\s{0,3}<[a-zA-Z]/u.test(line) && line.includes("</")) {
      flush();
      const raw = [];
      while (i < lines.length && !isBlank(lines[i])) raw.push(lines[i++]);
      i--;
      out.push(raw.join("\n")); // raw HTML block: passed through, as Markdown consumers expect
      afterBlank = true;
      continue;
    }

    if (LIST_MARKER.test(line)) {
      flush();
      const list = renderList(lines, i, slugger);
      out.push(list.html);
      i = list.next - 1;
      afterBlank = true;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flush();
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]));
      i--;
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      afterBlank = true;
      continue;
    }

    if (afterBlank && indentOf(line) >= 4) {
      flush();
      const body = [];
      while (i < lines.length && (isBlank(lines[i]) || indentOf(lines[i]) >= 4)) { body.push(lines[i].replace(/^(?: {4}|\t)/u, "")); i++; }
      while (body.length > 0 && isBlank(body[body.length - 1])) body.pop();
      out.push(`<pre><code>${escapeText(body.join("\n"))}\n</code></pre>`);
      afterBlank = true;
      continue;
    }

    paragraph.push(line.trim());
    afterBlank = false;
  }
  flush();
  return out.join("\n");
}

const plainText = (html) => html.replace(/<[^>]*>/gu, " ").replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/\s+/gu, " ").trim();

/** The page title: the first H1, falling back to the file name. */
function docTitle(source, rel) {
  const m = /^#\s+(.+?)\s*#*\s*$/mu.exec(source);
  return m ? headingText(m[1]) : rel.replace(/\.md$/iu, "").replace(/[-_]/gu, " ");
}

/** A one-line summary for llms.txt: the first paragraph, shortened to fit a single entry line. */
function docNote(content) {
  const m = /<p>([\s\S]*?)<\/p>/u.exec(content);
  if (!m) return "";
  const text = plainText(m[1]);
  return text.length <= 140 ? text : `${text.slice(0, text.lastIndexOf(" ", 137))}…`;
}

// ---------- The site ----------

const PAGE_TEMPLATE = ({ title, description, twinHref, content }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)}</title>
<meta name="description" content="${escapeAttr(description)}">
<link rel="alternate" type="text/markdown" href="${escapeAttr(twinHref)}">
<style>
body { margin: 2rem auto; max-width: 46rem; padding: 0 1rem; font: 16px/1.6 system-ui, sans-serif; color: #17252a; }
nav a { font-weight: 600; text-decoration: none; }
main { margin-top: 1.5rem; }
pre { padding: 0.75rem 1rem; overflow-x: auto; background: #f2f5f3; border-radius: 6px; }
code { font: 0.95em ui-monospace, monospace; }
p code, li code, td code { background: #f2f5f3; padding: 0.1em 0.3em; border-radius: 4px; }
blockquote { margin: 1rem 0; padding: 0.25rem 1rem; border-left: 4px solid #9fc4b8; color: #3d5a52; }
table { border-collapse: collapse; }
th, td { border: 1px solid #cdd9d3; padding: 0.35rem 0.6rem; text-align: left; }
</style>
</head>
<body>
<nav><a href="/">Seaworthy docs</a></nav>
<main>
${content}
</main>
</body>
</html>
`;

function listMarkdownFiles(directory, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).filter((e) => !e.name.startsWith("."))) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listMarkdownFiles(join(directory, entry.name), rel));
    else if (entry.isFile() && /\.md$/iu.test(entry.name)) files.push(rel);
  }
  return files.sort();
}

const sectionOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "");

/** Section display names in the fixed order, then any other top-level directory, sorted. */
function sectionsFor(files) {
  const known = new Map(SECTIONS);
  const extra = [...new Set(files.map(sectionOf))].filter((s) => s !== "" && !known.has(s)).sort();
  return [...SECTIONS.map(([key, title]) => ({ key, title })), ...extra.map((s) => ({ key: s, title: `${s[0].toUpperCase()}${s.slice(1)}` }))].filter((section) => files.some((f) => sectionOf(f) === section.key));
}

/** One llms.txt entry line: the proposal's `- [Title](url): note`, everything on one line. */
function llmsEntry(rel, title, note) {
  const safeTitle = title.replace(/[[\]]/gu, "");
  const safeNote = note === "" ? "" : `: ${note.replace(/[[\]\n]/gu, " ").replace(/\s+/gu, " ").trim()}`;
  return `- [${safeTitle}](${twinUrl(rel)})${safeNote}`;
}

/**
 * Build the docs site from `docsDir` (a folder of Markdown) into `outDir`.
 * Returns the root-relative paths of every file written, sorted. Pure over the inputs: the
 * same docs tree always yields the same bytes in the same order.
 */
export function buildDocsSite({ docsDir, outDir }) {
  docsDir = resolve(docsDir);
  outDir = resolve(outDir);
  if (!statSync(docsDir).isDirectory()) throw new Error(`${docsDir} is not a directory`);

  const files = listMarkdownFiles(docsDir);
  const docs = files.map((rel) => {
    const source = readFileSync(join(docsDir, rel), "utf8");
    const content = renderBlocks(source.split(/\r\n|\r|\n/u), createSlugger());
    return { rel, source, content, title: docTitle(source, rel), note: docNote(content) };
  });
  const sections = sectionsFor(files);

  rmSync(outDir, { recursive: true, force: true });
  const written = [];
  const write = (rel, body) => {
    const target = join(outDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    written.push(`/${rel}`);
  };

  for (const doc of docs) {
    write(`docs/${doc.rel.replace(/\.md$/iu, ".html")}`, PAGE_TEMPLATE({
      title: `${doc.title} · ${SITE_NAME} docs`,
      description: doc.note === "" ? SITE_SUMMARY : doc.note,
      twinHref: twinUrl(doc.rel),
      content: doc.content,
    }));
    write(`docs/${doc.rel}`, doc.source.endsWith("\n") ? doc.source : `${doc.source}\n`); // the Markdown twin, verbatim
  }

  // llms.txt: the llmstxt.org proposal — an H1, a one-line blockquote, H2 sections of link entries.
  write("llms.txt", [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_SUMMARY}`,
    "",
    ...sections.flatMap((section) => [`## ${section.title}`, "", ...docs.filter((d) => sectionOf(d.rel) === section.key).map((d) => llmsEntry(d.rel, d.title, d.note)), ""]),
  ].join("\n").replace(/\n+$/u, "\n"));

  // llms-full.txt: the whole guide in one fetch, as the proposal's optional second file.
  write("llms-full.txt", [
    `# ${SITE_NAME}`,
    `> ${SITE_SUMMARY}`,
    ...docs.map((d) => `\n## ${d.title}\n\n${d.source.replace(/\n+$/u, "")}\n`),
  ].join("\n").replace(/\n+$/u, "\n"));

  const indexContent = sections
    .map((section) => {
      const slug = section.key === "" ? "guides" : section.key;
      return `<h2 id="${slug}">${inline(section.title)}</h2>\n<ul>${docs
        .filter((d) => sectionOf(d.rel) === section.key)
        .map((d) => `<li><a href="${escapeAttr(pageUrl(d.rel))}">${inline(d.title)}</a>${d.note === "" ? "" : ` — ${inline(d.note)}`}</li>`)
        .join("")}</ul>`;
    })
    .join("\n");
  write("index.html", PAGE_TEMPLATE({
    title: `${SITE_NAME} docs`,
    description: SITE_SUMMARY,
    twinHref: "/llms.txt", // the index's Markdown equivalent is the site guide
    content: `<h1 id="seaworthy-docs">${inline(`${SITE_NAME} docs`)}</h1>\n<blockquote><p>${inline(SITE_SUMMARY)}</p></blockquote>\n${indexContent}`,
  }));

  return written.sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = resolve(process.argv[2] ?? join(root, "_site"));
  const written = buildDocsSite({ docsDir: join(root, "docs"), outDir });
  console.log(`docs site: ${written.length} files → ${outDir}`);
}

import assert from "node:assert/strict";
import { test } from "node:test";

import { readabilityJsonld, readabilityLlmsTxt, readabilityMdAlternates } from "../src/checks/readability.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const PAGE = '<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>t</h1></main></body></html>';

async function run(files: Record<string, string>, checks = [readabilityLlmsTxt]) {
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE, ...files })), checks });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("readability.llms-txt: a missing file is only a note", async () => {
  const [finding, ...rest] = await run({});
  assert.equal(rest.length, 0);
  assert.equal(finding!.severity, "note");
  assert.match(finding!.message, /no llms\.txt/);
});

test("readability.llms-txt accepts a file that follows the proposal", async () => {
  const text = "# Site\n\n> Summary.\n\nProse is fine here.\n\n## Docs\n\n- [A](/a.md): notes\n- [B](https://other.test/b)\n- [C](/a.md \"title\")\n\n## Optional\n\n- [D](/a.md)\n";
  assert.deepEqual(await run({ "llms.txt": text, "a.md": "# A\n" }), []);
});

test("readability.llms-txt reports empty, HTML, a missing H1, bad entries, and dead links", async () => {
  assert.match((await run({ "llms.txt": "  \n" }))[0]!.message, /empty/);
  assert.match((await run({ "llms.txt": "<!doctype html><title>404</title>" }))[0]!.message, /HTML page/);
  const noH1 = await run({ "llms.txt": "> only a summary\n\n## Docs\n" });
  assert.deepEqual(noH1.map((f) => [f.location.line, f.severity]), [[1, "warning"]]);
  const entries = await run({ "llms.txt": "# S\n\n## Docs\n\n- plain text\n- [Gone](/gone.md)\n- [Here](/a.md)\n", "a.md": "x" });
  assert.deepEqual(entries.map((f) => f.location.line), [5, 6]);
  assert.match(entries[1]!.message, /\/gone\.md/);
});

test("readability.llms-txt checks llms-full.txt and ignores a byte-order mark", async () => {
  assert.deepEqual(await run({ "llms.txt": "﻿# S\n", "llms-full.txt": "# S\n\nAll the text.\n" }), []);
  const findings = await run({ "llms.txt": "# S\n", "llms-full.txt": "" });
  assert.deepEqual(findings.map((f) => f.location.file), ["llms-full.txt"]);
});

test("readability.llms-txt honors the base path when resolving links", async () => {
  const site = buildSite(makeSite({ "index.html": PAGE, "llms.txt": "# S\n\n## D\n\n- [A](/repo/a.md)\n", "a.md": "x" }), { basePath: "/repo/" });
  const result = await runChecks({ site, checks: [readabilityLlmsTxt] });
  assert.deepEqual(result.findings, []);
});

const ARTICLE = "Seaworthy checks built sites before they are deployed so that agents can trust what they publish. Every finding names a file, a line, and a fix that can be applied and verified again. Reports are stable across runs and carry fingerprints for baselines.";
const withAlt = (href: string, body = ARTICLE) => `<!doctype html><html lang="en"><head><title>t</title><link rel="alternate" type="text/markdown" href="${href}"></head><body><main><h1>Title</h1><p>${body}</p></main></body></html>`;

test("readability.md-alternates accepts a Markdown copy of the same content", async () => {
  const markdown = `# Title\n\n${ARTICLE}\n`;
  assert.deepEqual(await run({ "p.html": withAlt("/p.md"), "p.md": markdown }, [readabilityMdAlternates]), []);
});

test("readability.md-alternates reports a missing copy, an HTML copy, an empty href, and a different document", async () => {
  const findings = await run(
    {
      "missing.html": withAlt("/nope.md"),
      "html.html": withAlt("/h.md"),
      "h.md": "<!doctype html><title>404</title>",
      "empty.html": withAlt(""),
      "other.html": withAlt("/o.md"),
      "o.md": "# Cooking\n\nChop the onions finely, then fry them slowly in butter until golden. Add garlic, stock, and a little salt; simmer for twenty minutes.",
      "short.html": withAlt("/s.md", "Too short."),
      "s.md": "# Unrelated\n\nAnything at all.",
      "external.html": withAlt("https://other.test/x.md"),
    },
    [readabilityMdAlternates],
  );
  assert.deepEqual(findings.map((f) => f.location.file), ["empty.html", "html.html", "missing.html", "other.html"]);
  assert.match(findings[3]!.message, /shares only \d+% of the words/);
});

test("readability.md-alternates ignores script text and other languages' words fairly", async () => {
  const persian = "این سایت پیش از انتشار بررسی می‌شود تا ایجنت‌ها بتوانند به محتوای آن اعتماد کنند و هر یافته فایل و خط و راه اصلاح مشخصی دارد که می‌توان آن را اجرا کرد و دوباره بررسی نمود";
  const page = `<!doctype html><html lang="fa"><head><title>t</title><link rel="alternate" type="text/markdown" href="/f.md"></head><body><main><p>${persian}</p><script>var unrelated = "alpha beta gamma delta epsilon zeta theta iota kappa lambda";</script></main></body></html>`;
  assert.deepEqual(await run({ "f.html": page, "f.md": `# عنوان\n\n${persian}\n` }, [readabilityMdAlternates]), []);
});

const ld = (json: string) => `<!doctype html>\n<html lang="en"><head><title>t</title>\n<script type="application/ld+json">${json}</script>\n</head><body><main><h1>t</h1></main></body></html>`;

test("readability.jsonld accepts complete items, @graph documents, and arrays", async () => {
  const article = '{"@context":"https://schema.org","@type":"Article","headline":"H","datePublished":"2026-10-18","author":{"@type":"Person","name":"A"}}';
  const graph = '{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"S","url":"https://x.test/"},{"@type":["Organization","Brand"],"name":"O","url":"https://x.test/"}]}';
  assert.deepEqual(await run({ "a.html": ld(article), "g.html": ld(graph), "r.html": ld(`[${article}]`) }, [readabilityJsonld]), []);
});

test("readability.jsonld reports parse errors with a position inside the script, a missing context, and a missing type", async () => {
  const findings = await run(
    {
      "bad.html": ld('{"@context":"https://schema.org",\n"@type":"Article",}'),
      "empty.html": ld("  "),
      "nocontext.html": ld('{"@type":"Article","headline":"H","datePublished":"2026-10-18","author":"A"}'),
      "notype.html": ld('{"@context":"https://schema.org","name":"x"}'),
    },
    [readabilityJsonld],
  );
  assert.deepEqual(findings.map((f) => f.location.file), ["bad.html", "empty.html", "nocontext.html", "notype.html"]);
  assert.match(findings[0]!.message, /does not parse/);
  assert.equal(findings[0]!.location.line, 4, "the error is on the second line of the JSON, which is line 4 of the file");
  assert.match(findings[1]!.message, /empty/);
  assert.match(findings[2]!.message, /no "@context"/);
  assert.match(findings[3]!.message, /no "@type"/);
});

test("readability.jsonld notes missing recommended fields and warns on dates that are not ISO 8601", async () => {
  const findings = await run(
    {
      "a.html": ld('{"@context":"https://schema.org","@type":"BlogPosting","headline":"H","datePublished":"18 October 2026"}'),
      "b.html": ld('{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}'),
      "c.html": ld('{"@context":"https://schema.org","@type":"Thing","name":"unknown types are not judged"}'),
    },
    [readabilityJsonld],
  );
  assert.deepEqual(findings.map((f) => [f.location.file, f.severity]), [["a.html", "warning"], ["a.html", "note"], ["b.html", "note"]]);
  assert.match(findings[0]!.message, /datePublished "18 October 2026"/);
  assert.match(findings[1]!.message, /missing author/);
  assert.match(findings[2]!.message, /missing itemListElement/);
});

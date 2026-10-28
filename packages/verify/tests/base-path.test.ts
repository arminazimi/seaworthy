import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { canonicalBasePath, detectBasePath, resolveBasePath } from "../src/base-path.js";
import { linksInternal } from "../src/checks/links.js";
import { buildSite } from "../src/site.js";
import { verifySite } from "../src/verify.js";
import type { BasePathDetectionResult } from "../src/base-path.js";
import { makeSite } from "./helpers.js";

const PAGE = (body = "") => `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>t</title></head>\n<body>\n${body}\n</body>\n</html>\n`;

/** Writes a built-output folder plus generator configs next to it, then detects from that output. */
function detectFrom(files: Record<string, string>, output: string): BasePathDetectionResult {
  const root = makeSite(files);
  const out = join(root, ...output.split("/"));
  return detectBasePath([out, root]);
}

const cases: readonly { generator: string; config: string; configText: string; output: string; path: string }[] = [
  { generator: "jekyll", config: "_config.yml", configText: "title: t\nbaseurl: \"/app/\"\n", output: "_site", path: "/app/" },
  { generator: "astro", config: "astro.config.mjs", configText: "export default defineConfig({ base: '/guides/' });\n", output: "dist", path: "/guides/" },
  { generator: "docusaurus", config: "docusaurus.config.js", configText: "// docs\nmodule.exports = { baseUrl: '/docs/' };\n", output: "build", path: "/docs/" },
  { generator: "hugo", config: "hugo.toml", configText: "title = 't'\nbaseURL = \"/blog/\"\n", output: "public", path: "/blog/" },
  { generator: "vitepress", config: ".vitepress/config.ts", configText: "export default { base: '/guide/' }\n", output: ".vitepress", path: "/guide/" },
];

/** The per-generate config lives next to the output folder the engine is given. */
test("each generator's config names the base path", () => {
  for (const { generator, config, configText, output, path } of cases) {
    const detection = detectFrom({ [config]: configText, [`${output}/index.html`]: PAGE() }, output);
    assert.equal(detection.status, "detected", `${generator}: ${JSON.stringify(detection)}`);
    if (detection.status !== "detected") continue;
    assert.equal(detection.finding.generator, generator);
    assert.equal(detection.finding.file, config);
    assert.equal(detection.finding.path, path);
    assert.equal(detection.finding.basePath, path);
  }
});

/** Slashes at either end collapse; `app`, `/guides`, and `//guide//` all become the same form. */
test("leading and trailing slashes normalize to one canonical form", () => {
  const tries: readonly { config: string; text: string; output: string; path: string }[] = [
    { config: "_config.yml", text: "baseurl: app\n", output: "_site", path: "/app/" },
    { config: "astro.config.mts", text: "export default { base: '/guides' }\n", output: "dist", path: "/guides/" },
    { config: ".vitepress/config.mjs", text: "export default { base: '//guide//' }\n", output: ".vitepress", path: "/guide/" },
  ];
  for (const { config, text, output, path } of tries) {
    const detection = detectFrom({ [config]: text, [`${output}/index.html`]: PAGE() }, output);
    assert.equal(detection.status, "detected", config);
    if (detection.status !== "detected") continue;
    assert.equal(detection.finding.path, path);
  }
});

test("an absolute baseURL keeps its host only in basePath, never in the engine path", () => {
  const detection = detectFrom({ "hugo.yaml": "baseURL: https://example.com/blog/\n", "_site/index.html": PAGE() }, "_site");
  assert.equal(detection.status, "detected");
  if (detection.status !== "detected") return;
  assert.equal(detection.finding.generator, "hugo");
  assert.equal(detection.finding.basePath, "https://example.com/blog/");
  assert.equal(detection.finding.path, "/blog/");
});

test("canonicalBasePath canonicalizes, or refuses rather than guessing", () => {
  assert.deepEqual(canonicalBasePath("/app"), { ok: true, basePath: "/app/", path: "/app/" });
  assert.deepEqual(canonicalBasePath("docs/"), { ok: true, basePath: "/docs/", path: "/docs/" });
  assert.deepEqual(canonicalBasePath(""), { ok: true, basePath: "/", path: "/" });
  assert.deepEqual(canonicalBasePath("https://example.com/blog/"), { ok: true, basePath: "https://example.com/blog/", path: "/blog/" });
  assert.equal(canonicalBasePath("https://example.com/blog/?p=1").ok, false);
  assert.equal(canonicalBasePath("https://example.com/blog/#top").ok, false);
  assert.equal(canonicalBasePath("ftp://example.com/blog/").ok, false);
  assert.equal(canonicalBasePath("/app with spaces/").ok, false);
});

const unclassifiedReason = (files: Record<string, string>, output: string): string => {
  const detection = detectFrom(files, output);
  assert.equal(detection.status, "unclassified", JSON.stringify(detection));
  return detection.status === "unclassified" ? detection.reason : "";
};

test("detection never guesses: every ambiguous value is reported with a reason", () => {
  assert.match(unclassifiedReason({ "_config.yml": "baseurl: |\n  /app/\n", "_site/index.html": PAGE() }, "_site"), /is not a plain string/);
  assert.match(unclassifiedReason({ "astro.config.ts": "export default { base: process.env.BASE_PATH }\n", "dist/index.html": PAGE() }, "dist"), /not a plain string literal/);
  assert.match(unclassifiedReason({ "astro.config.mjs": "export default { base: '/a/' }\nexport default { base: '/b/' }\n", "dist/index.html": PAGE() }, "dist"), /different values/);
  assert.match(unclassifiedReason({ "_config.yml": "baseurl: '{{ site.permalink }}'\n", "_site/index.html": PAGE() }, "_site"), /is not a URL path or an http\(s\) URL/);
  assert.match(unclassifiedReason({ "_config.yml": "# baseurl: \"/app/\"\npermalink: /app/\n", "_site/index.html": PAGE() }, "_site"), /does not name a base path/);
  assert.match(unclassifiedReason({ "_config.yml": "baseurl: \"/other/\"\n", "hugo.toml": "baseURL = \"/blog/\"\n", "_site/index.html": PAGE() }, "_site"), /conflicting base paths/);
});

test("resolveBasePath applies precedence: --base beats config beats detection beats /", () => {
  const root = makeSite({ "_config.yml": "baseurl: \"/app/\"\n", "_site/index.html": PAGE() });
  const out = join(root, "_site");

  assert.deepEqual(resolveBasePath({ folder: out }).detection, { status: "detected", finding: { basePath: "/app/", path: "/app/", generator: "jekyll", file: "_config.yml" } });
  assert.equal(resolveBasePath({ folder: out }).basePath, "/app/");
  // The config file beats detection.
  assert.equal(resolveBasePath({ folder: out, configBasePath: "/other/" }).basePath, "/other/");
  // The flag beats everything.
  assert.equal(resolveBasePath({ folder: out, configBasePath: "/other/", override: "/mine/" }).basePath, "/mine/");
  assert.equal(resolveBasePath({ folder: out, override: "/mine/" }).detection, undefined, "the flag short-circuits detection");

  const nowhere = resolveBasePath({ folder: makeSite({ "index.html": PAGE() }) });
  assert.equal(nowhere.basePath, "/");
  assert.equal(nowhere.detection?.status, "unclassified");
  if (nowhere.detection?.status !== "unclassified") return;
  assert.equal(nowhere.detection.examined, 0);
  assert.match(nowhere.detection.reason, /no generator config was found/);
});

test("verifySite verifies against the detected base path, and --base wins over it", async () => {
  // The output is written for a /app/ deployment: the link URL points at /app/about.html while the
  // file sits at the output root. Verifying against /app/ resolves it; verifying against / does not.
  const files = { "_config.yml": "baseurl: \"/app/\"\n", "_site/index.html": PAGE("<a href=\"/app/about.html\">a</a>"), "_site/about.html": PAGE() };
  const root = makeSite(files);
  const out = join(root, "_site");
  const options = { folder: out, rootLabel: "repo/_site", checks: [linksInternal], now: new Date("2027-01-01T00:00:00Z") };

  assert.equal(buildSite(out).basePath, "/", "without detection the graph starts at the root");
  assert.equal((await verifySite({ ...options, baseOverride: "/" })).report.findings.length, 1, "at / the /app/-prefixed link misses its page");
  assert.equal((await verifySite(options)).report.findings.length, 0, "detection names /app/, so the link resolves");
  assert.equal((await verifySite({ ...options, baseOverride: "/app/" })).report.findings.length, 0, "an explicit base that agrees also resolves");
  assert.equal((await verifySite({ ...options, baseOverride: "/other/" })).report.findings.length, 1, "an explicit base that disagrees misses it again");
});

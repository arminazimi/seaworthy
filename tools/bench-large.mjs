// Measures the engine on a large built site: sequential vs the worker pool, on a fixture the
// same seed regenerates byte-identically (issue #218). The 10,000-page site is GENERATED, not
// committed — `fixtures/` may not hold what a check cannot reproduce offline, and 10,000 files
// would bury the repository. Nothing here touches the network, and the run writes only to a
// temp folder (or --out), never into the repository.
//
//   npm run build
//   node tools/bench-large.mjs [--pages 10000] [--runs 2] [--workers auto] [--keep] [--out <dir>] [--generate-only]
//
//   --pages    number of HTML pages to generate (default 10000)
//   --runs     timed runs per mode; each figure reported is the best of them (default 2)
//   --workers  forced `SEAWORTHY_WORKERS` for the pool run (default: auto, the engine's own decision)
//   --keep     leave the generated site on disk and print its path
//   --generate-only  write the site, run nothing
//
// After each mode the report JSON is compared byte-for-byte with the first run's; a
// difference fails the tool (exit 1). That is the determinism contract of the parallel
// engine: same site, same report, whatever the machine.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

import { builtInChecks, reportToJson, verifySite } from "../packages/verify/dist/src/index.js";

const { values: flags } = parseArgs({
  options: {
    pages: { type: "string", default: "10000" },
    runs: { type: "string", default: "2" },
    workers: { type: "string", default: "auto" },
    out: { type: "string" },
    keep: { type: "boolean", default: false },
    "generate-only": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (flags.help) {
  console.log(`usage: node tools/bench-large.mjs [--pages 10000] [--runs 2] [--workers auto|N] [--keep] [--out <dir>] [--generate-only]

Generates a deterministic built site (seed 20261102, no network) and times the engine over it:
first sequential (SEAWORTHY_WORKERS=1), then the worker pool. Each mode's report JSON must be
byte-identical. Best of --runs warm runs is reported per mode. --generate-only writes the site only.`);
  process.exit(0);
}

const PAGES = Number(flags.pages);
const RUNS = Number(flags.runs);
if (!Number.isInteger(PAGES) || PAGES < 1) throw new Error(`--pages must be a positive integer, got ${flags.pages}`);
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`--runs must be a positive integer, got ${flags.runs}`);

// ---- the deterministic fixture --------------------------------------------------------------------------------

// mulberry32: a seeded PRNG, so every regeneration writes the same site on every machine.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20261102;

/** Builds the 10,000-page (or --pages) site: a docs/blog-shaped tree with findings sprinkled in on a fixed pattern. */
function generateSite(root, pages) {
  const rand = random(SEED);
  const words = "the quick brown fox jumps over lazy dogs while seaworthy verifies static sites for agents everywhere".split(" ");
  const paragraph = (n) => {
    let text = "";
    for (let i = 0; i < n; i++) text += `${words[Math.floor(rand() * words.length)]} `;
    return text.trim();
  };

  writeFileSync(join(root, "style.css"), "body { font-family: system-ui, sans-serif; margin: 2rem; }\n");
  writeFileSync(join(root, "app.js"), "console.log('seaworthy bench');\n");
  writeFileSync(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const page = (i, title) => {
    const prev = i > 0 ? `<a href="/blog/${String(i - 1).padStart(5, "0")}.html">previous</a>` : '<a href="/">home</a>';
    const next = i + 1 < pages ? `<a href="/blog/${String(i + 1).padStart(5, "0")}.html">next</a>` : '<a href="/">home</a>';
    const parts = [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${title}</title>`,
      i % 47 !== 0 ? `<meta name="description" content="${paragraph(8)}">` : "", // every 47th page lacks a description
      '<link rel="stylesheet" href="/style.css">',
      "</head>",
      "<body>",
      '<nav><a href="/">Seaworthy Bench</a></nav>',
      "<main>",
      "<h1>Blog</h1>",
      // A delayed heading jump on every 89th page trips headings.order.
      i % 89 === 0 ? "<h3>Notes</h3>" : "<h2>Notes</h2>",
      `<p>${paragraph(40 + Math.floor(rand() * 40))}</p>`,
      `<p>${paragraph(40 + Math.floor(rand() * 40))}</p>`,
      i % 37 === 0 ? '<p><img src="/logo.png"></p>' : "", // every 37th image lacks alt text
      i % 1000 === 500 ? '<p><a href="/blog/does-not-exist.html">a broken link</a></p>' : "", // about ten dead links per ten thousand pages, as on a real site
      `<p>${prev} · ${next}</p>`,
      "</main>",
      '<footer><a href="/" target="_blank">back home</a></footer>', // target=_blank without rel, every page
      '<script src="/app.js"></script>',
      "</body>",
      "</html>",
      "",
    ];
    return parts.filter((p) => p !== "").join("\n");
  };

  mkdirSync(join(root, "blog"), { recursive: true });
  const indexLinks = [];
  for (let i = 0; i < Math.min(100, pages); i++) indexLinks.push(`<li><a href="/blog/${String(i).padStart(5, "0")}.html">Post ${i}</a></li>`);
  writeFileSync(
    join(root, "index.html"),
    [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      "<title>Seaworthy benchmark site</title>",
      '<meta name="description" content="A generated site used to measure the check engine.">',
      '<link rel="stylesheet" href="/style.css">',
      "</head>",
      "<body><nav><a href="/">Seaworthy Bench</a></nav><main><h1>Seaworthy benchmark site</h1>",
      `<p>${paragraph(60)}</p><ul>${indexLinks.join("")}</ul>`,
      pages > 100 ? `<p><a href="/blog/${String(100).padStart(5, "0")}.html">older posts</a></p>` : "",
      "</main><footer>bench</footer></body></html>",
      "",
    ].join("\n")
  );
  for (let i = 0; i < pages - 1; i++) {
    writeFileSync(join(root, "blog", `${String(i).padStart(5, "0")}.html`), page(i, `Post ${i} | Seaworthy Bench`));
  }
}

// ---- measurement --------------------------------------------------------------------------------

const scratch = flags.out ?? mkdtempSync(join(tmpdir(), "seaworthy-bench-"));
const siteDir = join(scratch, "site");
mkdirSync(siteDir, { recursive: true });
generateSite(siteDir, PAGES);
console.log(`fixture: ${PAGES} pages generated at ${siteDir} (seed ${SEED}, deterministic)`);
if (flags["generate-only"]) {
  console.log(`generated only; keep? ${flags.keep}`);
  if (!flags.keep) rmSync(scratch, { recursive: true, force: true });
  process.exit(0);
}

console.log(`machine: ${cpus().length} logical CPUs · node ${process.version} · ${process.platform}`);

async function timed(mode) {
  const startedAt = performance.now();
  const result = await verifySite({ folder: siteDir, rootLabel: "site", checks: builtInChecks, now: new Date("2027-01-01T00:00:00Z"), timings: true });
  const wall = performance.now() - startedAt;
  return { wall, result, json: reportToJson(result.report) };
}

const modes = [{ name: "sequential" }, { name: "pool" }];

let reference;
const best = new Map();
// Alternate the modes so neither one owns the warmest cache: run 1 sequential, run 1 pool, run 2 sequential, ...
const envFor = { sequential: "1", pool: flags.workers === "auto" ? undefined : flags.workers };
for (let run = 1; run <= RUNS; run += 1) {
  for (const mode of modes) {
    if (envFor[mode.name] === undefined) delete process.env.SEAWORTHY_WORKERS;
    else process.env.SEAWORTHY_WORKERS = envFor[mode.name];
    const { wall, result, json } = await timed(mode.name);
    if (reference === undefined) reference = json;
    else if (json !== reference) {
      console.error(`PARITY FAIL: ${mode.name} run ${run} produced a different report than the first run (byte comparison)`);
      process.exitCode = 1;
    }
    const checks = result.timings?.checks ?? [];
    const slowest = [...checks].sort((a, b) => b.ms - a.ms).slice(0, 5).map((t) => `${t.check} ${Math.round(t.ms)}ms`).join(", ");
    const stages = (result.timings?.stages ?? []).map((s) => `${s.stage} ${Math.round(s.ms)}ms`).join(" · ");
    console.log(`${mode.name} run ${run}: wall ${Math.round(wall)}ms | ${stages} | findings ${result.report.summary.findings} | slowest: ${slowest}`);
    const previous = best.get(mode.name);
    if (previous === undefined || wall < previous.wall) best.set(mode.name, { wall, stages, checks });
  }
}

if (process.exitCode === 1) {
  console.error("parity: FAIL");
} else {
  console.log(`parity: OK — every run produced the same report JSON (${reference.length} bytes)`);
}
const seq = best.get("sequential");
const par = best.get("pool");
console.log(`best: sequential ${Math.round(seq.wall)}ms vs pool ${Math.round(par.wall)}ms → ${(seq.wall / par.wall).toFixed(2)}×`);
if (!flags.keep) rmSync(scratch, { recursive: true, force: true });
else console.log(`kept: ${scratch}`);

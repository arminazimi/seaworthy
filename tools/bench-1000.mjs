// Does the engine verify a 1,000-page built site inside the 30 s performance budget of issue #125?
// It measures the real thing: a generated 1,000-page site, verified by the built CLI as its own
// process — the wall time a user pays, including Node startup and report serialisation.
//
//   npm run build
//   node tools/bench-1000.mjs [--pages 1000] [--runs 3] [--budget 30] [--keep] [--out <dir>] [--generate-only]
//
//   --pages    HTML pages to generate (default 1000)
//   --runs     timed CLI runs; the verdict is judged on the BEST of them (default 3)
//   --budget   seconds the run must fit inside (default 30)
//   --keep     leave the generated site on disk and print its path
//   --out      write the site under an existing directory instead of a fresh temp folder
//   --generate-only  write the site, run nothing (what the test in packages/verify/tests uses)
//
// The fixture is GENERATED, never committed: `fixtures/` may not hold what a check cannot
// reproduce offline. Seed 20261102 (the same seed as tools/bench-large.mjs) makes every
// regeneration byte-identical on every machine, so a reported number is reproducible. Nothing
// here touches the network.
//
// Exit codes: 0 when the budget holds, 1 when a run exceeds it or the CLI misbehaves, 2 on a bad
// flag. A run whose report JSON differs byte-for-byte from the first run's is a determinism
// failure and fails the tool too — a fast but non-reproducible engine is not a pass.
//
// Deliberately NOT part of `npm run check`: a 30 s wall-clock gate on a shared runner measures
// the runner, not the engine (see the measurement notes in tools/check-startup.mjs). Run it on
// your own machine with `npm run bench:1000`.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "verify", "dist", "src", "cli.js");

export const SEED = 20261102;
export const DEFAULT_PAGES = 1000;
export const BUDGET_SECONDS = 30;

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

/**
 * Writes a docs/blog-shaped built site of exactly `pages` HTML files (index.html plus
 * pages - 1 /blog posts) with real findings sprinkled in on a fixed pattern: every 47th page
 * without a description, every 37th image without alt text, every 89th page with a heading jump,
 * `target="_blank"` without `rel` on every page, and a dead link around the middle of the run.
 * Findings matter: a clean site skips the report work that a real 1,000-page site pays.
 */
export function generateSite(root, pages, seed = SEED) {
  const rand = random(seed);
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
    return [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${title}</title>`,
      i % 47 !== 0 ? `<meta name="description" content="${paragraph(8)}">` : "",
      '<link rel="stylesheet" href="/style.css">',
      "</head>",
      "<body>",
      '<nav><a href="/">Seaworthy Bench</a></nav>',
      "<main>",
      "<h1>Blog</h1>",
      i % 89 === 0 ? "<h3>Notes</h3>" : "<h2>Notes</h2>",
      `<p>${paragraph(40 + Math.floor(rand() * 40))}</p>`,
      `<p>${paragraph(40 + Math.floor(rand() * 40))}</p>`,
      i % 37 === 0 ? '<p><img src="/logo.png"></p>' : "",
      i % 500 === 250 ? '<p><a href="/blog/does-not-exist.html">a broken link</a></p>' : "",
      `<p>${prev} · ${next}</p>`,
      "</main>",
      '<footer><a href="/" target="_blank">back home</a></footer>',
      '<script src="/app.js"></script>',
      "</body>",
      "</html>",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n");
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

/** Count the HTML files a built site holds, the way the engine's scan does it: everywhere under the root. */
export function countPages(root) {
  let found = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) found += countPages(join(root, entry.name));
    else if (entry.name.endsWith(".html")) found += 1;
  }
  return found;
}

/** Runs the built CLI over `siteDir` and resolves with its wall time in ms, exit code, stdout and stderr. */
function runCli(siteDir) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(process.execPath, [CLI, "verify", "site", "--format", "json", "--no-history", "--timings"], {
      cwd: dirname(siteDir),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ wall: performance.now() - startedAt, code, stdout, stderr }));
  });
}

const USAGE = `usage: node tools/bench-1000.mjs [--pages 1000] [--runs 3] [--budget 30] [--keep] [--out <dir>] [--generate-only]

Generates a deterministic 1,000-page built site (seed ${SEED}, no network) and verifies it with the
built CLI as its own process. Best of --runs timed runs must fit inside --budget seconds.`;

/** The tool, as a function so `--generate-only` can be driven from a test without the gate. */
export async function main(argv) {
  const { values: flags } = parseArgs({
    args: argv,
    options: {
      pages: { type: "string", default: String(DEFAULT_PAGES) },
      runs: { type: "string", default: "3" },
      budget: { type: "string", default: String(BUDGET_SECONDS) },
      out: { type: "string" },
      keep: { type: "boolean", default: false },
      "generate-only": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  const pages = Number(flags.pages);
  const runs = Number(flags.runs);
  const budgetMs = Number(flags.budget) * 1000;
  if (!Number.isInteger(pages) || pages < 1) throw new Error(`--pages must be a positive integer, got ${flags.pages}`);
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive integer, got ${flags.runs}`);
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error(`--budget must be a positive number of seconds, got ${flags.budget}`);

  const ownScratch = flags.out === undefined;
  const scratch = ownScratch ? mkdtempSync(join(tmpdir(), "seaworthy-1000-")) : flags.out;
  const siteDir = join(scratch, "site");
  mkdirSync(siteDir, { recursive: true });
  generateSite(siteDir, pages);
  const onDisk = countPages(siteDir);
  console.log(`fixture: ${onDisk} HTML pages at ${siteDir} (seed ${SEED}, deterministic)`);
  if (onDisk !== pages) {
    console.error(`FAIL: the generator wrote ${onDisk} pages, expected ${pages}`);
    return 1;
  }
  if (flags["generate-only"]) {
    if (!flags.keep && ownScratch) rmSync(scratch, { recursive: true, force: true });
    return 0;
  }
  if (!existsSync(CLI)) {
    console.error(`FAIL: ${CLI} is missing — run npm run build first`);
    return 1;
  }

  console.log(`machine: ${cpus().length} logical CPUs · node ${process.version} · ${process.platform}`);
  console.log(`budget: ${flags.budget}s · runs: ${runs} (verdict on the best; the CLI runs as its own process)`);

  let reference;
  let best;
  const samples = [];
  for (let run = 1; run <= runs; run += 1) {
    const { wall, code, stdout, stderr } = await runCli(siteDir);
    // 0 = clean, 1 = findings at or above --fail-on. 2 (usage) and 4 (engine crash) are failures,
    // and this fixture is built to carry findings, so 0 here would mean the run verified nothing.
    if (code !== 0 && code !== 1) {
      console.error(`FAIL: CLI exited ${code} on run ${run}`);
      console.error(stderr);
      return 1;
    }
    let report;
    try {
      report = JSON.parse(stdout);
    } catch {
      console.error(`FAIL: run ${run} printed no JSON report`);
      return 1;
    }
    if (report.summary.pages !== pages) {
      console.error(`FAIL: run ${run} reports ${report.summary.pages} pages, expected ${pages}`);
      return 1;
    }
    if (reference === undefined) reference = stdout;
    else if (stdout !== reference) {
      console.error(`PARITY FAIL: run ${run} produced a different report JSON than run 1 (byte comparison)`);
      return 1;
    }
    const engineTotal = /total\s+([0-9.]+)\s*m?s/.exec(stderr)?.[1];
    console.log(
      `run ${run}: wall ${Math.round(wall)}ms | pages ${report.summary.pages} | findings ${report.summary.findings}` +
        (engineTotal ? ` | engine total ${engineTotal}ms` : "")
    );
    samples.push(wall);
    if (best === undefined || wall < best) best = wall;
  }

  const verdict = best <= budgetMs ? "PASS" : "FAIL";
  console.log(
    `best of ${runs}: ${Math.round(best)}ms of ${Math.round(budgetMs)}ms (${(best / 1000).toFixed(2)}s, ${((best / budgetMs) * 100).toFixed(1)}% of the budget) — ${verdict}`
  );
  if (runs > 1) console.log(`parity: OK — ${runs} CLI runs produced the same report JSON (${reference.length} bytes)`);
  if (flags.keep) console.log(`kept: ${scratch}`);
  else if (ownScratch) rmSync(scratch, { recursive: true, force: true });
  return verdict === "PASS" ? 0 : 1;
}

// Runs only when executed directly, so the deterministic helpers can be imported.
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

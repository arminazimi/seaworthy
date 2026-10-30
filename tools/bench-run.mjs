// Runs the agent benchmark task suite and scores it: planning/bench/tasks.json (#101) in, a
// per-task verdict out. This is `bench.runner` (#102) — it owns execution and scoring only.
//
// The contract is #101's and is consumed, never redefined (planning/bench/README.md):
//   - each task gets its own temp workspace: task.start copied to <workspace>/site, every
//     task.seeds[] copied to <workspace>/<file>;
//   - each criterion runs from <workspace> as `node packages/verify/dist/src/cli.js <argv…>`
//     through tools/bench-tasks.mjs' runCriterion — an argv array, no shell;
//   - the verdict is the exit code alone: a criterion passes when it equals expect_exit
//     (0 clean, 1 findings at or above --fail-on, 2 usage, 4 crash — cli/types.ts);
//   - a task is solved when every one of its criteria passes.
//
// No agent is under test here. The benchmark needs a known-solved state to score against, so
// each task carries a scripted reference solution below: the edits a correct agent would make,
// applied inside the temp workspace. Seaworthy reports and suggests and never rewrites the
// user's site, so the "fix" step is this scripted edit — the CLI is only ever asked for its
// verdicts and for `fix --dry-run` previews, and the runner checks that no workspace file
// changed while it ran. Where a reference solution genuinely cannot clear a task's gate the
// runner prints the unresolved findings instead of loosening the gate.
//
// Fully offline and deterministic: no network, no installs, no writes outside its temp dirs,
// no timestamps or absolute paths in --json. Only the flags #101 allows a criterion to use
// (--fail-on/--base/--baseline) reach the CLI, and the validator rejects anything else.
//
// Usage:
//   node tools/bench-run.mjs                    # score the shipped suite, text output
//   node tools/bench-run.mjs --json             # deterministic JSON for CI diffing
//   node tools/bench-run.mjs --task images…     # one task (repeatable)
//   node tools/bench-run.mjs --list             # the plan without running the CLI
//
// Exit code: 0 when every scored task is solved, 1 otherwise, 2 on a usage error.

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import { loadTasks, runCriterion, TASKS_FILE, WORKSPACE_FOLDER } from "./bench-tasks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(root, "packages/verify/dist/src/cli.js");

/** Severity order for the diagnostics a failed gate prints; mirrors the CLI's own levels. */
const SEVERITIES = ["note", "warning", "error", "critical"];

// ── reference solutions ───────────────────────────────────────────────────────────────────
// One entry per shipped task id. Ops are applied inside the temp workspace, in order:
//   { write: rel, contents }        create/replace a workspace file
//   { replace: rel, find, with }     one exact substring swap (fails loudly if it does not fit,
//                                    so a fixture drift cannot score as a silent pass)
//   { remove: rel }                  delete a workspace file
// Paths are workspace-root-relative (`site/index.html`), matching how findings locate files.

const CLEAN_HEAD = (title, description) =>
  `  <meta charset="utf-8">\n` +
  `  <meta name="viewport" content="width=device-width, initial-scale=1">\n` +
  `  <title>${title}</title>\n` +
  `  <meta name="description" content="${description}">\n`;

/** A not-found page the checks accept: real content, no redirect, reachable home link. */
const notFoundPage = (lang, dir, title, body, home) =>
  `<!doctype html>\n<html lang="${lang}"${dir ? ` dir="${dir}"` : ""}>\n<head>\n${CLEAN_HEAD(title, "What to do when an address on this site does not exist.")}</head>\n<body>\n  <main id="main">\n    <h1>${body.h1}</h1>\n    <p>${body.p} <a href="${home}">${body.link}</a>.</p>\n  </main>\n</body>\n</html>\n`;

export const REFERENCE_SOLUTIONS = {
  "fix-broken-links": [
    { replace: "site/index.html", find: `href="/docs/guid.html"`, with: `href="/docs/guide.html"` },
    { replace: "site/index.html", find: `href="/blog/post.html#missing-section"`, with: `href="/blog/post.html#intro"` },
    { replace: "site/index.html", find: `href="blog/psot.html"`, with: `href="blog/post.html"` },
    { replace: "site/index.html", find: `href="/docs/guide.html#instal"`, with: `href="/docs/guide.html#install"` },
  ],

  "restore-missing-assets": [
    // Restore what the build never emitted, and repoint the two typos at the real files.
    { write: "site/css/missing.css", contents: "/* restored by the build */\n" },
    { write: "site/img/big.png", contents: "not a real png, but a file that exists" },
    { write: "site/media/poster.jpg", contents: "not a real jpeg, but a file that exists" },
    { write: "site/media/captions.vtt", contents: "WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nWelcome.\n" },
    { replace: "site/index.html", find: `src="/js/ap.js"`, with: `src="/js/app.js"` },
    { replace: "site/index.html", find: `src="/img/logo.pn"`, with: `src="/img/logo.png"` },
    {
      replace: "site/index.html",
      find: `<video src="/media/clip.mp4" poster="/media/poster.jpg"></video>`,
      with: `<video src="/media/clip.mp4" poster="/media/poster.jpg" width="320" height="180">\n<track src="/media/captions.vtt" kind="captions" srclang="en" label="English">\n</video>`,
    },
  ],

  "fix-image-alternatives": [
    { replace: "site/index.html", find: `<img src="/img/a.png">\n<img src="/img/b.gif"`, with: `<img src="/img/a.png" alt="Seaworthy mark" width="40" height="30">\n<img src="/img/b.gif"`, },
    { replace: "site/index.html", find: `<img\n  src="/img/a.png"\n  width="40" height="30"\n>`, with: `<img\n  src="/img/a.png"\n  alt="Seaworthy mark again"\n  width="40" height="30"\n>` },
  ],

  "add-not-found-page": [
    { replace: "site/index.html", find: `  <meta charset="utf-8">\n`, with: CLEAN_HEAD("Site", "A small site that now ships a real not-found page.") },
    {
      write: "site/404.html",
      contents: notFoundPage("en", "", "404 / Page not found", { h1: "Page not found", p: "The address does not exist on this site.", link: "go to the home page" }, "/"),
    },
  ],

  "add-missing-translation": [
    // Build the promised German pages, complete the hreflang sets, and clear every warning.
    {
      write: "site/index.html",
      contents: `<!doctype html>\n<html lang="en">\n<head>\n${CLEAN_HEAD("Home", "The home page of the English/German site.")}` +
        `<link rel="alternate" hreflang="en" href="/index.html">\n` +
        `<link rel="alternate" hreflang="de" href="/de/index.html">\n` +
        `<link rel="alternate" hreflang="x-default" href="/index.html">\n</head>\n<body>\n` +
        `  <a href="#main">Skip to main content</a>\n` +
        `  <header><nav><a href="/about.html">About</a> <a href="/legal.html">Legal</a> <a href="/de/index.html">Deutsch</a> <a href="/de/about.html">Über uns</a> <a href="/de/legal.html">Rechtliches</a></nav></header>\n` +
        `  <main id="main"><h1>Home</h1><p>Read this page in <a href="/de/index.html">German</a>.</p></main>\n</body>\n</html>\n`,
    },
    {
      write: "site/about.html",
      contents: `<!doctype html>\n<html lang="en">\n<head>\n${CLEAN_HEAD("About", "About this site, in English.")}` +
        `<link rel="alternate" hreflang="en" href="/about.html">\n` +
        `<link rel="alternate" hreflang="de" href="/de/about.html">\n` +
        `<link rel="alternate" hreflang="x-default" href="/about.html">\n</head>\n<body>\n` +
        `  <main id="main"><h1>About</h1><p>Die deutsche Version dieser Seite ist da. <a href="/de/about.html">Deutsch</a>.</p></main>\n</body>\n</html>\n`,
    },
    {
      write: "site/de/about.html",
      contents: `<!doctype html>\n<html lang="de">\n<head>\n${CLEAN_HEAD("Über uns", "Über diese Seite, auf Deutsch.")}` +
        `<link rel="alternate" hreflang="de" href="/de/about.html">\n` +
        `<link rel="alternate" hreflang="en" href="/about.html">\n` +
        `<link rel="alternate" hreflang="x-default" href="/about.html">\n</head>\n<body>\n` +
        `  <main id="main"><h1>Über uns</h1><p>Zurück zur <a href="/de/index.html">Startseite</a> oder auf <a href="/about.html">Englisch</a> lesen.</p></main>\n</body>\n</html>\n`,
    },
    {
      write: "site/legal.html",
      contents: `<!doctype html>\n<html lang="en">\n<head>\n${CLEAN_HEAD("Legal", "The legal notice of this site, in English.")}` +
        `<link rel="alternate" hreflang="en" href="/legal.html">\n` +
        `<link rel="alternate" hreflang="de" href="/de/legal.html">\n` +
        `<link rel="alternate" hreflang="x-default" href="/legal.html">\n</head>\n<body>\n` +
        `  <main id="main"><h1>Legal</h1><p>The German version is <a href="/de/legal.html">Rechtliches</a>.</p></main>\n</body>\n</html>\n`,
    },
    {
      write: "site/de/legal.html",
      contents: `<!doctype html>\n<html lang="de">\n<head>\n${CLEAN_HEAD("Rechtliches", "Der rechtliche Hinweis dieser Seite auf Deutsch.")}` +
        `<link rel="alternate" hreflang="de" href="/de/legal.html">\n` +
        `<link rel="alternate" hreflang="en" href="/legal.html">\n` +
        `<link rel="alternate" hreflang="x-default" href="/legal.html">\n</head>\n<body>\n` +
        `  <main id="main"><h1>Rechtliches</h1><p>Zurück zur <a href="/de/index.html">Startseite</a>.</p></main>\n</body>\n</html>\n`,
    },
    { replace: "site/de/index.html", find: `<head><meta charset="utf-8"><title>Startseite</title>`, with: `<head>\n${CLEAN_HEAD("Startseite", "Die Startseite dieser zweisprachigen Website.")}` },
    {
      write: "site/404.html",
      contents: notFoundPage("en", "", "404 / Page not found", { h1: "Page not found", p: "The address does not exist on this site.", link: "start at the home page" }, "/"),
    },
  ],

  "mirror-rtl-page": [
    {
      write: "site/index.html",
      contents: `<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n${CLEAN_HEAD("متجر", "متجر صغير؛ الصفحة تعمل من اليمين إلى اليسار.")}</head>\n<body>\n` +
        `  <main id="main">\n    <h1>متجر</h1>\n    <p>السلام عليكم: <span dir="ltr">welcome to our store</span></p>\n  </main>\n</body>\n</html>\n`,
    },
    { write: "site/main.css", contents: ".nav { border-inline-start: 1px solid black; }\n" },
    {
      write: "site/404.html",
      contents: notFoundPage("ar", "rtl", "٤٠٤ / الصفحة غير موجودة", { h1: "الصفحة غير موجودة", p: "هذا العنوان لا يوجد في هذا الموقع.", link: "الانتقال إلى الصفحة الرئيسية" }, "/"),
    },
  ],

  "make-agent-readable": [
    {
      write: "site/llms.txt",
      contents: `# Example Docs\n\n> Guides for Example.\n\n## Guides\n\n` +
        `- [Getting started](/docs/start.md): install and first run\n` +
        `- [Configuration reference](/docs/config.md): the settings you can change\n\n## Optional\n\n` +
        `- [Home](/): the front page\n`,
    },
    { write: "site/docs/config.md", contents: "# Configuration\n\nEvery setting the site reads, and what it changes.\n" },
    { write: "site/llms-full.txt", contents: "# Example Docs\n\n## Getting started\n\nInstall and first run.\n\n## Configuration\n\nThe settings you can change.\n" },
    { replace: "site/index.html", find: `  <meta charset="utf-8">\n`, with: CLEAN_HEAD("llms.txt", "A site whose llms.txt now resolves inside the build.") },
    {
      write: "site/404.html",
      contents: notFoundPage("en", "", "404 / Page not found", { h1: "Page not found", p: "The address does not exist on this site.", link: "start at the home page" }, "/"),
    },
  ],

  "migrate-base-url": [
    // Migrate at the root: every /seaworthy/ prefix goes, so resolution and the base path agree.
    { replace: "site/index.html", find: `href="/seaworthy/docs/guide.html"`, with: `href="/docs/guide.html"` },
    { replace: "site/index.html", find: `href="/seaworthy/about.html"`, with: `href="/about.html"` },
    { replace: "site/index.html", find: `href="/seaworthy/docs/"`, with: `href="/docs/"` },
    { replace: "site/index.html", find: `href="/seaworthy/"`, with: `href="/"` },
  ],

  "pass-baseline-gate": [
    // The baseline is untouched; the page people visit now links the draft, and every warning is gone.
    { replace: "site/index.html", find: `<body>\n<p><a href="/about.html">About</a></p>`, with: `<body>\n<main id="main">\n<h1>Home</h1>\n<p><a href="/about.html">About</a></p>\n</main>` },
    { replace: "site/index.html", find: `<head><meta charset="utf-8"><title>Home</title></head>`, with: `<head>\n${CLEAN_HEAD("Home", "The home page of the small project site.")}</head>` },
    { replace: "site/about.html", find: `<p><a href="/">Home</a></p>`, with: `<main id="main">\n<h1>About</h1>\n<p><a href="/">Home</a> and the <a href="/draft.html">draft</a>.</p>\n</main>` },
    { replace: "site/about.html", find: `<head><meta charset="utf-8"><title>About</title></head>`, with: `<head>\n${CLEAN_HEAD("About", "About the small project site.")}</head>` },
    {
      write: "site/draft.html",
      contents: `<!doctype html>\n<html lang="en">\n<head>\n${CLEAN_HEAD("Draft", "A working draft page, linked from About.")}</head>\n<body>\n<main id="main">\n<h1>Draft</h1>\n<p><a href="/about.html">Back to About</a></p>\n</main>\n</body>\n</html>\n`,
    },
    {
      write: "site/404.html",
      contents: `<!doctype html>\n<html lang="en">\n<head>\n${CLEAN_HEAD("404 / Page not found", "What to do when an address on this site does not exist.")}</head>\n<body>\n<main id="main">\n<h1>Page not found</h1>\n<p>The address does not exist here. <a href="/">Home</a>.</p>\n</main>\n</body>\n</html>\n`,
    },
  ],

  "ship-zero-findings": [
    // The strictest gate leaves nothing: notes count too, so every head tag is filled in.
    {
      write: "site/index.html",
      contents: `<!doctype html>\n<html lang="en">\n<head>\n${CLEAN_HEAD("Site", "A two-page site shipped with zero findings.")}` +
        `  <link rel="canonical" href="https://example.test/">\n` +
        `  <meta property="og:title" content="Site">\n` +
        `  <meta property="og:description" content="A two-page site shipped with zero findings.">\n` +
        `  <meta property="og:image" content="https://example.test/logo.png">\n` +
        `  <meta property="og:url" content="https://example.test/">\n` +
        `  <meta name="twitter:card" content="summary_large_image">\n</head>\n<body>\n` +
        `  <a href="#main">Skip to main content</a>\n` +
        `  <header><nav><a href="/404.html">Help</a></nav></header>\n` +
        `  <main id="main"><h1 id="top">Site</h1><p>A two-page site with nothing left to fix.</p>\n` +
        `  <img src="/logo.png" alt="Seaworthy logo" width="64" height="64">\n` +
        `  <p><a href="#top">Back to top</a></p></main>\n</body>\n</html>\n`,
    },
    {
      write: "site/404.html",
      contents: `<!doctype html>\n<html lang="en">\n<head>\n${CLEAN_HEAD("404 / Page not found", "What to do when an address on this site does not exist.")}` +
        `  <link rel="canonical" href="https://example.test/404.html">\n` +
        `  <meta property="og:title" content="Page not found">\n` +
        `  <meta property="og:description" content="The address does not exist. Start from the home page.">\n` +
        `  <meta property="og:image" content="https://example.test/logo.png">\n` +
        `  <meta property="og:url" content="https://example.test/404.html">\n` +
        `  <meta name="twitter:card" content="summary_large_image">\n</head>\n<body>\n` +
        `  <a href="#main">Skip to main content</a>\n` +
        `  <main id="main"><h1>Page not found</h1>\n` +
        `  <p>The address does not exist on this site. Start from the <a href="/">home page</a>.</p></main>\n</body>\n</html>\n`,
    },
    { write: "site/logo.png", contents: "not a real png, but a file that exists" },
    {
      write: "site/llms.txt",
      contents: `# Site\n\n> A two-page site shipped with zero findings.\n\n## Pages\n\n- [Home](/): the front page\n- [Not found](/404.html): what to do when an address is wrong\n`,
    },
  ],
};

// ── workspace ─────────────────────────────────────────────────────────────────────────────

function listFiles(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/** Content hashes of every workspace file: the immutability witness for one task's runs. */
export function snapshotWorkspace(dir) {
  const map = new Map();
  for (const rel of listFiles(dir)) map.set(rel, createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex"));
  return map;
}

function mutatedFiles(before, after) {
  const out = new Set();
  for (const [rel, hash] of after) if (before.get(rel) !== hash) out.add(rel);
  for (const rel of before.keys()) if (!after.has(rel)) out.add(rel);
  return [...out].sort();
}

/** #101's workspace contract: start site into <workspace>/site, seeds beside it. */
export function buildWorkspace(task, sourceRoot = root, mkDir = () => mkdtempSync(join(tmpdir(), "seaworthy-bench-run-"))) {
  const dir = mkDir();
  cpSync(join(sourceRoot, task.start), join(dir, WORKSPACE_FOLDER), { recursive: true });
  for (const seed of task.seeds ?? []) cpSync(join(sourceRoot, seed.from), join(dir, seed.file));
  return dir;
}

/** The scripted edit a correct agent would have made. Throws if an op no longer fits. */
export function applySolution(dir, ops) {
  for (const op of ops) {
    if (op.remove) {
      rmSync(join(dir, op.remove), { force: true });
      continue;
    }
    const target = join(dir, op.write ?? op.replace);
    if (op.write !== undefined) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, op.contents);
      continue;
    }
    const text = readFileSync(target, "utf8");
    const count = text.split(op.find).length - 1;
    if (count !== 1) {
      throw new Error(`reference solution for ${op.replace} does not apply: ${JSON.stringify(op.find)} found ${count} times, expected exactly 1`);
    }
    writeFileSync(target, text.replace(op.find, op.with));
  }
}

// ── scoring ───────────────────────────────────────────────────────────────────────────────

const failOnLevel = (argv) => {
  const i = argv.indexOf("--fail-on");
  return i === -1 ? "error" : argv[i + 1];
};

/** Verify's findings at or above the criterion's gate: why a red gate is still red. */
function unresolvedFindings(dir, level) {
  const result = spawnSync(process.execPath, [CLI, "verify", WORKSPACE_FOLDER, "--format", "json", "--fail-on", "none"], { cwd: dir, encoding: "utf8" });
  if (result.error) throw new Error(`diagnostic verify could not run in ${dir}: ${result.error.message}`);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    return [{ checkId: "engine", severity: "error", message: `verify --format json did not return a report (exit ${result.status})` }];
  }
  const rank = SEVERITIES.indexOf(level);
  return (report.findings ?? [])
    .filter((f) => SEVERITIES.indexOf(f.severity) >= rank)
    .map((f) => ({
      checkId: f.checkId,
      severity: f.severity,
      file: f.location?.file ?? "",
      line: f.location?.line ?? null,
      message: f.message,
      fixHint: f.fix?.summary ?? "",
    }))
    .sort((a, b) => `${a.checkId}${a.file}${a.line}`.localeCompare(`${b.checkId}${b.file}${b.line}`));
}

/** `seaworthy fix <folder> --dry-run`: the suggestion preview, read only for its edit count. */
function fixPreview(dir) {
  const result = spawnSync(process.execPath, [CLI, "fix", WORKSPACE_FOLDER, "--dry-run"], { cwd: dir, encoding: "utf8" });
  if (result.error) throw new Error(`fix --dry-run could not run in ${dir}: ${result.error.message}`);
  const match = /(\d+) edits? in/.exec(result.stderr ?? "");
  return { exit: result.status, suggestedEdits: match ? Number(match[1]) : 0, diffLines: (result.stdout ?? "").split("\n").length };
}

/**
 * Score one task: build the workspace, run every criterion on the untouched start, apply the
 * scripted reference solution, run them again, and report. `verdict` is solved only when all
 * criteria match expect_exit after the edit and no CLI run touched a workspace file.
 */
export function scoreTask(task, { ops = [], sourceRoot = root, mkDir } = {}) {
  const dir = buildWorkspace(task, sourceRoot, mkDir ?? (() => mkdtempSync(join(tmpdir(), "seaworthy-bench-run-"))));
  const criteria = [];
  try {
    for (const criterion of task.criteria ?? []) {
      const before = runCriterion(criterion.argv, dir);
      criteria.push({ id: criterion.id, argv: [...criterion.argv], expectExit: criterion.expect_exit, exitBefore: before, exitAfter: null, verdict: "pending", unresolved: [] });
    }

    applySolution(dir, ops);

    const witness = snapshotWorkspace(dir);
    for (const [index, entry] of criteria.entries()) {
      entry.exitAfter = runCriterion(task.criteria[index].argv, dir);
      entry.verdict = entry.exitAfter === task.criteria[index].expect_exit ? "pass" : "fail";
    }

    for (const [index, entry] of criteria.entries()) {
      if (entry.verdict === "fail") entry.unresolved = unresolvedFindings(dir, failOnLevel(task.criteria[index].argv));
    }

    const fix = fixPreview(dir);
    // The engine records every run in <workspace>/.seaworthy/history/, stamped with the wall
    // clock, so those paths are counted and never compared or printed; everything else in the
    // workspace must be byte-identical. Seaworthy reports and suggests — it never rewrites.
    const touched = mutatedFiles(witness, snapshotWorkspace(dir));
    const isEngineHistory = (p) => p === ".seaworthy" || p.startsWith(".seaworthy/");
    const mutated = touched.filter((p) => !isEngineHistory(p));
    const solved = criteria.length > 0 && criteria.every((c) => c.verdict === "pass") && mutated.length === 0;
    return {
      id: task.id,
      title: task.title,
      criteria,
      verdict: solved ? "solved" : "unsolved",
      solvedOnStart: (task.criteria ?? []).every((c, i) => criteria[i].exitBefore === c.expect_exit),
      cliMutatedWorkspace: mutated,
      engineHistoryRuns: touched.filter(isEngineHistory).length,
      fixDryRun: fix,
      error: null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The scored plan, without running anything: task ids, criteria, gates, expected exits. */
export function planFor(data) {
  return data.tasks.map((task) => ({
    id: task.id,
    criteria: task.criteria.map((c) => ({ id: c.id, argv: [...c.argv], expectExit: c.expect_exit })),
  }));
}

/** A task that could not be scored at all: it counts as unsolved and says why. */
function unscoredTask(task, message) {
  return {
    id: task.id,
    title: task.title,
    criteria: task.criteria.map((c) => ({ id: c.id, argv: [...c.argv], expectExit: c.expect_exit, exitBefore: null, exitAfter: null, verdict: "skipped", unresolved: [] })),
    verdict: "unsolved",
    solvedOnStart: false,
    cliMutatedWorkspace: [],
    engineHistoryRuns: 0,
    fixDryRun: { exit: null, suggestedEdits: 0, diffLines: 0 },
    error: message,
  };
}

export function runSuite(data, { only = [], sourceRoot = root } = {}) {
  const tasks = [];
  for (const task of data.tasks) {
    if (only.length && !only.includes(task.id)) continue;
    const ops = REFERENCE_SOLUTIONS[task.id];
    if (!ops) {
      tasks.push(unscoredTask(task, `no scripted reference solution for task "${task.id}"`));
      continue;
    }
    try {
      tasks.push(scoreTask(task, { ops, sourceRoot, mkDir: () => mkdtempSync(join(tmpdir(), "seaworthy-bench-run-")) }));
    } catch (error) {
      tasks.push(unscoredTask(task, error.message));
    }
  }
  const criteriaTotal = tasks.reduce((sum, t) => sum + t.criteria.length, 0);
  const green = tasks.reduce((sum, t) => sum + t.criteria.filter((c) => c.verdict === "pass").length, 0);
  return {
    version: 0,
    tasksFile: TASKS_FILE,
    offline: true,
    tasks,
    summary: {
      tasks: tasks.length,
      criteria: criteriaTotal,
      solved: tasks.filter((t) => t.verdict === "solved").length,
      unsolved: tasks.filter((t) => t.verdict !== "solved").length,
      criteriaGreen: green,
      verifyRuns: tasks.reduce((sum, t) => sum + t.criteria.filter((c) => c.exitBefore !== null).length * 2, 0),
      fixPreviews: tasks.filter((t) => t.fixDryRun.exit !== null).length,
    },
  };
}

// ── output ────────────────────────────────────────────────────────────────────────────────

/** Byte-stable across runs and platforms: fixed key order, no timestamps, no temp paths. */
export function renderJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderText(report) {
  const lines = [`seaworthy bench run (offline) — ${report.summary.tasks} tasks from ${report.tasksFile}`, ""];
  for (const task of report.tasks) {
    const passed = task.criteria.filter((c) => c.verdict === "pass").length;
    const mark = task.verdict === "solved" ? "PASS" : "FAIL";
    const gate = task.solvedOnStart ? "SUITE REGRESSION: already green on the untouched start" : "red on the untouched start as #101 requires";
    lines.push(`${mark}  ${task.id.padEnd(26)} criteria ${passed}/${task.criteria.length} green on the reference solution, ${gate}, fix --dry-run exit ${task.fixDryRun.exit}: ${task.fixDryRun.suggestedEdits} suggested edit(s)`);
    if (task.error) lines.push(`      ${task.error}`);
    for (const criterion of task.criteria) {
      if (criterion.verdict === "fail") {
        lines.push(`      ${criterion.id}: ${JSON.stringify(criterion.argv)} exited ${criterion.exitAfter}, expected ${criterion.expectExit}`);
        for (const f of criterion.unresolved.slice(0, 12)) lines.push(`        [${f.severity}] ${f.checkId} ${f.file}${f.line ? `:${f.line}` : ""}: ${f.message}`);
        if (criterion.unresolved.length > 12) lines.push(`        … ${criterion.unresolved.length - 12} more findings at or above the gate`);
      }
    }
    if (task.cliMutatedWorkspace.length) lines.push(`      INVALID: a CLI run changed workspace files: ${task.cliMutatedWorkspace.join(", ")}`);
  }
  const s = report.summary;
  lines.push("", `bench run: ${s.solved}/${s.tasks} tasks solved, ${s.criteriaGreen}/${s.criteria} criteria green — ${s.verifyRuns} verify runs, ${s.fixPreviews} fix previews, no network`);
  return lines.join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: { json: { type: "boolean", default: false }, list: { type: "boolean", default: false }, task: { type: "string", multiple: true, default: [] } },
    strict: true,
  });
  let data;
  try {
    data = loadTasks();
  } catch (error) {
    console.error(`bench run: cannot read ${TASKS_FILE}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(CLI)) {
    console.error(`bench run: build the CLI first (npm run build) — ${CLI} is missing`);
    process.exitCode = 1;
    return;
  }
  if (values.list) {
    const plan = planFor(data).filter((t) => !values.task.length || values.task.includes(t.id));
    console.log(values.json ? JSON.stringify({ version: 0, tasks: plan }, null, 2) : plan.map((t) => `${t.id}\t${t.criteria.map((c) => `${c.argv.join(" ")} => exit ${c.expectExit}`).join(" ; ")}`).join("\n"));
    return;
  }
  const unknown = values.task.filter((id) => !data.tasks.some((t) => t.id === id));
  if (unknown.length) {
    console.error(`bench run: unknown task id(s): ${unknown.join(", ")}`);
    process.exitCode = 2;
    return;
  }
  const report = runSuite(data, { only: values.task });
  if (values.json) process.stdout.write(renderJson(report));
  else console.log(renderText(report));
  process.exitCode = report.summary.unsolved === 0 ? 0 : 1;
}

// Run only when executed directly, not when imported by tests (same guard as bench-tasks.mjs).
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedDirectly()) await main();

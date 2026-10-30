import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, type TestContext } from "node:test";

import { readBaseline, createBaseline } from "../src/baseline.js";
import { builtInChecks } from "../src/checks/index.js";
import { EXIT, run } from "../src/cli.js";
import { CONFIG_FILE, parseConfig } from "../src/config.js";
import { DEFAULT_FOLDERS } from "../src/folders.js";
import { AGENTS_HEADING, AGENTS_MARKER, AGENTS_SECTION, BASELINE_FILE, detectGenerator, INIT_TARGETS, planAgents, planInit, WORKFLOW_FILE as INIT_WORKFLOW_FILE } from "../src/init.js";
import { REPORT_SPEC_VERSION } from "../src/version.js";
import { makeSite } from "./helpers.js";

/** Every file in the folder, relative and forward-slashed, so sets compare the same on any OS. */
function listing(root: string): Set<string> {
  const files = new Set<string>();
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else files.add(rel.split("\\").join("/"));
    }
  };
  walk(root, "");
  return files;
}

const read = (root: string, path: string): string => readFileSync(join(root, ...path.split("/")), "utf8");

test("init with an Astro site writes exactly the three files it owns", async () => {
  const root = makeSite({ "astro.config.mjs": "import { defineConfig } from 'astro/config';\n" });
  const before = listing(root);
  const result = await run(["init"], { cwd: root });
  assert.equal(result.code, EXIT.ok);
  assert.deepEqual([...listing(root)].sort(), [...before, ...INIT_TARGETS].sort());
  assert.equal(result.stdout, [
    `seaworthy: init wrote 3 files in . (detected Astro from astro.config.mjs)`,
    `  wrote ${CONFIG_FILE} (root dist; baseline ${BASELINE_FILE})`,
    `  wrote ${INIT_WORKFLOW_FILE} (Astro: npm ci && npm run build, then seaworthy verify)`,
    `  wrote ${BASELINE_FILE} (empty, 0 entries: every finding is new and fails)`,
    `  next: commit what changed; seaworthy verify then fails only on findings the baseline does not accept`,
  ].join("\n") + "\n");
});

test("init's config is valid per the existing schema and the baseline is empty", async () => {
  const root = makeSite({ "astro.config.mjs": "" });
  await run(["init"], { cwd: root });
  assert.deepEqual(JSON.parse(read(root, CONFIG_FILE)), {
    $schema: "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
    root: "dist",
    baseline: BASELINE_FILE,
  });
  // The same rules `verify` and `config check` apply: no unknown key, no bad value.
  parseConfig(JSON.parse(read(root, CONFIG_FILE)), CONFIG_FILE, builtInChecks.map((c) => c.meta.id));
  const baseline = JSON.parse(read(root, BASELINE_FILE));
  assert.deepEqual(baseline, createBaseline([]));
  assert.deepEqual(baseline.entries, [], "the first baseline is empty: every finding is new");
  assert.equal(baseline.spec, REPORT_SPEC_VERSION);
  assert.equal(readBaseline(join(root, BASELINE_FILE)).entries.length, 0);
});

test("init's workflow builds the detected site, then verifies it", async () => {
  const root = makeSite({ "astro.config.mjs": "" });
  await run(["init"], { cwd: root });
  const workflow = read(root, INIT_WORKFLOW_FILE);
  assert.match(workflow, /^# Seaworthy CI:/);
  assert.match(workflow, /actions\/checkout@v4/);
  assert.match(workflow, /node-version: "22"/);
  assert.match(workflow, /npm ci\n {10}npm run build/);
  assert.match(workflow, /- name: Verify\n {8}run: npx seaworthy verify/);
  assert.match(workflow, /permissions:\n {2}contents: read/, "the workflow only reads the repository");
});

test("init detects Jekyll, Hugo, Docusaurus, and GitHub Pages from marker names only", async () => {
  // Jekyll with a Gemfile builds with bundler; the built site is _site.
  const jekyll = makeSite({ "Gemfile": "gem 'jekyll'\n", "_config.yml": "title: x\n" });
  const jekyllResult = await run(["init"], { cwd: jekyll });
  assert.match(jekyllResult.stdout, /detected Jekyll from _config\.yml/);
  assert.match(read(jekyll, INIT_WORKFLOW_FILE), /bundle exec jekyll build/);
  assert.equal(JSON.parse(read(jekyll, CONFIG_FILE)).root, "_site");
  // Jekyll without a Gemfile says so instead of pretending the build is pinned.
  const bareJekyll = makeSite({ "_config.yml": "" });
  await run(["init"], { cwd: bareJekyll });
  assert.match(read(bareJekyll, INIT_WORKFLOW_FILE), /# No Gemfile detected/);
  assert.match(read(bareJekyll, INIT_WORKFLOW_FILE), /gem install jekyll/);
  // Hugo builds into public via the Hugo setup action; Docusaurus builds into build.
  const hugo = makeSite({ "hugo.toml": "" });
  await run(["init"], { cwd: hugo });
  assert.match(read(hugo, INIT_WORKFLOW_FILE), /peaceiris\/actions-hugo@v3/);
  assert.equal(JSON.parse(read(hugo, CONFIG_FILE)).root, "public");
  const docusaurus = makeSite({ "docusaurus.config.js": "" });
  const docusaurusResult = await run(["init"], { cwd: docusaurus });
  assert.match(docusaurusResult.stdout, /detected Docusaurus from docusaurus\.config\.js/);
  assert.equal(JSON.parse(read(docusaurus, CONFIG_FILE)).root, "build");
  // GitHub Pages with legacy docs/ output points the config at docs instead of the defaults.
  const pages = makeSite({ "docs/.nojekyll": "" });
  const pagesResult = await run(["init"], { cwd: pages });
  assert.match(pagesResult.stdout, /detected GitHub Pages from docs\/\.nojekyll/);
  assert.equal(JSON.parse(read(pages, CONFIG_FILE)).root, "docs");
  assert.match(read(pages, INIT_WORKFLOW_FILE), /# No build step/);
});

test("init with no generator it knows still writes the three files and says so", async () => {
  const root = makeSite({ "README.md": "# my site\n", "site/index.html": "<p>hi</p>\n" });
  const result = await run(["init"], { cwd: root });
  assert.equal(result.code, EXIT.ok);
  assert.match(result.stdout, /^seaworthy: init wrote 3 files in \. \(no generator detected; looked for /);
  const config = JSON.parse(read(root, CONFIG_FILE));
  assert.ok(!("root" in config), "no fabricated root: verify keeps trying its default folders");
  assert.deepEqual(Object.keys(config).sort(), ["$schema", "baseline"]);
  const workflow = read(root, INIT_WORKFLOW_FILE);
  assert.match(workflow, /# add your build step here/);
});

test("a second init is idempotent: nothing changes and the files keep their bytes", async () => {
  const root = makeSite({ "astro.config.mjs": "" });
  await run(["init"], { cwd: root });
  const firstFiles = INIT_TARGETS.map((path) => read(root, path));
  const second = await run(["init"], { cwd: root });
  assert.equal(second.code, EXIT.ok);
  assert.match(second.stdout, /^seaworthy: init kept 3 files already present in \. \(detected Astro from astro\.config\.mjs\); use --force to rewrite the files init owns/);
  assert.equal(second.stdout.split("\n").length, 6); // lead + 3 kept lines + next, plus the empty after the trailing newline
  for (const path of INIT_TARGETS) {
    assert.equal(read(root, path), firstFiles[INIT_TARGETS.indexOf(path)], `${path} is byte-identical on the second run`);
  }
});

test("--force rewrites the files init owns but never destroys a baseline", async () => {
  const root = makeSite({ "astro.config.mjs": "" });
  await run(["init"], { cwd: root });
  const userBaseline = read(root, BASELINE_FILE);
  const forced = await run(["init", "--force"], { cwd: root });
  assert.equal(forced.code, EXIT.ok);
  assert.match(forced.stdout, /^seaworthy: init wrote 2 files, kept 1 file already present in /);
  assert.match(forced.stdout, new RegExp(`kept ${BASELINE_FILE} \\(already present; a baseline records accepted findings`));
  assert.match(forced.stdout, /wrote seaworthy\.config\.json/);
  assert.match(forced.stdout, /wrote \.github\/workflows\/seaworthy\.yml/);
  assert.equal(read(root, BASELINE_FILE), userBaseline, "init never rewrites a baseline, not even with --force");
});

test("an existing config blocks the write without destroying it", async () => {
  const root = makeSite({});
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ root: "user-owns-this" }, null, 2));
  const result = await run(["init"], { cwd: root });
  assert.equal(result.code, EXIT.ok, "a kept file is not an error: init did its job for the rest");
  assert.equal(JSON.parse(read(root, CONFIG_FILE)).root, "user-owns-this", "the user's own config is untouched");
  assert.match(result.stdout, /kept seaworthy\.config\.json \(already present/);
  // With --force the user asked for init's version, so the write happens.
  const forced = await run(["init", "--force"], { cwd: root });
  assert.match(forced.stdout, /wrote seaworthy\.config\.json/);
  assert.ok(!("root" in JSON.parse(read(root, CONFIG_FILE))), "no marker files, so init does not fabricate a root");
});

test("init never writes outside the folder it was pointed at", async () => {
  const root = makeSite({ "index.html": "<p>x</p>\n" });
  const before = listing(root);
  const result = await run(["init"], { cwd: root });
  const added = [...listing(root)].filter((path) => !before.has(path));
  assert.deepEqual(added.sort(), [...INIT_TARGETS].sort(), "only the three files init owns");
  assert.ok(!result.stdout.includes(root), "no absolute paths in the output");
});

test("init refuses usage errors and never touches a non-folder", async () => {
  const root = makeSite({});
  assert.equal((await run(["init", "--bogus"], { cwd: root })).code, EXIT.usage);
  assert.equal((await run(["init", "--force", "--force"], { cwd: root })).code, EXIT.usage);
  assert.equal((await run(["init", "a", "b"], { cwd: root })).code, EXIT.usage);
  const missing = await run(["init", "no-such-folder"], { cwd: root });
  assert.equal(missing.code, EXIT.usage);
  assert.match(missing.stderr, /^seaworthy: no-such-folder is not a folder/);
});

test("init prints help on --help and takes an explicit project folder", async () => {
  const help = await run(["init", "--help"]);
  assert.equal(help.code, EXIT.ok);
  assert.match(help.stdout, /^seaworthy init/);
  assert.match(help.stdout, /--force/);
  // An explicit project folder works the same as the default current folder.
  const root = makeSite({});
  const subdir = join(root, "project");
  mkdirSync(subdir);
  writeFileSync(join(subdir, "hugo.toml"), "");
  const result = await run(["init", "project"], { cwd: root });
  assert.equal(result.code, EXIT.ok);
  assert.match(result.stdout, /^seaworthy: init wrote 3 files in project \(detected Hugo from hugo\.toml\)/);
});

test("the planner is pure: same folder, same plan, twice", () => {
  const astro = detectGenerator(["astro.config.mjs", "Gemfile"]);
  assert.ok(astro);
  assert.deepEqual({ id: astro.id, name: astro.name, marker: astro.marker, root: astro.root }, { id: "astro", name: "Astro", marker: "astro.config.mjs", root: "dist" });
  const a = planInit(detectGenerator(["_config.yml"]));
  const b = planInit(detectGenerator(["_config.yml"]));
  assert.deepEqual(a, b);
  assert.equal(a.writes.length, INIT_TARGETS.length);
});

// --agents: the plan prints a patch for the repo's agent instructions and never applies it.

/** The patch block of an `init --agents` run -- everything from the diff header on, "" when there is none. */
const patchOf = (stdout: string): string => {
  const at = stdout.indexOf("diff --git ");
  return at === -1 ? "" : stdout.slice(at);
};

/** A folder of the caller's own files, outside this repository, for git to apply a patch in. */
function scratch(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "seaworthy-agents-"));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
  return root;
}

const gitSkip = (t: TestContext): boolean => {
  const version = spawnSync("git", ["--version"]);
  if (version.status === 0 && !version.error) return false;
  t.skip("git is not available, so the patch cannot be check-applied");
  return true;
};

/**
 * git in a folder, with line-ending conversion switched off. The patch init prints is LF text, and
 * a runner configured for CRLF checkouts would materialise CRLF from it; that is git doing its job,
 * so the test pins the conversion instead of asserting the product is byte-identical everywhere.
 */
const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-c", "core.autocrlf=false", "-c", "core.eol=lf", ...args], { cwd, encoding: "utf8" });

test("--agents prints a patch that creates AGENTS.md and writes no agent file itself", async (t: TestContext) => {
  const root = makeSite({ "astro.config.mjs": "" });
  const result = await run(["init", "--agents"], { cwd: root });
  assert.equal(result.code, EXIT.ok);
  assert.deepEqual([...listing(root)].sort(), ["astro.config.mjs", ...INIT_TARGETS].sort(), "the three files init owns, and no AGENTS.md");
  assert.match(result.stdout, /^ {2}agents: AGENTS\.md \(does not exist yet;.*`git apply` from this folder\)$/m);
  assert.ok(result.stdout.indexOf("  agents: ") < result.stdout.indexOf("  next: "), "the agent line belongs to the report, before the next step");

  const patch = patchOf(result.stdout);
  assert.ok(patch.startsWith("diff --git a/AGENTS.md b/AGENTS.md\nnew file mode 100644\n--- /dev/null\n+++ b/AGENTS.md\n@@ -0,0 +1,"), patch);
  assert.equal(patch.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length, AGENTS_SECTION.split("\n").length - 1, "every line of the section is an addition, none extra");

  if (gitSkip(t)) return;
  const copy = scratch({});
  // A work tree, because a patch that creates a file names /dev/null as its old side: outside a
  // repository git reads that as a path relative to the folder and refuses it.
  git(copy, "init", "-q");
  writeFileSync(join(copy, "agents.patch"), patch);
  const applied = git(copy, "apply", "agents.patch");
  assert.equal(applied.status, 0, `git apply rejects the new-file patch:\n${applied.stderr}`);
  assert.equal(readFileSync(join(copy, "AGENTS.md"), "utf8"), AGENTS_SECTION);
});

test("--agents appends to an existing AGENTS.md, leaves its bytes alone, and adds nothing else", async (t: TestContext) => {
  const mine = "# my project\n\nBuild with `npm run build`, then serve `dist`.\n";
  const root = makeSite({ "astro.config.mjs": "", "AGENTS.md": mine });
  const result = await run(["init", "--agents"], { cwd: root });
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), mine, "init never edits the user's agent file");
  assert.match(result.stdout, /^ {2}agents: AGENTS\.md \(the patch appends to this file and keeps every line you wrote;/m);

  const patch = patchOf(result.stdout);
  assert.ok(patch.startsWith("diff --git a/AGENTS.md b/AGENTS.md\n--- a/AGENTS.md\n+++ b/AGENTS.md\n"), patch);
  const deleted = patch.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---"));
  assert.deepEqual(deleted, [], "the patch removes no line of the user's file");

  if (gitSkip(t)) return;
  const copy = scratch({ "AGENTS.md": mine });
  writeFileSync(join(copy, "agents.patch"), patch);
  const check = git(copy, "apply", "--check", "agents.patch");
  assert.equal(check.status, 0, `git apply --check rejects the patch:\n${patch}\n${check.stderr}`);
  assert.equal(git(copy, "apply", "agents.patch").status, 0);
  assert.ok(readFileSync(join(copy, "AGENTS.md"), "utf8").startsWith(mine), "every byte the user wrote stays first");
  assert.ok(readFileSync(join(copy, "AGENTS.md"), "utf8").includes(AGENTS_HEADING));
});

test("an agent file that already carries the section gets no patch", async () => {
  const root = makeSite({ "AGENTS.md": `# my project\n\n${AGENTS_SECTION}\n` });
  const result = await run(["init", "--agents"], { cwd: root });
  assert.equal(patchOf(result.stdout), "", "a second run offers nothing to apply");
  assert.match(result.stdout, /^ {2}agents: AGENTS\.md \(already carries the Seaworthy section; nothing to add\)$/m);
  // The heading alone counts too: a person who wrote their own section is not asked to add ours.
  const byHeading = planAgents({ "AGENTS.md": `## Seaworthy verification\n\nOurs, in our own words.\n` });
  assert.deepEqual(byHeading, { target: "AGENTS.md", patch: "", summary: "already carries the Seaworthy section; nothing to add" });
});

test("CLAUDE.md is the target when the repo has no AGENTS.md, and AGENTS.md is never written", async () => {
  const root = makeSite({ "CLAUDE.md": "# rules\n" });
  const result = await run(["init", "--agents"], { cwd: root });
  assert.match(result.stdout, /^ {2}agents: CLAUDE\.md \(the patch appends to this file and keeps every line you wrote;/m);
  assert.ok(patchOf(result.stdout).startsWith("diff --git a/CLAUDE.md b/CLAUDE.md\n--- a/CLAUDE.md\n+++ b/CLAUDE.md\n"));
  assert.ok(!listing(root).has("AGENTS.md"), "no second instructions file appears behind the user's back");
  // With neither file the plan creates AGENTS.md, the file every agent reads first.
  assert.equal(planAgents({}).target, "AGENTS.md");
});

test("--agents twice prints the same patch: nothing is consumed, because nothing is written", async () => {
  const root = makeSite({ "astro.config.mjs": "", "AGENTS.md": "# my project\n" });
  await run(["init"], { cwd: root });
  const first = await run(["init", "--agents"], { cwd: root });
  const second = await run(["init", "--agents"], { cwd: root });
  assert.equal(second.stdout, first.stdout);
  assert.notEqual(patchOf(first.stdout), "");
});

test("the printed section states only what the CLI really does", () => {
  // A rename of a flag, a folder or an exit code has to show up here, not silently in the wild.
  assert.deepEqual([...DEFAULT_FOLDERS], ["dist", "build", "out", "public", "_site", "site"]);
  for (const folder of DEFAULT_FOLDERS) assert.ok(AGENTS_SECTION.includes(`\`${folder}\``), `${folder} named in the section`);
  for (const fact of ["--fail-on", "--format json", "fix <built-dir> --dry-run", "git apply", "--update-baseline", "`0` clean", "`4` an engine crash"])
    assert.ok(AGENTS_SECTION.includes(fact), `${fact} in the section`);
  assert.ok(AGENTS_SECTION.includes("never edits your files") && AGENTS_SECTION.includes("no network"), "the trust rules are stated where agents read them");
});

test("planAgents is pure and its new-file patch is the whole section", () => {
  const input = { "AGENTS.md": "# my project\n" };
  assert.deepEqual(planAgents(input), planAgents(input));
  const fresh = planAgents({});
  assert.equal(fresh.target, "AGENTS.md");
  assert.ok(fresh.patch.includes(AGENTS_MARKER));
  assert.equal(fresh.patch.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length, AGENTS_SECTION.split("\n").length - 1);
});

test("--agents is a flag: it takes no value, is passed once, and never replaces init's own files", async () => {
  const root = makeSite({ "astro.config.mjs": "" });
  assert.equal((await run(["init", "--agents", "--agents"], { cwd: root })).code, EXIT.usage);
  assert.equal((await run(["init", "--agents=on"], { cwd: root })).code, EXIT.usage);
  const usage = await run(["init", "--bogus"], { cwd: root });
  assert.match(usage.stderr, /takes only --force and --agents/);
  // With the config already present, --agents still prints its patch and writes nothing new.
  await run(["init"], { cwd: root });
  const before = listing(root);
  const again = await run(["init", "--agents"], { cwd: root });
  assert.equal(patchOf(again.stdout) === "", false);
  assert.deepEqual([...listing(root)].sort(), [...before].sort(), "no file at all beyond the three init owns");
  assert.match(again.stdout, /^seaworthy: init kept 3 files already present/);
});

test("init --agents with an explicit project folder patches that folder's file", async () => {
  const root = makeSite({});
  mkdirSync(join(root, "project"));
  writeFileSync(join(root, "project", "hugo.toml"), "");
  writeFileSync(join(root, "project", "AGENTS.md"), "# project rules\n");
  const result = await run(["init", "project", "--agents"], { cwd: root });
  assert.equal(result.code, EXIT.ok);
  assert.match(result.stdout, /^ {2}agents: AGENTS\.md \(the patch appends/m);
  assert.ok(!listing(root).has("AGENTS.md"), "the current folder's agent file is not the one patched");
  assert.ok(!listing(root).has("seaworthy.config.json"), "and no file is written outside the folder named");
});

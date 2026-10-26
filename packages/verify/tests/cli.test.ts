import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { DEFAULT_FOLDERS, EXIT, rootLabel, run } from "../src/cli.js";
import type { Check } from "../src/types.js";
import { REPORT_SPEC_VERSION, VERSION } from "../src/version.js";
import { makeSite, reportErrors } from "./helpers.js";

const PAGE = '<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body><a href="/missing.html">x</a></body></html>\n';

const problem = (severity: "error" | "warning" | "note"): Check => ({
  meta: { id: `x.${severity}`, title: `a ${severity}`, severity, needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: (ctx) => [...ctx.site.pages.values()].map((page) => ({ message: `${severity} on ${page.url}`, location: { file: page.file, line: 3, column: 7 }, fix: { kind: "manual" as const, summary: `fix the ${severity}` }, key: page.url })),
});
const crashing: Check = {
  meta: { id: "x.crash", title: "crashes", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run() {
    throw new Error("boom");
  },
};
const rendered: Check = { meta: { id: "a11y.x", title: "needs a browser", severity: "error", needs: ["html", "browser"], docs: "https://example.test/x", standards: [] }, run: () => [] };

test("--version prints the package version", async () => {
  const result = await run(["--version"]);
  assert.deepEqual([result.code, result.stdout], [EXIT.ok, `${VERSION}\n`]);
});

test("no arguments and --help print usage", async () => {
  for (const argv of [[], ["--help"], ["-h"]]) {
    const result = await run(argv);
    assert.equal(result.code, EXIT.ok);
    assert.match(result.stdout, /Usage:\n {2}seaworthy verify \[dir\]/);
    assert.match(result.stdout, /--timings +Time each stage and check/);
    assert.match(result.stdout, /Exit codes:/);
  }
});

test("unknown commands and options are usage errors", async () => {
  assert.equal((await run(["frobnicate"])).code, EXIT.usage);
  const site = makeSite({ "index.html": PAGE });
  for (const argv of [["verify", site, "--bogus"], ["verify", site, "extra"], ["verify", site, "--format"], ["verify", site, "--format", "xml"], ["verify", site, "--fail-on", "fatal"]]) {
    const result = await run(argv);
    assert.equal(result.code, EXIT.usage, argv.join(" "));
    assert.match(result.stderr, /^seaworthy: /);
    assert.equal(result.stdout, "");
  }
});

test("verify reports findings, exits 1 for errors, and prints a readable summary", async () => {
  const site = makeSite({ "index.html": PAGE, "about.html": PAGE });
  const result = await run(["verify", site], { checks: [problem("error")] });
  assert.equal(result.code, EXIT.findings);
  assert.match(result.stdout, /about\.html/);
  assert.match(result.stdout, /3:7 +error +x\.error +error on \/about\.html/);
  assert.match(result.stdout, /fix: fix the error/);
  assert.match(result.stdout, /2 findings in 2 files: 2 errors\./);
});

test("--fail-on decides the exit code", async () => {
  const site = makeSite({ "index.html": PAGE });
  const exit = async (checks: Check[], failOn?: string) => (await run(["verify", site, ...(failOn ? ["--fail-on", failOn] : [])], { checks })).code;
  assert.equal(await exit([problem("warning")]), EXIT.ok, "warnings do not fail by default");
  assert.equal(await exit([problem("warning")], "warning"), EXIT.findings);
  assert.equal(await exit([problem("note")], "warning"), EXIT.ok);
  assert.equal(await exit([problem("note")], "note"), EXIT.findings);
  assert.equal(await exit([problem("error")], "none"), EXIT.ok);
  assert.equal(await exit([]), EXIT.ok);
});

test("no findings prints a clear all-clear", async () => {
  const result = await run(["verify", makeSite({ "index.html": PAGE })], { checks: [] });
  assert.equal(result.code, EXIT.ok);
  assert.match(result.stdout, /No findings\./);
});

test("--format json emits a schema-valid report with a relative root", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  const result = await run(["verify", "dist", "--format", "json"], { cwd, checks: [problem("error"), rendered] });
  const report = JSON.parse(result.stdout);
  assert.deepEqual(reportErrors(report), []);
  assert.equal(report.root, "dist");
  assert.equal(report.spec, REPORT_SPEC_VERSION);
  assert.deepEqual(report.skipped.map((s: { check: string }) => s.check), ["a11y.x"]);
  assert.ok(!result.stdout.includes(cwd), "no absolute paths in the report");
});

test("--rendered enables checks that need a browser", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  const off = JSON.parse((await run(["verify", "dist", "--format=json"], { cwd, checks: [rendered] })).stdout);
  const on = JSON.parse((await run(["verify", "dist", "--format=json", "--rendered"], { cwd, checks: [rendered] })).stdout);
  assert.equal(off.skipped.length, 1);
  assert.equal(on.skipped.length, 0);
});

test("--format markdown renders a table and caps long reports", async () => {
  const many = makeSite(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`p${String(i).padStart(2, "0")}.html`, PAGE])));
  const result = await run(["verify", many, "--format", "markdown"], { checks: [problem("error")] });
  assert.match(result.stdout, /^## Seaworthy: 60 findings in 60 files/);
  assert.match(result.stdout, /\| Severity \| Check \| Location \| Problem \|/);
  assert.match(result.stdout, /\.\.\.and 10 more\./);
  assert.equal((result.stdout.match(/^\| error \|/gm) ?? []).length, 50);
});

test("--out writes the report to a file and prints a one-line summary", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  const result = await run(["verify", "dist", "--format", "json", "--out", "reports/seaworthy.json"], { cwd, checks: [problem("error")] });
  assert.equal(result.code, EXIT.findings);
  assert.match(result.stdout, /^seaworthy: 1 finding \(1 error\); json report written to reports\/seaworthy\.json\n$/);
  assert.deepEqual(reportErrors(JSON.parse(readFileSync(join(cwd, "reports", "seaworthy.json"), "utf8"))), []);
});

test("--timings prints stages and checks to stderr and leaves stdout byte-identical", async () => {
  const site = makeSite({ "index.html": PAGE });
  const args = ["verify", site, "--format", "json"];
  const plain = await run(args, { checks: [problem("error"), rendered] });
  const timed = await run([...args, "--timings"], { checks: [problem("error"), rendered] });

  assert.equal(timed.code, plain.code);
  assert.equal(timed.stdout, plain.stdout, "stdout is unchanged, so json and sarif output stay parseable");
  assert.equal(plain.stderr, "", "timings are opt-in");
  assert.match(timed.stderr, /^seaworthy: timings\n/);
  assert.match(timed.stderr, /^ {2}total \d+\.\d ms$/m);
  for (const stage of ["site", "checks", "suppressions", "baseline", "report"]) assert.match(timed.stderr, new RegExp(`^ {2}stage ${stage} \\d+\\.\\d ms$`, "m"), stage);
  assert.match(timed.stderr, /^ {2}check x\.error \d+\.\d ms$/m);
  assert.doesNotMatch(timed.stderr, /a11y\.x/, "a skipped check is not timed");
  assert.equal(JSON.parse(timed.stdout).timings, undefined, "timings never enter the report");
});

test("--timings leaves the --out report schema-valid and unchanged", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  const args = ["verify", "dist", "--format", "json", "--out", "r.json"];
  await run(args, { cwd, checks: [problem("error")] });
  const before = readFileSync(join(cwd, "r.json"), "utf8");
  const timed = await run([...args, "--timings"], { cwd, checks: [problem("error")] });

  assert.equal(readFileSync(join(cwd, "r.json"), "utf8"), before, "the written report is unchanged");
  assert.deepEqual(reportErrors(JSON.parse(before)), []);
  assert.match(timed.stderr, /^seaworthy: timings\n/);
  assert.doesNotMatch(timed.stdout, /timings/);
});

test("--timings adds a changed stage under --changed and keeps the report out of stdout", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE, "dist/about.html": PAGE });
  const timed = await run(["verify", "dist", "--changed", "--timings", "--format", "json"], { cwd, checks: [problem("error")] });

  assert.deepEqual(
    [...timed.stderr.matchAll(/^ {2}stage (\w+) /gm)].map((match) => match[1]),
    ["site", "changed", "checks", "suppressions", "baseline", "report"],
  );
  const report = JSON.parse(timed.stdout);
  assert.deepEqual(reportErrors(report), []);
  assert.equal(report.timings, undefined);
});

test("a crashing check exits 4 and is listed, while other checks still report", async () => {
  const result = await run(["verify", makeSite({ "index.html": PAGE }), "--format", "json"], { checks: [crashing, problem("note")] });
  assert.equal(result.code, EXIT.internal);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.errors, [{ check: "x.crash", message: "boom" }]);
  assert.equal(report.findings.length, 1);
  assert.match(result.stderr, /1 check crashed/);
});

test("finds the build folder by default and says so when there is none", async () => {
  const cwd = makeSite({ "build/index.html": PAGE });
  const found = await run(["verify", "--format", "json"], { cwd, checks: [] });
  assert.equal(JSON.parse(found.stdout).root, "build");
  const none = await run(["verify"], { cwd: makeSite({ "src/a.txt": "x" }), checks: [] });
  assert.equal(none.code, EXIT.usage);
  assert.match(none.stderr, new RegExp(`one of ${DEFAULT_FOLDERS.join(", ")}`));
  const notDir = await run(["verify", "a.txt"], { cwd: makeSite({ "a.txt": "x" }) });
  assert.equal(notDir.code, EXIT.usage);
  assert.match(notDir.stderr, /not a folder/);
});

test("the same site gives byte-identical reports", async () => {
  const site = makeSite({ "index.html": PAGE, "a/b.html": PAGE });
  const once = () => run(["verify", site, "--format", "json"], { checks: [problem("error"), problem("warning")] }).then((r) => r.stdout);
  assert.equal(await once(), await once());
});

test("rootLabel is always relative", () => {
  assert.equal(rootLabel("/work", "/work"), ".");
  assert.equal(rootLabel("/work", "/work/dist"), "dist");
  assert.equal(rootLabel("/work", "/work/a/b"), "a/b");
  assert.equal(rootLabel("/work/x", "/work/dist"), "../dist");
});

test("report spec version starts at 0 until the contract is frozen", () => {
  assert.equal(REPORT_SPEC_VERSION, 0);
});

test("the built binary runs as a process, finds real problems, and uses exit codes", () => {
  const bin = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  assert.equal(execFileSync(process.execPath, [bin, "--version"], { encoding: "utf8" }), `${VERSION}\n`);

  // The repository's own clean fixture: the real binary with every real check must accept a correct site.
  const clean = fileURLToPath(new URL("../../../../fixtures/clean/minimal/site", import.meta.url));
  const ok = spawnSync(process.execPath, [bin, "verify", clean], { encoding: "utf8" });
  assert.equal(ok.status, EXIT.ok);
  assert.match(ok.stdout, /No findings\./);

  const broken = spawnSync(process.execPath, [bin, "verify", makeSite({ "index.html": PAGE })], { encoding: "utf8" });
  assert.equal(broken.status, EXIT.findings, "the built-in links.internal check finds /missing.html");
  assert.match(broken.stdout, /links\.internal +Link to \/missing\.html points to a page that does not exist/);

  const bad = spawnSync(process.execPath, [bin, "verify", join(clean, "nope")], { encoding: "utf8" });
  assert.equal(bad.status, EXIT.usage);
});


const imgCheck: Check = {
  meta: { id: "images.alt", title: "Image has no alt", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: (ctx) => [...ctx.site.pages.values()].filter((p) => p.source.includes("<img src=")).map((p) => ({ message: "no alt", location: { file: p.file, line: 1 }, fix: { kind: "manual" as const, summary: "add alt" }, key: p.url })),
};
const IMG = '<!doctype html><title>t</title><img src="a.png">';

test("seaworthy.config.json is picked up: root, failOn, and severity overrides", async () => {
  const cwd = makeSite({
    "site/index.html": IMG,
    "seaworthy.config.json": JSON.stringify({ root: "site", failOn: "none", checks: { "images.alt": "warning" } }),
  });
  const result = await run(["verify", "--format", "json"], { cwd, checks: [imgCheck] });
  const report = JSON.parse(result.stdout);
  assert.equal(report.root, "site");
  assert.deepEqual(report.summary.bySeverity, { warning: 1 });
  assert.equal(result.code, EXIT.ok, "failOn: none from the config");
  assert.equal((await run(["verify", "--fail-on", "warning"], { cwd, checks: [imgCheck] })).code, EXIT.findings, "a flag beats the config");
});

test("a bad config is a usage error that names the problem", async () => {
  const cwd = makeSite({ "site/index.html": IMG, "seaworthy.config.json": JSON.stringify({ checks: { "images.alt": "critical" } }) });
  const result = await run(["verify", "site"], { cwd, checks: [imgCheck] });
  assert.equal(result.code, EXIT.usage);
  assert.match(result.stderr, /checks\."images\.alt": got "critical"/);
  const missing = await run(["verify", "site", "--config", "nope.json"], { cwd, checks: [imgCheck] });
  assert.match(missing.stderr, /config file not found: nope\.json/);
});

test("adopting with a baseline: record once, then only new findings fail", async () => {
  const cwd = makeSite({ "dist/index.html": IMG, "dist/about.html": IMG });
  const first = await run(["verify", "dist"], { cwd, checks: [imgCheck] });
  assert.equal(first.code, EXIT.findings);

  const written = await run(["verify", "dist", "--update-baseline", "seaworthy-baseline.json"], { cwd, checks: [imgCheck] });
  assert.equal(written.code, EXIT.ok);
  assert.match(written.stdout, /baseline written to seaworthy-baseline\.json \(2 findings in 2 entries\)/);
  assert.ok(existsSync(join(cwd, "seaworthy-baseline.json")));

  const adopted = await run(["verify", "dist", "--baseline", "seaworthy-baseline.json", "--format", "json"], { cwd, checks: [imgCheck] });
  assert.equal(adopted.code, EXIT.ok);
  assert.deepEqual(JSON.parse(adopted.stdout).summary.baselined, 2);

  writeFileSync(join(cwd, "dist", "new.html"), IMG);
  const grown = await run(["verify", "dist", "--baseline", "seaworthy-baseline.json", "--format", "json"], { cwd, checks: [imgCheck] });
  assert.equal(grown.code, EXIT.findings);
  assert.deepEqual(JSON.parse(grown.stdout).findings.map((f: { location: { file: string } }) => f.location.file), ["new.html"]);
});

test("baseline flag mistakes are usage errors with a way forward", async () => {
  const cwd = makeSite({ "dist/index.html": IMG });
  const missing = await run(["verify", "dist", "--baseline", "nope.json"], { cwd, checks: [imgCheck] });
  assert.equal(missing.code, EXIT.usage);
  assert.match(missing.stderr, /baseline file not found: nope\.json\. Create it with --update-baseline nope\.json/);
  const both = await run(["verify", "dist", "--baseline", "a.json", "--update-baseline", "b.json"], { cwd, checks: [imgCheck] });
  assert.match(both.stderr, /not both/);
  writeFileSync(join(cwd, "bad.json"), "{}");
  assert.equal((await run(["verify", "dist", "--baseline", "bad.json"], { cwd, checks: [imgCheck] })).code, EXIT.usage);
});

test("the baseline named in the config is used", async () => {
  const cwd = makeSite({ "dist/index.html": IMG });
  await run(["verify", "dist", "--update-baseline", "b.json"], { cwd, checks: [imgCheck] });
  writeFileSync(join(cwd, "seaworthy.config.json"), JSON.stringify({ baseline: "b.json" }));
  assert.equal((await run(["verify", "dist"], { cwd, checks: [imgCheck] })).code, EXIT.ok);
});

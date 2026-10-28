import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { buildIssues, concurrentPairs, loadBriefs, parseBriefFiles, preview } from "./build.mjs";
import { parseRoadmap } from "./parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const real = readFileSync(join(here, "..", "..", "ROADMAP.md"), "utf8");

// The sample is a partial roadmap: skip whole-roadmap completeness checks.
const PARTIAL = { done: {}, strict: false };

const SAMPLE = `
| Phase | Dates | Theme | Release |
|---|---|---|---|
| Phase 0 | 2026-10-19 → 2026-11-01 | Foundations | none |

\`\`\`\`markdown
<!-- seaworthy-roadmap-key: ignored.example -->
## Epic: Inside a fence
\`\`\`\`

# Phase 0 — Foundations (2026-10-19 → 2026-11-01)

## Epic: Repository
<!-- seaworthy-roadmap-key: E-foundation -->
> **Epic** · **Phase:** Phase 0 — Foundations (2026-10-19 → 2026-11-01) · **Track:** verify

### Outcome
A repository people can contribute to.

### Scope
- One check command

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| \`foundation.layout\` | Create the layout | strong-agent | S | none |
| \`foundation.check\` | Add the check | free-agent | XS | \`foundation.layout\` |

### Exit criteria
- [ ] Check passes.

# Metrics
`;

// Adds a dependency chain (check → ci → release) and two independent tasks next to the SAMPLE.
const PARALLEL_SAMPLE = SAMPLE.replace(
  "| `foundation.check` | Add the check | free-agent | XS | `foundation.layout` |",
  [
    "| `foundation.check` | Add the check | free-agent | XS | `foundation.layout` |",
    "| `foundation.ci` | Run CI | free-agent | XS | `foundation.check` |",
    "| `foundation.release` | Cut a release | free-agent | XS | `foundation.ci` |",
    "| `foundation.docs` | Write docs | free-agent | XS | none |",
    "| `foundation.notes` | Write notes | free-agent | XS | none |",
    "| `foundation.blank` | Do something else | free-agent | XS | none |",
  ].join("\n"),
);

const briefWithFiles = (...files) =>
  ["## Goal", "Do it.", "", "## Agent brief", "", "**Files**", ...files.map((file) => `- \`${file}\``), "", "**Steps**", "1. Do it."].join(
    "\n",
  );

const PARALLEL_BRIEFS = new Map([
  ["foundation.layout", briefWithFiles("docs/shared.md", "docs/ordered.md", "docs/extra.md")],
  ["foundation.check", briefWithFiles("docs/ordered.md")],
  ["foundation.ci", briefWithFiles("docs/ordered.md")],
  ["foundation.release", briefWithFiles("docs/ordered.md")],
  ["foundation.docs", briefWithFiles("docs/shared.md", "docs/extra.md")],
  ["foundation.notes", "## Goal\nWrite notes.\n\n## Agent brief\n\n**Steps**\n1. Write them."],
]);

test("parses phases, epics, and tasks, and ignores fenced examples", () => {
  const { phases, epics, tasks, errors } = parseRoadmap(SAMPLE);
  assert.deepEqual(errors, []);
  assert.equal(phases.length, 1);
  assert.deepEqual(phases[0], { id: "Phase 0", start: "2026-10-19", end: "2026-11-01", title: "Foundations", release: "none" });
  assert.equal(epics.length, 1);
  assert.equal(epics[0].key, "E-foundation");
  assert.equal(epics[0].track, "verify");
  assert.equal(epics[0].outcome, "A repository people can contribute to.");
  assert.deepEqual(epics[0].scope, ["One check command"]);
  assert.deepEqual(epics[0].exit, ["Check passes."]);
  assert.deepEqual(
    tasks.map((t) => [t.key, t.lane, t.size, t.deps, t.epic]),
    [
      ["foundation.layout", "strong-agent", "S", [], "E-foundation"],
      ["foundation.check", "free-agent", "XS", ["foundation.layout"], "E-foundation"],
    ],
  );
});

test("builds labels and bodies with unresolved references for apply.mjs", () => {
  const { issues, errors } = buildIssues(SAMPLE, new Map(), PARTIAL);
  assert.deepEqual(errors, []);
  const check = issues.find((i) => i.key === "foundation.check");
  assert.ok(check.labels.includes("lane: free-agent"));
  assert.ok(check.labels.includes("size: XS"));
  assert.ok(check.labels.includes("track: verify"));
  assert.ok(check.labels.includes("help wanted"));
  assert.ok(!check.labels.includes("good first issue"), "good first issue requires a brief");
  assert.match(check.body, /<!-- seaworthy-roadmap-key: foundation\.check -->/);
  assert.match(check.body, /## Depends on\n- \{\{ref:foundation\.layout\}\}/);
  const epic = issues.find((i) => i.key === "E-foundation");
  assert.equal(epic.title, "Epic: Repository");
  assert.match(epic.body, /- \[ \] \{\{ref:foundation\.layout\}\}/);
});

test("a brief replaces the generic section and earns good first issue", () => {
  const briefs = new Map([["foundation.check", "## Goal\nAdd it.\n\n## Done when\n- [ ] It runs."]]);
  const { issues, errors } = buildIssues(SAMPLE, briefs, PARTIAL);
  assert.deepEqual(errors, []);
  const check = issues.find((i) => i.key === "foundation.check");
  assert.ok(check.labels.includes("good first issue"));
  assert.ok(!check.labels.includes("status: needs-brief"));
  assert.match(check.body, /## Goal\nAdd it\./);
  assert.doesNotMatch(check.body, /no detailed brief yet/);
});

test("parses only the bullet paths under **Files**", () => {
  const brief = [
    "## Agent brief",
    "",
    "**Files**",
    "- `packages/a.ts` (new)",
    "- docs/README.md (add the row)",
    "",
    "**Steps**",
    "1. Do it.",
    "",
    "**Files**",
    "- ignored.md",
  ].join("\n");
  assert.deepEqual(parseBriefFiles(brief), ["packages/a.ts", "docs/README.md"]);
  assert.deepEqual(parseBriefFiles("## Goal\nNo files here."), []);
  assert.deepEqual(parseBriefFiles("**Files**\n\n**Steps**\n- nope"), []);
});

test("concurrentPairs treats only reachable tasks as ordered", () => {
  const tasks = [
    { key: "a", deps: [] },
    { key: "b", deps: ["a"] },
    { key: "c", deps: ["b"] },
    { key: "d", deps: [] },
  ];
  assert.deepEqual(concurrentPairs(tasks), [
    ["a", "d"],
    ["b", "d"],
    ["c", "d"],
  ]);
});

test("warns once per shared file between concurrent tasks", () => {
  const { warnings, conflicts, errors } = buildIssues(PARALLEL_SAMPLE, PARALLEL_BRIEFS, PARTIAL);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    conflicts.map((c) => [c.tasks, c.path]),
    [
      [["foundation.layout", "foundation.docs"], "docs/shared.md"],
      [["foundation.layout", "foundation.docs"], "docs/extra.md"],
    ],
  );
  assert.equal(warnings.length, 2);
  for (const warning of warnings) {
    assert.match(warning, /foundation\.layout/);
    assert.match(warning, /foundation\.docs/);
    assert.match(warning, /docs\/(shared|extra)\.md/);
  }
  assert.ok(!warnings.some((w) => w.includes("docs/ordered.md")), "a dependency chain is not concurrent");
  assert.ok(!warnings.some((w) => w.includes("foundation.notes")), "a brief without Files is ignored");
  assert.ok(!warnings.some((w) => w.includes("foundation.blank")), "a task without a brief is ignored");
});

test("preview includes the conflict map", () => {
  const result = buildIssues(PARALLEL_SAMPLE, PARALLEL_BRIEFS, PARTIAL);
  const markdown = preview(result);
  const map = markdown.split("## Conflict map")[1]?.split("## Sample bodies")[0] ?? "";
  assert.match(map, /foundation\.layout/);
  assert.match(map, /foundation\.docs/);
  assert.match(map, /docs\/shared\.md/);
  assert.match(map, /docs\/extra\.md/);
  assert.doesNotMatch(map, /docs\/ordered\.md/);
});

test("reports unknown dependencies, bad lanes, and cycles", () => {
  const broken = SAMPLE.replace("| strong-agent | S | none |", "| robot | L | `foundation.check` |").replace(
    "| `foundation.layout` |\n",
    "| `missing.task` |\n",
  );
  const { errors } = buildIssues(broken, new Map(), PARTIAL);
  assert.ok(errors.some((e) => e.includes('unknown lane "robot"')));
  assert.ok(errors.some((e) => e.includes("size must be XS, S, or M")));
  assert.ok(errors.some((e) => e.includes("unknown dependency missing.task")));
});

test("detects dependency cycles", () => {
  const cyclic = SAMPLE.replace("| strong-agent | S | none |", "| strong-agent | S | `foundation.check` |");
  const { errors } = buildIssues(cyclic, new Map(), PARTIAL);
  assert.ok(errors.some((e) => e.startsWith("dependency cycle")));
});

test("the real ROADMAP.md and briefs build without errors", () => {
  const { issues, errors, stats } = buildIssues(real, loadBriefs());
  assert.deepEqual(errors, []);
  assert.ok(stats.epics >= 20);
  assert.ok(stats.tasks >= 100);
  for (const issue of issues) assert.ok(issue.title.length <= 256, `${issue.key}: title too long for GitHub`);
  for (const issue of issues) assert.ok(issue.body.length < 65_000, `${issue.key}: body too long for GitHub`);
});

test("items moved to the theme project are no longer in the roadmap", async () => {
  const { MOVED_TO_THEME } = await import("./status.mjs");
  const { issues } = buildIssues(real, loadBriefs());
  const keys = new Set(issues.map((i) => i.key));
  for (const key of MOVED_TO_THEME) assert.ok(!keys.has(key), `${key} is still in ROADMAP.md`);
  assert.ok(!issues.some((i) => i.labels.includes("track: theme")), "no theme track remains");
});

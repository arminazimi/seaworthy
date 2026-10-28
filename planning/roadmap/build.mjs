// Builds the roadmap issue set from ROADMAP.md, validates it, and writes a local preview.
//
//   node planning/roadmap/build.mjs           # validate and write planning/roadmap/out/
//   node planning/roadmap/build.mjs --check   # validate only (used by `npm run check`)
//
// Output: planning/roadmap/out/{issues.json,labels.json,preview.md}. Nothing is sent to GitHub.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BUILTIN_LABELS, EPIC_AREAS, LABELS, LANES, SIZES, TRACKS, typeFor } from "./labels.mjs";
import { parseRoadmap } from "./parse.mjs";
import { DONE, MOVED_TO_THEME } from "./status.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const ref = (key) => `{{ref:${key}}}`;
const marker = (key) => `<!-- seaworthy-roadmap-key: ${key} -->`;
const FOOTER_TASK =
  "<sub>Part of the Seaworthy H1 roadmap. New here? Read `CONTRIBUTING.md` and `AGENTS.md`, then comment to claim this issue. One issue = one pull request.</sub>";
const FOOTER_EPIC = "<sub>Pick any open task above whose dependencies are closed. Lane labels say who it suits.</sub>";

const DEFAULT_DONT = [
  "Do not expand scope beyond this issue; open a follow-up instead.",
  "Do not change a versioned contract (report schema, check IDs, config schema) without updating its spec and changelog.",
  "Do not add network access to checks unless the check is marked opt-in.",
];

function defaultDone(task) {
  if (task.key.startsWith("check.")) {
    return [
      "The check fires on its broken fixture and stays silent on all clean fixtures.",
      "The check has a docs page with its ID, rationale, and fix examples.",
      "`npm run check` passes.",
    ];
  }
  if (task.key.startsWith("spike.")) {
    return ["An ADR in `docs/adr/` records the question, what was tried, the decision, and its consequences.", "Spike code is deleted or clearly marked throwaway."];
  }
  if (task.lane === "maintainer") return ["The outcome is recorded in the issue (what was done, links, decisions)."];
  return ["The change does what the goal says.", "Tests cover the observable behavior.", "`npm run check` passes."];
}

/** Reads planning/roadmap/briefs/<key>.md files. */
export function loadBriefs(dir = join(here, "briefs")) {
  const briefs = new Map();
  if (!existsSync(dir)) return briefs;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    briefs.set(basename(file, ".md"), readFileSync(join(dir, file), "utf8").trim());
  }
  return briefs;
}

const BOLD_LABEL = /^\*\*[^*]+\*\*:?\s*$/;
const FILES_HEADING = /^\*\*Files:?\*\*\s*$/i;
const SECTION_HEADING = /^#{1,6}\s/;

/** Reads the bullet paths under a brief's **Files** heading. Other sections are ignored. */
export function parseBriefFiles(markdown) {
  const files = [];
  let inFiles = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!inFiles) {
      if (FILES_HEADING.test(line)) inFiles = true;
      continue;
    }
    if (BOLD_LABEL.test(line) || SECTION_HEADING.test(line)) break;
    if (!line.startsWith("- ")) continue;
    const bullet = line.slice(2).trim();
    const ticked = bullet.match(/`([^`]+)`/);
    const path = (ticked ? ticked[1] : bullet.replace(/\s+\([^)]*\)\s*$/, "")).trim();
    if (path) files.push(path);
  }
  return [...new Set(files)];
}

/**
 * Pairs of tasks that can run at the same time: neither is reachable from the other
 * through the transitive Depends graph. Same phase alone is not enough.
 */
export function concurrentPairs(tasks) {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const closure = new Map();
  const reachable = (key) => {
    if (closure.has(key)) return closure.get(key);
    const keys = new Set();
    closure.set(key, keys);
    for (const dep of byKey.get(key)?.deps ?? []) {
      keys.add(dep);
      for (const nested of reachable(dep)) keys.add(nested);
    }
    return keys;
  };
  const pairs = [];
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      const a = tasks[i].key;
      const b = tasks[j].key;
      if (!reachable(a).has(b) && !reachable(b).has(a)) pairs.push([a, b]);
    }
  }
  return pairs;
}

/** One warning per unordered concurrent pair of tasks and shared **Files** path. */
export function conflictWarnings(tasks, filesByKey) {
  const warnings = [];
  for (const [a, b] of concurrentPairs(tasks)) {
    const bFiles = new Set(filesByKey.get(b) ?? []);
    for (const path of new Set(filesByKey.get(a) ?? [])) {
      if (!bFiles.has(path)) continue;
      warnings.push({ tasks: [a, b], path, message: `${a} and ${b} can run at the same time and both list ${path}` });
    }
  }
  return warnings;
}

/**
 * Turns parsed roadmap data into issues and validates everything.
 * `strict` also requires every EPIC_AREAS entry to match an epic (off for partial test roadmaps).
 * @returns {{ issues: object[], labels: object[], phases: object[], errors: string[], stats: object }}
 */
export function buildIssues(markdown, briefs = new Map(), { done = DONE, strict = true } = {}) {
  const { phases, epics, tasks, errors } = parseRoadmap(markdown);
  const phaseById = new Map(phases.map((p) => [p.id, p]));
  const byKey = new Map();

  for (const item of [...epics, ...tasks]) {
    if (byKey.has(item.key)) errors.push(`duplicate key ${item.key}`);
    byKey.set(item.key, item);
  }
  for (const epic of epics) {
    if (!phaseById.has(epic.phase)) errors.push(`${epic.key}: phase ${epic.phase} is not in the phase table`);
    if (!EPIC_AREAS[epic.key]) errors.push(`${epic.key}: add its area labels to EPIC_AREAS in labels.mjs`);
    if (!epic.outcome) errors.push(`${epic.key}: missing ### Outcome`);
    if (!tasks.some((t) => t.epic === epic.key)) errors.push(`${epic.key}: has no tasks`);
  }
  for (const key of strict ? Object.keys(EPIC_AREAS) : []) {
    if (!epics.some((e) => e.key === key)) errors.push(`EPIC_AREAS lists ${key}, which is not an epic in ROADMAP.md`);
  }
  for (const task of tasks) {
    if (!LANES[task.lane]) errors.push(`${task.key}: unknown lane "${task.lane}"`);
    if (!SIZES[task.size]) errors.push(`${task.key}: size must be XS, S, or M (got "${task.size}")`);
    if (!task.epic) errors.push(`${task.key}: not inside an epic`);
    for (const dep of task.deps) {
      if (!byKey.has(dep)) errors.push(`${task.key}: unknown dependency ${dep}`);
      else if (byKey.get(dep).kind !== "task") errors.push(`${task.key}: depends on epic ${dep}; depend on a task instead`);
    }
  }
  for (const key of Object.keys(done)) {
    if (!byKey.has(key) || byKey.get(key).kind !== "task") errors.push(`status.mjs marks ${key} done, but it is not a task`);
  }
  for (const key of MOVED_TO_THEME) {
    if (byKey.has(key)) errors.push(`${key} is listed in MOVED_TO_THEME but is still in ROADMAP.md`);
  }
  for (const key of briefs.keys()) {
    if (!byKey.has(key) || byKey.get(key).kind !== "task") errors.push(`briefs/${key}.md does not match a task key`);
  }

  // Dependency cycles.
  const state = new Map();
  const visit = (key, path) => {
    if (state.get(key) === "done") return;
    if (state.get(key) === "active") {
      errors.push(`dependency cycle: ${[...path, key].join(" → ")}`);
      return;
    }
    state.set(key, "active");
    for (const dep of byKey.get(key)?.deps ?? []) if (byKey.has(dep)) visit(dep, [...path, key]);
    state.set(key, "done");
  };
  for (const task of tasks) visit(task.key, []);

  const filesByKey = new Map([...briefs].map(([key, brief]) => [key, parseBriefFiles(brief)]));
  const conflicts = conflictWarnings(tasks, filesByKey);
  const warnings = conflicts.map((conflict) => conflict.message);

  const phaseLine = (id) => {
    const p = phaseById.get(id);
    return p ? `${p.id} — ${p.title} (${p.start} → ${p.end})` : id;
  };

  function labelsFor(item) {
    const set = new Set(["roadmap"]);
    const epicKey = item.kind === "epic" ? item.key : item.epic;
    for (const area of EPIC_AREAS[epicKey] ?? []) set.add(area);
    if (item.track && TRACKS[item.track]) set.add(TRACKS[item.track].label);
    if (item.kind === "epic") {
      set.add("type: epic");
      return [...set];
    }
    set.add("type: task");
    const type = typeFor(item.key);
    if (type) set.add(type);
    if (LANES[item.lane]) set.add(LANES[item.lane].label);
    if (SIZES[item.size]) set.add(SIZES[item.size].label);
    if (!briefs.has(item.key) && item.lane !== "maintainer" && !done[item.key]) set.add("status: needs-brief");
    if (item.lane === "free-agent") {
      set.add("help wanted");
      if (item.size === "XS" && briefs.has(item.key)) set.add("good first issue");
    }
    return [...set];
  }

  function taskBody(task) {
    const lane = LANES[task.lane];
    const size = SIZES[task.size];
    const lines = [
      marker(task.key),
      `> **Epic:** ${ref(task.epic)} · **Phase:** ${phaseLine(task.phase)}`,
      `> **Lane:** \`${lane?.label ?? task.lane}\` — ${lane?.who ?? ""} · **Size:** ${task.size} (${size?.meaning ?? ""})`,
      "",
    ];
    const brief = briefs.get(task.key);
    if (brief) {
      lines.push(brief, "");
    } else {
      lines.push("## Goal", `${task.title.replace(/\.$/, "")}.`, "");
      lines.push("## Agent brief", "");
      if (task.lane !== "maintainer") {
        lines.push(
          "> [!NOTE]",
          "> This task has no detailed brief yet. Before opening a PR, comment with a short plan: the files you will touch, the steps, and how you will test it.",
          "",
        );
      }
      lines.push("**Do not**", ...DEFAULT_DONT.map((d) => `- ${d}`), "");
      if (task.lane !== "maintainer") lines.push("**Run**", "```bash", "npm ci", "npm run check", "```", "");
      lines.push("## Done when", ...defaultDone(task).map((d) => `- [ ] ${d}`), "");
    }
    if (task.deps.length) lines.push("## Depends on", ...task.deps.map((d) => `- ${ref(d)}`), "");
    lines.push("---", FOOTER_TASK);
    return lines.join("\n");
  }

  function epicBody(epic, children) {
    const extra = epic.header.replace(/^\*\*Epic\*\*\s*·\s*\*\*Phase:\*\*\s*[^·]+/, "").trim();
    const lines = [marker(epic.key), `> **Epic** · **Phase:** ${phaseLine(epic.phase)}${extra ? ` ${extra}` : ""}`, "", "## Outcome", epic.outcome, ""];
    if (epic.scope.length) lines.push("## Scope", ...epic.scope.map((s) => `- ${s}`), "");
    if (epic.nonGoals.length) lines.push("## Non-goals", ...epic.nonGoals.map((s) => `- ${s}`), "");
    lines.push("## Tasks", ...children.map((c) => `- [ ] ${ref(c.key)}`), "");
    if (epic.exit.length) lines.push("## Exit criteria", ...epic.exit.map((s) => `- [ ] ${s}`), "");
    lines.push("---", FOOTER_EPIC);
    return lines.join("\n");
  }

  const issues = [...epics, ...tasks].map((item) => {
    const children = tasks.filter((t) => t.epic === item.key);
    return {
      key: item.key,
      kind: item.kind,
      title: item.kind === "epic" ? `Epic: ${item.title}` : item.title,
      phase: item.phase,
      epic: item.kind === "task" ? item.epic : null,
      lane: item.lane ?? null,
      size: item.size ?? null,
      deps: item.deps ?? [],
      hasBrief: item.kind === "task" ? briefs.has(item.key) : null,
      labels: labelsFor(item),
      body: item.kind === "epic" ? epicBody(item, children) : taskBody(item),
    };
  });

  const known = new Set([...LABELS.map((l) => l.name), ...BUILTIN_LABELS]);
  for (const issue of issues) for (const l of issue.labels) if (!known.has(l)) errors.push(`${issue.key}: undefined label ${l}`);
  for (const issue of issues) for (const m of issue.body.matchAll(/\{\{ref:([^}]+)\}\}/g)) if (!byKey.has(m[1])) errors.push(`${issue.key}: unresolvable reference ${m[1]}`);

  const count = (pred) => issues.filter(pred).length;
  const stats = {
    epics: count((i) => i.kind === "epic"),
    tasks: count((i) => i.kind === "task"),
    withBrief: count((i) => i.hasBrief === true),
    byLane: Object.fromEntries(Object.keys(LANES).map((l) => [l, count((i) => i.lane === l)])),
    byPhase: Object.fromEntries(phases.map((p) => [p.id, { epics: count((i) => i.phase === p.id && i.kind === "epic"), tasks: count((i) => i.phase === p.id && i.kind === "task") }])),
  };

  return { issues, labels: LABELS, phases, errors, warnings, conflicts, stats };
}

export function preview({ issues, phases, stats, conflicts = [] }) {
  const lanes = Object.keys(LANES);
  const rows = phases.map((p) => {
    const s = stats.byPhase[p.id];
    const lane = (l) => issues.filter((i) => i.phase === p.id && i.lane === l).length;
    return `| ${p.id} | ${p.start} → ${p.end} | ${s.epics} | ${s.tasks} | ${lanes.map(lane).join(" | ")} |`;
  });
  const sampleKeys = ["E-verify", "foundation.layout", "check.links-internal", "brand.secure"];
  const conflictRows = conflicts.length
    ? ["| Tasks | File |", "|---|---|", ...conflicts.map((c) => `| \`${c.tasks.join("`, `")}\` | \`${c.path}\` |`)]
    : ["No concurrent tasks share a **Files** path."];
  return [
    "# Seaworthy H1 roadmap — issue preview",
    "",
    "Generated locally by `planning/roadmap/build.mjs` from `ROADMAP.md`. Nothing has been sent to GitHub.",
    "",
    `- Issues: **${issues.length}** (${stats.epics} epics, ${stats.tasks} tasks)`,
    `- Tasks with a detailed brief: **${stats.withBrief}** of ${stats.tasks} (the rest are labeled \`status: needs-brief\`, except maintainer tasks)`,
    `- Milestones: one per phase (${phases.length})`,
    "",
    `| Phase | Dates | Epics | Tasks | ${lanes.join(" | ")} |`,
    `|---|---|---|---|${lanes.map(() => "---").join("|")}|`,
    ...rows,
    "",
    "## Conflict map",
    "",
    "Tasks can run at the same time when neither is reachable from the other through the transitive `Depends` graph.",
    "",
    ...conflictRows,
    "",
    "## Sample bodies",
    "",
    ...sampleKeys.flatMap((k) => {
      const issue = issues.find((i) => i.key === k);
      return issue ? [`### ${issue.title}`, "", `Labels: ${issue.labels.map((l) => `\`${l}\``).join(", ")}`, "", "````markdown", issue.body, "````", ""] : [];
    }),
  ].join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  const markdown = readFileSync(join(root, "ROADMAP.md"), "utf8");
  const result = buildIssues(markdown, loadBriefs());
  if (result.errors.length) {
    console.error(result.errors.map((e) => `roadmap: ${e}`).join("\n"));
    process.exit(1);
  }
  for (const warning of result.warnings) console.warn(`roadmap warning: ${warning}`);
  const { stats } = result;
  const summary = `OK: roadmap (${result.phases.length} phases, ${stats.epics} epics, ${stats.tasks} tasks, ${stats.withBrief} with briefs)`;
  if (check) {
    console.log(summary);
    return;
  }
  const out = join(here, "out");
  mkdirSync(out, { recursive: true });
  const phases = result.phases.map((p) => ({ ...p, dueOn: `${p.end}T23:59:59Z`, description: `${p.title} (${p.start} → ${p.end}). Release: ${p.release}.` }));
  writeFileSync(join(out, "issues.json"), JSON.stringify({ phases, issues: result.issues, movedToTheme: MOVED_TO_THEME }, null, 2) + "\n");
  writeFileSync(join(out, "labels.json"), JSON.stringify(result.labels, null, 2) + "\n");
  writeFileSync(join(out, "preview.md"), preview(result) + "\n");
  console.log(summary);
  console.log(`Wrote ${join("planning", "roadmap", "out")}/{issues.json,labels.json,preview.md}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

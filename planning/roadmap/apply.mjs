// Applies the generated roadmap to GitHub. DRY RUN by default.
//
//   node planning/roadmap/apply.mjs            # print the plan, change nothing
//   node planning/roadmap/apply.mjs --apply    # sync labels, phase milestones, and issues
//
// Run `node planning/roadmap/build.mjs` first. Target repo: $SEAWORTHY_REPO or arminazimi/seaworthy.
// Each phase is its own milestone. Resumable and idempotent: issue and milestone numbers are recorded
// in out/state.json, with a digest of what was last written so unchanged issues are skipped.
// Requires: gh CLI authenticated with `repo` scope.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DONE } from "./status.mjs";

const REPO = process.env.SEAWORTHY_REPO ?? "arminazimi/seaworthy";
const DELAY_MS = 1500; // stay under GitHub secondary rate limits for content creation

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
const statePath = join(out, "state.json");
const apply = process.argv.includes("--apply");

if (!existsSync(join(out, "issues.json"))) {
  console.error("Run `node planning/roadmap/build.mjs` first.");
  process.exit(1);
}

const { phases, issues, movedToTheme = [] } = JSON.parse(readFileSync(join(out, "issues.json"), "utf8"));
const labels = JSON.parse(readFileSync(join(out, "labels.json"), "utf8"));
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
state.repo ??= REPO;
state.numbers ??= {};
state.phases ??= {};
state.written ??= {};
state.closed ??= {};
state.moved ??= {};
if (state.repo !== REPO) {
  console.error(`out/state.json belongs to ${state.repo}, not ${REPO}. Move it aside to start fresh.`);
  process.exit(1);
}

const keys = new Set(issues.map((i) => i.key));
for (const key of Object.keys(DONE)) {
  if (!keys.has(key)) {
    console.error(`status.mjs marks ${key} done, but it is not a roadmap task.`);
    process.exit(1);
  }
}

const scratch = mkdtempSync(join(tmpdir(), "seaworthy-roadmap-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");

function ghOnce(args, input) {
  if (input !== undefined) {
    const file = join(scratch, "payload.json");
    writeFileSync(file, JSON.stringify(input));
    args = [...args, "--input", file];
  }
  const text = execFileSync("gh", ["api", ...args], { encoding: "utf8", maxBuffer: 1e8, stdio: ["ignore", "pipe", "pipe"] });
  return text.trim() ? JSON.parse(text) : null;
}

const isTransient = (error) => /unexpected EOF|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timeout|HTTP 50[0-9]|HTTP 429|secondary rate limit/i.test(String(error?.stderr ?? error?.message ?? error));
const pause = (ms) => execFileSync(process.execPath, ["-e", `setTimeout(() => {}, ${ms})`]);

/** GET and PATCH are safe to repeat: retry transient failures with backoff. */
function gh(args, input) {
  for (let attempt = 1; ; attempt++) {
    try {
      return ghOnce(args, input);
    } catch (error) {
      if (attempt >= 4 || !isTransient(error)) throw error;
      console.log(`  retry ${attempt} after: ${String(error.stderr ?? error.message).trim().split("\n")[0]}`);
      pause(2000 * 2 ** attempt);
    }
  }
}

/** Finds an issue that already carries a roadmap key, among the most recently created ones. */
function findCreated(key) {
  const recent = gh([`repos/${REPO}/issues?state=all&per_page=30&sort=created&direction=desc`]);
  return recent.find((i) => (i.body ?? "").startsWith(`<!-- seaworthy-roadmap-key: ${key} -->`));
}

/**
 * Creating an issue is not safe to repeat: a request can fail after GitHub created the issue. Before each retry,
 * look for an issue with this key, so a retry never makes a duplicate.
 */
function createIssue(key, payload) {
  for (let attempt = 1; ; attempt++) {
    try {
      return ghOnce([`repos/${REPO}/issues`, "-X", "POST"], payload);
    } catch (error) {
      if (attempt >= 4 || !isTransient(error)) throw error;
      pause(2000 * 2 ** attempt);
      const existing = findCreated(key);
      if (existing) {
        console.log(`  recovered #${existing.number} for ${key}, created by the failed request`);
        return existing;
      }
      console.log(`  retry ${attempt} creating ${key}`);
    }
  }
}

function resolve(body) {
  return body.replace(/\{\{ref:([^}]+)\}\}/g, (_, key) => {
    const n = state.numbers[key];
    if (!n) throw new Error(`unresolved reference ${key}`);
    return `#${n}`;
  });
}

const newIssues = issues.filter((i) => !state.numbers[i.key]);
const toClose = Object.keys(DONE).filter((k) => !state.closed[k]);
const toMove = movedToTheme.filter((k) => state.numbers[k] && !state.moved[k]);
const roadmapKeys = new Set(issues.map((i) => i.key));
const orphaned = Object.keys(state.numbers).filter((k) => !roadmapKeys.has(k) && !movedToTheme.includes(k));
const payload = (issue) => ({ title: issue.title, body: resolve(issue.body), labels: issue.labels, milestone: state.phases[issue.phase] });
const digest = (p) => createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 16);

console.log(`${apply ? "APPLY" : "DRY RUN"} → ${REPO}`);
console.log(`- ensure ${labels.length} labels`);
for (const p of phases) console.log(`- ensure milestone "${p.id} — ${p.title}" (due ${p.end}, ${issues.filter((i) => i.phase === p.id).length} issues)`);
console.log(`- create ${newIssues.length} new issues (${newIssues.filter((i) => i.kind === "epic").length} epics, ${newIssues.filter((i) => i.kind === "task").length} tasks)`);
console.log(`- sync title, body, labels, and milestone on ${issues.length} issues (unchanged ones are skipped)`);
console.log(`- close ${toClose.length} tasks already done: ${toClose.join(", ") || "none"}`);
console.log(`- mark ${toMove.length} issues as moved to the theme project (label, no milestone, one comment; not closed)`);
if (orphaned.length) console.log(`- WARNING: ${orphaned.length} issues are no longer in ROADMAP.md and not marked moved: ${orphaned.join(", ")}`);
if (!apply) {
  console.log("\nNothing was changed. Re-run with --apply after maintainer approval.");
  process.exit(0);
}

gh([`repos/${REPO}`]); // fails fast if the repo does not exist or is not reachable

// 1. Labels
const present = new Set(gh([`repos/${REPO}/labels?per_page=100`, "--paginate"]).map((l) => l.name));
for (const l of labels) {
  if (present.has(l.name)) continue;
  gh([`repos/${REPO}/labels`, "-X", "POST"], { name: l.name, color: l.color, description: l.description.slice(0, 100) });
  console.log(`label + ${l.name}`);
}

// 2. Phase milestones, in order.
const existingMilestones = gh([`repos/${REPO}/milestones?state=all&per_page=100`]);
for (const p of phases) {
  const title = `${p.id} — ${p.title}`;
  const found = existingMilestones.find((m) => m.title === title) ?? existingMilestones.find((m) => m.title.startsWith(`${p.id} — `));
  const body = { title, description: p.description, due_on: p.dueOn };
  if (found) {
    gh([`repos/${REPO}/milestones/${found.number}`, "-X", "PATCH"], body);
    state.phases[p.id] = found.number;
  } else {
    state.phases[p.id] = gh([`repos/${REPO}/milestones`, "-X", "POST"], body).number;
    console.log(`milestone + #${state.phases[p.id]} ${title}`);
  }
  save();
}

// 3. Create new issues with placeholder bodies (references resolve in step 4).
for (const issue of newIssues) {
  const created = createIssue(issue.key, {
    title: issue.title,
    body: `<!-- seaworthy-roadmap-key: ${issue.key} -->\n_Roadmap issue is being created; details follow shortly._`,
    labels: issue.labels,
    milestone: state.phases[issue.phase],
  });
  state.numbers[issue.key] = created.number;
  save();
  console.log(`+ #${created.number} ${issue.title}`);
  await sleep(DELAY_MS);
}

// 4. Sync every issue; skip ones whose last written payload is unchanged.
for (const issue of issues) {
  const p = payload(issue);
  const d = digest(p);
  if (state.written[issue.key] === d) continue;
  gh([`repos/${REPO}/issues/${state.numbers[issue.key]}`, "-X", "PATCH"], p);
  state.written[issue.key] = d;
  save();
  console.log(`~ #${state.numbers[issue.key]} ${issue.title}`);
  await sleep(DELAY_MS / 2);
}

// 5. Close tasks that were already done, with a note saying where.
for (const key of toClose) {
  const n = state.numbers[key];
  gh([`repos/${REPO}/issues/${n}/comments`, "-X", "POST"], { body: DONE[key] });
  gh([`repos/${REPO}/issues/${n}`, "-X", "PATCH"], { state: "closed", state_reason: "completed" });
  state.closed[key] = true;
  save();
  console.log(`✓ #${n} closed (${key})`);
  await sleep(DELAY_MS / 2);
}
// 6. Issues that moved to the theme project: label them, take them out of milestones, and say so once.
for (const key of toMove) {
  const n = state.numbers[key];
  const current = gh([`repos/${REPO}/issues/${n}`]);
  const names = [...new Set([...current.labels.map((l) => l.name), "moved: theme"])];
  gh([`repos/${REPO}/issues/${n}`, "-X", "PATCH"], { labels: names, milestone: null });
  gh([`repos/${REPO}/issues/${n}/comments`, "-X", "POST"], {
    body: "This item belongs to the reference theme, which is becoming its own project (see `docs/adr/0009-theme-split-and-position.md`). It is out of Seaworthy's milestones and will be transferred to the theme repository once it exists, keeping its history.",
  });
  state.moved[key] = true;
  save();
  console.log(`→ #${n} moved: theme (${key})`);
  await sleep(DELAY_MS / 2);
}
console.log("Done.");

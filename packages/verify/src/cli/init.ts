// `seaworthy init [dir] [--force] [--agents]`: write the config, the CI workflow, and the empty
// baseline. The plan is pure (../init.ts); this layer only checks what exists, writes what the
// plan holds, and prints exactly which file it wrote or kept. Non-interactive: it never asks and
// never edits. With --agents it additionally reads one of the user's agent files and prints a
// git-apply-able patch for the verify section; it never writes that file.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { AGENTS_FILES, BASELINE_FILE, detectGenerator, INIT_MARKERS, INIT_MARKERS_HINT, planAgents, planInit, WORKFLOW_FILE, type AgentsInput, type PlanOptions } from "../init.js";
import { CONFIG_FILE } from "../config.js";
import { EXIT, rootLabel, UsageError, type CliEnvironment, type CliResult } from "./types.js";

const INIT_HELP = `seaworthy init

Create the three files that adopt Seaworthy in one step, for people and agents. It detects the
site generator from marker file names only (Jekyll, Astro, Docusaurus, Hugo, or GitHub Pages)
and writes, without editing any file of yours and without running any checks, with no writes
outside the folder you name:

  seaworthy.config.json             built site folder and the baseline, per the config schema
  .github/workflows/seaworthy.yml   the generator's build step, then \`seaworthy verify\`
  seaworthy-baseline.json           an EMPTY first baseline: today's findings are accepted by
                                    recording them with --update-baseline (docs/configuration.md),
                                    while CI fails on every new one

The workflow is commented, and the config is plain JSON (JSON has no comments and the schema
rejects unknown keys), so the guidance a commented config would carry lives in the workflow and
in the docs page.

Usage:
  seaworthy init [dir] [options]

Arguments:
  dir                  The project folder (the source, not the built site). Default: the current folder.

Options:
  --force              Overwrite seaworthy.config.json and seaworthy.yml with init's version. A second run
                       without it says "already present" and changes nothing. A baseline file that already
                       exists is never rewritten -- not even with --force -- because it records findings
                       you have accepted.
  --agents             Print, and write nothing, one unified diff that appends a "Seaworthy verification"
                       section to the repo's agent instructions: AGENTS.md when it exists, else CLAUDE.md
                       when it exists, else a new AGENTS.md. Those files are yours; init reads only the
                       chosen one and never edits it. Apply the patch yourself with \`git apply\`, run
                       from the project folder. A file that already carries the section gets no patch.
  --help, -h           Print this help

Exit codes:
  0  every file is present now (written, or kept and reported)
  2  usage error
`;

export async function initCommand(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  let dir: string | undefined;
  let force = false;
  let agents = false;
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") return { code: EXIT.ok, stdout: INIT_HELP, stderr: "" };
    if (arg === "--force") {
      if (force) throw new UsageError("pass --force once");
      force = true;
      continue;
    }
    if (arg === "--agents") {
      if (agents) throw new UsageError("pass --agents once");
      agents = true;
      continue;
    }
    if (arg.startsWith("-")) throw new UsageError(`unknown option "${arg}"; seaworthy init takes only --force and --agents`);
    if (dir !== undefined) throw new UsageError(`unexpected argument "${arg}"; init takes one folder`);
    dir = arg;
  }

  const cwd = env.cwd ?? process.cwd();
  const base = resolve(cwd, dir ?? ".");
  if (!existsSync(base) || !statSync(base).isDirectory()) throw new UsageError(`${dir ?? "."} is not a folder`);
  const label = rootLabel(cwd, base);

  // Detection reads file names only: it never opens a user file, so an unparseable
  // generator config cannot crash init.
  const present = INIT_MARKERS.filter((name) => existsSync(resolve(base, name)));
  const detected = detectGenerator(present);
  const existing: PlanOptions["existing"] = {
    [CONFIG_FILE]: existsSync(resolve(base, CONFIG_FILE)),
    [WORKFLOW_FILE]: existsSync(resolve(base, WORKFLOW_FILE)),
    [BASELINE_FILE]: existsSync(resolve(base, BASELINE_FILE)),
  };

  const plan = planInit(detected, { existing, force });
  for (const write of plan.writes) {
    for (const folder of write.dirs) mkdirSync(resolve(base, folder), { recursive: true });
    writeFileSync(resolve(base, write.path), write.content);
  }

  // --agents prints the patch for the one agent file the plan picks, and writes nothing there.
  // The other candidate is never read: init opens only the file the patch applies to.
  let agentsLine = "";
  let agentsPatch = "";
  if (agents) {
    const existingAgents = AGENTS_FILES.find((file) => existsSync(resolve(base, file)));
    const input: AgentsInput = existingAgents === undefined ? {} : existingAgents === "AGENTS.md" ? { "AGENTS.md": readFileSync(resolve(base, existingAgents), "utf8") } : { "CLAUDE.md": readFileSync(resolve(base, existingAgents), "utf8") };
    const agentsPlan = planAgents(input);
    agentsLine = `  agents: ${agentsPlan.target} (${agentsPlan.summary})`;
    agentsPatch = agentsPlan.patch;
  }

  const detection = detected === undefined ? `no generator detected; looked for ${INIT_MARKERS_HINT}` : `detected ${detected.name} from ${detected.marker}`;
  const fileWord = (n: number): string => (n === 1 ? "1 file" : `${n} files`);
  const wroteCount = plan.writes.length;
  const keptCount = plan.keeps.length;
  const lead =
    wroteCount === 0
      ? `seaworthy: init kept ${fileWord(keptCount)} already present in ${label} (${detection}); use --force to rewrite the files init owns`
      : keptCount === 0
        ? `seaworthy: init wrote ${fileWord(wroteCount)} in ${label} (${detection})`
        : `seaworthy: init wrote ${fileWord(wroteCount)}, kept ${fileWord(keptCount)} already present in ${label} (${detection})`;
  const lines = [
    lead,
    ...plan.writes.map((write) => `  wrote ${write.path} (${write.summary})`),
    ...plan.keeps.map((keep) => `  kept ${keep.path} (${keep.summary})`),
    ...(agentsLine === "" ? [] : [agentsLine]),
    `  next: ${plan.next}`,
  ];
  return { code: EXIT.ok, stdout: lines.join("\n") + "\n" + (agentsPatch === "" ? "" : "\n" + agentsPatch), stderr: "" };
}

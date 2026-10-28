// Labels a pull request `conflict` and posts one rebase prompt when it stops merging cleanly.
// Usage: REPO=owner/repo PR=123 node tools/pr-conflict.mjs   (GH_TOKEN is read by gh)
//
// Every network call goes through the `gh` CLI. The runner is injectable so tests stay offline.
// The workflow checks out the default branch only, never the pull request head.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const LABEL = "conflict";
export const MARKER = "<!-- seaworthy-conflict-bot -->";
export const LABEL_DESCRIPTION = "This pull request no longer merges cleanly with the base branch";
export const COMMENT = `${MARKER}
This pull request no longer merges cleanly with \`main\`. Rebase it on the latest main:

\`\`\`bash
git fetch origin main
git rebase origin/main
\`\`\`

Resolve the conflicts, then re-run the checks and push:

\`\`\`bash
npm run check
git push --force-with-lease
\`\`\`

If the rebase goes wrong, \`git rebase --abort\` restores the branch. The \`conflict\` label is removed automatically once the pull request merges cleanly again.`;

const ATTEMPTS = 5;
const DELAY_MS = 2000;

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw new Error(`gh ${args[0]} could not run: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`gh ${args[0]} failed (exit ${result.status})${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout;
}

function parsePull(text, repo, pr) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`gh api repos/${repo}/pulls/${pr} returned invalid JSON`);
  }
}

/**
 * Fetches the pull request, waiting out GitHub's null `mergeable`, then reconciles the
 * `conflict` label and the single rebase comment. Returns what changed.
 */
export async function main({
  repo = process.env.REPO,
  pr = process.env.PR,
  runner = gh,
  attempts = ATTEMPTS,
  delayMs = DELAY_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
} = {}) {
  if (!repo) throw new Error("REPO is not set");
  const number = Number(pr);
  if (!pr || !Number.isInteger(number) || number <= 0) throw new Error(`PR must be a positive integer, got ${pr}`);

  const pullPath = `repos/${repo}/pulls/${number}`;
  let pull;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    pull = parsePull(runner(["api", pullPath]), repo, number);
    if (typeof pull.mergeable === "boolean") break;
    if (attempt < attempts) await sleep(delayMs);
  }
  if (typeof pull.mergeable !== "boolean") {
    throw new Error(`mergeable is still unknown after ${attempts} attempts; try again when GitHub has computed it`);
  }

  const labels = (pull.labels ?? []).map((label) => label.name);
  const hasLabel = labels.includes(LABEL);

  if (pull.mergeable) {
    if (!hasLabel) {
      log("conflict: merges cleanly; no conflict label to remove");
      return { mergeable: true, labeled: false, unlabeled: false, commented: false };
    }
    runner(["api", "--method", "DELETE", `repos/${repo}/issues/${number}/labels/${LABEL}`]);
    log("conflict: merges cleanly; removed conflict label");
    return { mergeable: true, labeled: false, unlabeled: true, commented: false };
  }

  let labeled = false;
  if (!hasLabel) {
    runner(["label", "create", LABEL, "--force", "--color", "B60205", "--description", LABEL_DESCRIPTION, "--repo", repo]);
    runner(["api", "--method", "POST", `repos/${repo}/issues/${number}/labels`, "-f", `labels[]=${LABEL}`]);
    labeled = true;
  }

  const commentsPath = `repos/${repo}/issues/${number}/comments`;
  const bodies = runner(["api", commentsPath, "--paginate", "--jq", ".[].body"]);
  let commented = false;
  if (!bodies.includes(MARKER)) {
    runner(["api", "--method", "POST", commentsPath, "-f", `body=${COMMENT}`]);
    commented = true;
  }

  log(
    `conflict: does not merge cleanly; ${labeled ? "added conflict label" : "conflict label present"}, ${commented ? "posted rebase comment" : "rebase comment present"}`,
  );
  return { mergeable: false, labeled, unlabeled: false, commented };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`conflict: ${error.message}`);
    process.exitCode = 1;
  });
}

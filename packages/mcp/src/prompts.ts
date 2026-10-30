// MCP prompts for the workflows people actually run: a client fetches a numbered runbook
// (`fix_everything`, `adopt_existing_site`, `make_agent_ready`) instead of composing commands
// itself. Like the tools, this package is a thin adapter and owns no check logic (AGENTS.md).
// Every command, flag, tool name, check ID, and exit code quoted in a prompt exists in this
// repository today — verified against packages/verify/src/cli/ and packages/mcp/src/ — and the
// text stays honest about the pre-alpha state and about Seaworthy never editing files.
// Prompts are pure text: no site is read, no command is run, no clock is read, so the same
// arguments always produce the same messages.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_FOLDERS } from "@seaworthy/verify";
import { z } from "zod";

import { VERIFY_SITE_NAME } from "./verify-tools.js";

/** Prompt name, as a client would call it. Part of the MCP surface; stable once released. */
export const FIX_EVERYTHING_NAME = "fix_everything";
export const ADOPT_EXISTING_SITE_NAME = "adopt_existing_site";
export const MAKE_AGENT_READY_NAME = "make_agent_ready";

export const FIX_EVERYTHING_DESCRIPTION =
  "Get back one user message: a numbered preview loop that drives a built site to zero findings at or above a chosen severity, using `seaworthy verify` and `seaworthy fix --dry-run`. Seaworthy never edits files, so every write in the loop belongs to the caller.";

export const ADOPT_EXISTING_SITE_DESCRIPTION =
  "Get back one user message: a numbered runbook for adopting Seaworthy on an existing site whose findings are too many to fix first — `seaworthy init`, then record a baseline with `--update-baseline` (fingerprints with counts, not line numbers), then gate on new findings only with `--baseline`. Committing the baseline stays the user's action.";

export const MAKE_AGENT_READY_DESCRIPTION =
  "Get back one user message: a numbered runbook that works the findings deciding whether an agent can read, trust, and navigate a built site, by check ID — the `readability.*` catalog (llms.txt, markdown alternates, JSON-LD, and the rest that exists today) plus the discoverability basics, with the opt-in `--rendered` and `--network` gates called out.";

/** The optional site folder both fix and agent-ready prompts address. */
const siteArg = z
  .string()
  .optional()
  .describe(`The built site folder, relative to the workspace. Omit it and the commands use the default: the first of ${DEFAULT_FOLDERS.join(", ")} that exists.`);

/** Arguments of `fix_everything`. */
export const FIX_EVERYTHING_ARGS = {
  site: siteArg,
  fail_on: z
    .enum(["error", "warning", "note"])
    .optional()
    .describe('The severity the loop runs until it is clean at, as `--fail-on` takes it. Default: "error".'),
};

/** Arguments of `adopt_existing_site`. */
export const ADOPT_EXISTING_SITE_ARGS = {
  site: siteArg,
};

/** Arguments of `make_agent_ready`. */
export const MAKE_AGENT_READY_ARGS = {
  site: siteArg,
};

/** The parsed arguments a client may send to `fix_everything`. */
export interface FixEverythingInput {
  readonly site?: string | undefined;
  readonly fail_on?: "error" | "warning" | "note" | undefined;
}

/** The parsed arguments `adopt_existing_site` and `make_agent_ready` accept. */
export interface SitePromptInput {
  readonly site?: string | undefined;
}

/** " dist" for a named folder, "" for the default. Keeps command lines natural in the text. */
const siteWord = (site: string | undefined): string => (site === undefined ? "" : ` ${site}`);

/** The default-folder note appended when no site was named. */
const defaultNote = (site: string | undefined): string =>
  site === undefined ? ` (no folder given: the first of ${DEFAULT_FOLDERS.join(", ")} that exists)` : "";

/** Wraps a runbook as the single user message every Seaworthy prompt returns. */
function runbook(description: string, text: string): GetPromptResult {
  return { description, messages: [{ role: "user", content: { type: "text", text } }] };
}

/** Builds the `fix_everything` runbook: a preview loop, never a write. */
export function fixEverythingPrompt(args: FixEverythingInput = {}): GetPromptResult {
  const failOn = args.fail_on ?? "error";
  const dir = siteWord(args.site);
  const text = `Fix every Seaworthy finding at or above "${failOn}"${args.site === undefined ? "" : ` in ${args.site}`}. Seaworthy reports and suggests; it never edits your files. This is a preview loop: every step below tells you what to read, and every change stays yours to apply.

1. Run the checks and read what fails:
   seaworthy verify${dir} --format json --fail-on ${failOn}${defaultNote(args.site)}
   Exit codes: 0 = no findings at or above "${failOn}"; 1 = findings at or above it; 2 = usage error; 4 = a check or the engine crashed.
2. While it exits 1, preview every suggested fix as one unified diff:
   seaworthy fix${dir} --dry-run
   dry-run is the only mode \`fix\` has: it runs the checks and prints ONE unified diff of every edit the suggested fixes would apply to the built output, with paths relative to the site folder, and changes nothing. Findings whose fixes cannot be turned into safe edits — manual fixes, edits that need content a person must supply (such as alt text), or edits whose anchor text no longer matches the file — are listed on stderr as manual guidance instead.
   Alternatively, seaworthy verify${dir} --format prompt returns one copy-pasteable prompt that fixes every finding, grouped by file, to work through in order.
3. Apply the edits you accept yourself — for example \`git apply\` from the site folder — or change the source your generator reads, then rebuild the site. Prefer the source: a diff applied only to the built output is gone at the next build.
4. Rebuild, re-run step 1, and repeat until it exits 0.

If your server exposes the ${VERIFY_SITE_NAME} tool, calling it returns the same report JSON as step 1; the fix preview in step 2 is CLI-only today, and no tool applies edits — nothing here ever writes for you.`;
  return runbook("Preview loop to a clean verify run: read the report, preview the diff, apply it yourself, repeat.", text);
}

/** Builds the `adopt_existing_site` runbook: the real baseline mechanics. */
export function adoptExistingSitePrompt(args: SitePromptInput = {}): GetPromptResult {
  const dir = siteWord(args.site);
  const text = `Adopt Seaworthy on an existing site that already has more findings than you can fix today, without breaking its CI: record the current state as a baseline now, and fail only on new findings from here on.

0. Install first. Seaworthy is pre-alpha: nothing is on npm and no release tag exists, so pin the install to a commit and place it AFTER the site's own npm ci (npm ci would wipe it): npm install --no-save github:arminazimi/seaworthy#<commit>. A devDependencies entry with the same git URL is the persistent form of the same line.
1. From the project folder (the source, not the output) run:
   seaworthy init
   It detects astro, docusaurus, hugo, jekyll, or pages from marker file names only, and writes exactly three files: seaworthy.config.json, .github/workflows/seaworthy.yml (a bare verify step after the build), and an EMPTY seaworthy-baseline.json. A second run says "already present" and never rewrites the baseline — a baseline records findings you have accepted. Exit 0 = all files present; 2 = usage error.
2. Build the site so the output folder exists.
3. Record today's findings as the baseline:
   seaworthy verify${dir} --update-baseline seaworthy-baseline.json${defaultNote(args.site)}
   This writes every current finding into that file as a fingerprint with a count — fingerprints, not line numbers, so the same problem stays the same finding even when it moves — and then exits 0.
4. Verify through the baseline:
   seaworthy verify${dir} --baseline seaworthy-baseline.json --fail-on error${defaultNote(args.site)}
   Findings the baseline accepts are neither reported nor counted against the exit code; only new ones fail the run (exit 1 at or above --fail-on; 0 = clean, 2 = usage error, 4 = crash). Committing seaworthy-baseline.json is your action, never Seaworthy's: it writes only the file you named and never touches git.
5. As the team fixes baselined findings, re-record with --update-baseline; entries no longer matching any finding are pruned, so the accepted backlog only shrinks.
6. Optional daily driver: seaworthy verify${dir} --changed reports only findings in files that changed since the last run (hashes in .seaworthy/cache.json), and --changed-since <ref> compares against a git ref — useful when the built output is committed.

Note for MCP users: if your server exposes the ${VERIFY_SITE_NAME} tool, its report covers the whole site and does not consult a baseline file — the baseline gate lives in the CLI flags above.`;
  return runbook("Baseline adoption: init, record today's findings with --update-baseline, then fail only on new ones with --baseline.", text);
}

/** Builds the `make_agent_ready` runbook; every check ID quoted below is a live check. */
export function makeAgentReadyPrompt(args: SitePromptInput = {}): GetPromptResult {
  const dir = siteWord(args.site);
  const text = `Make a built site agent-ready: work the findings that decide whether an agent can read, trust, and navigate it. Every check ID below exists in the engine you are running (confirm with the list_checks tool, which reads no site).

1. Run every offline check, at the lowest severity so nothing is skipped:
   seaworthy verify${dir} --format json --fail-on note${defaultNote(args.site)}
   Exit codes: 0 = no findings at all; 1 = findings at or above note; 2 = usage error; 4 = a check or the engine crashed.
2. Opt-in gates, only where the machine supports them:
   --rendered   runs the checks that render pages in a browser; needs a browser installed.
   --network    lets the checks that need it reach the network; every other check stays offline.
3. Clear the agent-readability catalog first — these ten readability checks are reported by today's engine:
   - readability.llms-txt: llms.txt is missing or does not follow the proposal
   - readability.md-alternates: Markdown alternate is missing or does not match the page
   - readability.jsonld: JSON-LD does not parse or lacks fields consumers need
   - readability.ai-robots: robots.txt rules for AI crawlers contradict each other or the site
   - readability.content-signals: Content-Signal or Content-Usage line in robots.txt is malformed
   - readability.ssr-content: page content only appears after JavaScript runs
   - readability.agent-skills: Agent Skills index is invalid or lists a skill that is not in the site
   - readability.api-catalog: API catalog is not a valid linkset or links to files that are not in the site
   - readability.mcp-card: MCP Server Card is invalid or incomplete
   - readability.a2a-card: A2A agent card is invalid or missing required fields
4. Then the discoverability and navigation basics the same report already covers:
   meta.lang (page does not declare its language), meta.title (page has no title), meta.description (page has no meta description), meta.canonical (page has no usable canonical URL), headings.h1 (page does not have exactly one h1), images.alt (image has no alt attribute), links.internal (internal link points to a missing page or anchor), robots.sitemap (robots.txt Sitemap line is invalid or points to a missing sitemap), sitemap.entries (sitemap lists a page that is not in the built site).
5. Every finding names its check ID, its file, its location, and a fix hint — fix at the source your generator reads, rebuild, and re-run. seaworthy verify${dir} --format prompt turns the remaining findings into one copy-pasteable fix prompt, grouped by file.
6. Repeat until step 1 exits 0. To see what else the engine checks — all severities, requirements, and docs links — call the list_checks tool.`;
  return runbook("Agent-readability runbook: the readability.* catalog plus discoverability basics, with the opt-in browser and network gates.", text);
}

/**
 * Registers the three workflow prompts on a server, in this fixed order, before it connects.
 * Registration order is the wire order of `prompts/list`, so it is deterministic.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(FIX_EVERYTHING_NAME, { description: FIX_EVERYTHING_DESCRIPTION, argsSchema: FIX_EVERYTHING_ARGS }, (args) => fixEverythingPrompt(args satisfies FixEverythingInput));
  server.registerPrompt(ADOPT_EXISTING_SITE_NAME, { description: ADOPT_EXISTING_SITE_DESCRIPTION, argsSchema: ADOPT_EXISTING_SITE_ARGS }, (args) => adoptExistingSitePrompt(args satisfies SitePromptInput));
  server.registerPrompt(MAKE_AGENT_READY_NAME, { description: MAKE_AGENT_READY_DESCRIPTION, argsSchema: MAKE_AGENT_READY_ARGS }, (args) => makeAgentReadyPrompt(args satisfies SitePromptInput));
}

// `seaworthy init` plans the three files that adopt Seaworthy in one step: a config per
// the existing schema, a CI workflow for the generator the folder already shows, and an
// EMPTY first baseline. The plan is a pure function (no fs, no clock, no network), and the
// CLI layer executes it and prints exactly what it wrote where. Non-interactive by design:
// no questions, no overwrites without --force, and never a write outside the target folder.

import { createBaseline } from "./baseline.js";
import { CONFIG_FILE } from "./config.js";

/** The baseline file init creates. The same name the docs and the `--update-baseline` examples use. */
export const BASELINE_FILE = "seaworthy-baseline.json";

/** The CI workflow file init creates. Namespaced, so it never sits next to a user's own workflow. */
export const WORKFLOW_FILE = ".github/workflows/seaworthy.yml";

/** The three files, in creation order. */
export const INIT_TARGETS = [CONFIG_FILE, WORKFLOW_FILE, BASELINE_FILE] as const;

/** The published schema for the generated config, so editors autocomplete it. */
export const CONFIG_SCHEMA_URL = "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json";

/** File names (and a handful of nested names) whose presence says which generator the folder uses. */
export const INIT_MARKERS = [
  "astro.config.mjs", "astro.config.js", "astro.config.ts", "astro.config.mts", "astro.config.cjs",
  "docusaurus.config.js", "docusaurus.config.mjs", "docusaurus.config.ts", "docusaurus.config.cjs",
  "hugo.toml", "hugo.yaml", "hugo.json", "config.toml", "config.yaml", "config.json",
  "_config.yml", "_config.toml",
  ".nojekyll", "CNAME", "docs/.nojekyll", "docs/CNAME",
  "Gemfile",
] as const;

/** What init looks for, in the message for a folder whose generator it does not know. */
export const INIT_MARKERS_HINT = "Jekyll (_config.yml), Astro (astro.config.*), Docusaurus (docusaurus.config.*), Hugo (hugo.toml or config.toml), GitHub Pages (.nojekyll or CNAME)";

export type GeneratorId = "astro" | "docusaurus" | "hugo" | "jekyll" | "pages";

export interface GeneratorInfo {
  id: GeneratorId;
  /** Capitalized name for messages: "Astro", not "astro". */
  name: string;
  /** The file that matched, for the "detected Astro from astro.config.mjs" message. */
  marker: string;
  /** The built site folder, or undefined when verify should try its default folders. */
  root: string | undefined;
  /** The build block for the workflow (every line ends with \n), or "" when there is no build step. */
  buildSteps: string;
  /** One short line for the CLI summary of what the workflow will do. */
  buildSummary: string;
}

interface GeneratorSpec {
  id: GeneratorId;
  name: string;
  markers: readonly string[];
  root: string | undefined;
  /** The workflow steps block and the one-line summary; `present` is the marker list so a spec can depend on sibling files (a Jekyll Gemfile). */
  build: (marker: string, present: readonly string[]) => { steps: string; summary: string };
}

/** Quotes every line at the workflow's step indentation (six spaces). */
const steps = (lines: readonly string[]): string => lines.map((line) => (line === "" ? "\n" : `      ${line}\n`)).join("");

const npmBuild = {
  steps: steps(["- uses: actions/setup-node@v4", "  with:", '    node-version: "22"', "- name: Build the site", "  run: |", "    npm ci", "    npm run build"]),
  summary: "npm ci && npm run build",
};

const GENERATORS: readonly GeneratorSpec[] = [
  {
    id: "astro",
    name: "Astro",
    markers: ["astro.config.mjs", "astro.config.js", "astro.config.ts", "astro.config.mts", "astro.config.cjs"],
    root: "dist",
    build: () => npmBuild,
  },
  {
    id: "docusaurus",
    name: "Docusaurus",
    markers: ["docusaurus.config.js", "docusaurus.config.mjs", "docusaurus.config.ts", "docusaurus.config.cjs"],
    root: "build",
    build: () => npmBuild,
  },
  {
    id: "hugo",
    name: "Hugo",
    markers: ["hugo.toml", "hugo.yaml", "hugo.json", "config.toml", "config.yaml", "config.json"],
    root: "public",
    build: () => ({
      steps: steps([
        "- uses: peaceiris/actions-hugo@v3",
        "  with:",
        '    hugo-version: "latest" # pin a version here for reproducible builds',
        "- name: Build the site",
        "  run: hugo",
      ]),
      summary: "Hugo via peaceiris/actions-hugo",
    }),
  },
  {
    id: "jekyll",
    name: "Jekyll",
    markers: ["_config.yml", "_config.toml"],
    root: "_site",
    build: (_marker, present) =>
      present.includes("Gemfile")
        ? {
            steps: steps([
              "- uses: ruby/setup-ruby@v1",
              "  with:",
              '    ruby-version: "3.2"',
              "    bundler-cache: true",
              "- name: Build the site",
              "  run: bundle exec jekyll build",
            ]),
            summary: "Jekyll via bundle exec",
          }
        : {
            steps: steps([
              "# No Gemfile detected: bundler would pin the Jekyll version. Adding one (`bundle init`,",
              "# `bundle add jekyll`) turns this step into a locked, reproducible build.",
              "- name: Build the site",
              "  run: |",
              "    gem install jekyll",
              "    jekyll build",
            ]),
            summary: "Jekyll via gem install",
          },
  },
  {
    id: "pages",
    name: "GitHub Pages",
    // Legacy project pages put the served files in docs/, so their markers carry the folder with them.
    markers: [".nojekyll", "CNAME", "docs/.nojekyll", "docs/CNAME"],
    root: undefined,
    build: (marker) => ({
      steps: steps([
        `# No build step: ${marker.includes("/") ? `the served files are committed in ${marker.split("/")[0]}/` : "the served files are committed at the top level"}, so verify`,
        "# checks whatever the checkout fetched. If the site must be built first, add the",
        "# build step here, above the verify step.",
      ]),
      summary: marker.includes("/") ? `verifies the committed output in ${marker.split("/")[0]}` : "verifies the committed output",
    }),
  },
];

/**
 * Pure detection: which generator the folder's marker file names imply. It reads names only,
 * never a file's contents, and generator configs win over GitHub Pages markers (a Jekyll
 * repo can still carry a CNAME). Earlier entries in the table take precedence.
 */
export function detectGenerator(present: readonly string[]): GeneratorInfo | undefined {
  for (const spec of GENERATORS) {
    for (const marker of spec.markers) {
      if (!present.includes(marker)) continue;
      const { steps: buildSteps, summary: buildSummary } = spec.build(marker, present);
      return {
        id: spec.id,
        name: spec.name,
        marker,
        root: spec.id === "pages" && marker.includes("/") ? marker.split("/")[0] : spec.root,
        buildSteps,
        buildSummary,
      };
    }
  }
  return undefined;
}

export interface InitWrite {
  /** Target-relative path, with forward slashes on every platform. */
  path: string;
  /** The exact bytes to write. */
  content: string;
  /** Relative folders to create first, when they are missing. */
  dirs: readonly string[];
  /** The summary after "wrote <path>". */
  summary: string;
}

export interface InitKeep {
  path: string;
  /** Why init left the file alone, said so the user knows what to do instead. */
  summary: string;
}

export interface InitPlan {
  detected: GeneratorInfo | undefined;
  writes: InitWrite[];
  keeps: InitKeep[];
  /** Printed guidance once the writes are done. */
  next: string;
}

export interface PlanOptions {
  /** Which of the three files already exist. Missing keys mean absent. */
  existing?: Partial<Record<(typeof INIT_TARGETS)[number], boolean>>;
  /** Overwrite the files init owns (the config and the workflow). A baseline is never rewritten. */
  force?: boolean;
}

/**
 * The pure heart of `seaworthy init`: one config (root plus the baseline), one workflow for
 * the detected generator, one empty baseline. The config is plain JSON — JSON has no comments
 * and the schema rejects unknown keys — so the guidance a commented file would carry lives in
 * the workflow's comments, in the summary, and in docs/configuration.md. A second run says
 * "already present" for every file it does not rewrite.
 */
export function planInit(detected: GeneratorInfo | undefined, options: PlanOptions = {}): InitPlan {
  const existing = options.existing ?? {};
  const force = options.force === true;

  const writes: InitWrite[] = [];
  const keeps: InitKeep[] = [];

  const configSummary = detected?.root !== undefined ? `root ${detected.root}; baseline ${BASELINE_FILE}` : `baseline ${BASELINE_FILE}; verify tries the default folders`;
  if (existing[CONFIG_FILE] && !force) keeps.push({ path: CONFIG_FILE, summary: "already present; pass --force to overwrite it with init's version" });
  else writes.push({ path: CONFIG_FILE, content: JSON.stringify({ $schema: CONFIG_SCHEMA_URL, ...(detected?.root !== undefined ? { root: detected.root } : {}), baseline: BASELINE_FILE }, null, 2) + "\n", dirs: [], summary: configSummary });

  const workflowSummary = detected !== undefined ? `${detected.name}: ${detected.buildSummary}, then seaworthy verify` : "no build step: add yours above the verify step";
  if (existing[WORKFLOW_FILE] && !force) keeps.push({ path: WORKFLOW_FILE, summary: "already present; pass --force to overwrite it with init's version" });
  else writes.push({ path: WORKFLOW_FILE, content: workflowContent(detected), dirs: [".github", ".github/workflows"], summary: workflowSummary });

  // A baseline records findings the user has accepted, so an existing one is never
  // rewritten -- not even with --force. Removing it is a deliberate user decision.
  if (existing[BASELINE_FILE]) keeps.push({ path: BASELINE_FILE, summary: "already present; a baseline records accepted findings, so init never rewrites it" });
  else writes.push({ path: BASELINE_FILE, content: JSON.stringify(createBaseline([]), null, 2) + "\n", dirs: [], summary: "empty, 0 entries: every finding is new and fails" });

  const next = writes.length === 0 ? "nothing to do; use seaworthy init --force to rewrite the files init owns" : "commit what changed; seaworthy verify then fails only on findings the baseline does not accept";
  return { detected, writes, keeps, next };
}

/** The workflow text: its YAML comments carry what a commented config cannot. */
export function workflowContent(detected: GeneratorInfo | undefined): string {
  const head: readonly string[] = [
    "# Seaworthy CI: verify the built site on every push and pull request, and fail on any finding",
    "# the baseline in seaworthy-baseline.json does not accept. Written by `seaworthy init`; a later",
    "# init --force rewrites this file, so keep a copy when you edit it by hand or pin versions.",
    "",
    "# Start from an empty baseline: to accept findings on purpose, run locally and commit the file:",
    "#   npx seaworthy verify --update-baseline seaworthy-baseline.json",
    "",
    "name: seaworthy",
    "",
    "on:",
    "  push:",
    "    branches: [main]",
    "  pull_request:",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  verify:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
  ];
  const tail: readonly string[] = [
    "      - name: Verify",
    "        run: npx seaworthy verify",
    "",
  ];
  // Generated build steps already carry their trailing newlines; the head and tail join with \n.
  const build =
    detected !== undefined
      ? detected.buildSteps
      : steps([
          "# No generator detected (looked for " + INIT_MARKERS_HINT + ").",
          "# Verify runs on the first of dist, build, out, public, _site, or site that exists;",
          "# add your build step here if the site must be built first.",
        ]);
  return head.join("\n") + "\n" + build + tail.join("\n") + "\n";
}

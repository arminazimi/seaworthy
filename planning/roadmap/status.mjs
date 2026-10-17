// Tasks already finished before their issues existed. apply.mjs creates these issues and closes them
// with a note, so the roadmap history stays complete. Keys must match tasks in ROADMAP.md.

export const DONE = {
  "foundation.layout": "Done in the initial commit: monorepo layout with packages/verify, packages/mcp, packages/action, and documented folders.",
  "foundation.check": "Done in the initial commit: `npm run check` runs build, tests, roadmap validation, and the layout check. (No linter yet; typecheck runs through the build.)",
  "foundation.ci": "Done in the initial commit: `.github/workflows/ci.yml` runs `npm run check` on Linux, macOS, and Windows with Node 22 and 24.",
  "foundation.agents-md": "Done in the initial commit: `AGENTS.md` and `CLAUDE.md`.",
  "foundation.contributing": "Done in the initial commit: `CONTRIBUTING.md` with lanes, sizes, and the claim process.",
  "foundation.labels": "Done in the initial commit: labels are defined in `planning/roadmap/labels.mjs` and created by `apply.mjs`.",
  "foundation.issue-gen": "Done in the initial commit: `planning/roadmap/` parses ROADMAP.md, validates it, and syncs issues.",
  "foundation.license": "Done in the initial commit: Apache-2.0.",
};

/**
 * Roadmap items that moved to the theme project (ADR 0009). Their issues are labeled `moved: theme`, taken out of
 * this repository's milestones, and transferred once the theme repository exists. Keys must no longer be in ROADMAP.md.
 */
export const MOVED_TO_THEME = [
  "spike.md-twin-liquid",
  "spike.persian-type",
  "E-theme-tokens",
  "theme.tokens",
  "theme.dark",
  "theme.config",
  "theme.signature",
  "theme.tokens-docs",
  "E-theme-layouts",
  "theme.base",
  "theme.home",
  "theme.doc",
  "theme.post",
  "theme.page",
  "theme.code",
  "theme.logical-css",
  "theme.i18n",
  "theme.persian",
  "theme.search",
  "E-theme-ai",
  "theme.llms-txt",
  "theme.md-twin",
  "theme.jsonld",
  "theme.copy-button",
  "theme.action",
  "launch2.template",
  "launch2.directories",
  "launch2.visual-tests",
  "ext.presets",
];

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

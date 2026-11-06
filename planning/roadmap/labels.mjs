// Label definitions, lanes, sizes, and how roadmap items map to labels.

export const LANES = {
  "strong-agent": { label: "lane: strong-agent", who: "a strong coding agent or an experienced contributor" },
  "free-agent": { label: "lane: free-agent", who: "free or lightweight agents, and newcomers" },
  maintainer: { label: "lane: maintainer", who: "a maintainer (accounts, credentials, or decisions)" },
};

export const SIZES = {
  XS: { label: "size: XS", meaning: "under an hour" },
  S: { label: "size: S", meaning: "a few hours" },
  M: { label: "size: M", meaning: "about a day" },
};

/** Priority: how much the release needs the item. Execution order comes from dependencies first, then priority. */
export const PRIORITIES = {
  P0: { label: "priority: P0", meaning: "on the critical path: other work waits for it" },
  P1: { label: "priority: P1", meaning: "required for the release" },
  P2: { label: "priority: P2", meaning: "required for the release, can land late" },
  P3: { label: "priority: P3", meaning: "nice to have in the release" },
};

export const TRACKS = {
  verify: { label: "track: verify" },
};

/** Area labels per epic. Every epic in ROADMAP.md must appear here. */
export const EPIC_AREAS = {
  "E-foundation": ["area: core", "area: devops"],
  "E-direction": ["area: checks", "area: i18n"],
  "E-bidi": ["area: checks", "area: i18n"],
  "E-css": ["area: checks", "area: i18n"],
  "E-persian": ["area: checks", "area: i18n"],
  "E-arabic-hebrew-urdu": ["area: checks", "area: i18n"],
  "E-rendered": ["area: checks", "area: i18n"],
  "E-pseudo": ["area: core", "area: i18n"],
  "E-i18n": ["area: checks", "area: i18n"],
  "E-report": ["area: core", "area: agent"],
  "E-surfaces": ["area: integration", "area: agent"],
  "E-docs-launch": ["area: docs", "area: release"],
  "E-cleanup": ["area: core", "area: docs"],
};

/** Type label from a task key prefix. First match wins. */
export const TYPE_BY_PREFIX = [
  ["adr.", "type: spike"],
  ["foundation.fixtures", "type: fixture"],
  ["pseudo.fixture", "type: fixture"],
  ["dir.", "type: check"],
  ["bidi.", "type: check"],
  ["css.", "type: check"],
  ["fa.", "type: check"],
  ["ar.", "type: check"],
  ["he.", "type: check"],
  ["ur.", "type: check"],
  ["render.", "type: check"],
  ["i18n.", "type: check"],
  ["surface.", "type: integration"],
  ["docs.", "type: docs"],
];

const L = (name, color, description) => ({ name, color, description });

export const LABELS = [
  L("roadmap", "0e8a16", "Work committed in the public roadmap"),
  L("type: epic", "3e4b9e", "Tracking issue that groups small tasks"),
  L("type: task", "c5def5", "One small, independently mergeable change"),
  L("type: check", "1d76db", "Add or change a verify check"),
  L("type: integration", "1d76db", "Framework, host, or CI integration"),
  L("type: preset", "1d76db", "Rule preset (extends)"),
  L("type: fixture", "1d76db", "Fixture sites and ground truth"),
  L("type: test", "1d76db", "Tests, benchmarks, and quality gates"),
  L("type: docs", "1d76db", "Documentation"),
  L("type: spike", "1d76db", "Time-boxed investigation that ends in an ADR"),
  L("lane: strong-agent", "5319e7", "Needs a strong coding agent or experienced contributor"),
  L("lane: free-agent", "7057ff", "Spec-complete: suitable for free agents and new contributors"),
  L("lane: maintainer", "b60205", "Requires maintainer accounts, credentials, or decisions"),
  L("size: XS", "ededed", "Expected effort: under 1 hour"),
  L("size: S", "d4c5f9", "Expected effort: a few hours"),
  L("size: M", "bfd4f2", "Expected effort: about a day"),
  L("track: verify", "0052cc", "Tier 1: blocks launch wave 1"),
  L("priority: P0", "b60205", "Critical path: other work waits for it"),
  L("priority: P1", "d93f0b", "Required for the release"),
  L("priority: P2", "fbca04", "Required for the release, can land late"),
  L("priority: P3", "c2e0c6", "Nice to have in the release"),
  L("status: ready", "0e8a16", "Every dependency is closed: an agent can start now"),
  L("moved: theme", "c2e0c6", "Belongs to the theme project now; will be transferred there (ADR 0009)"),
  L("status: needs-brief", "fbca04", "No agent brief yet: comment with a plan before opening a PR"),
  L("status: blocked", "b60205", "Blocked on an external dependency"),
  L("area: core", "006b75", "Engine, CLI, contracts, and architecture"),
  L("area: checks", "006b75", "Built-in checks"),
  L("area: agent", "006b75", "MCP server, Agent Skills, plugins, and agent evaluation"),
  L("area: integration", "006b75", "Framework and host integrations"),
  L("area: a11y", "006b75", "Accessibility checks"),
  L("area: html", "006b75", "HTML conformance"),
  L("area: live", "006b75", "Live-site verification and hosting checks"),
  L("area: dx", "006b75", "Developer experience: setup, output, and the agent loop"),
  L("area: i18n", "006b75", "RTL, languages, and localization"),
  L("area: devops", "006b75", "CI, GitHub Action, and repository automation"),
  L("area: docs", "006b75", "Documentation and playbooks"),
  L("area: brand", "006b75", "Name, logo, badge, and launch assets"),
  L("area: community", "006b75", "Contributors, governance, launches, and outreach"),
  L("area: standards", "006b75", "Specs, conformance, and external standards"),
  L("area: release", "006b75", "Packaging, publishing, and discoverability"),
  L("area: validation", "006b75", "Ground truth, benchmarks, and accuracy evidence"),
];

/** Labels GitHub creates by default and the generator may also use. */
export const BUILTIN_LABELS = ["good first issue", "help wanted", "bug", "documentation", "enhancement"];

export function typeFor(key) {
  return TYPE_BY_PREFIX.find(([prefix]) => key.startsWith(prefix))?.[1] ?? null;
}

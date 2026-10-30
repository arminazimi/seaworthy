// Unit tests for the workflow prompts: what the runbooks may say. Every guard here is against
// docs drift — commands, flags, tool names, check IDs, install lines, and exit codes quoted in a
// prompt must exist in this repository today, so each test verifies the text against the real
// source (the verify API and the tool registry) instead of a second hand-written list of facts.

import assert from "node:assert/strict";
import { test } from "node:test";

import { builtInChecks } from "@seaworthy/verify";

import { PLANNED_TOOLS } from "../src/planned.js";
import {
  ADOPT_EXISTING_SITE_NAME,
  FIX_EVERYTHING_NAME,
  MAKE_AGENT_READY_NAME,
  adoptExistingSitePrompt,
  fixEverythingPrompt,
  makeAgentReadyPrompt,
} from "../src/prompts.js";
import { LIST_CHECKS_NAME } from "../src/list-checks.js";
import { VERIFY_CHANGED_NAME, VERIFY_SITE_NAME } from "../src/verify-tools.js";

/** The prompt under test: name, fetched runbook, and the builder to call it with. */
const prompts = [
  { name: FIX_EVERYTHING_NAME, result: fixEverythingPrompt(), withSite: fixEverythingPrompt({ site: "dist", fail_on: "note" }) },
  { name: ADOPT_EXISTING_SITE_NAME, result: adoptExistingSitePrompt(), withSite: adoptExistingSitePrompt({ site: "dist" }) },
  { name: MAKE_AGENT_READY_NAME, result: makeAgentReadyPrompt(), withSite: makeAgentReadyPrompt({ site: "dist" }) },
];

const textOf = (result: ReturnType<typeof fixEverythingPrompt>): string => {
  assert.equal(result.messages.length, 1, "a runbook is exactly one message");
  const message = result.messages[0]!;
  assert.equal(message.role, "user");
  assert.deepEqual(Object.keys(message.content), ["type", "text"]);
  return message.content.type === "text" ? message.content.text : "";
};

test("every prompt returns one user text message with a description", () => {
  for (const { result } of prompts) {
    const description = result.description;
    assert.equal(typeof description, "string");
    assert.ok(description !== undefined && description.length > 0);
    assert.ok(textOf(result).length > 200, `${description} — the runbook should be substantive`);
  }
});

test("prompts are deterministic: the same arguments build the same text", () => {
  assert.deepEqual(fixEverythingPrompt({ site: "dist", fail_on: "warning" }), fixEverythingPrompt({ site: "dist", fail_on: "warning" }));
  assert.deepEqual(adoptExistingSitePrompt({ site: "dist" }), adoptExistingSitePrompt({ site: "dist" }));
  assert.deepEqual(makeAgentReadyPrompt(), makeAgentReadyPrompt());
});

// The flags `seaworthy` really parses (packages/verify/src/cli/options/*, --dry-run of `fix`,
// and npm's own --no-save quoted in the install line). A prompt naming anything else is drift.
const REAL_FLAGS = [
  "--base",
  "--baseline",
  "--browser-path",
  "--changed",
  "--changed-since",
  "--config",
  "--dry-run",
  "--fail-on",
  "--format",
  "--markdown",
  "--max-findings",
  "--network",
  "--new-only",
  "--no-history",
  "--no-save",
  "--out",
  "--rendered",
  "--timings",
  "--update-baseline",
  "--watch",
];

test("no prompt quotes a CLI flag that does not exist", () => {
  for (const { name, result, withSite } of prompts) {
    for (const text of [textOf(result), textOf(withSite)]) {
      for (const flag of text.match(/--[a-z][a-z-]*/g) ?? []) {
        assert.ok(REAL_FLAGS.includes(flag), `${name}: unknown flag ${flag} in a runbook`);
      }
    }
  }
});

test("no prompt quotes a tool the server does not register, planned ones included", () => {
  const registered = new Set([LIST_CHECKS_NAME, VERIFY_SITE_NAME, VERIFY_CHANGED_NAME]);
  const promptNames = new Set([FIX_EVERYTHING_NAME, ADOPT_EXISTING_SITE_NAME, MAKE_AGENT_READY_NAME]);
  for (const { name, result, withSite } of prompts) {
    for (const text of [textOf(result), textOf(withSite)]) {
      for (const planned of PLANNED_TOOLS) {
        assert.ok(!text.includes(planned), `${name}: runbook advertises planned tool ${planned}`);
      }
      // Any snake_case tool-like mention in a runbook is either a registered tool or this server's own prompt.
      for (const mentioned of text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []) {
        assert.ok(registered.has(mentioned) || promptNames.has(mentioned), `${name}: runbook names unknown tool ${mentioned}`);
      }
    }
  }
});

// Any `word.word` token that shares a namespace with a real check ID must itself be a real ID:
// this catches an invented check like "seo.llms-txt". File names (robots.txt, seaworthy.config.json)
// are skipped by extension, and "seaworthy" is not a check namespace anyway.
const FILE_EXTENSIONS = new Set(["txt", "json", "html", "md", "yml", "js", "css", "csv", "lock", "xml"]);

test("every check ID quoted in a runbook exists in the engine", () => {
  const ids = new Set(builtInChecks.map((check) => check.meta.id));
  const namespaces = new Set([...ids].map((id) => id.split(".")[0]));
  for (const { name, result, withSite } of prompts) {
    for (const text of [textOf(result), textOf(withSite)]) {
      for (const token of text.match(/[a-z0-9-]+\.[a-z0-9-]+/g) ?? []) {
        const [namespace, suffix] = token.split(".");
        if (!namespaces.has(namespace!) || FILE_EXTENSIONS.has(suffix!)) continue;
        assert.ok(ids.has(token), `${name}: runbook quotes check "${token}", which does not exist`);
      }
    }
  }
});

test("the agent-ready runbook names the real readability catalog and only real basics", () => {
  const ids = new Set(builtInChecks.map((check) => check.meta.id));
  for (const id of [
    "readability.llms-txt",
    "readability.md-alternates",
    "readability.jsonld",
    "readability.ai-robots",
    "readability.content-signals",
    "readability.ssr-content",
    "readability.agent-skills",
    "readability.api-catalog",
    "readability.mcp-card",
    "readability.a2a-card",
    "meta.lang",
    "meta.title",
    "meta.description",
    "meta.canonical",
    "headings.h1",
    "images.alt",
    "links.internal",
    "robots.sitemap",
    "sitemap.entries",
  ]) {
    assert.ok(ids.has(id), `test premise: ${id} must be a live check`);
    assert.ok(textOf(makeAgentReadyPrompt()).includes(id), `agent-ready runbook must cite ${id}`);
  }
});

test("pre-alpha honesty: no npm package names and no release tags in any runbook", () => {
  for (const { name, result, withSite } of prompts) {
    for (const text of [textOf(result), textOf(withSite)]) {
      for (const forbidden of ["npm i seaworthy", "npm install seaworthy", "npm i -D seaworthy", "npm i -D @seaworthy", "@v1"]) {
        assert.ok(!text.includes(forbidden), `${name}: runbook claims "${forbidden}", which does not exist`);
      }
      if (text.includes("github:arminazimi/seaworthy")) assert.ok(text.includes("#<commit>"), "git installs must be pinned to a commit");
    }
  }
});

test("the fix loop is a preview: Seaworthy never edits files, and the runbook says so", () => {
  const text = textOf(fixEverythingPrompt({ site: "dist" }));
  assert.ok(text.includes("seaworthy fix dist --dry-run"));
  assert.ok(text.includes("never edits"));
  assert.ok(text.includes("git apply"));
  assert.ok(!text.includes("seaworthy fix dist\n"), "fix without --dry-run must never appear");
});

test("the adoption runbook uses the real baseline mechanics", () => {
  const text = textOf(adoptExistingSitePrompt());
  assert.ok(text.includes("--update-baseline seaworthy-baseline.json"));
  assert.ok(text.includes("--baseline seaworthy-baseline.json"));
  assert.ok(text.includes("fingerprint"), "a baseline records fingerprints, not line numbers");
  assert.ok(text.includes("not line numbers"), "and says so");
  assert.ok(text.includes("never touches git") || text.includes("your action"), "committing the baseline is the user's action");
});

test("exit codes quoted in runbooks match the CLI contract", () => {
  const all = prompts.map(({ result }) => textOf(result)).join("\n");
  // The four documented codes appear; a fifth (like the watch interrupt 130) must not be quoted as general.
  for (const code of ["0", "1", "2", "4"]) assert.ok(all.includes(`${code} =`), `exit code ${code} should be documented`);
  assert.ok(!all.includes("exit 3"), "no invented exit code 3");
});

test("a named site folder appears in every command line of the runbook", () => {
  const fix = textOf(fixEverythingPrompt({ site: "out" }));
  assert.ok(fix.includes("seaworthy verify out --format json"));
  assert.ok(fix.includes("seaworthy fix out --dry-run"));
  assert.ok(!fix.includes("the first of dist"), "the default-folder note only applies to an unnamed folder");
  const adopt = textOf(adoptExistingSitePrompt({ site: "out" }));
  assert.ok(adopt.includes("seaworthy verify out --update-baseline"));
});

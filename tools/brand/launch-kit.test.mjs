// Keeps the launch kit in brand/launch-1/ honest: every path it names exists, its copy matches the
// brand tokens, it uses no hype word outside the section that bans them, and it covers exactly the
// channels the roadmap's launch-1 epic names.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BRAND_DIR = join(root, "brand");
const KIT_DIR = join(BRAND_DIR, "launch-1");
const KIT_FILES = ["README.md", "copy.md", "facts.md", "assets.md", "channels.md", "checklist.md"];
const ROOT_FILES = new Set(["README.md", "LICENSE", "AGENTS.md", "CONTRIBUTING.md", "CHANGELOG.md", "ROADMAP.md"]);

const read = (path) => readFileSync(path, "utf8");
const kitFile = (name) => read(join(KIT_DIR, name));
const kitText = () => KIT_FILES.map(kitFile).join("\n");

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A backticked token is a path when it looks like one: no spaces, an extension, and either a slash or a known root file. */
function looksLikePath(token) {
  if (/\s/.test(token)) return false;
  if (!/^[A-Za-z0-9_./-]+$/.test(token)) return false;
  if (!/\.[A-Za-z0-9]+$/.test(token)) return false;
  if (token.includes("/")) return true;
  return ROOT_FILES.has(token);
}

/** A path in the kit resolves against the kit folder, or against the repository root for repo-relative paths. */
function resolves(token, from) {
  if (existsSync(join(from, token))) return true;
  if (token.startsWith("..")) return false;
  return existsSync(join(root, token));
}

test("the launch kit holds every file a launch post needs, and nothing else", () => {
  const files = readdirSync(KIT_DIR, { recursive: true }).sort();
  assert.deepEqual(files, [...KIT_FILES].sort());
  for (const file of files) assert.ok(file.endsWith(".md"), `${file} is not markdown`);
});

test("every path the kit names resolves to a file", () => {
  for (const name of KIT_FILES) {
    const text = kitFile(name);
    for (const [, , target] of text.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
      const path = target.split("#")[0] ?? "";
      if (path === "" || /^[a-z]+:/i.test(path)) continue;
      assert.ok(existsSync(join(KIT_DIR, path)), `${name}: link to ${target} is broken`);
    }
    for (const [, token] of text.matchAll(/`([^`]+)`/g)) {
      if (!looksLikePath(token)) continue;
      assert.ok(resolves(token, KIT_DIR), `${name}: ${token} does not exist`);
    }
  }
});

test("the copy carries the brand's own words", () => {
  const tokens = JSON.parse(read(join(BRAND_DIR, "tokens.json")));
  const copy = kitFile("copy.md");
  assert.ok(copy.includes(tokens.tagline), "the tagline");
  assert.ok(copy.includes(tokens.taglineSecondary), "the secondary line");
  assert.ok(copy.includes(tokens.descriptor), "the descriptor");
  assert.ok(kitText().includes("npx seaworthy verify ./dist"), "the command");
});

test("the guide's forbidden words appear only in the section that bans them", () => {
  const guide = read(join(BRAND_DIR, "BRAND_GUIDE.md"));
  const voice = guide.slice(guide.indexOf("## Voice"), guide.indexOf("\n## ", guide.indexOf("## Voice") + 1));
  const forbidden = [...voice.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
  assert.ok(forbidden.length >= 5, "the guide's voice rules did not list the forbidden words");

  const parts = kitFile("copy.md").split(/^## /m);
  const avoid = parts.find((part) => part.startsWith("Words to avoid"));
  assert.ok(avoid, "copy.md needs a section that lists the words to avoid");

  const kit = kitText();
  for (const word of forbidden) {
    assert.ok(avoid.toLowerCase().includes(word.toLowerCase()), `copy.md should ban ${word}`);
    const count = [...kit.matchAll(new RegExp(`\\b${escapeRegex(word)}\\b`, "gi"))].length;
    assert.equal(count, 1, `${word} appears ${count} times in the kit; it may only appear in the section that bans it`);
  }
});

test("the kit never writes a product name the guide forbids", () => {
  const guide = read(join(BRAND_DIR, "BRAND_GUIDE.md"));
  const line = guide.split("\n").find((text) => text.includes("Do not rename the product")) ?? "";
  const variants = [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
  assert.ok(variants.length >= 2, "the guide's naming rules did not list the forbidden variants");
  for (const name of KIT_FILES) {
    for (const [index, text] of kitFile(name).split("\n").entries()) {
      for (const variant of variants) {
        if (!text.includes(variant)) continue;
        assert.match(text, /never write/i, `${name}:${index + 1} writes ${variant} outside a "never write" line`);
      }
    }
  }
});

/** The launch-1 epic of the roadmap: the section the kit's channels come from. */
function launch1Section() {
  const roadmap = read(join(root, "ROADMAP.md"));
  const start = roadmap.indexOf("## Epic: Launch wave 1");
  assert.notEqual(start, -1, "the roadmap has no launch-1 epic");
  const end = roadmap.indexOf("\n## ", start + 1);
  return roadmap.slice(start, end === -1 ? roadmap.length : end);
}

test("every channel in the kit is a channel the roadmap names", () => {
  const section = launch1Section();
  const rows = kitFile("channels.md").split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| ---") && !line.startsWith("| Channel "));
  const channels = rows.map((row) => (row.split("|")[1] ?? "").trim()).filter((channel) => channel !== "");
  assert.ok(channels.length >= 8, "the kit lists too few channels");
  for (const channel of channels) {
    assert.match(section, new RegExp(`\\b${escapeRegex(channel)}\\b`), `the roadmap does not name ${channel}`);
  }
});

test("every channel the roadmap names is in the kit", () => {
  const section = launch1Section();
  const scope = section.slice(section.indexOf("### Scope"), section.indexOf("### Tasks"));
  const bullet = scope.split("\n").find((line) => line.startsWith("- ") && line.includes("Show HN"));
  assert.ok(bullet, "the roadmap's launch-1 scope no longer lists the channels");
  const channels = bullet.replace(/^-\s*/, "").split(/[(),]/).map((part) => part.trim()).filter((part) => part !== "");
  assert.ok(channels.length >= 5, "the roadmap's scope list could not be read");
  const kit = kitFile("channels.md");
  for (const channel of channels) assert.ok(kit.includes(channel), `the kit does not cover ${channel}`);
});

// The generated registries must collect exactly what the modules export: a module added without
// regenerating, a dropped export, or a wrong sort order fails here. See tools/gen-registries.mjs.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";

import { builtInChecks } from "../src/checks/index.js";
import { PLAIN } from "../src/color.js";
import { FORMATS, formatReport } from "../src/formats/index.js";
import { buildReport } from "../src/report.js";
import type { Check, Report } from "../src/types.js";

// packages/verify/dist/tests/registry.test.js -> dist/ is one level up, the repository root four up.
const DIST = fileURLToPath(new URL("..", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Built modules that still have a TypeScript source: tsc never prunes output of deleted sources. */
function modulesOf(subdir: string): string[] {
  const distDir = join(DIST, "src", subdir);
  const srcDir = join(DIST, "..", "src", subdir);
  return readdirSync(distDir).filter((f) => f.endsWith(".js") && existsSync(join(srcDir, f.replace(/\.js$/, ".ts")))).sort();
}

const isCheck = (value: unknown): value is Check =>
  typeof value === "object" && value !== null && typeof (value as Check).meta?.id === "string" && typeof (value as Check).run === "function";
const sorted = (ids: readonly string[]): string[] => [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Every check exported by any built checks module, keyed and ordered by check ID. */
async function discoveredChecks(): Promise<Map<string, string>> {
  const dir = join(DIST, "src", "checks");
  const byId = new Map<string, string>();
  for (const file of modulesOf("checks").filter((f) => !["index.js", "registry.js"].includes(f))) {
    const module = (await import(pathToFileURL(join(dir, file)).href)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(module)) if (isCheck(value)) byId.set(value.meta.id, name);
  }
  return byId;
}

/** Every built format module that exports `render`, keyed by format ID. */
async function discoveredFormats(): Promise<Map<string, (report: Report, context: unknown, paint: unknown) => string>> {
  const dir = join(DIST, "src", "formats");
  const byId = new Map();
  for (const file of modulesOf("formats").filter((f) => !["index.js", "registry.js", "base.js"].includes(f))) {
    const module = (await import(pathToFileURL(join(dir, file)).href)) as Record<string, unknown>;
    if (typeof module.render === "function") byId.set(file.replace(/\.js$/, ""), module.render as (report: Report, context: unknown, paint: unknown) => string);
  }
  return byId;
}

describe("the generated registries", () => {
  test("builtInChecks is every exported check, in check-ID order", async () => {
    const byId = await discoveredChecks();
    assert.deepEqual(builtInChecks.map((c) => c.meta.id), sorted([...byId.keys()]));
  });

  test("FORMATS is every format module, in format-ID order", async () => {
    const byId = await discoveredFormats();
    assert.deepEqual([...FORMATS], sorted([...byId.keys()]));
  });

  test("formatReport dispatches each format to its module's render", async () => {
    const byId = await discoveredFormats();
    const report = buildReport({ root: "site", pages: 1, checks: [], findings: [] });
    for (const format of FORMATS) {
      const render = byId.get(format);
      assert.ok(render, `no module renders "${format}"`);
      assert.equal(formatReport(report, format), render(report, {}, PLAIN));
    }
  });

  test("the committed registries match what the generator would write", () => {
    // Throws, and so fails the test, when a registry is stale: run `npm run build && node tools/gen-registries.mjs`.
    execFileSync(process.execPath, [join(ROOT, "tools", "gen-registries.mjs"), "--check"], { cwd: ROOT, stdio: "pipe" });
  });
});

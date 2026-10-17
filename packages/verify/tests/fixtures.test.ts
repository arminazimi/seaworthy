// Ground-truth tests: every fixture under fixtures/ must report exactly the findings in its expected.json.
// See fixtures/README.md. These tests also enforce that every built-in check has a broken fixture and a docs page.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { builtInChecks } from "../src/checks/index.js";
import { parseConfig } from "../src/config.js";
import { toSarif } from "../src/formats/sarif.js";
import { SUPPRESSION_CHECKS } from "../src/suppress.js";
import { verifySite } from "../src/verify.js";
import { reportErrors, sarifErrors } from "./helpers.js";

// packages/verify/dist/tests/fixtures.test.js -> repository root is four levels up.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURES = join(ROOT, "fixtures");
const DOCS = join(ROOT, "docs", "checks");
const DOCS_URL = "https://github.com/arminazimi/seaworthy/blob/main/docs/checks/";

interface Expected {
  description?: string;
  findings: { check: string; file: string; line?: number; column?: number }[];
}
interface Settings {
  checks?: string[];
  config?: unknown;
}

const folders = (kind: "clean" | "broken"): string[] => {
  const dir = join(FIXTURES, kind);
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
};
const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback);
const NOW = new Date("2027-01-01T00:00:00Z");

async function runFixture(kind: "clean" | "broken", name: string) {
  const dir = join(FIXTURES, kind, name);
  const settings = readJson<Settings>(join(dir, "fixture.json"), {});
  const known = builtInChecks.map((c) => c.meta.id);
  if (settings.checks) for (const id of settings.checks) assert.ok(known.includes(id), `${kind}/${name}: fixture.json names unknown check ${id}`);
  const checks = settings.checks ? builtInChecks.filter((c) => settings.checks!.includes(c.meta.id)) : builtInChecks;
  const config = settings.config === undefined ? undefined : parseConfig(settings.config, `${kind}/${name}/fixture.json`, known);
  const result = await verifySite({ folder: join(dir, "site"), rootLabel: "site", checks, ...(config ? { config } : {}), now: NOW });
  return { result, expected: readJson<Expected>(join(dir, "expected.json"), { findings: [] }) };
}

const describeFindings = (rows: { check: string; file: string; line?: number | undefined; column?: number | undefined }[]) => rows.map((r) => `${r.file}:${r.line ?? "-"}:${r.column ?? "-"} ${r.check}`);

for (const kind of ["clean", "broken"] as const) {
  describe(`${kind} fixtures`, () => {
    for (const name of folders(kind)) {
      test(`${kind}/${name} reports exactly its ground truth`, async () => {
        assert.ok(existsSync(join(FIXTURES, kind, name, "site")), "a fixture needs a site/ folder");
        assert.ok(existsSync(join(FIXTURES, kind, name, "expected.json")), "a fixture needs an expected.json");
        const { result, expected } = await runFixture(kind, name);
        const actual = result.report.findings.map((f) => ({ check: f.checkId, file: f.location.file, line: f.location.line, column: f.location.column }));

        assert.equal(actual.length, expected.findings.length, `finding count differs.\n expected: ${JSON.stringify(describeFindings(expected.findings))}\n actual:   ${JSON.stringify(describeFindings(actual))}`);
        expected.findings.forEach((want, i) => {
          const got = actual[i]!;
          assert.equal(got.check, want.check, `finding ${i}: check`);
          assert.equal(got.file, want.file, `finding ${i}: file`);
          if (want.line !== undefined) assert.equal(got.line, want.line, `finding ${i} (${want.check} in ${want.file}): line`);
          if (want.column !== undefined) assert.equal(got.column, want.column, `finding ${i} (${want.check} in ${want.file}): column`);
        });
        if (kind === "broken") assert.ok(expected.findings.length > 0, "a broken fixture must expect at least one finding");
        assert.deepEqual(result.report.errors, [], "no check may crash on a fixture");

        assert.deepEqual(reportErrors(result.report), [], "the report matches the schema");
        const readLine = (file: string, line: number) => result.site.pages.get(`/${file}`)?.source.split(/\r?\n/)[line - 1];
        assert.deepEqual(sarifErrors(toSarif(result.report, { readLine })), [], "the SARIF matches the official schema");
      });
    }
  });
}

describe("the check contract", () => {
  test("every built-in check has valid metadata and a docs page", () => {
    for (const check of [...builtInChecks, ...SUPPRESSION_CHECKS]) {
      const { id, title, docs, severity, standards, needs } = check.meta;
      assert.match(id, /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, `${id}: ID format`);
      assert.ok(title.length >= 8 && !title.endsWith("."), `${id}: title is a short phrase without a final period`);
      assert.ok(["error", "warning", "note"].includes(severity), `${id}: severity`);
      assert.ok(Array.isArray(standards), `${id}: standards is a list`);
      assert.ok(needs.includes("html") || needs.includes("files"), `${id}: needs html or files`);
      assert.equal(docs, `${DOCS_URL}${id}.md`, `${id}: docs URL`);
      assert.ok(existsSync(join(DOCS, `${id}.md`)), `${id}: missing docs/checks/${id}.md`);
      const page = readFileSync(join(DOCS, `${id}.md`), "utf8");
      assert.ok(page.startsWith(`# ${id}\n`), `${id}: the page must start with "# ${id}"`);
      for (const section of ["## Why it matters", "## What it checks", "## How to fix", "## Options", "## Standards"]) assert.ok(page.includes(section), `${id}: docs page needs "${section}"`);
    }
  });

  test("every built-in check that needs no browser or network is triggered by a broken fixture", async () => {
    const covered = new Set<string>();
    for (const name of folders("broken")) {
      const { expected } = await runFixture("broken", name);
      for (const f of expected.findings) covered.add(f.check);
    }
    const missing = builtInChecks.filter((c) => !c.meta.needs.includes("browser") && !c.meta.needs.includes("network")).map((c) => c.meta.id).filter((id) => !covered.has(id));
    assert.deepEqual(missing, [], `these checks have no broken fixture; add one under fixtures/broken/ (see fixtures/README.md)`);
  });

  test("check IDs are unique", () => {
    const ids = [...builtInChecks, ...SUPPRESSION_CHECKS].map((c) => c.meta.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("a clean fixture exists", () => {
    assert.ok(folders("clean").length > 0);
  });
});

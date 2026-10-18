// The severity policy of spec/agent-readability/v1.md, as tests: nothing in the agent-readability pack is ever an error.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { builtInChecks } from "../src/checks/index.js";
import { verifySite } from "../src/verify.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const readability = builtInChecks.filter((c) => c.meta.id.startsWith("readability."));
const NOW = new Date("2027-01-01T00:00:00Z");

test("no readability check has error as its default severity", () => {
  assert.ok(readability.length >= 10, "the readability pack is registered");
  for (const check of readability) assert.ok(check.meta.severity === "warning" || check.meta.severity === "note", `${check.meta.id} defaults to ${check.meta.severity}`);
});

test("no finding from a readability check is an error, on any broken fixture", async () => {
  const dir = join(ROOT, "fixtures", "broken");
  const names = readdirSync(dir).filter((n) => n.startsWith("readability-"));
  assert.ok(names.length >= 10, "the readability fixtures exist");
  for (const name of names) {
    const { report } = await verifySite({ folder: join(dir, name, "site"), rootLabel: "site", checks: readability, now: NOW });
    for (const finding of report.findings) assert.notEqual(finding.severity, "error", `${finding.checkId} in ${name}/${finding.location.file}`);
  }
});

test("the spec lists exactly the readability checks that exist, with severities that match", () => {
  const spec = readFileSync(join(ROOT, "spec", "agent-readability", "v1.md"), "utf8");
  const section = spec.slice(spec.indexOf("## Checks"), spec.indexOf("## The score"));
  const rows = [...section.matchAll(/^\| `(readability\.[a-z0-9-]+)` \|[^|]*\|[^|]*\| ([^|]+) \|/gm)].map((m) => ({ id: m[1] as string, severity: (m[2] as string).trim() }));
  assert.deepEqual(rows.map((r) => r.id).sort(), readability.map((c) => c.meta.id).sort());
  for (const row of rows) assert.ok(!/error/i.test(row.severity.replace(/never error/i, "")), `${row.id}: the spec must not allow error (${row.severity})`);
});

test("every readability docs page says what happens when the thing is absent or a draft", () => {
  for (const check of readability) {
    const page = join(ROOT, "docs", "checks", `${check.meta.id}.md`);
    assert.ok(existsSync(page), check.meta.id);
    const text = readFileSync(page, "utf8");
    assert.match(text, /Agent-readability spec/, `${check.meta.id} links the spec`);
    assert.match(text, /not reported|never|only a note|is optional|opt-in/i, `${check.meta.id} says that absence or severity is deliberate`);
  }
});

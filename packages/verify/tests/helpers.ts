import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after } from "node:test";

const made: string[] = [];

/** Writes a built site to a temp folder: a map of relative path to file content. Cleaned up after the test file. */
export function makeSite(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "seaworthy-test-"));
  made.push(root);
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

after(() => {
  for (const root of made) rmSync(root, { recursive: true, force: true });
});

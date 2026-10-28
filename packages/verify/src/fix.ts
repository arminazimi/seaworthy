// `seaworthy fix --dry-run`: every edit the suggested fixes would make, as ONE unified diff.
//
// A finding turns into diff lines when its fix carries text-anchored edits (`kind: "edit"`)
// whose anchors still match the built output. Manual fixes, edits that need content only a
// person can supply (such as alt text), and edits whose anchor text is no longer where the
// check found it degrade to manual guidance on stderr. Seaworthy writes nothing: the diff is
// a preview an agent or a person applies with `git apply`.

import type { Finding, Location, Severity } from "./types.js";
import { unifiedDiff } from "./udiff.js";

export interface ManualFix {
  checkId: string;
  severity: Severity;
  message: string;
  location: Location;
  /** The fix hint from the finding, for manual work. */
  summary: string;
  /** Why the finding could not be turned into a diff hunk. */
  reason: string;
}

export interface FixPreview {
  /** One unified diff covering every plannable edit across every file. Empty when none apply. */
  diff: string;
  /** Distinct edits planned (findings that propose the same edit share one). */
  edits: number;
  /** Files the plans touch. */
  files: number;
  manual: readonly ManualFix[];
}

interface Planned {
  file: string;
  line: number;
  find: string;
  replace: string;
  key: string;
}

/**
 * Turns a report into a fix preview. `readFile` returns a site file's text or undefined when
 * it is missing; paths are relative to the site root and are user input: read, never evaluated.
 */
export function planFix(report: Finding[], readFile: (file: string) => string | undefined): FixPreview {
  const manual: ManualFix[] = [];
  let edits = 0;
  // Working copies, so a finding's edits apply to a file once even when several findings touch it.
  const working = new Map<string, string[]>();
  const originals = new Map<string, string>();
  const applied = new Set<string>();
  const touched = new Set<string>();

  const push = (finding: Finding, reason: string): void => {
    manual.push({ checkId: finding.checkId, severity: finding.severity, message: finding.message, location: finding.location, summary: finding.fix.summary, reason });
  };

  for (const finding of report) {
    const proposed = finding.fix.kind === "edit" ? finding.fix.edits : [];
    if (proposed.length === 0) {
      push(finding, "manual: the check has no edit for this case");
      continue;
    }
    if (proposed.some((e) => e.needsInput === true)) {
      push(finding, "needs input: the edit inserts content only a person can supply");
      continue;
    }
    // Verify every anchor against the current working copies, then commit the whole finding's
    // edits together, so a finding is either fully planned or fully manual.
    const staged: Planned[] = [];
    let reason: string | undefined;
    const seenHere = new Set<string>();
    for (const edit of proposed) {
      const key = JSON.stringify([edit.file, edit.line, edit.find, edit.replace]);
      if (applied.has(key) || seenHere.has(key)) continue; // an earlier finding already plans this edit
      seenHere.add(key);
      if (!working.has(edit.file)) {
        const text = readFile(edit.file);
        if (text === undefined) {
          reason = `missing file: ${edit.file} is not in the site`;
          break;
        }
        originals.set(edit.file, text);
        working.set(edit.file, text.split("\n"));
      }
      const lines = working.get(edit.file)!;
      const line = lines[edit.line - 1];
      if (line === undefined) {
        reason = `missing line: ${edit.file} has no line ${edit.line}`;
        break;
      }
      if (!line.includes(edit.find)) {
        reason = `stale anchor: "${edit.find}" is no longer on line ${edit.line} of ${edit.file}`;
        break;
      }
      staged.push({ file: edit.file, line: edit.line, find: edit.find, replace: edit.replace, key });
    }
    if (reason !== undefined) {
      push(finding, reason);
      continue;
    }
    for (const plan of staged) {
      const lines = working.get(plan.file)!;
      lines[plan.line - 1] = lines[plan.line - 1]!.replace(plan.find, () => plan.replace);
      applied.add(plan.key);
      touched.add(plan.file);
      edits++;
    }
  }

  // Deterministic output: files in sorted order, each as one diff. A no-op edit changes nothing.
  const diffs: string[] = [];
  for (const file of [...touched].sort()) {
    const text = unifiedDiff(originals.get(file)!, working.get(file)!.join("\n"), file);
    if (text !== "") diffs.push(text);
  }
  return { diff: diffs.join(""), edits, files: diffs.length, manual };
}

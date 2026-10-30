// Ready-to-paste prompts for agents, generated once in buildReport so that every
// output format prints identical text. They contain only what every format already
// shows: the check ID, the location, the fix, and — when a source mapping names it —
// the source file and line, the same ones the report's `sourceLocation` carries.
// No private run state, no absolute paths, no timestamps, so the same site yields the
// same prompt everywhere.

import { describeLocation } from "./formats/pretty.js";
import type { Edit, Finding } from "./types.js";

/** The finding's file relative to where verify ran, like the terminal report prints it. */
function withRoot(root: string, file: string): string {
  return root === "." ? file : `${root}/${file}`;
}

function where(finding: Finding, root: string): string {
  const position = describeLocation(finding);
  return position === "-" ? withRoot(root, finding.location.file) : `${withRoot(root, finding.location.file)}:${position}`;
}

/**
 * Exact edit content, quoted so it survives every output format. Double quotes need
 * JSON.stringify's escape, so single quotes keep the plain text readable; content with
 * one falls back to JSON quoting. Either way the text is deterministic.
 */
const quote = (text: string): string => (text.includes("'") ? JSON.stringify(text) : `'${text}'`);

function editPart(edit: Edit): string {
  const replacement = edit.needsInput ? "content you choose" : quote(edit.replace);
  return `on line ${edit.line}, replace ${quote(edit.find)} with ${replacement}`;
}

function editsPart(edits: readonly Edit[]): string | undefined {
  if (edits.length === 0) return undefined;
  return `Edit: ${edits.map(editPart).join(" and ")}.`;
}

/** The verify command the instructions tell the agent to re-run at the end. */
function verifyCommand(root: string): string {
  return root === "." ? "seaworthy verify" : `seaworthy verify ${root}`;
}

/** Whether finding A's line sorts before B's; findings without a line sort last. */
const beforeLine = (a: Finding, b: Finding): number =>
  (a.location.line ?? Number.MAX_SAFE_INTEGER) - (b.location.line ?? Number.MAX_SAFE_INTEGER) ||
  (a.location.column ?? 0) - (b.location.column ?? 0);

/**
 * Where the source is, when a mapping says: `docs/guide.md:41`. The path is repository-relative, so
 * unlike a finding location it never carries the verified folder — the source is not in it.
 */
function sourcePosition(finding: Finding): string | undefined {
  const source = finding.sourceLocation;
  if (source === undefined) return undefined;
  return `${source.file}${source.line === undefined ? "" : `:${source.line}`}${source.column === undefined ? "" : `:${source.column}`}`;
}

/** ` Source is docs/guide.md:41.`, or nothing when no mapping names the source. */
function sourceNote(finding: Finding): string {
  const source = sourcePosition(finding);
  return source === undefined ? "" : ` Source is ${source}.`;
}

/** One line per finding: what is wrong, where, and how to fix it. */
export function findingPrompt(finding: Finding, root: string): string {
  const parts = [
    `Fix this Seaworthy finding. Check ${finding.checkId} (${finding.severity}) at ${where(finding, root)}${finding.location.line === undefined ? " (no exact line is known)" : ""}. ${finding.message}`,
    `Fix: ${finding.fix.summary}.`,
  ];
  if (finding.location.approximateLine === true) parts.push("The line is approximate; confirm it in the file before editing.");
  const edits = editsPart(finding.fix.edits);
  if (edits) parts.push(edits);
  const source = sourcePosition(finding);
  parts.push(
    source === undefined
      ? "The location is the built output; apply the same fix in the source that generates it, rebuild, then re-run seaworthy verify to confirm the finding is gone."
      : `The location is the built output; its source is ${source}, so edit that file, rebuild, then re-run seaworthy verify to confirm the finding is gone.`,
  );
  return parts.join(" ");
}

/** One prompt for the whole report: every finding in report order, ready to paste. */
export function reportPrompt(findings: readonly Finding[], root: string): string {
  const line = root === "." ? "Each location is the built output the verification ran on" : `Each location is the built output (${root})`;
  const lines = [
    `Fix every Seaworthy finding below, in the order given. ${line}, so apply the same fix in the source that generates it, rebuild once at the end, then run ${verifyCommand(root)} and confirm every finding is gone.`,
  ];
  for (const [index, finding] of findings.entries()) lines.push(`${index + 1}. ${where(finding, root)} ${finding.checkId} (${finding.severity}): ${finding.message} Fix: ${finding.fix.summary}${sourceNote(finding)}`);
  return lines.join("\n");
}

/**
 * The exported working prompt: every finding, grouped by file so the agent opens each file
 * once. Groups are ordered by finding count ascending (files with the fewest findings first,
 * so quick wins land early and a systematically broken template comes last once the agent is
 * warmed up), ties broken by file path for determinism. Within a file, findings keep the
 * report's line order, so the edits read top-down. Every line reuses the shared finding
 * wording, so the two whole-report prompts say the same thing about the same finding.
 */
export function groupedReportPrompt(findings: readonly Finding[], root: string): string {
  if (findings.length === 0) return `No Seaworthy findings. Nothing to fix; run ${verifyCommand(root)} to confirm.`;
  const built = root === "." ? "Each location is the built output the verification ran on" : `Each location is the built output (${root})`;
  const lines = [
    `Fix every Seaworthy finding below, grouped by file so you open each file once. Files with the fewest findings come first; within a file, findings are in line order. ${built}, so apply the same fix in the source that generates it, rebuild once at the end, then run ${verifyCommand(root)} and confirm every finding is gone.`,
  ];
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const group = groups.get(finding.location.file);
    if (group) group.push(finding);
    else groups.set(finding.location.file, [finding]);
  }
  const ordered = [...groups].sort((a, b) => a[1].length - b[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [file, group] of ordered) {
    lines.push("", `${withRoot(root, file)} — ${group.length} finding${group.length === 1 ? "" : "s"}`);
    for (const finding of [...group].sort(beforeLine)) {
      const edits = editsPart(finding.fix.edits);
      const approximate = finding.location.approximateLine === true ? " The line is approximate; confirm it in the file before editing." : "";
      lines.push(`- ${where(finding, root)} ${finding.checkId} (${finding.severity}): ${finding.message} Fix: ${finding.fix.summary}${approximate}${edits ? ` ${edits}` : ""}${sourceNote(finding)}`);
    }
  }
  return lines.join("\n");
}

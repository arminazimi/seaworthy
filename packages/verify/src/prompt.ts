// Ready-to-paste prompts for agents, generated once in buildReport so that every
// output format prints identical text. They contain only what every format already
// shows: the check ID, the location, and the fix. No private run state, no absolute
// paths, no timestamps, so the same site yields the same prompt everywhere.

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

/** One line per finding: what is wrong, where, and how to fix it. */
export function findingPrompt(finding: Finding, root: string): string {
  const parts = [
    `Fix this Seaworthy finding. Check ${finding.checkId} (${finding.severity}) at ${where(finding, root)}${finding.location.line === undefined ? " (no exact line is known)" : ""}. ${finding.message}`,
    `Fix: ${finding.fix.summary}.`,
  ];
  if (finding.location.approximateLine === true) parts.push("The line is approximate; confirm it in the file before editing.");
  const edits = editsPart(finding.fix.edits);
  if (edits) parts.push(edits);
  parts.push("The location is the built output; apply the same fix in the source that generates it, rebuild, then re-run seaworthy verify to confirm the finding is gone.");
  return parts.join(" ");
}

/** One prompt for the whole report: every finding in report order, ready to paste. */
export function reportPrompt(findings: readonly Finding[], root: string): string {
  const line = root === "." ? "Each location is the built output the verification ran on" : `Each location is the built output (${root})`;
  const verify = root === "." ? "seaworthy verify" : `seaworthy verify ${root}`;
  const lines = [
    `Fix every Seaworthy finding below, in the order given. ${line}, so apply the same fix in the source that generates it, rebuild once at the end, then run ${verify} and confirm every finding is gone.`,
  ];
  for (const [index, finding] of findings.entries()) lines.push(`${index + 1}. ${where(finding, root)} ${finding.checkId} (${finding.severity}): ${finding.message} Fix: ${finding.fix.summary}`);
  return lines.join("\n");
}

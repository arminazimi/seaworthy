// SARIF 2.1.0 output for GitHub code scanning and other SARIF consumers. See ADR 0006 and ADR 0008.

import type { Finding, Report } from "../types.js";

export interface SarifContext {
  /** Returns the text of one line (1-based) of a site file, so edits can be turned into exact SARIF regions. */
  readLine?: (file: string, line: number) => string | undefined;
}

const INFORMATION_URI = "https://github.com/arminazimi/seaworthy";
export const SARIF_FINGERPRINT_KEY = "seaworthy/v1";

/** Locations are relative to where verify ran (the repository root in CI): the report root joined with the file. */
export function sarifUri(report: Report, file: string): string {
  const path = report.root === "." ? file : `${report.root.replace(/^\.\//, "")}/${file}`;
  return path.split("/").map(encodeURIComponent).join("/");
}

function fixesFor(report: Report, finding: Finding, context: SarifContext): object[] {
  const fixes: object[] = [];
  for (const edit of finding.fix.edits) {
    const text = context.readLine?.(edit.file, edit.line);
    const at = text?.indexOf(edit.find) ?? -1;
    if (at < 0) continue; // the text moved or the source is unavailable: omit rather than guess
    fixes.push({
      description: { text: finding.fix.summary },
      artifactChanges: [
        {
          artifactLocation: { uri: sarifUri(report, edit.file) },
          replacements: [
            {
              deletedRegion: { startLine: edit.line, startColumn: at + 1, endColumn: at + 1 + edit.find.length },
              insertedContent: { text: edit.replace },
            },
          ],
        },
      ],
    });
  }
  return fixes;
}

export function toSarif(report: Report, context: SarifContext = {}): object {
  const ruleIndex = new Map(report.checks.map((check, index) => [check.id, index]));
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: report.tool.name,
            version: report.tool.version,
            informationUri: INFORMATION_URI,
            rules: report.checks.map((check) => ({
              id: check.id,
              name: check.id,
              shortDescription: { text: check.title },
              helpUri: check.docs,
              defaultConfiguration: { level: check.severity },
              properties: { tags: [...check.standards, ...check.needs.filter((n) => n === "browser" || n === "network").map((n) => `needs-${n}`)] },
            })),
          },
        },
        results: report.findings.map((finding) => {
          const fixes = fixesFor(report, finding, context);
          return {
            ruleId: finding.checkId,
            ruleIndex: ruleIndex.get(finding.checkId),
            level: finding.severity,
            message: { text: finding.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: sarifUri(report, finding.location.file) },
                  // Code scanning needs a line; findings without one anchor to the top of the file.
                  region: { startLine: finding.location.line ?? 1, ...(finding.location.column === undefined ? {} : { startColumn: finding.location.column }) },
                },
              },
            ],
            partialFingerprints: { [SARIF_FINGERPRINT_KEY]: finding.fingerprint },
            properties: {
              fixSummary: finding.fix.summary,
              ...(finding.location.selector === undefined ? {} : { selector: finding.location.selector }),
              ...(finding.location.approximateLine ? { approximateLine: true } : {}),
            },
            ...(fixes.length > 0 ? { fixes } : {}),
          };
        }),
        invocations: [
          {
            executionSuccessful: report.errors.length === 0,
            toolExecutionNotifications: [
              ...report.skipped.map((s) => ({ level: "note", message: { text: `${s.check} did not run: ${s.reason}. ${s.hint}` }, descriptor: { id: s.check } })),
              ...report.errors.map((e) => ({ level: "error", message: { text: `${e.check} crashed: ${e.message}` }, descriptor: { id: e.check } })),
            ],
          },
        ],
      },
    ],
  };
}

export function formatSarif(report: Report, context: SarifContext = {}): string {
  return JSON.stringify(toSarif(report, context), null, 2) + "\n";
}

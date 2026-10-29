// `seaworthy history [--format csv|json] [--out <file>]`: export the runs recorded in
// .seaworthy/history. Reading only — this command never writes to the store, and never
// creates one. Without --out the export goes to stdout; --out writes it to a file and
// prints a one-line summary, like `verify --out`.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { readHistory, stableStringify, type HistoryRecord } from "../history.js";
import { EXIT, UsageError, type CliEnvironment, type CliResult } from "./types.js";

const FORMATS = ["csv", "json"] as const;
type ExportFormat = (typeof FORMATS)[number];

const HISTORY_HELP = `seaworthy history

Export the run summaries that \`verify\` records in .seaworthy/history, newest of the last 30 runs included.
The command only reads: it never writes to the store, and a missing store exports as empty, not as an error.

Usage:
  seaworthy history [--format csv|json] [--out <file>]

Options:
  --format <format>    csv or json. Default json: the stored records as an array, oldest run first,
                       with the keys and timestamps exactly as they are on disk.
  --out <file>         Write the export to a file instead of stdout; prints a one-line summary instead.
  --help, -h           Print this help

csv:
  One row per run, oldest first: runAt, root, findings, errors, warnings, notes, then one check:<id>
  column per check present in the store, sorted alphabetically. A count a run does not carry is an
  empty cell, never an invented zero. Minimal RFC-4180 quoting, \\n line endings, no BOM.

Exit codes:
  0  the export completed
  2  usage error
`;

/**
 * One row per run, header first. Severity columns are fixed (`errors, warnings, notes`); a check
 * column appears once per ID present in the store, so the columns are deterministic for a store.
 */
export function historyToCsv(records: readonly HistoryRecord[]): string {
  const checkIds = [...new Set(records.flatMap((r) => Object.keys(r.counts?.byCheck ?? {})))].sort();
  const rows: string[] = [csvRow(["runAt", "root", "findings", "errors", "warnings", "notes", ...checkIds.map((id) => `check:${id}`)])];
  for (const record of records) {
    const counts = record.counts;
    const cells = [
      record.started ?? "",
      record.root ?? "",
      text(counts?.findings),
      text(counts?.bySeverity?.error),
      text(counts?.bySeverity?.warning),
      text(counts?.bySeverity?.note),
      ...checkIds.map((id) => text(counts?.byCheck?.[id])),
    ];
    rows.push(csvRow(cells));
  }
  return rows.join("\n") + "\n";
}

/** A count as text; a count the run does not carry is an empty cell. */
function text(count: number | undefined): string {
  return count === undefined ? "" : String(count);
}

/** Quote only what needs it (comma, quote, CR or LF), doubling embedded quotes, per RFC-4180. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Header and row cells all go through the escaper. */
function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(",");
}

export async function historyCommand(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  if (args.includes("-h") || args.includes("--help")) return { code: EXIT.ok, stdout: HISTORY_HELP, stderr: "" };

  let format: ExportFormat = "json";
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    if (flag === "--format" || flag === "--out") {
      const given = inline ?? args[i + 1];
      if (given === undefined || given.startsWith("--")) throw new UsageError(`${flag} needs a value`);
      if (flag === "--format") {
        if (!(FORMATS as readonly string[]).includes(given)) throw new UsageError(`unknown format "${given}"; use ${FORMATS.join(", ")}`);
        format = given as ExportFormat;
      } else {
        if (out !== undefined) throw new UsageError(`give --out once, not twice ("${out}" and "${given}")`);
        out = given;
      }
      if (inline === undefined) i++;
      continue;
    }
    if (arg.startsWith("-")) throw new UsageError(`unknown option ${flag}`);
    throw new UsageError(`unexpected argument "${arg}"; history takes no folder, it reads .seaworthy/history where it runs`);
  }

  const cwd = env.cwd ?? process.cwd();
  const records = readHistory(cwd);
  // stableStringify: sorted keys, fixed timestamps as stored, trailing newline — byte-identical
  // across platforms, like every other JSON this CLI writes.
  const text = format === "csv" ? historyToCsv(records) : stableStringify(records);

  if (out !== undefined) {
    const target = resolve(cwd, out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    const n = records.length;
    const runs = n === 0 ? "no runs recorded" : `${n} run${n === 1 ? "" : "s"}`;
    return { code: EXIT.ok, stdout: `seaworthy: ${runs}; ${format} history written to ${out}\n`, stderr: "" };
  }
  return { code: EXIT.ok, stdout: text, stderr: "" };
}

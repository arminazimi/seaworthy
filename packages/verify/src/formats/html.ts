// Self-contained HTML report for people: summary counts at the top, findings
// grouped by file and check with severity colors, and small vanilla-JS filters
// for severity, check, and file substring. The page is one file with inline CSS
// and JS: no external requests, no timestamps, so the same report always yields
// byte-identical output. Site contents are untrusted input, so every value is
// escaped before it enters the markup (see the attacker-fixture test).

import { SEVERITIES, type Finding, type Report, type Severity } from "../types.js";
import type { Formatter } from "./base.js";
import { describeLocation, readabilityLine } from "./pretty.js";

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

const SEV_CLASS: Record<Severity, string> = { error: "error", warning: "warn", note: "note" };

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #fdfdfc; --fg: #1f242a; --muted: #66707c; --line: #dbe1e8; --panel: #f3f5f7;
  --error: #b42318; --warning: #94571a; --note: #1a5fb4;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14181d; --fg: #e6eaee; --muted: #98a3ae; --line: #2a3138; --panel: #1c2228;
    --error: #f97066; --warning: #e6ab54; --note: #7ab1f5;
  }
}
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 60rem; padding: 1.5rem 1rem 3rem; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--fg); }
h1 { margin: 0; font-size: 1.35rem; }
h2, h3, p { margin: 0.25rem 0; }
code { font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace; font-size: 0.9em; }
header .meta, .notes li { color: var(--muted); }
.counts { margin-top: 0.5rem; }
.error, .warn, .note { color: var(--error); }
.warn { color: var(--warning); }
.note { color: var(--note); }
section.file, aside { display: block; border: 1px solid var(--line); border-radius: 0.6rem; padding: 0.75rem 1rem; margin: 1rem 0; background: var(--panel); }
h2 { font-size: 1.05rem; }
h3 { font-size: 0.95rem; }
h2 .title, h3 .title { color: var(--muted); font-weight: 400; margin-left: 0.5rem; }
ul.findings { list-style: none; margin: 0.5rem 0 0; padding: 0; }
li.finding { border: 1px solid var(--line); border-radius: 0.4rem; padding: 0.5rem 0.75rem; margin: 0.5rem 0; }
li.finding .sev { color: var(--bg); background: currentcolor; border-radius: 0.3rem; padding: 0.05rem 0.45rem; font-size: 0.75rem; font-weight: 600; }
li.finding .loc { margin-left: 0.6rem; }
li.finding .msg { white-space: pre-wrap; }
li.finding .fix { color: var(--muted); font-size: 0.9rem; }
li.finding details pre { white-space: pre-wrap; font: ui-monospace, monospace; margin: 0.25rem 0; }
li.finding details summary { cursor: pointer; color: var(--muted); font-size: 0.85rem; }
#filters { border: 1px solid var(--line); border-radius: 0.6rem; padding: 0.6rem 1rem; margin: 1.25rem 0 0.5rem; }
#filters span.sevbtns { display: inline-flex; gap: 0.35rem; margin-right: 1rem; }
#filters .sev { border: 1px solid var(--line); border-radius: 0.3rem; padding: 0.15rem 0.6rem; background: transparent; color: inherit; font: inherit; font-size: 0.85rem; cursor: pointer; }
#filters .sev.on { background: var(--fg); border-color: var(--fg); color: var(--bg); }
#filters label { margin-right: 1rem; }
#filters input { margin: 0 0.35rem 0 0.25rem; }
#filter-status { color: var(--muted); font-size: 0.85rem; }
#findings .count { color: var(--muted); font-weight: 400; margin-left: 0.4rem; }
footer { color: var(--muted); font-size: 0.85rem; }
`;

// Plain ES5 in two passes: filters hide rows, then containers left with no
// visible rows. Everything reads data-* attributes written from escaped text.
const JS = `
(function () {
  "use strict";
  var buttons = Array.prototype.slice.call(document.querySelectorAll("#filters .sev"));
  var rows = Array.prototype.slice.call(document.querySelectorAll("#findings .finding"));
  var slots = Array.prototype.slice.call(document.querySelectorAll("#findings .file, #findings .check, #findings ul.findings"));
  var checkInput = document.getElementById("filter-check");
  var fileInput = document.getElementById("filter-file");
  var status = document.getElementById("filter-status");
  var sev = "all";
  function apply() {
    var check = checkInput ? checkInput.value.toLowerCase() : "";
    var file = fileInput ? fileInput.value.toLowerCase() : "";
    var shown = 0;
    rows.forEach(function (row) {
      var dataCheck = row.getAttribute("data-check").toLowerCase();
      var dataFile = row.getAttribute("data-file").toLowerCase();
      var on = (sev === "all" || row.getAttribute("data-sev") === sev)
        && (check === "" || dataCheck.indexOf(check) !== -1)
        && (file === "" || dataFile.indexOf(file) !== -1);
      if (on) { row.removeAttribute("hidden"); shown = shown + 1; }
      else { row.setAttribute("hidden", ""); }
    });
    slots.forEach(function (slot) {
      var any = slot.querySelector(".finding:not([hidden])");
      if (any) { slot.removeAttribute("hidden"); }
      else { slot.setAttribute("hidden", ""); }
    });
    if (status) { status.textContent = shown + " of " + rows.length + " finding" + (rows.length === 1 ? "" : "s"); }
  }
  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      sev = button.getAttribute("data-sev");
      buttons.forEach(function (other) { other.classList.toggle("on", other === button); });
      apply();
    });
  });
  [checkInput, fileInput].forEach(function (input) {
    if (input) { input.addEventListener("input", apply); }
  });
  apply();
})();
`;

function findingRow(finding: Finding): string {
  const sev = SEV_CLASS[finding.severity];
  const prompt = finding.prompt === undefined ? "" : `<details class="prompt"><summary>agent prompt</summary><pre>${escapeHtml(finding.prompt)}</pre></details>`;
  return `<li class="finding ${sev}" data-sev="${finding.severity}" data-check="${escapeHtml(finding.checkId)}" data-file="${escapeHtml(finding.location.file)}">`
    + `<p><span class="sev ${sev}">${finding.severity}</span><code class="loc">${escapeHtml(describeLocation(finding))}</code></p>`
    + `<p class="msg">${escapeHtml(finding.message)}</p>`
    + `<p class="fix">fix: ${escapeHtml(finding.fix.summary)}</p>`
    + prompt
    + `</li>`;
}

/** Findings grouped by file, then by check, both in report order (deterministic). */
function findingSections(report: Report): string {
  const titles = new Map(report.checks.map((check) => [check.id, check.title]));
  const files: { file: string; checks: { check: string; items: Finding[] }[] }[] = [];
  for (const finding of report.findings) {
    let file = files.find((group) => group.file === finding.location.file);
    if (file === undefined) { file = { file: finding.location.file, checks: [] }; files.push(file); }
    let check = file.checks.find((group) => group.check === finding.checkId);
    if (check === undefined) { check = { check: finding.checkId, items: [] }; file.checks.push(check); }
    check.items.push(finding);
  }
  return files.map((file) => {
    const inFile = file.checks.reduce((n, check) => n + check.items.length, 0);
    return `<section class="file">`
      + `<h2><code>${escapeHtml(file.file)}</code><span class="count">${inFile} ${inFile === 1 ? "finding" : "findings"}</span></h2>`
      + file.checks.map((check) => {
        const title = titles.get(check.check);
        return `<section class="check">`
          + `<h3><code>${escapeHtml(check.check)}</code>${title === undefined ? "" : `<span class="title">${escapeHtml(title)}</span>`}<span class="count">${check.items.length}</span></h3>`
          + `<ul class="findings">${check.items.map(findingRow).join("")}</ul>`
          + `</section>`;
      }).join("")
      + `</section>`;
  }).join("");
}

function severityCountsPart(report: Report): string {
  const parts: string[] = [];
  for (const severity of SEVERITIES) {
    const count = report.summary.bySeverity[severity];
    if (count) parts.push(`<span class="${SEV_CLASS[severity]}">${plural(count, severity)}</span>`);
  }
  return parts.join(", ");
}

function notes(report: Report): string {
  const items: string[] = [];
  if (report.summary.changedFiles !== undefined) items.push(`Scope: findings in the ${plural(report.summary.changedFiles, "file")} that changed.`);
  if (report.summary.suppressed > 0) items.push(`${plural(report.summary.suppressed, "finding")} suppressed on purpose.`);
  if (report.summary.baselined > 0) items.push(`${plural(report.summary.baselined, "finding")} accepted by the baseline.`);
  if (report.summary.baselineStale > 0) items.push(`${plural(report.summary.baselineStale, "baseline entry")} fixed: run --update-baseline to prune.`);
  const readability = readabilityLine(report);
  if (readability) items.push(readability);
  return items.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
}

function asides(report: Report): string {
  const parts: string[] = [];
  if (report.skipped.length > 0) {
    parts.push(`<aside><h2>Skipped, not run</h2><ul>`
      + report.skipped.map((s) => `<li><code>${escapeHtml(s.check)}</code>: ${escapeHtml(s.reason)} ${escapeHtml(s.hint)}</li>`).join("")
      + `</ul></aside>`);
  }
  if (report.errors.length > 0) {
    parts.push(`<aside><h2>Check errors, these checks crashed</h2><ul>`
      + report.errors.map((e) => `<li><code>${escapeHtml(e.check)}</code>: ${escapeHtml(e.message)}</li>`).join("")
      + `</ul></aside>`);
  }
  return parts.join("");
}

export function formatHtml(report: Report): string {
  const total = report.summary.findings;
  const counts = severityCountsPart(report);
  const summaryPart = total === 0
    ? `<p class="counts">No findings.</p>`
    : [`<p class="counts">${plural(total, "finding")}: ${counts}</p>`, `<ul class="notes">${notes(report)}</ul>`].join("");
  const prompt = report.prompt === undefined ? "" : `<details class="reportprompt"><summary>prompt to fix every finding</summary><pre>${escapeHtml(report.prompt)}</pre></details>`;

  return ([
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>Seaworthy ${escapeHtml(report.tool.version)}: ${escapeHtml(report.root)} — ${total === 0 ? "no findings" : plural(total, "finding")}</title>`,
    `<style>${CSS}</style>`,
    `</head>`,
    `<body>`,
    `<header>`,
    `<h1>Seaworthy</h1>`,
    `<p class="meta">${escapeHtml(report.root)}: ${plural(report.summary.pages, "page")}, ${plural(report.checks.length, "check")} · report spec ${report.spec}</p>`,
    summaryPart,
    `</header>`,
    total === 0 ? "" : `<fieldset id="filters">`
      + `<legend>Filter</legend>`
      + `<span class="sevbtns"><button type="button" class="sev on" data-sev="all">all</button>`
      + `<button type="button" class="sev" data-sev="error">errors</button>`
      + `<button type="button" class="sev" data-sev="warning">warnings</button>`
      + `<button type="button" class="sev" data-sev="note">notes</button></span>`
      + `<label>check <input id="filter-check" type="search" spellcheck="false" autocomplete="off"></label>`
      + `<label>file <input id="filter-file" type="search" spellcheck="false" autocomplete="off"></label>`
      + `<p id="filter-status" aria-live="polite"></p>`
      + `</fieldset>`,
    total === 0 ? "" : `<main id="findings">${findingSections(report)}</main>`,
    prompt,
    asides(report),
    total === 0 ? "" : `<script>${JS}</script>`,
    `<footer>Seaworthy ${escapeHtml(report.tool.version)} · <code>seaworthy verify ${escapeHtml(report.root)} --format html</code></footer>`,
    `</body>`,
    `</html>`,
  ]).join("") + "\n";
}

export const render: Formatter = (report) => formatHtml(report);

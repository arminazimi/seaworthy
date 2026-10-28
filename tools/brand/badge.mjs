// Seaworthy status badge. The README badge is the project's main growth loop, so it is a function
// that the GitHub Action's badge endpoint (task action.badge) can import.

import { markFragment, tokens } from "./mark.mjs";

const color = (name) => tokens.colors[name].value;

export const STATUS = {
  passing: { fill: color("seaTeal"), word: "passing" },
  warnings: { fill: color("signalAmber"), word: "warnings" },
  failing: { fill: color("alertRed"), word: "errors" },
};

const FONT = "Inter, Verdana, Arial, sans-serif";
const CHAR_WIDTH = 7.4; // average advance at 12px bold; labels are short and ASCII
const HEIGHT = 28;
const PAD = 10;
const MARK = 18;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textWidth = (s) => Math.round(s.length * CHAR_WIDTH);

/**
 * @param {"passing"|"warnings"|"failing"} state
 * @param {number} [count] number of warnings or errors; ignored for "passing"
 */
export function badgeSvg(state, count) {
  const s = STATUS[state];
  if (!s) throw new Error(`unknown badge state ${state}`);
  const value = state === "passing" ? s.word : `${count ?? 0} ${count === 1 ? s.word.replace(/s$/, "") : s.word}`;
  const label = "seaworthy";
  const leftW = PAD + MARK + 8 + textWidth(label) + PAD;
  const rightW = PAD + textWidth(value) + PAD;
  const w = leftW + rightW;
  const sand = color("sand");
  const ink = color("ink");
  const text = `${label}: ${value}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${HEIGHT}" viewBox="0 0 ${w} ${HEIGHT}" role="img" aria-label="${esc(text)}">`,
    `<title>${esc(text)}</title>`,
    `<clipPath id="r"><rect width="${w}" height="${HEIGHT}" rx="6"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${leftW}" height="${HEIGHT}" fill="${ink}"/>`,
    `<rect x="${leftW}" width="${rightW}" height="${HEIGHT}" fill="${s.fill}"/>`,
    `</g>`,
    `<g transform="translate(${PAD} ${(HEIGHT - MARK) / 2}) scale(${MARK / 256})">${markFragment("mono")}</g>`,
    `<g fill="${sand}" font-family="${FONT}" font-size="12" font-weight="700" dominant-baseline="central">`,
    `<text x="${PAD + MARK + 8}" y="${HEIGHT / 2 + 0.5}">${label}</text>`,
    `<text x="${leftW + PAD}" y="${HEIGHT / 2 + 0.5}">${esc(value)}</text>`,
    `</g>`,
    `</svg>`,
    ``,
  ].join("\n");
}

/**
 * The README snippet a verified repository pastes into its README to show the badge. `OWNER`, `REPO`,
 * and `BRANCH` are the three placeholders to substitute after the badge file is committed and served
 * (see docs/badge.md). Kept here so the snippet and the badge stay the same artwork (docs/badge.md
 * carries this block verbatim; tools/brand/badge-report.test.mjs enforces it).
 */
export const README_SNIPPET =
  "[![seaworthy verified](https://raw.githubusercontent.com/OWNER/REPO/BRANCH/seaworthy-badge.svg)](https://github.com/arminazimi/seaworthy)";

const isCount = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * The badge endpoint's pure function: a Seaworthy report (as `seaworthy verify --format json` writes
 * it) in, badge state and deterministic SVG bytes out. Same scheme as the default CLI gate
 * (`--fail-on error`): error-severity findings or a crashed check are red `errors`, warnings are
 * amber `warnings`, everything else — notes included — is teal `passing`. The report JSON is
 * untrusted input: parsed, never evaluated, and counts are read only from the summary.
 * @param {unknown} report
 * @returns {{ state: "passing"|"warnings"|"failing", count: number | undefined, svg: string }}
 */
export function badgeForReport(report) {
  if (typeof report !== "object" || report === null || Array.isArray(report)) throw new TypeError("badge: report must be the JSON object `seaworthy verify --format json` writes");
  const summary = report.summary;
  if (typeof summary !== "object" || summary === null || Array.isArray(summary)) throw new TypeError("badge: report.summary must be an object");
  const bySeverity = summary.bySeverity ?? {};
  if (typeof bySeverity !== "object" || bySeverity === null || Array.isArray(bySeverity)) throw new TypeError("badge: report.summary.bySeverity must be an object of counts");
  for (const [severity, count] of Object.entries(bySeverity)) {
    if (!isCount(count)) throw new TypeError(`badge: report.summary.bySeverity.${severity} must be a whole number, got ${JSON.stringify(count)}`);
  }
  const checkErrors = report.errors ?? [];
  if (!Array.isArray(checkErrors)) throw new TypeError("badge: report.errors must be an array");
  const errors = (bySeverity.error ?? 0) + checkErrors.length;
  const warnings = bySeverity.warning ?? 0;
  if (errors > 0) return { state: "failing", count: errors, svg: badgeSvg("failing", errors) };
  if (warnings > 0) return { state: "warnings", count: warnings, svg: badgeSvg("warnings", warnings) };
  return { state: "passing", count: undefined, svg: badgeSvg("passing") };
}

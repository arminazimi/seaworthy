// Badge artwork and the report-to-state mapping for Seaworthy: one pure module that needs nothing
// but Node builtins, so `seaworthy-badge` runs from an installed @seaworthy/action with no Seaworthy
// checkout. tools/brand/badge.mjs re-exports this module (BRAND_GUIDE.md: one source for every
// badge); tools/brand/badge-report.test.mjs pins these bytes to brand/tokens.json and mark.mjs.
// The report JSON is untrusted input: parsed, never evaluated.

/** Badge states, and the count and wording each one shows: the words the checks count report. */
export type BadgeState = "passing" | "warnings" | "failing";

/** The output of the badge endpoint: the state the SVG shows, the count behind it, and the bytes. */
export interface Badge {
  state: BadgeState;
  /** Findings or crashed checks that put the badge in this state; undefined while passing. */
  count?: number | undefined;
  /** Deterministic SVG bytes; the same report always produces the same value. */
  svg: string;
}

/** The counts the badge is painted with: the status colors from brand/tokens.json. */
const COLOR = {
  seaTeal: "#2F6F73",
  signalAmber: "#8A5A00",
  alertRed: "#B3261E",
  sand: "#F6EEE9",
  ink: "#2A1F2D",
} as const;

/** State to segment color and wording. "failing" says "errors", the phrases the gate reports. */
export const STATUS: Record<BadgeState, { fill: string; word: string }> = {
  passing: { fill: COLOR.seaTeal, word: "passing" },
  warnings: { fill: COLOR.signalAmber, word: "warnings" },
  failing: { fill: COLOR.alertRed, word: "errors" },
};

const FONT = "Inter, Verdana, Arial, sans-serif";
const CHAR_WIDTH = 7.4; // average advance at 12px bold; labels are short and ASCII
const HEIGHT = 28;
const PAD = 10;
const MARK = 18;

/**
 * The mark in its `mono` variant, the way tools/brand/mark.mjs `markFragment("mono")` draws it:
 * two open rings and the waterline, all in the sand color, at the 256 × 256 geometry the badge
 * scales down. Inlined so the package needs no checkout; the byte identity is pinned per report
 * by tools/brand/badge-report.test.mjs.
 */
const MONO_MARK =
  `<g fill="none" stroke-width="13"><g stroke="${COLOR.sand}">` +
  `<path d="M42.54 107 A88 88 0 0 1 213.46 107"/><path d="M42.54 149 A88 88 0 0 0 213.46 149"/></g>` +
  `<g stroke="${COLOR.sand}"><path d="M71.8 107 A60 60 0 0 1 184.2 107"/><path d="M71.8 149 A60 60 0 0 0 184.2 149"/></g></g>` +
  `<rect x="14" y="121" width="228" height="14" fill="${COLOR.sand}"/>`;

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textWidth = (s: string): number => Math.round(s.length * CHAR_WIDTH);

/**
 * The badge SVG for a state: a pure function of its arguments, the same state and count always in
 * the same bytes. Throws when the state is not `passing`, `warnings`, or `failing`.
 * @param state
 * @param count number of warnings or errors; ignored for "passing"
 */
export function badgeSvg(state: BadgeState, count?: number | undefined): string {
  const s = STATUS[state];
  if (!s) throw new Error(`unknown badge state ${state}`);
  const value = state === "passing" ? s.word : `${count ?? 0} ${count === 1 ? s.word.replace(/s$/, "") : s.word}`;
  const label = "seaworthy";
  const leftW = PAD + MARK + 8 + textWidth(label) + PAD;
  const rightW = PAD + textWidth(value) + PAD;
  const w = leftW + rightW;
  const text = `${label}: ${value}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${HEIGHT}" viewBox="0 0 ${w} ${HEIGHT}" role="img" aria-label="${esc(text)}">`,
    `<title>${esc(text)}</title>`,
    `<clipPath id="r"><rect width="${w}" height="${HEIGHT}" rx="6"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${leftW}" height="${HEIGHT}" fill="${COLOR.ink}"/>`,
    `<rect x="${leftW}" width="${rightW}" height="${HEIGHT}" fill="${s.fill}"/>`,
    `</g>`,
    `<g transform="translate(${PAD} ${(HEIGHT - MARK) / 2}) scale(${MARK / 256})">${MONO_MARK}</g>`,
    `<g fill="${COLOR.sand}" font-family="${FONT}" font-size="12" font-weight="700" dominant-baseline="central">`,
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

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * The badge endpoint's pure function: a Seaworthy report (as `seaworthy verify --format json` writes
 * it) in, badge state and deterministic SVG bytes out. Same scheme as the default CLI gate
 * (`--fail-on error`): error-severity findings or a crashed check are red `errors`, warnings are
 * amber `warnings`, everything else — notes included — is teal `passing`. The report JSON is
 * untrusted input: parsed, never evaluated, and counts are read only from the summary.
 * @param report
 */
export function badgeForReport(report: unknown): Badge {
  if (typeof report !== "object" || report === null || Array.isArray(report)) throw new TypeError("badge: report must be the JSON object `seaworthy verify --format json` writes");
  const summary = (report as { summary?: unknown }).summary;
  if (typeof summary !== "object" || summary === null || Array.isArray(summary)) throw new TypeError("badge: report.summary must be an object");
  const bySeverity = (summary as { bySeverity?: unknown }).bySeverity ?? {};
  if (typeof bySeverity !== "object" || bySeverity === null || Array.isArray(bySeverity)) throw new TypeError("badge: report.summary.bySeverity must be an object of counts");
  for (const [severity, count] of Object.entries(bySeverity)) {
    if (!isCount(count)) throw new TypeError(`badge: report.summary.bySeverity.${severity} must be a whole number, got ${JSON.stringify(count)}`);
  }
  const checkErrors = (report as { errors?: unknown }).errors ?? [];
  if (!Array.isArray(checkErrors)) throw new TypeError("badge: report.errors must be an array");
  // The loop above has validated every count; a missing severity entry contributes nothing.
  const by = bySeverity as { error?: number | undefined; warning?: number | undefined };
  const errors = (by.error ?? 0) + checkErrors.length;
  const warnings = by.warning ?? 0;
  if (errors > 0) return { state: "failing", count: errors, svg: badgeSvg("failing", errors) };
  if (warnings > 0) return { state: "warnings", count: warnings, svg: badgeSvg("warnings", warnings) };
  return { state: "passing", count: undefined, svg: badgeSvg("passing") };
}

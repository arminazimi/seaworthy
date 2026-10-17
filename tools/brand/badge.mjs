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

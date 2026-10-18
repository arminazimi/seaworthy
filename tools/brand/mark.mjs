// Seaworthy mark geometry and brand tokens. Single source for every generated brand asset.
// The mark is two concentric rings (static checks outside, rendered checks inside) crossed by a
// waterline. The rings open where the line passes through.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const BRAND_DIR = join(here, "..", "..", "brand");
export const tokens = JSON.parse(readFileSync(join(BRAND_DIR, "tokens.json"), "utf8"));

const c = (name) => tokens.colors[name].value;

/** Colorways. `outer`, `inner`, and `line` are the three painted parts of the mark. */
export const VARIANTS = {
  dark: { outer: c("sand"), inner: c("roseLight"), line: c("desertRose"), label: "dark surface" },
  light: { outer: c("ink"), inner: c("roseDeep"), line: c("ink"), label: "light surface" },
  mono: { outer: c("sand"), inner: c("sand"), line: c("sand"), label: "one-color, dark surface" },
  "mono-light": { outer: c("ink"), inner: c("ink"), line: c("ink"), label: "one-color, light surface" },
};

const CENTER = 128;
const HALF_GAP = 21; // rings are open for |y - center| < HALF_GAP
const RINGS = { outer: { r: 88, width: 13 }, inner: { r: 60, width: 13 } };
const LINE = { x: 14, y: 121, width: 228, height: 14 };

const n = (x) => Number(x.toFixed(2));

function arcs(r) {
  const dx = Math.sqrt(r * r - HALF_GAP * HALF_GAP);
  const left = n(CENTER - dx);
  const right = n(CENTER + dx);
  const top = CENTER - HALF_GAP;
  const bottom = CENTER + HALF_GAP;
  return `<path d="M${left} ${top} A${r} ${r} 0 0 1 ${right} ${top}"/><path d="M${left} ${bottom} A${r} ${r} 0 0 0 ${right} ${bottom}"/>`;
}

/** SVG fragment for the mark in a 256 × 256 box. Embed with a transform to place and scale it. */
export function markFragment(variant) {
  const v = VARIANTS[variant];
  if (!v) throw new Error(`unknown mark variant ${variant}`);
  return [
    `<g fill="none" stroke-width="${RINGS.outer.width}">`,
    `<g stroke="${v.outer}">${arcs(RINGS.outer.r)}</g>`,
    `<g stroke="${v.inner}">${arcs(RINGS.inner.r)}</g>`,
    `</g>`,
    `<rect x="${LINE.x}" y="${LINE.y}" width="${LINE.width}" height="${LINE.height}" fill="${v.line}"/>`,
  ].join("");
}

/**
 * The favicon mark: one thick open ring and a waterline on the dark canvas. The full mark has two thin rings that turn to
 * mush at 16 px; this one keeps every stroke at least 2 px wide at 16 px. `rounded` is for browser tabs; the square one
 * is full-bleed for the Apple touch icon and web-app manifest icons, which are masked by the system.
 */
const FAVICON = { r: 76, width: 36, halfGap: 30, line: { x: 22, y: 112, width: 212, height: 32 } };

export function faviconSvg({ rounded }) {
  const f = FAVICON;
  const dx = Math.sqrt(f.r * f.r - f.halfGap * f.halfGap);
  const left = n(CENTER - dx);
  const right = n(CENTER + dx);
  const top = CENTER - f.halfGap;
  const bottom = CENTER + f.halfGap;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-labelledby="title">`,
    `<title id="title">Seaworthy</title>`,
    `<rect width="256" height="256"${rounded ? ' rx="56"' : ""} fill="${c("abyss")}"/>`,
    `<g fill="none" stroke="${c("sand")}" stroke-width="${f.width}"><path d="M${left} ${top} A${f.r} ${f.r} 0 0 1 ${right} ${top}"/><path d="M${left} ${bottom} A${f.r} ${f.r} 0 0 0 ${right} ${bottom}"/></g>`,
    `<rect x="${f.line.x}" y="${f.line.y}" width="${f.line.width}" height="${f.line.height}" fill="${c("desertRose")}"/>`,
    `</svg>`,
    ``,
  ].join("\n");
}

export const FAVICON_GEOMETRY = FAVICON;

export function markSvg(variant) {
  const v = VARIANTS[variant];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-labelledby="title">`,
    `<title id="title">Seaworthy mark (${v.label})</title>`,
    markFragment(variant),
    `</svg>`,
    ``,
  ].join("\n");
}

export function tokensCss() {
  const kebab = (s) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  const lines = [":root {"];
  for (const [name, { value }] of Object.entries(tokens.colors)) lines.push(`  --seaworthy-color-${kebab(name)}: ${value.toLowerCase()};`);
  lines.push("");
  lines.push(`  --seaworthy-font-sans: ${tokens.fonts.sans};`);
  lines.push(`  --seaworthy-font-mono: ${tokens.fonts.mono};`);
  lines.push("");
  for (const [k, v] of Object.entries(tokens.spacing)) lines.push(`  --seaworthy-space-${k}: ${v}px;`);
  lines.push("");
  for (const [k, v] of Object.entries(tokens.radius)) lines.push(`  --seaworthy-radius-${k}: ${v}px;`);
  lines.push("}", "");
  lines.push(
    `[data-seaworthy-theme="dark"] {`,
    `  --seaworthy-canvas: var(--seaworthy-color-abyss);`,
    `  --seaworthy-surface: var(--seaworthy-color-ink);`,
    `  --seaworthy-text: var(--seaworthy-color-sand);`,
    `  --seaworthy-text-accent: var(--seaworthy-color-rose-light);`,
    `  --seaworthy-text-muted: var(--seaworthy-color-mist);`,
    `  --seaworthy-line: var(--seaworthy-color-desert-rose);`,
    `}`,
    ``,
    `[data-seaworthy-theme="light"] {`,
    `  --seaworthy-canvas: var(--seaworthy-color-sand);`,
    `  --seaworthy-surface: #fff;`,
    `  --seaworthy-text: var(--seaworthy-color-ink);`,
    `  --seaworthy-text-accent: var(--seaworthy-color-rose-deep);`,
    `  --seaworthy-text-muted: var(--seaworthy-color-ink);`,
    `  --seaworthy-line: var(--seaworthy-color-rose-deep);`,
    `}`,
    ``,
  );
  return lines.join("\n");
}

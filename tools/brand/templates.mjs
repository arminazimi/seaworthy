// Brand templates: avatar, social preview, banner, marketplace art, and the logo review sheet.
// Each function returns a complete SVG document. Presets list the PNG exports built from them.

import { markFragment, tokens } from "./mark.mjs";

const color = (name) => tokens.colors[name].value;

const SANS = "Inter Variable, Inter, Helvetica Neue, Arial, sans-serif";
const MONO = "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace";

const THEMES = {
  dark: { bg: color("abyss"), mark: "dark", text: color("sand"), accent: color("roseLight"), muted: color("mist") },
  light: { bg: color("sand"), mark: "light", text: color("ink"), accent: color("roseDeep"), muted: color("ink") },
};

const sans = (x, y, size, fill, spacing, content) =>
  `<text x="${x}" y="${y}" fill="${fill}" font-family="${SANS}" font-size="${size}" font-weight="700" letter-spacing="${spacing}">${content}</text>`;
const mono = (x, y, size, fill, spacing, content) =>
  `<text x="${x}" y="${y}" fill="${fill}" font-family="${MONO}" font-size="${size}" letter-spacing="${spacing}">${content}</text>`;
const place = (variant, x, y, scale) => `<g transform="translate(${x} ${y}) scale(${scale})">${markFragment(variant)}</g>`;

function doc(w, h, title, body) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title">`,
    `<title id="title">${title}</title>`,
    ...body,
    `</svg>`,
    ``,
  ].join("\n");
}

const TAGLINE = tokens.tagline.toUpperCase();
const TAGLINE_2 = tokens.taglineSecondary.toUpperCase();
const COMMAND = "npx seaworthy verify ./dist";

export const TEMPLATES = {
  "social-preview": (t) =>
    doc(1280, 640, "Seaworthy social preview", [
      `<rect width="1280" height="640" fill="${t.bg}"/>`,
      place(t.mark, 112, 192, 1),
      sans(420, 322, 82, t.text, 11, "SEAWORTHY"),
      mono(424, 378, 24, t.accent, 2, TAGLINE),
      mono(112, 566, 20, t.muted, 0.5, COMMAND),
    ]),
  avatar: (t) => doc(512, 512, "Seaworthy avatar", [`<rect width="512" height="512" fill="${t.bg}"/>`, place(t.mark, 76.8, 76.8, 1.4)]),
  banner: (t) =>
    doc(1500, 500, "Seaworthy banner", [
      `<rect width="1500" height="500" fill="${t.bg}"/>`,
      place(t.mark, 150, 122, 1),
      sans(470, 250, 92, t.text, 12, "SEAWORTHY"),
      mono(474, 308, 26, t.accent, 2, TAGLINE_2),
      mono(474, 388, 22, t.muted, 0.5, COMMAND),
    ]),
  "marketplace-feature": (t) =>
    doc(965, 482, "Seaworthy marketplace feature background", [`<rect width="965" height="482" fill="${t.bg}"/>`, place(t.mark, 329, 87.5, 1.2)]),
  "marketplace-logo": (t) => doc(512, 512, "Seaworthy marketplace logo", [place(t.mark, 51.2, 51.2, 1.6)]),
};

/** PNG exports. `background: null` renders with a transparent background. */
export const PRESETS = [
  ...["dark", "light"].flatMap((theme) => [
    { name: `social-preview-${theme}`, template: "social-preview", theme, width: 1280, height: 640, background: THEMES[theme].bg },
    { name: `avatar-${theme}`, template: "avatar", theme, width: 512, height: 512, background: THEMES[theme].bg },
    { name: `banner-${theme}`, template: "banner", theme, width: 1500, height: 500, background: THEMES[theme].bg },
    { name: `marketplace-feature-${theme}`, template: "marketplace-feature", theme, width: 965, height: 482, background: THEMES[theme].bg },
    { name: `marketplace-logo-${theme}`, template: "marketplace-logo", theme, width: 512, height: 512, background: null },
  ]),
];

export const TEMPLATE_FILES = PRESETS.map((p) => ({ file: `templates/${p.name}.svg`, svg: TEMPLATES[p.template](THEMES[p.theme]) }));

/** Review sheet: dark, light, and mono lockups, small-size checks, and the palette. */
export function logoSheet() {
  const lockup = (t, x) => [
    place(t.mark, x, 150, 0.95),
    sans(x + 263, 276, 50, t.text, 5, "SEAWORTHY"),
    mono(x + 265, 312, 13, t.accent, 1.5, TAGLINE),
    mono(x + 265, 336, 13, t.muted, 1.5, TAGLINE_2),
  ];
  const swatch = (name, cx) => [
    `<circle cx="${cx}" cy="710" r="30" fill="${color(name)}" stroke="#4a3f4d" stroke-width="1"/>`,
    mono(cx - 36, 770, 12, "#9A8F98", 0, color(name)),
  ];
  const names = ["abyss", "ink", "desertRose", "roseDeep", "roseLight", "sand", "seaTeal", "signalAmber", "alertRed"];
  return doc(1600, 900, "Seaworthy logo system review sheet", [
    `<rect width="1600" height="900" fill="#0C080F"/>`,
    `<rect x="40" y="40" width="740" height="510" rx="24" fill="${color("abyss")}"/>`,
    `<rect x="820" y="40" width="740" height="510" rx="24" fill="${color("sand")}"/>`,
    `<rect x="40" y="590" width="1520" height="270" rx="24" fill="${color("ink")}"/>`,
    ...lockup(THEMES.dark, 92),
    ...lockup(THEMES.light, 872),
    place("mono", 100, 625, 0.72),
    place("dark", 335, 680, 0.3125),
    place("dark", 455, 712, 0.15625),
    mono(340, 815, 14, "#9A8F98", 0, "80px"),
    mono(462, 815, 14, "#9A8F98", 0, "40px"),
    ...names.flatMap((name, i) => swatch(name, 640 + i * 100)),
  ]);
}

export const EXPORT_PRESETS_JSON = {
  version: tokens.version,
  format: "png",
  note: "Exports are rendered from the SVG sources with headless Chrome. Run `npm run export:brand`.",
  presets: PRESETS.map((p) => ({
    name: p.name,
    source: `templates/${p.name}.svg`,
    output: `exports/${p.name}.png`,
    width: p.width,
    height: p.height,
    background: p.background,
  })),
};

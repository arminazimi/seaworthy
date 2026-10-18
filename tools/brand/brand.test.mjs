import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { badgeSvg } from "./badge.mjs";
import { generatedFiles } from "./build.mjs";
import { readIco } from "./ico.mjs";
import { BRAND_DIR, FAVICON_GEOMETRY, VARIANTS, faviconSvg, markSvg, tokens } from "./mark.mjs";
import { FAVICON_ICO, FAVICON_PNGS } from "./templates.mjs";

const hex = (name) => tokens.colors[name].value;

function luminance(h) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg, bg) {
  const [hi, lo] = [luminance(hex(fg)), luminance(hex(bg))].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

test("every pair the guide approves for text meets 4.5:1", () => {
  const approved = [
    ["sand", "abyss"], ["sand", "ink"], ["ink", "sand"], ["roseLight", "abyss"], ["roseLight", "ink"],
    ["desertRose", "abyss"], ["desertRose", "ink"], ["mist", "abyss"], ["mist", "ink"], ["roseDeep", "sand"],
    ["sand", "seaTeal"], ["sand", "signalAmber"], ["sand", "alertRed"],
  ];
  for (const [fg, bg] of approved) assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg} is ${contrast(fg, bg).toFixed(2)}:1`);
});

test("the pairs the guide forbids really fall short", () => {
  assert.ok(contrast("desertRose", "sand") < 3, "desert rose on sand");
  assert.ok(contrast("roseDeep", "abyss") < 4.5, "rose deep on abyss");
});

test("the guide's contrast table matches the tokens", () => {
  const guide = readFileSync(join(BRAND_DIR, "BRAND_GUIDE.md"), "utf8");
  const names = { Sand: "sand", Abyss: "abyss", Ink: "ink", "Rose Light": "roseLight", "Desert Rose": "desertRose", Mist: "mist", "Rose Deep": "roseDeep", "Sea Teal": "seaTeal", "Signal Amber": "signalAmber", "Alert Red": "alertRed" };
  const rows = [...guide.matchAll(/^\| ([A-Za-z ]+) \| ([A-Za-z ]+) \| (\d+\.\d+):1 \|/gm)];
  assert.ok(rows.length >= 13, "contrast table not found");
  for (const [, fg, bg, ratio] of rows) {
    assert.ok(names[fg] && names[bg], `unknown color in table: ${fg} / ${bg}`);
    assert.equal(contrast(names[fg], names[bg]).toFixed(2), ratio, `${fg} on ${bg}`);
  }
});

test("the mark has no green element: green is reserved for status", () => {
  const green = hex("seaTeal").toLowerCase();
  for (const variant of Object.keys(VARIANTS)) assert.ok(!markSvg(variant).toLowerCase().includes(green), `${variant} mark uses sea teal`);
});

test("badges carry a word, not just a color", () => {
  assert.match(badgeSvg("passing"), />passing</);
  assert.match(badgeSvg("warnings", 3), />3 warnings</);
  assert.match(badgeSvg("warnings", 1), />1 warning</);
  assert.match(badgeSvg("failing", 12), />12 errors</);
  assert.throws(() => badgeSvg("unknown"), /unknown badge state/);
});

test("generation is deterministic", () => {
  const a = generatedFiles();
  const b = generatedFiles();
  assert.deepEqual([...a], [...b]);
  for (const [path, content] of a) if (path.endsWith(".svg")) assert.match(content, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, path);
});

test("the favicon mark keeps every stroke at least 2 px wide at 16 px", () => {
  const scale = 16 / 256;
  assert.ok(FAVICON_GEOMETRY.width * scale >= 2, "ring stroke");
  assert.ok(FAVICON_GEOMETRY.line.height * scale >= 2, "waterline");
  for (const rounded of [true, false]) {
    const svg = faviconSvg({ rounded });
    assert.equal(svg.includes('rx="'), rounded);
    assert.ok(!svg.toLowerCase().includes(hex("seaTeal").toLowerCase()), "no green in the mark");
  }
});

test("the favicon exports exist at the sizes they claim, and the .ico holds 16, 32, and 48 px PNGs", () => {
  const dimensions = (file) => {
    const png = readFileSync(join(BRAND_DIR, file));
    assert.equal(png.toString("latin1", 1, 4), "PNG", file);
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  };
  for (const { output, size } of FAVICON_PNGS) assert.deepEqual(dimensions(output), [size, size], output);
  const images = readIco(readFileSync(join(BRAND_DIR, FAVICON_ICO.output)));
  assert.deepEqual(images.map((i) => i.width), FAVICON_ICO.sizes);
  assert.ok(images.every((i) => i.png && i.width === i.height));
});

test("the full-bleed icons are opaque, so a system can mask them without black corners", () => {
  for (const file of ["favicon/apple-touch-icon.png", "favicon/icon-192.png", "favicon/icon-512.png"]) {
    const colorType = readFileSync(join(BRAND_DIR, file)).readUInt8(25);
    assert.equal(colorType, 2, `${file} should be RGB without an alpha channel`);
  }
});

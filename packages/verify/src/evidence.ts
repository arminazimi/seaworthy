// Evidence images: the pixels a rendered finding was proved with.
//
// A rendered check under --evidence saves a PNG crop of the viewport around each offending
// element into one folder the user named, and the finding carries the path. Seaworthy still
// writes nothing inside the folder it verifies: the evidence folder is the user's explicit
// opt-in, outside the site (the CLI refuses it otherwise).
//
// Names are deterministic: the finding's fingerprint, so two runs of the same site write the
// same files and a report names the crop that belongs to it, with no timestamps anywhere.
// The bytes come straight from the browser (see ./render.ts) — no image library, no new dependency.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { EvidenceSink } from "./types.js";

/**
 * Writes one crop into the run's evidence folder and returns the path the report names it by:
 * `label` joined with `name` in forward slashes — relative to where the command ran, never absolute.
 */
export function saveCrop(sink: EvidenceSink, name: string, png: Buffer): string {
  mkdirSync(sink.dir, { recursive: true });
  writeFileSync(join(sink.dir, name), png);
  return sink.label === "" ? name : `${sink.label}/${name}`;
}

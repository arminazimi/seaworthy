// Where the site is deployed: the base path, such as `/repo/` for a GitHub project page.
//
// Verification normally guesses nothing about deployment, but the generator configs next to the
// built output often name it. This module finds those known config files, reads the one base-path
// setting each generator uses, and canonicalizes it into the one form the engine checks against.
// Configs are untrusted input, so every format is read by a small text scanner and nothing is ever
// evaluated or executed — JS and TS configs are searched for a single string literal, not run.
//
// Detection never guesses. A value that is not a plain literal, is set twice with different values,
// or is not a URL path or http(s) URL is reported as unclassified with a reason, and verification
// falls back to the root (`/`); the user then sets `basePath` or `--base` explicitly.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { normalizeBasePath } from "./site.js";

/** The generators whose source config files detection reads. */
export type BasePathGenerator = "jekyll" | "astro" | "docusaurus" | "hugo" | "vitepress";

/** The config file a finding came from, relative to the folder it was found in. */
export interface BasePathSource {
  readonly generator: BasePathGenerator;
  readonly file: string;
}

/** One accepted base-path setting, in canonical form. */
export interface BasePathFinding {
  /** The setting as written, canonicalized: origin-relative such as `/repo/`, or with scheme and host preserved when the config had an absolute URL. */
  readonly basePath: string;
  /** The origin-relative path the engine verifies against: `/repo/`, or `/` for the site root. A deployment host is not observable from built output, so it is not carried here. */
  readonly path: string;
  readonly generator: BasePathGenerator;
  readonly file: string;
}

export interface BasePathDetection {
  readonly status: "detected";
  readonly finding: BasePathFinding;
}

export interface UnclassifiedBasePath {
  readonly status: "unclassified";
  /** Why no base path was detected. Making one up here would mean guessing. */
  readonly reason: string;
  /** How many generator config files were in fact present. 0 means none were found. */
  readonly examined: number;
}

const MAX_CONFIG_BYTES = 1_000_000;

interface ConfigCandidate {
  readonly generator: BasePathGenerator;
  readonly file: string;
  readonly format: "yaml" | "toml" | "json" | "js";
  readonly key: string;
}

/** The known source config files, in the order they are examined. Hugo also keeps its legacy `config.*` names. */
const CANDIDATES: readonly ConfigCandidate[] = [
  { generator: "jekyll", file: "_config.yml", format: "yaml", key: "baseurl" },
  { generator: "jekyll", file: "_config.yaml", format: "yaml", key: "baseurl" },
  { generator: "astro", file: "astro.config.mjs", format: "js", key: "base" },
  { generator: "astro", file: "astro.config.js", format: "js", key: "base" },
  { generator: "astro", file: "astro.config.ts", format: "js", key: "base" },
  { generator: "astro", file: "astro.config.mts", format: "js", key: "base" },
  { generator: "docusaurus", file: "docusaurus.config.js", format: "js", key: "baseUrl" },
  { generator: "docusaurus", file: "docusaurus.config.mjs", format: "js", key: "baseUrl" },
  { generator: "docusaurus", file: "docusaurus.config.ts", format: "js", key: "baseUrl" },
  { generator: "hugo", file: "hugo.toml", format: "toml", key: "baseURL" },
  { generator: "hugo", file: "hugo.yaml", format: "yaml", key: "baseURL" },
  { generator: "hugo", file: "hugo.yml", format: "yaml", key: "baseURL" },
  { generator: "hugo", file: "hugo.json", format: "json", key: "baseURL" },
  { generator: "hugo", file: "config.toml", format: "toml", key: "baseURL" },
  { generator: "hugo", file: "config.yaml", format: "yaml", key: "baseURL" },
  { generator: "vitepress", file: ".vitepress/config.ts", format: "js", key: "base" },
  { generator: "vitepress", file: ".vitepress/config.mts", format: "js", key: "base" },
  { generator: "vitepress", file: ".vitepress/config.mjs", format: "js", key: "base" },
  { generator: "vitepress", file: ".vitepress/config.js", format: "js", key: "base" },
];

/** What one existing config file yielded. `value` is the raw setting as written; `null` means it is set to nothing (the site root). */
type RawFinding =
  | { kind: "ok"; value: string | null; source: BasePathSource }
  | { kind: "unset" }
  | { kind: "unclassifiable"; reason: string };

const URL_FORM = /^https?:\/\//i;
// The same shape `seaworthy.config.json` validates `basePath` against.
const PATH_FORM = /^\/?[A-Za-z0-9._~%/-]*$/;

export type Canonical =
  | { ok: true; basePath: string; path: string }
  | { ok: false; reason: string };

/** `/`, `//repo/`, `/repo`, and `repo` all become `/repo/`; empty becomes `/`. */
function canonicalPathSegment(segment: string): string {
  const trimmed = segment.trim().replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

/**
 * Canonicalizes one raw setting. For an absolute URL the scheme and host are kept in `basePath`
 * while `path` carries only the pathname — a deployment host is not observable from the built
 * output, so verification uses the path alone. Rejects instead of guessing when the value is
 * neither a URL path nor an http(s) URL, or the URL carries a query string or fragment.
 */
export function canonicalBasePath(value: string | null | undefined): Canonical {
  const raw = (value ?? "").trim();
  if (URL_FORM.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return { ok: false, reason: `is not a complete URL: ${JSON.stringify(raw)}` };
    }
    if (parsed.search !== "") return { ok: false, reason: `carries a query string: ${JSON.stringify(parsed.search)}` };
    if (parsed.hash !== "") return { ok: false, reason: `carries a fragment: ${JSON.stringify(parsed.hash)}` };
    const path = canonicalPathSegment(parsed.pathname);
    return { ok: true, basePath: `${parsed.protocol}//${parsed.host}${path}`, path };
  }
  if (!PATH_FORM.test(raw)) return { ok: false, reason: `is not a URL path or an http(s) URL: ${JSON.stringify(raw)}` };
  const path = canonicalPathSegment(raw);
  return { ok: true, basePath: path, path };
}

/** Marks a raw scalar canonical, or explains the value the config set. */
function canonicalizeScalar(value: string, key: string): Canonical {
  const canonical = canonicalBasePath(value);
  return canonical.ok ? canonical : { ok: false, reason: canonical.reason };
}

function readConfig(file: string): { source: string } | undefined {
  if (!existsSync(file)) return undefined;
  if (!statSync(file).isFile()) return undefined;
  if (statSync(file).size > MAX_CONFIG_BYTES) return undefined; // not a generator config this check reads
  return { source: readFileSync(file, "utf8") };
}

/** Removes a YAML comment: a `#` at the line start or after whitespace, never inside quotes. */
function withoutYamlComment(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) return line.slice(0, i);
  }
  return line;
}

/** Splits a YAML key/value line at its top-level colon, or returns undefined when the line is not one. */
function yamlKeyValue(line: string): { key: string; rest: string } | undefined {
  const cleaned = withoutYamlComment(line);
  const match = /^[A-Za-z][A-Za-z0-9_-]*[ \t]*:/.exec(cleaned);
  if (!match) return undefined;
  const key = match[0].slice(0, -1).replace(/[ \t]+$/, "");
  return { key, rest: cleaned.slice(match[0].length).trim() };
}

/**
 * Reads one scalar out of a YAML key/value line. Quoted values are unquoted; a value of nothing
 * (YAML null — the Jekyll `baseurl:` quirk) means the site root. Block scalars, tags, anchors and
 * aliases, and flow collections are rejected rather than guessed at.
 */
function yamlScalar(rest: string, key: string): Canonical | "root" {
  if (rest === "" || rest === "~") return "root";
  const single = /^'((?:[^']|'')*)'$/.exec(rest);
  if (single) return canonicalizeScalar(single[1]!.replace("''", "'"), key);
  const double = /^"((?:[^"\\]|\\.)*)"$/.exec(rest);
  if (double) {
    const body = double[1]!;
    let out = "";
    for (let i = 0; i < body.length; i++) {
      const c = body[i] as string;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const next = body[i + 1];
      if (next !== "\\" && next !== '"') return { ok: false, reason: `is not a plain quoted string: ${JSON.stringify(rest.slice(0, 60))}` };
      out += next;
      i++;
    }
    return canonicalizeScalar(out, key);
  }
  if (/^[|>&[{!]/.test(rest)) return { ok: false, reason: `is not a plain string: ${JSON.stringify(rest.slice(0, 60))}` };
  return canonicalizeScalar(rest, key);
}

function parseYaml(text: string, key: string, source: BasePathSource): RawFinding {
  const hits = text.split(/\r?\n/).map((line) => yamlKeyValue(line)).filter((entry) => entry !== undefined && entry.key.toLowerCase() === key.toLowerCase());
  if (hits.length === 0) return { kind: "unset" };
  if (hits.length > 1) return { kind: "unclassifiable", reason: `${description(source)} sets ${key} more than once` };
  const scalar = yamlScalar(hits[0]!.rest, key);
  if (scalar === "root") return { kind: "ok", value: null, source };
  return scalar.ok ? { kind: "ok", value: scalar.basePath, source } : { kind: "unclassifiable", reason: `${description(source)} sets ${key}, and that value ${scalar.reason}` };
}

/** Removes a TOML comment: a `#` at the line start or after whitespace, never inside quotes. */
function withoutTomlComment(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1] as string))) return line.slice(0, i);
  }
  return line;
}

/**
 * Reads `baseURL` from a TOML config. Only a quoted top-level scalar is read: a key below a
 * `[table]` header, a multi-line string, or a key set twice is rejected rather than guessed at.
 * Hugo's `uglyURLs` setting changes URL style, not the base path, so it is deliberately not read.
 */
function parseToml(text: string, source: BasePathSource): RawFinding {
  let afterHeader = false;
  let nested: string | undefined;
  const values: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cleaned = withoutTomlComment(line).trim();
    if (cleaned === "") continue;
    const header = /^\[([^\]]*)\]$/.exec(cleaned);
    if (header !== null) {
      afterHeader = true;
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9$_-]*)[ \t]*[=](.+)$/.exec(cleaned);
    if (!match || match[1]!.toLowerCase() !== "baseurl") continue;
    const rest = match[2]!.trim();
    if (afterHeader) return { kind: "unclassifiable", reason: `${description(source)} sets baseURL inside [${header?.[1] ?? nested ?? "a table"}], not at the top level` };
    values.push(rest);
  }
  if (values.length === 0) return { kind: "unset" };
  if (values.length > 1) return { kind: "unclassifiable", reason: `${description(source)} sets baseURL more than once` };
  return fromScalar(tomlScalar(values[0]!, "baseURL"), source, "baseURL");
}

/** Reads a TOML string scalar. */
function tomlScalar(rest: string, key: string): Canonical {
  const literal = /^'([^']*)'$/.exec(rest);
  if (literal) return canonicalizeScalar(literal[1]!, key);
  const basic = /^"((?:[^"\\]|\\.)*)"$/.exec(rest);
  if (basic) {
    const body = basic[1]!;
    let out = "";
    for (let i = 0; i < body.length; i++) {
      const c = body[i] as string;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const next = body[i + 1];
      if (next !== "\\" && next !== '"') return { ok: false, reason: `is not a plain quoted string: ${JSON.stringify(rest.slice(0, 60))}` };
      out += next;
      i++;
    }
    return canonicalizeScalar(out, key);
  }
  return { ok: false, reason: `is not a plain quoted string: ${JSON.stringify(rest.slice(0, 60))}` };
}

function fromScalar(scalar: Canonical, source: BasePathSource, key: string): RawFinding {
  return scalar.ok ? { kind: "ok", value: scalar.basePath, source } : { kind: "unclassifiable", reason: `${description(source)} sets ${key}, and that value ${scalar.reason}` };
}

function parseJson(text: string, source: BasePathSource): RawFinding {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { kind: "unclassifiable", reason: `${description(source)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { kind: "unclassifiable", reason: `${description(source)} is not a JSON object` };
  const value = (raw as Record<string, unknown>)["baseURL"];
  if (value === undefined) return { kind: "unset" };
  if (typeof value !== "string") return { kind: "unclassifiable", reason: `${description(source)} sets baseURL to ${JSON.stringify(value)}, not a string` };
  const canonical = canonicalBasePath(value);
  return canonical.ok ? { kind: "ok", value: canonical.basePath, source } : { kind: "unclassifiable", reason: `${description(source)} sets baseURL, and that value ${canonical.reason}` };
}

/**
 * Removes JS/TS comments while keeping string literal contents. Returns undefined when the source
 * uses something this check does not read (template literals with `${...}`), so the caller can
 * classify the file instead of trusting a fragment.
 */
function withoutJsComments(source: string): string | undefined {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i] as string;
    if (c === "/" && source[i + 1] === "/") {
      i++;
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) return undefined;
      out += " ";
      i = end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < source.length) {
        const d = source[i] as string;
        if (d === "\\") {
          out += d + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (c === "`" && d === "$" && source[i + 1] === "{") return undefined;
        out += d;
        i++;
        if (d === c) break;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Unquotes one string body: only the own-quote escape and doubled backslashes are read. */
function jsStringBody(body: string, quote: string): string | undefined {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) return undefined;
    if (next === "\\" || next === quote) out += next;
    else if (next === "/") out += "/"; // URL slashes, escaped in some configs
    else return undefined; // unknown escape: classify rather than guess
    i++;
  }
  return out;
}

/**
 * Reads the base-path key from a JS/TS config — MJS, JS, or TS. Only a plain string literal is
 * read; anything else (an environment read, a variable, a template) is classified, never valuated.
 * A key set twice with different values is ambiguous, so it is rejected rather than picking one.
 */
function parseJs(text: string, key: string, source: BasePathSource): RawFinding {
  const code = withoutJsComments(text);
  if (code === undefined) return { kind: "unclassifiable", reason: `${description(source)} is not read as plain JavaScript: template interpolation is not evaluated` };
  const index = code.search(new RegExp(`(?<![A-Za-z0-9$_.])${key}\\s*:(?!=)`));
  if (index === -1) return { kind: "unset" };
  const regex = new RegExp(`(?<![A-Za-z0-9$_.])${key}\\s*:(?!=)\\s*(['"\`])((?:\\\\.|[^\\\\])*?)\\1`, "g");
  const values: Canonical[] = [];
  for (const match of code.matchAll(regex)) {
    const body = jsStringBody(match[2] as string, match[1] as string);
    values.push(body === undefined ? { ok: false, reason: `is not a value this check reads: ${JSON.stringify(match[0]?.slice(0, 60))}` } : canonicalizeScalar(body, key));
  }
  if (values.length === 0) return { kind: "unclassifiable", reason: `${description(source)} sets ${key} to a value this check does not read (not a plain string literal)` };
  const distinct = new Set(values.map((value) => (value.ok ? value.basePath : value.reason)));
  if (distinct.size > 1) return { kind: "unclassifiable", reason: `${description(source)} sets ${key} to different values: ${[...distinct].join(" vs ")}` };
  const value = values[0]!;
  return value.ok ? { kind: "ok", value: value.basePath, source } : { kind: "unclassifiable", reason: `${description(source)} sets ${key}, and that value ${value.reason}` };
}

function description(source: BasePathSource): string {
  const names: Record<BasePathGenerator, string> = { jekyll: "Jekyll", astro: "Astro", docusaurus: "Docusaurus", hugo: "Hugo", vitepress: "VitePress" };
  return `${names[source.generator]}'s ${source.file}`;
}

export type BasePathDetectionResult = BasePathDetection | UnclassifiedBasePath;

/** The config file shapes detection reads, for messages. */
const CONFIG_NAMES = "Jekyll (_config.yml), Astro (astro.config.*), Docusaurus (docusaurus.config.*), Hugo (hugo.* or config.*), or VitePress (.vitepress/config.*) config";

/** The same list, without the trailing "config" word, for sentences that add their own noun. */
const CONFIG_NAMES_NAME_ONLY = "Jekyll (_config.yml), Astro (astro.config.*), Docusaurus (docusaurus.config.*), Hugo (hugo.* or config.*), or VitePress (.vitepress/config.*) config file";

/**
 * Reads the known generator config files in the given directories (typically the built output
 * folder, then the repo root) and returns the one base path they agree on. Every accepted value is
 * canonicalized; anything ambiguous or unreadable is reported as unclassified with a reason.
 */
export function detectBasePath(directories: readonly string[]): BasePathDetectionResult {
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const directory of directories) {
    const key = resolve(directory);
    if (seen.has(key)) continue;
    seen.add(key);
    dirs.push(directory);
  }

  const findings: BasePathFinding[] = [];
  const reasons: string[] = [];
  let unset = 0;
  let examined = 0;
  for (const directory of dirs) {
    for (const candidate of CANDIDATES) {
      const read = readConfig(join(directory, ...candidate.file.split("/")));
      if (read === undefined) continue;
      examined++;
      const source: BasePathSource = { generator: candidate.generator, file: candidate.file };
      const parsed =
        candidate.format === "yaml" ? parseYaml(read.source, candidate.key, source)
        : candidate.format === "toml" ? parseToml(read.source, source)
        : candidate.format === "json" ? parseJson(read.source, source)
        : parseJs(read.source, candidate.key, source);
      if (parsed.kind === "unset") {
        unset++;
        continue;
      }
      if (parsed.kind === "unclassifiable") reasons.push(parsed.reason);
      else {
        const canonical = canonicalBasePath(parsed.value === null ? "" : parsed.value);
        if (canonical.ok) findings.push({ basePath: canonical.basePath, path: canonical.path, generator: source.generator, file: source.file });
        else reasons.push(`${description(source)} sets ${candidate.key}, and that value ${canonical.reason}`);
      }
    }
  }

  const accepted = new Map<string, BasePathFinding>();
  for (const finding of findings) if (!accepted.has(finding.basePath)) accepted.set(finding.basePath, finding);
  if (accepted.size === 0) {
    if (reasons.length === 1) return { status: "unclassified", reason: reasons[0] as string, examined };
    if (reasons.length > 1) return { status: "unclassified", reason: `${reasons[0] as string}; and ${reasons.length - 1} more config file${reasons.length === 2 ? " has" : "s have"} the same problem`, examined };
    if (unset > 0) return { status: "unclassified", reason: `${unset} generator config file${unset === 1 ? "" : "s"} examined ${unset === 1 ? "does" : "do"} not name a base path; set basePath in the config or pass --base`, examined };
    return { status: "unclassified", reason: `no generator config was found next to the built output — a ${CONFIG_NAMES_NAME_ONLY} would be read, but none was present; set basePath in the config or pass --base`, examined };
  }
  if (accepted.size > 1) {
    const listed = [...accepted.values()].map((finding) => `${finding.basePath} (${finding.file})`).join(", ");
    return { status: "unclassified", reason: `conflicting base paths: ${listed}; set basePath in the config or pass --base to pick one`, examined };
  }
  return { status: "detected", finding: findings[0] as BasePathFinding };
}

export interface BasePathResolution {
  /** The base path in engine form, `/` or `/repo/`, decided by precedence. */
  readonly basePath: string;
  /** Present only when detection ran (no explicit value set): what it found or why it found nothing. */
  readonly detection?: BasePathDetectionResult;
}

/**
 * Applies base-path precedence: an explicit `--base` value, then the config's `basePath`, then the
 * value detected from the generator configs next to the build output, then `/`. Detection never
 * guesses: an ambiguous or unreadable config leaves `/` and its reason says why.
 */
export function resolveBasePath(options: { folder: string; configBasePath?: string; override?: string; extraDirectories?: readonly string[] }): BasePathResolution {
  if (options.override !== undefined) {
    const canonical = canonicalBasePath(options.override);
    return { basePath: canonical.ok ? canonical.path : normalizeBasePath(options.override) };
  }
  if (options.configBasePath !== undefined) return { basePath: normalizeBasePath(options.configBasePath) };
  const detection = detectBasePath([options.folder, ...(options.extraDirectories ?? []), dirname(options.folder)]);
  return detection.status === "detected" ? { basePath: detection.finding.path, detection } : { basePath: "/", detection };
}

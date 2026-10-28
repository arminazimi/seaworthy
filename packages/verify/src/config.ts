// seaworthy.config.json: which checks run, at what severity, with what options, and what to ignore.
// JSON only, so a config is data an agent can edit safely and a schema can describe.
// Errors name the key, the bad value, and the allowed values.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { matchesCheck } from "./glob.js";
import { closest } from "./text.js";
import { SEVERITIES, type Check, type Severity } from "./types.js";

export const CONFIG_FILE = "seaworthy.config.json";

export interface CheckSetting {
  off: boolean;
  severity?: Severity;
  options: Record<string, unknown>;
}

export interface ConfigSuppression {
  check: string;
  file?: string;
  fingerprint?: string;
  reason: string;
  /** `YYYY-MM-DD`, inclusive. After it the suppression stops applying and is reported. */
  expires?: string;
}

export interface Config {
  root?: string;
  /** Where the site is deployed, such as `/repo/` for a GitHub project page. Default `/`. */
  basePath?: string;
  failOn?: Severity | "none";
  rendered?: boolean;
  network?: boolean;
  /** Keyed by check ID or by a prefix pattern such as `a11y.*`. */
  checks: Record<string, CheckSetting>;
  /** Site-relative globs. Findings in matching files are dropped. */
  ignore: string[];
  suppressions: ConfigSuppression[];
  baseline?: string;
}

export class ConfigError extends Error {}

const TOP_LEVEL = ["$schema", "root", "basePath", "failOn", "rendered", "network", "checks", "ignore", "suppressions", "baseline"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function suggest(word: string, options: readonly string[]): string {
  const best = closest(word, options);
  return best === undefined ? "" : ` Did you mean "${best}"?`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const show = (v: unknown): string => JSON.stringify(v) ?? String(v);

/** Validates parsed JSON. Throws one ConfigError that lists every problem. */
export function parseConfig(raw: unknown, source: string, knownCheckIds: readonly string[]): Config {
  const problems: string[] = [];
  const bad = (path: string, message: string) => problems.push(`${path}: ${message}`);
  if (!isObject(raw)) throw new ConfigError(`${source}: the config must be a JSON object, got ${show(raw)}`);

  for (const key of Object.keys(raw)) if (!TOP_LEVEL.includes(key)) bad(key, `unknown key.${suggest(key, TOP_LEVEL)} Allowed keys: ${TOP_LEVEL.join(", ")}`);

  const config: Config = { checks: {}, ignore: [], suppressions: [] };
  if (raw.root !== undefined) typeof raw.root === "string" && raw.root !== "" ? (config.root = raw.root) : bad("root", `must be a folder path string, got ${show(raw.root)}`);
  if (raw.basePath !== undefined) typeof raw.basePath === "string" && /^\/?[A-Za-z0-9._~%/-]*$/.test(raw.basePath) ? (config.basePath = raw.basePath) : bad("basePath", `must be a URL path such as "/repo/", got ${show(raw.basePath)}`);
  if (raw.failOn !== undefined) {
    if (typeof raw.failOn === "string" && [...SEVERITIES, "none"].includes(raw.failOn)) config.failOn = raw.failOn as Severity | "none";
    else bad("failOn", `got ${show(raw.failOn)}; allowed values: error, warning, note, none`);
  }
  for (const flag of ["rendered", "network"] as const) {
    if (raw[flag] === undefined) continue;
    if (typeof raw[flag] === "boolean") config[flag] = raw[flag] as boolean;
    else bad(flag, `must be true or false, got ${show(raw[flag])}`);
  }
  if (raw.baseline !== undefined) typeof raw.baseline === "string" && raw.baseline !== "" ? (config.baseline = raw.baseline) : bad("baseline", `must be a file path string, got ${show(raw.baseline)}`);

  if (raw.ignore !== undefined) {
    if (Array.isArray(raw.ignore) && raw.ignore.every((g) => typeof g === "string" && g !== "")) config.ignore = raw.ignore as string[];
    else bad("ignore", `must be a list of site-relative globs such as "drafts/**", got ${show(raw.ignore)}`);
  }

  if (raw.checks !== undefined) {
    if (!isObject(raw.checks)) bad("checks", `must be an object keyed by check ID, got ${show(raw.checks)}`);
    else {
      for (const [pattern, value] of Object.entries(raw.checks)) {
        const where = `checks.${show(pattern)}`;
        const matches = knownCheckIds.filter((id) => matchesCheck(pattern, id));
        if (matches.length === 0) {
          bad(where, `matches no check.${suggest(pattern, knownCheckIds)} Known checks: ${knownCheckIds.join(", ") || "none"}`);
          continue;
        }
        const setting: CheckSetting = { off: false, options: {} };
        if (value === "off") setting.off = true;
        else if (typeof value === "string" && (SEVERITIES as readonly string[]).includes(value)) setting.severity = value as Severity;
        else if (isObject(value)) {
          for (const key of Object.keys(value)) if (!["off", "severity", "options"].includes(key)) bad(`${where}.${key}`, `unknown key. Allowed keys: off, severity, options`);
          if (value.off !== undefined) typeof value.off === "boolean" ? (setting.off = value.off) : bad(`${where}.off`, `must be true or false, got ${show(value.off)}`);
          if (value.severity !== undefined) {
            if (typeof value.severity === "string" && (SEVERITIES as readonly string[]).includes(value.severity)) setting.severity = value.severity as Severity;
            else bad(`${where}.severity`, `got ${show(value.severity)}; allowed values: ${SEVERITIES.join(", ")}`);
          }
          if (value.options !== undefined) isObject(value.options) ? (setting.options = value.options) : bad(`${where}.options`, `must be an object, got ${show(value.options)}`);
        } else bad(where, `got ${show(value)}; use "off", a severity (${SEVERITIES.join(", ")}), or an object with off, severity, or options`);
        config.checks[pattern] = setting;
      }
    }
  }

  if (raw.suppressions !== undefined) {
    if (!Array.isArray(raw.suppressions)) bad("suppressions", `must be a list, got ${show(raw.suppressions)}`);
    else
      raw.suppressions.forEach((entry: unknown, i: number) => {
        const where = `suppressions[${i}]`;
        if (!isObject(entry)) return bad(where, `must be an object, got ${show(entry)}`);
        for (const key of Object.keys(entry)) if (!["check", "file", "fingerprint", "reason", "expires"].includes(key)) bad(`${where}.${key}`, "unknown key. Allowed keys: check, file, fingerprint, reason, expires");
        const { check, file, fingerprint, reason, expires } = entry;
        if (typeof check !== "string" || !knownCheckIds.some((id) => matchesCheck(check, id))) bad(`${where}.check`, `got ${show(check)}; must be a known check ID or prefix pattern.${typeof check === "string" ? suggest(check, knownCheckIds) : ""}`);
        if (typeof reason !== "string" || reason.trim().length < 3) bad(`${where}.reason`, "a reason is required, so the next reader knows why this is suppressed");
        if (file === undefined && fingerprint === undefined) bad(where, 'needs "file" or "fingerprint" (to turn a check off everywhere, use "checks" instead)');
        if (file !== undefined && (typeof file !== "string" || file === "")) bad(`${where}.file`, `must be a site-relative path or glob, got ${show(file)}`);
        if (fingerprint !== undefined && !(typeof fingerprint === "string" && /^[0-9a-f]{16}$/.test(fingerprint))) bad(`${where}.fingerprint`, `must be the 16-character fingerprint from a report, got ${show(fingerprint)}`);
        if (expires !== undefined && !(typeof expires === "string" && DATE.test(expires) && !Number.isNaN(Date.parse(`${expires}T00:00:00Z`)))) bad(`${where}.expires`, `must be a date like 2027-03-01, got ${show(expires)}`);
        if (typeof check === "string" && typeof reason === "string") {
          const s: ConfigSuppression = { check, reason: reason.trim() };
          if (typeof file === "string") s.file = file;
          if (typeof fingerprint === "string") s.fingerprint = fingerprint;
          if (typeof expires === "string") s.expires = expires;
          config.suppressions.push(s);
        }
      });
  }

  if (problems.length > 0) throw new ConfigError(`${source} has ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  return config;
}

/** Reads and validates a config file. Returns an empty config when `path` is omitted and the default file is absent. */
export function loadConfig(cwd: string, path: string | undefined, knownCheckIds: readonly string[]): { config: Config; file: string | undefined } {
  const file = resolve(cwd, path ?? CONFIG_FILE);
  if (!existsSync(file)) {
    if (path !== undefined) throw new ConfigError(`config file not found: ${path}; fix the path or pass an existing file`);
    return { config: { checks: {}, ignore: [], suppressions: [] }, file: undefined };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ConfigError(`${path ?? CONFIG_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { config: parseConfig(raw, path ?? CONFIG_FILE, knownCheckIds), file };
}

export interface ResolvedChecks {
  checks: Check[];
  severity: Record<string, Severity>;
  options: Record<string, Record<string, unknown>>;
}

/**
 * Applies on/off, severity, and options. Entries apply from least to most specific, and the more specific entry
 * decides: a longer prefix beats a shorter one, and an exact check ID beats any prefix. So
 * `{ "a11y.*": "off", "a11y.color-contrast": "warning" }` turns every a11y check off except contrast, at warning.
 */
export function resolveChecks(config: Config, checks: readonly Check[]): ResolvedChecks {
  const result: ResolvedChecks = { checks: [], severity: {}, options: {} };
  const specificity = (pattern: string) => (pattern.endsWith(".*") ? pattern.length : 10_000 + pattern.length);
  const patterns = Object.keys(config.checks).sort((a, b) => specificity(a) - specificity(b));
  for (const check of checks) {
    const id = check.meta.id;
    let off = false;
    let severity: Severity | undefined;
    const options: Record<string, unknown> = {};
    for (const pattern of patterns) {
      if (!matchesCheck(pattern, id)) continue;
      const setting = config.checks[pattern]!;
      off = setting.off;
      if (setting.severity !== undefined) severity = setting.severity;
      Object.assign(options, setting.options);
    }
    if (off) continue;
    result.checks.push(check);
    if (severity !== undefined) result.severity[id] = severity;
    if (Object.keys(options).length > 0) result.options[id] = options;
  }
  return result;
}

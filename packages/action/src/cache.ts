// Cache rules for the Seaworthy GitHub Action (issue #261): what may be kept between runs,
// what key keeps it honest, and which restored records this run is allowed to read.
//
// What is cached: the run-history store the verify CLI already writes, `.seaworthy/history`, and
// nothing else. Not the site (untrusted input, rebuilt by the consumer's own job), not the reports
// or SARIF, not `node_modules`, and not a browser: Seaworthy never downloads one (ADR 0005,
// `packages/verify/src/browser.ts`), it launches the Chrome, Chromium, or Edge the machine already
// has, so there is no browser binary for this Action to keep. `.seaworthy/cache.json`, the
// `--changed` hashes, is left out too; why is written down below, next to the rules.
//
// Why a key, not a path, is the safety: a restored store changes what a run reports, not only how
// fast it is. `seaworthy diff`, `--new-only`, and the HTML/PR-comment trend all read the stored
// runs, so a store from another branch is a wrong baseline: the run compares against findings that
// were never there and calls them unchanged. The key therefore isolates the store completely —
// the OS, the ref that triggered the run, this Action's own pinned ref, and a digest of the
// workspace config — and there are deliberately no restore-keys: a prefix match is exactly the
// "some other run's history" case this file exists to prevent.
//
// Isolation by key is not enough, because `actions/cache` may hand back an entry whose raw parts
// were folded together (a renamed branch, an older runner): `recordDistrust` is the second check,
// on the store's own `root` and `spec` fields, and it refuses rather than guesses.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { HISTORY_DIR, HISTORY_SPEC_VERSION } from "@seaworthy/verify";

/** The prefix every history cache key starts with, so one workflow's entries are findable. */
export const CACHE_KEY_PREFIX = "seaworthy-history";

/** The values of the `cache` input: `off` caches nothing, `history` caches the run-history store. */
export const CACHE_MODES = ["off", "history"] as const;
export type CacheMode = (typeof CACHE_MODES)[number];

/** The default: caching run state changes results, so a workflow asks for it. */
export const CACHE_DEFAULT: CacheMode = "off";

// Why `.seaworthy/cache.json`, the `--changed` cache, is not part of the cached state: it keys on
// the site folder label and a sha256 per file, which does prove a *file's bytes* are the same — but
// nothing in the file records which tool wrote it, so a store restored across a version bump would
// say "this page is unchanged" to a build that added a check able to flag it, and `--changed` would
// then filter that finding out. Skipping a check for a file that did change is the failure this
// Action must never cause, so the changed cache is neither saved nor restored. The Action runs the
// full check on every file anyway: `packages/action/src/run.ts` never passes `--changed`, the same
// rule docs/agent-loop.md gives for CI.

/** The store's own file names, as the history writer writes them: `<seq>-<utc stamp>.json`. */
const STORE_FILE = /^\d{4,}-\d{8}T\d{9}Z\.json$/;

/** Longest a readable part of a key may be; GitHub's limit is 512 bytes for the whole key. */
const PART_MAX = 48;

/** How much of a digest goes into the key: enough that two folded parts cannot collide. */
const DIGEST_MAX = 12;

/**
 * The parts the key is computed from, every one of them a value the runner or the workspace gives:
 * the cache must never depend on a guess about what the run is.
 */
export interface CacheKeyInput {
  /** `RUNNER_OS`: Linux, macOS, or Windows. */
  readonly os: string;
  /** `GITHUB_REF`: `refs/heads/main`, `refs/pull/12/merge`. The ref that triggered the run. */
  readonly ref: string;
  /** `github.action_ref`: this Action's own pinned ref, the build whose checks filled the store. */
  readonly tool: string;
  /** The workspace's `seaworthy.config.json` text, "" when the site has none. */
  readonly config: string;
}

/**
 * GitHub's cache keys take alphanumeric characters, `-` and `_` only, so anything else becomes a
 * separator and a part that sanitizes away to nothing falls back to a named one. The digest at the
 * end of the key carries the raw bytes, so this folding costs nothing in accuracy.
 */
function keyPart(value: string, fallback: string): string {
  const folded = value
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return (folded === "" ? fallback : folded).slice(0, PART_MAX).replace(/-$/g, "");
}

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * The history cache key for a run: `<prefix>-<os>-<ref>-<config>-<action ref>-<digest>`.
 *
 * Different refs, different keys — a pull request run never restores main's history, and main
 * never restores a pull request's. Different config, different key — a run whose checks changed
 * starts a fresh store instead of comparing against runs made under other settings (the safe
 * direction: no previous run means `--new-only` reports everything). The trailing digest is over
 * the raw parts, so two refs that fold to the same text (`feature/a` and `feature-a`) still get
 * separate stores.
 */
export function historyCacheKey(input: CacheKeyInput): string {
  const config = input.config === "" ? "no-config" : digest(input.config).slice(0, 16);
  const parts = [keyPart(input.os, "no-os"), keyPart(input.ref, "no-ref"), config, keyPart(input.tool, "no-action-ref")];
  return `${CACHE_KEY_PREFIX}-${parts.join("-")}-${digest(JSON.stringify([input.os, input.ref, input.tool, input.config])).slice(0, DIGEST_MAX)}`;
}

/**
 * The key from the runner's environment, or "" when it cannot be computed. An empty key is the
 * only safe answer to a missing part: `action.yml` skips the cache step when the key is empty, and
 * the run verifies the site with no history rather than with an unisolated one.
 */
export function cacheKeyFromEnv(env: Readonly<Record<string, string | undefined>>, config: string): string {
  const os = (env.RUNNER_OS ?? "").trim();
  const ref = (env.GITHUB_REF ?? "").trim();
  if (os === "" || ref === "") return "";
  return historyCacheKey({ os, ref, tool: (env.SEAWORTHY_CACHE_TOOL ?? env.GITHUB_ACTION_REF ?? "").trim(), config });
}

/** A restored record this run refused, with the reason the Action logs. */
export interface UntrustedRecord {
  readonly name: string;
  readonly reason: string;
}

export interface StoreReview {
  /** Records left in place: the CLI may read them. */
  readonly kept: number;
  /** Records deleted before the CLI ran, oldest name first. */
  readonly dropped: readonly UntrustedRecord[];
}

/**
 * Why a restored record may not be read by this run, or undefined when it may. Checked against the
 * store's own fields, never against a name or a timestamp: the rule is that a record must say who
 * wrote it (`tool`), be readable by this build (`spec` no newer than this build's), name the folder
 * it measured (`root`, equal to this run's when the Action knows it), and carry what a reader needs
 * (`started`, `counts.findings`).
 *
 * A record from an *older* spec is kept: the readers only use fields every version has, so refusing
 * it would throw away the history a version bump is meant to keep.
 */
export function recordDistrust(value: unknown, expected: { readonly root: string | undefined; readonly spec: number }): string | undefined {
  if (value === null || typeof value !== "object") return "not a JSON object";
  const record = value as Record<string, unknown>;
  if (record["tool"] !== "seaworthy") return "not written by seaworthy";
  const spec = record["spec"];
  if (typeof spec !== "number" || !Number.isFinite(spec)) return "no spec version";
  if (spec > expected.spec) return `recorded with spec ${spec}, this build reads up to ${expected.spec}`;
  const root = record["root"];
  if (typeof root !== "string" || root === "") return "names no site folder";
  if (expected.root !== undefined && root !== expected.root) return `recorded for ${root}, this run verifies ${expected.root}`;
  if (typeof record["started"] !== "string") return "no run timestamp";
  const counts = record["counts"];
  if (counts === null || typeof counts !== "object" || typeof (counts as Record<string, unknown>)["findings"] !== "number") return "no finding counts";
  return undefined;
}

/** Where the store of a run in `cwd` lives: the one folder this Action caches. */
export const historyStoreDir = (cwd: string): string => join(cwd, HISTORY_DIR);

/**
 * Deletes the restored records this run must not trust, before the CLI reads the store.
 *
 * Only Seaworthy's own state is touched, and only files named like records: a record that fails the
 * check is deleted rather than skipped, so the save at the end of the job cannot hand the next run
 * the same untrusted file. Everything else in the folder is left for the CLI's reader, which skips
 * what it cannot parse. Like the rest of the cache path this is non-fatal: a folder that cannot be
 * read, or a file that cannot be deleted, costs history, never the run.
 */
export function reviewRestoredHistory(cwd: string, expectedRoot: string | undefined): StoreReview {
  const dir = historyStoreDir(cwd);
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => STORE_FILE.test(name)).sort();
  } catch {
    return { kept: 0, dropped: [] }; // no store at all: the first run of this ref and config
  }
  const dropped: UntrustedRecord[] = [];
  let kept = 0;
  for (const name of names) {
    const path = join(dir, name);
    let reason: string | undefined;
    try {
      reason = recordDistrust(JSON.parse(readFileSync(path, "utf8")) as unknown, { root: expectedRoot, spec: HISTORY_SPEC_VERSION });
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    if (reason === undefined) {
      kept++;
      continue;
    }
    try {
      unlinkSync(path);
    } catch {
      // Still in place: reported, and the readers degrade around it like around a crashed write.
    }
    dropped.push({ name, reason });
  }
  return { kept, dropped };
}

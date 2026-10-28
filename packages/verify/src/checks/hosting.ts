// hosting.headers, hosting.redirects: the _headers and _redirects files of Netlify and
// Cloudflare Pages must be valid, and every path they name must be something the build serves.
// Format sources: docs.netlify.com (custom headers, redirects) and developers.cloudflare.com
// Pages (headers, redirects). The files are split and inspected; nothing is ever executed.

import type { SiteGraph } from "../site.js";
import type { FindingDraft } from "../types.js";
import { siteText } from "./files.js";
import { check, meta } from "./helpers.js";

/** Header-field name characters: RFC 7230 tchar plus letters and digits. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SCHEME = /^https?:\/\//i;
/** With a status of 301 to 308 a redirect changes the address, so it must not point at itself. */
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
/** A path with neither splat nor placeholder matches one URL, so the build must serve it exactly. */
const isConcrete = (path: string): boolean => !path.includes("*") && !path.includes(":");
const pathPart = (path: string): string => path.split(/[?#]/)[0] ?? "";
const unquote = (token: string): string => (token.startsWith("\"") && token.length > 1 && token.endsWith("\"") ? token.slice(1, -1) : token);
const fixFor = (summary: string): FindingDraft["fix"] => ({ kind: "manual", summary, edits: [] });
const RULE_SUMMARY = "Both hosts read the file top to bottom and silently ignore a line that does not follow their format. See docs.netlify.com (custom headers, redirects) and developers.cloudflare.com/pages (headers, redirects).";

/** Whether the built site serves something at a root-relative URL path, honoring the base path. */
function served(site: SiteGraph, path: string): boolean {
  const target = site.resolveLink("/", path);
  return target.kind === "internal" && target.file !== undefined;
}

/**
 * What makes a splat or placeholder in a path never match. A redirect splat must end the
 * path, and only one is allowed; a header wildcard may sit anywhere inside a segment. A
 * splat and a placeholder may never share one segment, and a placeholder always starts
 * right after its `/`.
 */
function patternProblem(source: string, kind: "headers" | "redirects"): string | undefined {
  for (const segment of source.split("/").slice(1)) {
    if (segment.includes("*") && segment.includes(":")) return `${source} has a splat and a placeholder in the same path segment, which the hosts do not support.`;
  }
  if (kind === "redirects") {
    const splats = source.split("*").length - 1;
    if (splats > 1) return `${source} has more than one splat (*) in it. Only one splat is allowed, ending the path.`;
    if (splats === 1 && source.lastIndexOf("*") !== source.length - 1) return `${source} puts a splat before the end of the path. A splat must end the path, for example /blog/*.`;
  }
  return undefined;
}

/** Where in a path a placeholder breaks the hosts' rules: it must start its own segment. */
function placeholderProblem(source: string): string | undefined {
  for (const segment of source.split("/").slice(1)) {
    const at = segment.indexOf(":");
    if (at < 0) continue;
    return at > 0 ? `${source} puts a placeholder after text ("/${segment}"). A placeholder must start its path segment, for example /blog/:year.` : undefined;
  }
  return undefined;
}

/** The first URL path on a line: the token as-is, or what a `"quoted path"` wraps. */
function firstPath(line: string): string | undefined {
  if (!line.startsWith("\"")) return line.split(/\s+/)[0];
  const end = line.indexOf("\"", 1);
  return end === -1 ? undefined : line.slice(1, end);
}

/** Splits a redirect line between whitespace, keeping `"a source with spaces"` as one token. */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let rest = line;
  while (rest !== "") {
    rest = rest.replace(/^\s+/, "");
    if (rest === "") break;
    if (rest.startsWith("\"")) {
      const end = rest.indexOf("\"", 1);
      if (end === -1) {
        tokens.push(rest);
        break;
      }
      tokens.push(rest.slice(0, end + 1));
      rest = rest.slice(end + 1);
      continue;
    }
    const cut = rest.search(/\s/);
    if (cut === -1) {
      tokens.push(rest);
      break;
    }
    tokens.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return tokens;
}

/**
 * The parts of one redirect rule: source, destination, status code (with an optional `!`
 * force marker), and the conditions after it. `stripped` names the first token that does
 * not belong on the line.
 */
interface RedirectRule {
  source: string;
  destination: string | undefined;
  status: number | undefined;
  statusToken: string | undefined;
  conditions: string[];
  stripped: string | undefined;
}

function redirectRule(tokens: string[]): RedirectRule {
  const source = unquote(tokens[0] as string);
  let destination: string | undefined;
  let status: number | undefined;
  let statusToken: string | undefined;
  const conditions: string[] = [];
  let stripped: string | undefined;
  for (const raw of tokens.slice(1)) {
    const token = unquote(raw);
    if (/^[0-9]+!?$/.test(token)) {
      if (status === undefined) {
        status = Number.parseInt(token, 10);
        statusToken = token;
        continue;
      }
    } else if (token.startsWith("/") || SCHEME.test(token)) {
      if (destination === undefined) {
        destination = token;
        continue;
      }
    } else if (token.includes("=")) {
      conditions.push(token);
      continue;
    }
    stripped ??= token;
  }
  return { source, destination, status, statusToken, conditions, stripped };
}

export const hostingHeaders = check(meta("hosting.headers", "_headers has a malformed line or names a path the built site does not serve", "warning", ["Netlify custom headers", "Cloudflare Pages headers"], ["files"]), (ctx) => {
  const text = siteText(ctx.site, "/_headers");
  if (text === undefined) return [];
  const out: FindingDraft[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const location = { file: "_headers", line: i + 1, column: raw.length - raw.trimStart().length + 1 };
    const path = /^(\*|\/|")/.test(trimmed) ? firstPath(trimmed) : undefined;
    if (path !== undefined) {
      if (!path.startsWith("/") && path !== "*") {
        out.push({ message: `The _headers path "${path}" is not a URL path: it must start with /.`, location, fix: fixFor(`Point the path at a URL the site serves, for example /* or /about.html. ${RULE_SUMMARY}`), key: `not-a-path:${path}` });
        return;
      }
      const problem = patternProblem(path, "headers") ?? placeholderProblem(path);
      if (problem) {
        out.push({ message: `The _headers path ${problem}`, location, fix: fixFor(`Rewrite the path the way the hosts match rules: a placeholder directly after the /, and never a splat in one segment with it. ${RULE_SUMMARY}`), key: `pattern:${path}` });
        return;
      }
      if (isConcrete(path) && !served(ctx.site, path)) {
        out.push({ message: `The _headers path "${path}" matches nothing in the built site, so these headers are never sent.`, location, fix: fixFor("Point the path at a page the build emits, or build the page it applies to. A path that matches nothing silently does nothing."), key: `missing:${path}` });
      }
      return;
    }
    const colon = trimmed.indexOf(":");
    if (colon > 0) {
      const name = trimmed.slice(0, colon).trim();
      if (HEADER_NAME.test(name)) return; // a header line the hosts would apply
      out.push({ message: `The name before the colon is not a valid HTTP header field name: "${name}".`, location, fix: fixFor(`Write the header as a single field name (letters, digits, and the marks !#$%&'*+-.^_|~), a colon, and a value. ${RULE_SUMMARY}`), key: `bad-name:${name}` });
      return;
    }
    out.push({ message: `This line is not a URL path and not a header like "X-Frame-Options: DENY": it holds just "${trimmed}".`, location, fix: fixFor(`A header block is a URL path on one line and each header on its own line below it, like X-Frame-Options: DENY. ${RULE_SUMMARY}`), key: `not-a-header:${trimmed}` });
  });
  return out;
});

export const hostingRedirects = check(meta("hosting.redirects", "_redirects has a malformed line or redirects to a path the built site does not serve", "error", ["Netlify redirects", "Cloudflare Pages redirects"], ["files"]), (ctx) => {
  const text = siteText(ctx.site, "/_redirects");
  if (text === undefined) return [];
  const out: FindingDraft[] = [];
  const firstRuleFor = new Map<string, number>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const location = { file: "_redirects", line: i + 1, column: raw.length - raw.trimStart().length + 1 };
    const rule = redirectRule(tokenize(trimmed));
    if (!rule.source.startsWith("/") && rule.source !== "*") {
      const written = (tokenize(trimmed)[0] as string) ?? trimmed;
      out.push({ message: `The line must start with a source path, for example /old-page: the source here is "${written}".`, location, fix: fixFor(`Write each rule as: source, destination, and optional status code (with a ! to force it) and conditions like Country=de, separated by spaces. ${RULE_SUMMARY}`), key: `malformed:${written}` });
      return;
    }
    if (rule.stripped !== undefined) {
      out.push({ message: `The redirect line has an extra word: "${rule.stripped}" is not a destination, a status code, or a condition with an =, like Country=de.`, location, fix: fixFor(`A rule holds one source, one destination, one status code, and its conditions, all separated by spaces. ${RULE_SUMMARY}`), key: `malformed:${rule.stripped}` });
      return;
    }
    const { source, destination, status, statusToken, conditions } = rule;
    if (status !== undefined && (status < 200 || status > 599)) {
      out.push({ message: `${statusToken} is not a status code the hosts support. Use a code from 200 to 599, optionally with a ! to force the rule.`, location, fix: fixFor(`Replace it with the code the rule should send, for example 301 for a permanent move or 200 for a rewrite. ${RULE_SUMMARY}`), key: `bad-status:${statusToken}` });
      return;
    }
    if (destination === undefined) {
      if (status === undefined) {
        out.push({ message: "The redirect line has no destination and no status code, so it can never serve anything.", location, fix: fixFor(`Give the rule a destination, for example: ${source} /new-page. ${RULE_SUMMARY}`), key: `no-destination:${source}` });
      } else if (status !== 404 && status !== 410) {
        out.push({ message: `The redirect with the status ${statusToken} has no destination. Only 404 and 410 work without one.`, location, fix: fixFor(`Give the rule a destination, for example: ${source} /new-page ${statusToken}. ${RULE_SUMMARY}`), key: `needs-destination:${source}` });
      }
      return;
    }
    if (!destination.startsWith("/") && !SCHEME.test(destination)) {
      out.push({ message: `The redirect to "${destination}" is not a URL path or an absolute URL.`, location, fix: fixFor("Point the destination at a path starting with / (or under the base path, when the site sits under one) or at a full https:// address."), key: `not-a-target:${destination}` });
      return;
    }
    const problem = patternProblem(source, "redirects") ?? placeholderProblem(source);
    if (problem) {
      out.push({ message: `The redirect source ${problem}`, location, fix: fixFor(`Rewrite the source path the way the hosts match rules: one splat ending the path, a placeholder directly after the /. ${RULE_SUMMARY}`), key: `pattern:${source}` });
      return;
    }
    const conditional = `${source}\u0000${conditions.slice().sort().join("\u0000")}`;
    if (firstRuleFor.has(conditional)) {
      out.push({ message: `The rule for ${conditions.length > 0 ? `${source} (${conditions.join(" ")})` : source} repeats a rule above. The hosts apply only the first match, so this line never runs.`, location, severity: "warning", fix: fixFor("Keep the line you want to be the first match, and delete the later duplicate or change its source."), key: `duplicate:${conditional}` });
      return;
    }
    firstRuleFor.set(conditional, i + 1);
    if (status !== undefined && REDIRECT_CODES.has(status) && source === pathPart(destination)) {
      out.push({ message: `The redirect from ${source} to ${destination} sends the visitor to the same address, so browsers follow it until they give up.`, location, fix: fixFor("Change the destination to the address the redirect should land on. The hosts cannot add or remove a trailing slash with a rule, so /blog/a/ to /blog/a loops forever."), key: `self-redirect:${conditional}` });
      return;
    }
    if (isConcrete(pathPart(destination)) && destination.startsWith("/") && !served(ctx.site, pathPart(destination))) {
      out.push({ message: `The redirect to ${pathPart(destination)} points at a file the built site does not have.`, location, fix: fixFor("Point the destination at a page the build emits, or build the page it should land on. People who click the moved link get a 404 instead."), key: `missing:${pathPart(destination)}` });
    }
  });
  return out;
});

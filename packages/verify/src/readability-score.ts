// The agent-readability summary: how many of the checks that apply to this site came out clean.
// A count, not a quality judgment. See spec/agent-readability/v1.md, "The score".

import { siteText } from "./checks/files.js";
import { registrationAnchors } from "./checks/webmcp.js";
import { attr, type SiteGraph } from "./site.js";
import type { Finding, Readability } from "./types.js";

const hasPage = (site: SiteGraph, test: (page: SiteGraph["pages"] extends ReadonlyMap<string, infer P> ? P : never) => boolean): boolean => [...site.pages.values()].some(test);

/** Whether the thing a check looks at exists in this site. A check that has nothing to look at is not counted. */
const APPLIES: Record<string, (site: SiteGraph) => boolean> = {
  "readability.llms-txt": () => true, // a missing file is itself a (note-level) finding
  "readability.md-alternates": (site) => hasPage(site, (p) => p.elements.some((e) => e.tagName === "link" && (attr(e, "type") ?? "").trim().toLowerCase() === "text/markdown")),
  "readability.jsonld": (site) => hasPage(site, (p) => p.elements.some((e) => e.tagName === "script" && (attr(e, "type") ?? "").trim().toLowerCase() === "application/ld+json")),
  "readability.ai-robots": (site) => siteText(site, "/robots.txt") !== undefined,
  "readability.ssr-content": (site) => site.pages.size > 0,
  "readability.content-signals": (site) => /^\s*content-(signal|usage)\s*:/im.test(siteText(site, "/robots.txt") ?? ""),
  "readability.agent-skills": (site) => siteText(site, "/.well-known/agent-skills/index.json") !== undefined,
  "readability.api-catalog": (site) => ["/.well-known/api-catalog", "/.well-known/api-catalog.json"].some((p) => siteText(site, p) !== undefined),
  "readability.mcp-card": (site) => ["/.well-known/mcp/server-card.json", "/.well-known/mcp.json", "/.well-known/mcp/server-cards.json"].some((p) => siteText(site, p) !== undefined),
  "readability.a2a-card": (site) => siteText(site, "/.well-known/agent-card.json") !== undefined,
  "readability.markdown-negotiation": () => true,
  // The same claim the check reads findings from: a page whose source registers tools. Prose about WebMCP is not.
  "readability.webmcp": (site) => hasPage(site, (page) => registrationAnchors(site, page).length > 0),
};

/**
 * `ran` are the IDs of the readability checks that ran (not skipped). A check counts when its input exists or it produced
 * a finding. Returns undefined when no readability check applies, so reports without the pack do not carry the field.
 */
export function readabilitySummary(site: SiteGraph, ran: readonly string[], findings: readonly Finding[]): Readability | undefined {
  const withFindings = new Set(findings.filter((f) => f.checkId.startsWith("readability.")).map((f) => f.checkId));
  const counted = ran.filter((id) => id.startsWith("readability.") && ((APPLIES[id]?.(site) ?? false) || withFindings.has(id)));
  if (counted.length === 0) return undefined;
  const dirty = counted.filter((id) => withFindings.has(id)).length;
  const passed = counted.length - dirty;
  return { score: Math.round((100 * passed) / counted.length), checks: counted.length, passed, withFindings: dirty };
}

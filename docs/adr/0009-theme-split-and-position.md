# 0009. The theme becomes its own project; Seaworthy competes on pre-deploy verification and CI-grade contracts

**Status:** Accepted (2026-10-18). Supersedes the part of ADR 0001 that keeps the reference theme in this repository, and the theme notes in ADR 0002.

## Context

ADR 0001 kept an editorial, RTL-ready reference theme in this repository as a tier-2 track. Two things changed.

**The theme fits better as a separate project.** It is a site builder (Jekyll, Ruby, Liquid); Seaworthy is a verifier (Node, TypeScript). In one repository they share a CI matrix, an issue tracker, and a launch, and a verifier that ships its own theme looks less framework-agnostic than it claims. As a separate project, the theme becomes Seaworthy's first real consumer: it verifies every pull request with the Seaworthy Action and shows the badge.

**Research on 2026-10-18 changed how we see the field.**

- Demand is real and growing. In a vendor study by AudioEye, five AI tools built 15 sites targeting WCAG 2.2 AA and all 15 failed Level A, averaging about 55 issues per page ([VentureBeat](https://venturebeat.com/ai/we-asked-five-ai-tools-to-build-accessible-websites-all-15-sites-failed)). WebAIM's 2026 scan reported the first decline in homepage accessibility in six years, partly attributed to AI-assisted coding ([Stacker](https://stacker.com/stories/ai/study-ai-coding-tools-do-not-write-accessible-code)). The European Accessibility Act has applied since June 2025, and EN 301 549 v4.1.1 moves European guidance to WCAG 2.2 ([BrowserStack](https://www.browserstack.com/blog/what-en-301-549-v4-1-1-means-for-your-accessibility-strategy/)).
- A direct competitor exists. [squirrelscan](https://github.com/squirrelscan/squirrelscan) (MIT, started January 2026, about 280 stars) is "the website QA tool for your coding agent": 300+ rules across SEO, performance, security, accessibility, and agent readiness, with Agent Skills, an MCP server, and LLM-oriented output. Its documentation shows audits of live domains; it does not document auditing a build folder before deploy, SARIF, baselines, suppressions, or literal code edits, and browser rendering uses paid cloud credits ([docs](https://docs.squirrelscan.com/index.md)).
- Cloudflare launched an [Agent Readiness score](https://blog.cloudflare.com/agent-readiness/): live URLs only, agent standards only (Markdown content negotiation, Content Signals, AI bot rules, Agent Skills index, API Catalog, MCP Server Card, Web Bot Auth, WebMCP), no CLI or CI, no accessibility or broken links.
- `llms.txt` adoption grew 8.8 times in a year, but about 97% of files received no requests at all ([PPC Land](https://ppc.land/llms-txt-adoption-rises-8-8x-but-97-of-files-get-zero-ai-requests/)). Markdown content negotiation is gaining ground ([Cloudflare](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents)). Agent standards such as IETF AIPREF and MCP Server Cards are still drafts.

## Decision

1. **The theme moves to its own repository.** Its epics and spikes leave this roadmap. Their issues are labeled `moved: theme`, taken out of this repository's milestones, and transferred once the theme repository exists, so their history is kept. The dependency points one way: the theme depends on Seaworthy (the Action, the badge, the agent-readability spec), never the reverse.
2. **Seaworthy does not compete on rule count.** It competes on what the field lacks:
   - **Verification before deploy:** built output, offline, on localhost and pull requests, deterministic. Live-site verification is added in Phase 5, so Seaworthy covers both sides of the deploy.
   - **CI-grade contracts:** versioned report, stable check IDs, fingerprints, SARIF, baselines, and expiring suppressions.
   - **Proven fixes:** text-anchored edits that tests apply mechanically and verify again.
   - **Local and free:** rendered checks use a browser the user already has; no cloud credits.
   - **An open spec** others can implement.
3. **Coverage still has to grow a lot**, led by accessibility, because that is where the demand and the regulation are. The roadmap roughly doubles in size: a static accessibility pack, Node-native HTML conformance (from the parser's own errors, no Java), the agent standards Cloudflare checks (with honest severities: `llms.txt` is a note), live-site and hosting checks, site-level quality checks, a faster agent loop, rendered layout checks, Markdown sources, and an i18n pack.
4. **Phase 5 changes from "reference theme" to "live sites and the agent loop."** Dates stay the same.

## Consequences

- The roadmap grows from about 160 to about 300 tasks in the same six months. Most new tasks are small rule checks in the `free-agent` lane that agents and contributors can do in parallel. If throughput is too low, dates move rather than quality.
- A public, honest benchmark against squirrelscan, lychee, and pa11y on a shared corpus becomes a launch requirement, and every "only Seaworthy does X" claim needs a tested link.
- The `theme/` folder and the theme track are removed from this repository. The two theme spike briefs leave with it.
- Agent standards that are still drafts are checked only when a site publishes them, and their findings stay at note or warning until the standard settles.

# Roadmap: H1 (2026-10-19 → 2027-04-18)

> **Seaworthy** · *Ship sites agents can trust.*
>
> **Seaworthy verifies websites for agents.** One command checks any built static site (any framework, any host)
> and returns a versioned, machine-readable report: every finding has an ID, a location, and a fix hint that an agent can apply.
> Before deploy on the build folder, and after deploy on the live site.

## North star

By month 12, when a coding agent builds or edits a website, it runs `seaworthy verify` before it says "done",
the way it runs tests before it commits. "Seaworthy verified" is a badge people expect, and the report format
is a spec that other tools implement.

This roadmap covers the first six months:
- **Launch wave 1 (Phase 4):** `seaworthy verify` 0.1, with MCP, Agent Skills, and a GitHub Action.
- **Launch wave 2 (Phase 5):** live-site verification, hosting and site-level checks, and a faster agent loop.
- **Phase 6:** extension API for custom checks and a draft spec (0.9) that months 7 to 12 turn into 1.0.

## Why verify is the core product

| | Theme first | Verify first (this roadmap) |
|---|---|---|
| Who can use it | People starting a new Jekyll site | Every static site and every agent that builds one |
| Cost to try | Migrate a site | One command: `npx seaworthy verify ./dist` |
| Path to a standard | Themes rarely become standards | Verification tools do (ESLint, Lighthouse) |
| As models improve | Building a theme gets easier | More generated output means more need to check it |

## Position

Research on 2026-10-18 ([ADR 0009](docs/adr/0009-theme-split-and-position.md)) found real demand (AI-built sites fail basic accessibility; the European Accessibility Act applies since June 2025) and real competition:

| Tool | What it does | What it lacks that Seaworthy has |
|---|---|---|
| squirrelscan | Website QA for coding agents: 300+ rules, Skills, MCP, LLM output | Documented audits are of live domains; no SARIF, baseline, suppressions, or literal edits; rendering uses paid cloud credits |
| Cloudflare Agent Readiness | Scores a live URL on emerging agent standards | No CLI or CI; no accessibility or links; one URL, not a site |
| lychee, html-proofer, pa11y, Lighthouse CI | One slice each (links, accessibility, performance) | One shared report, IDs, fingerprints, and fixes across all of them |

Seaworthy does not compete on rule count. It competes on **verification before deploy** (and after, from Phase 5), **CI-grade contracts**, **fixes proven by tests**, **local and free** rendered checks, and an **open spec**. Coverage still roughly doubles in this roadmap, led by accessibility.

The reference theme is now a separate project that uses Seaworthy to verify itself ([ADR 0009](docs/adr/0009-theme-split-and-position.md)).

## Consumers

The reference theme is a separate project that depends on Seaworthy ([ADR 0009](docs/adr/0009-theme-split-and-position.md)). Its source maps, agent-readable output, CI gate, badge, and MCP server each rely on a Seaworthy deliverable, listed with phases in [docs/consumers/theme.md](docs/consumers/theme.md). Seaworthy never depends on the theme. Tasks that exist mainly for it: `spec.source-map`, `int.source-map`, `readability.webmcp`, `int.theme-fixture`, and `launch2.theme-consumer`.

## Product principles

These rules decide every scope question below.

1. **Verify, don't advise.** Every check produces pass/fail with a location and a fix hint. "Looks good" is never an output.
2. **Agent-native from day one.** Every capability is reachable from the CLI, MCP, and an Agent Skill, and always returns machine-readable output.
3. **Framework-agnostic.** Verify reads built output (HTML, assets, metadata), never a framework's internals. Framework support is a recipe, not a fork.
4. **Build on existing standards.** `llms.txt`, schema.org, WCAG, SARIF, Open Graph. Seaworthy checks conformance to them; it does not invent competing formats.
5. **Auto-discoverable.** Agents and humans find Seaworthy where they already look: MCP Registry, agent marketplaces, `llms.txt`, agent instruction files, GitHub Marketplace.
6. **Adoptable on day one.** A baseline file lets an existing site with 500 findings adopt Seaworthy and only fail on new ones.
7. **Small core, open edges.** The core stays small. New checks, presets, and integrations arrive as extensions through a versioned contract.
8. **Versioned contracts.** Report schema, check IDs, config schema, and extension API all carry `spec:` versions. Breaking changes need a major version, an RFC, and a migration note.

## Phases

| Phase | Dates | Focus | Release |
|---|---|---|---|
| Phase 0 | 2026-10-19 → 2026-11-01 | Foundations and feasibility spikes | none |
| Phase 1 | 2026-11-02 → 2026-11-29 | Verify engine and check pack v1 | `verify 0.1.0-alpha.1` |
| Phase 2 | 2026-11-30 → 2026-12-20 | Agent interface: MCP, Skills, Action | `verify 0.1.0-alpha.2` |
| Phase 3 | 2026-12-21 → 2027-01-17 | Integrations, benchmark, docs, private beta | `verify 0.1.0-beta.1` |
| Phase 4 | 2027-01-18 → 2027-02-07 | **Launch wave 1: verify** | **`verify 0.1.0`** |
| Phase 5 | 2027-02-08 → 2027-03-07 | **Launch wave 2: live sites and the agent loop** | **`verify 0.2.0`** |
| Phase 6 | 2027-03-08 → 2027-04-18 | Extensions, spec 0.9, community | `verify 0.3.0` + Spec 0.9 |

**Volume.** About 300 tasks. Most rule checks are small `free-agent` tasks meant to run in parallel, by agents and contributors. If throughput is too low, dates move rather than quality.

Phase 3 spans the holiday period, which is why it is four weeks long.

## Labels

Copy the label system from Evergreen, with areas for this project.

| Group | Labels |
|---|---|
| Roadmap | `roadmap`, `type: epic`, `type: task` |
| Lane | `lane: strong-agent` (needs a strong coding agent or experienced contributor), `lane: free-agent` (spec-complete, good for free agents and newcomers), `lane: maintainer` (accounts, credentials, or decisions) |
| Size | `size: XS` (< 1h), `size: S` (a few hours), `size: M` (about a day) |
| Type | `type: check`, `type: integration`, `type: preset`, `type: fixture`, `type: test`, `type: docs`, `type: spike` |
| Area | `area: core`, `area: checks`, `area: a11y`, `area: html`, `area: live`, `area: agent`, `area: integration`, `area: i18n`, `area: devops`, `area: dx`, `area: docs`, `area: brand`, `area: community`, `area: standards`, `area: release`, `area: validation` |
| Status | `moved: theme` (now belongs to the theme project; will be transferred) |

No task is bigger than `size: M`. Anything bigger becomes an epic.

## Child issue template

Every task in this roadmap becomes one issue with this shape. One issue = one pull request.

````markdown
<!-- seaworthy-roadmap-key: check.links-internal -->
> **Epic:** #NN · **Phase:** Phase 1 — Verify engine and check pack v1 (2026-11-02 → 2026-11-29)
> **Lane:** `lane: free-agent` · **Size:** S (a few hours)

## Goal
One sentence: what exists when this is done.

## Agent brief

**Files**
- `packages/verify/src/checks/links-internal.ts`
- `fixtures/broken/links-internal/`

**Steps**
1. ...

**Do not**
- Do not expand scope beyond this issue; open a follow-up instead.
- Do not change a versioned contract (report schema, check IDs) without updating its schema and changelog.
- Do not add network access to checks unless the check is marked opt-in.

**Run**
```bash
npm ci
npm run check
```

## Done when
- [ ] The check fires on its broken fixture and stays silent on all clean fixtures.
- [ ] The check has a docs page with ID, rationale, and fix examples.
- [ ] `npm run check` passes.

## Depends on
- #NN
````

---

# Phase 0 — Foundations and feasibility spikes (2026-10-19 → 2026-11-01)

## Epic: Repository, CI, and contribution lanes
<!-- seaworthy-roadmap-key: E-foundation -->
> **Epic** · **Phase:** Phase 0 — Foundations and feasibility spikes (2026-10-19 → 2026-11-01)

### Outcome
A repository that agents and humans can contribute to on day one: clear lanes, one check command, and instruction files for agents.

### Scope
- Monorepo: `packages/verify`, `packages/mcp`, `packages/action`, `skills/`, `fixtures/`, `spec/`, `docs/`
- `npm run check` as the single gate
- `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`
- Label set and roadmap-to-issues generator (port of Evergreen's `planning/roadmap`)

### Non-goals
- Securing the name, org, and domain (tracked in E-brand).

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `foundation.layout` | Create the monorepo layout | strong-agent | S | none |
| `foundation.check` | `npm run check`: lint, typecheck, schema validation, tests, fixture runs | strong-agent | S | `foundation.layout` |
| `foundation.ci` | GitHub Actions CI on push and PR (Node LTS matrix, macOS/Linux/Windows) | free-agent | S | `foundation.check` |
| `foundation.agents-md` | `AGENTS.md` and `CLAUDE.md`: layout, commands, contracts, "one issue = one PR" | strong-agent | S | `foundation.layout` |
| `foundation.contributing` | `CONTRIBUTING.md` with lanes, sizes, and claim process | free-agent | XS | `foundation.agents-md` |
| `foundation.labels` | Script that creates the label set | free-agent | XS | none |
| `foundation.issue-gen` | Port the roadmap-to-issues generator so this file becomes issues and epics | strong-agent | M | `foundation.labels` |
| `foundation.license` | License (MIT or Apache-2.0) | maintainer | XS | none |

### Exit criteria
- [ ] `npm ci && npm run check` is green on a fresh clone on all three OSes.
- [ ] Every task in this roadmap exists as a labeled issue linked to its epic.

## Epic: Feasibility spikes
<!-- seaworthy-roadmap-key: E-spikes -->
> **Epic** · **Phase:** Phase 0 — Foundations and feasibility spikes (2026-10-19 → 2026-11-01)

### Outcome
Answer the questions that could change the architecture before building on them. Spike code is throwaway; the output is a written decision (ADR).

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `spike.runtime` | Node vs. a single binary; measure install size and cold start for `npx` | strong-agent | S | none |
| `spike.browser` | Headless browser for a11y and Lighthouse: cost in CI, and a static-only fallback when no browser is available | strong-agent | M | none |
| `spike.check-model` | Check API design: static (HTML/AST) vs. rendered (browser) checks, and how they share one report | strong-agent | M | none |
| `spike.prior-art` | Review html-proofer, lychee, pa11y, Lighthouse CI, webhint; list what to reuse vs. build | strong-agent | S | none |
| `spike.competitors` | Run squirrelscan, Cloudflare Agent Readiness, lychee, and pa11y on the fixtures; write down what each finds and misses | strong-agent | M | none |
| `spike.crawler` | Design live-site crawling: discovery from links and sitemaps, robots.txt, rate limits, page caps, and how pages enter the site graph | strong-agent | M | `spike.check-model` |
| `spike.html-conformance` | Can parse5's parse errors plus a few rules give useful HTML conformance without Java? Compare with the Nu Html Checker on the fixtures | strong-agent | S | none |
| `spike.markdown-sources` | Checking repository Markdown (README, docs) for broken links and anchors: GitHub heading slugs, relative paths, and where it fits | strong-agent | S | none |

### Exit criteria
- [ ] Each spike has an ADR in `docs/adr/` with a decision and its consequences.

## Epic: Brand and naming
<!-- seaworthy-roadmap-key: E-brand -->
> **Epic** · **Phase:** Phase 0 → Phase 3 · **Tier:** must close before Phase 4

### Outcome
Name, mark, palette, badge, and launch art are decided and shipped as a reusable brand kit that works in a README, a terminal, and a social card. The name and visual system are final: **Seaworthy**, the Load Line mark (two rings crossed by a waterline), Desert Rose and Ink palette, dark-first. What remains is securing the name and polishing small-size and legal details.

### Scope
- Name status (checked 2026-10-17): GitHub `seaworthy` and `seaworthyhq` are taken; `seaworthy-sh`, `seaworthy-dev`, `useseaworthy` are free. npm `seaworthy-cli`, `@seaworthy/verify`, `@seaworthy/mcp` are free; the `@seaworthy` npm org is unconfirmed. `seaworthy.com`, `.dev`, `.io`, `.app`, `.tools` are registered; `seaworthy.sh` had no DNS record.
- Tagline: *Ship sites agents can trust.* Secondary line for banners: *Verified before it sails.*
- Palette: Abyss, Ink, Desert Rose, Rose Deep, Rose Light, Sand, Mist; Sea Teal, Signal Amber, and Alert Red reserved for pass, warn, and fail.
- The full system is in `brand/BRAND_GUIDE.md`; every SVG and PNG is generated by `tools/brand/`.

### Non-goals
- Animated logos or motion design.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `brand.secure` | Register GitHub org, npm org (`@seaworthy`), and domain (`seaworthy.sh` if free); run a trademark search | maintainer | S | none |
| `brand.logo` | Load Line mark in four variants (dark, light, mono, mono-light) as SVG and PNG, with a logo review sheet | maintainer | M | none |
| `brand.badge` | Status badge design (passing, warnings, errors) and a reusable generator | strong-agent | S | `brand.logo` |
| `brand.kit` | Brand kit in `brand/`: tokens, guide, templates, exports, and a check that keeps them in sync | strong-agent | S | `brand.logo` |
| `brand.favicon` | Simplified mark that holds at 16 and 32 px, and a favicon set | strong-agent | S | `brand.logo` |
| `brand.policy` | Brand-use policy: when the name and logo may be used, and by whom | maintainer | XS | `brand.secure` |

### Exit criteria
- [ ] Name, org, npm scope, and domain are registered.
- [ ] `brand/` contains everything both launch kits need.
- [ ] A favicon exists that stays readable at 16 px.

---|---|---|---|---|
| `brand.secure` | Register GitHub org, npm org (`@seaworthy`), and domain (`seaworthy.sh` if free); run a trademark search | maintainer | S | none |
| `brand.logo` | Logo mark (Plimsoll line) and wordmark in SVG, light and dark | maintainer | M | none |
| `brand.badge` | "Seaworthy" badge design: pass, warn, fail | strong-agent | S | `brand.logo` |
| `brand.kit` | Brand kit in `brand/`: colors, type, social card template | strong-agent | S | `brand.logo` |

### Exit criteria
- [ ] Name, org, npm scope, and domain are registered.
- [ ] `brand/` contains everything both launch kits need.

---

# Phase 1 — Verify engine and check pack v1 (2026-11-02 → 2026-11-29)

## Epic: Verify engine
<!-- seaworthy-roadmap-key: E-verify -->
> **Epic** · **Phase:** Phase 1 — Verify engine and check pack v1 (2026-11-02 → 2026-11-29) · **Track:** verify

### Outcome
`seaworthy verify <dir>` checks any built static site folder and returns a versioned report. Every finding has a stable check ID, severity, file and line, and a machine-readable fix hint.

### Scope
- CLI: `seaworthy verify [dir] --format json|sarif|pretty|markdown`
- Report schema `spec/report/v1` with a `fix` object per finding (what to change, where, and an example)
- Check API shared by built-in and (later) external checks
- Exit codes and severity thresholds for CI gates
- **Baseline:** `--baseline` writes current findings; later runs fail only on new ones
- **Suppressions:** inline or config-based, with a required reason and optional expiry date
- **Incremental:** `--changed` checks only files changed since a git ref (fast loop for agents)

### Non-goals
- Editing files. Verify reports and suggests; agents and humans apply fixes.
- Network calls by default. Checks that need the network are opt-in.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `verify.cli` | CLI skeleton, config loading, exit codes | strong-agent | S | `spike.runtime` |
| `verify.report-schema` | Report JSON Schema v1 with stable check IDs and `fix` object | strong-agent | M | `spike.check-model` |
| `verify.check-api` | Check interface: id, metadata, run, findings | strong-agent | M | `verify.report-schema` |
| `verify.html-parse` | Shared HTML parsing and site graph (pages, links, assets) built once per run | strong-agent | M | `verify.check-api` |
| `verify.sarif` | SARIF output for GitHub code scanning | free-agent | S | `verify.report-schema` |
| `verify.pretty` | Human-readable terminal output | free-agent | S | `verify.report-schema` |
| `verify.markdown` | Markdown output for PR comments and agent chats | free-agent | S | `verify.report-schema` |
| `verify.config` | Config file: enable, disable, severity overrides, budgets; JSON Schema for it | strong-agent | S | `verify.check-api` |
| `verify.baseline` | `--baseline` file and "new findings only" mode | strong-agent | M | `verify.report-schema` |
| `verify.suppress` | Suppressions with required reason and optional expiry | strong-agent | S | `verify.config` |
| `verify.changed` | `--changed <ref>` incremental mode | strong-agent | S | `verify.html-parse` |
| `verify.fixtures` | Clean and broken fixture sites with ground-truth findings | free-agent | S | `verify.check-api` |
| `verify.timings` | `--timings`: time per check and per stage, kept out of the default report so it stays deterministic | free-agent | S | `verify.cli` |
| `verify.max-findings` | `--max-findings` and per-check caps, so a broken site does not produce a 50,000-line report | free-agent | S | `verify.cli` |
| `verify.parallel` | Run static checks in parallel over the shared graph; measure on a 10,000-page fixture | strong-agent | M | `verify.html-parse` |

### Exit criteria
- [ ] `seaworthy verify` produces a valid report on fixtures built with at least three different generators.
- [ ] Every fixture's findings match its ground truth exactly.
- [ ] A site with existing findings adopts verify through a baseline with zero failures on first run.

## Epic: Check pack v1
<!-- seaworthy-roadmap-key: E-checks -->
> **Epic** · **Phase:** Phase 1 → Phase 2 · **Track:** verify

### Outcome
The checks that catch what breaks most often on static sites. Each check is one small task, with its own fixture and docs page.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `check.links-internal` | Broken internal links and anchors | free-agent | S | `verify.html-parse` |
| `check.links-external` | External links (opt-in, cached, rate-limited) | free-agent | S | `check.links-internal` |
| `check.assets` | Missing CSS, JS, images, and fonts | free-agent | S | `verify.html-parse` |
| `check.base-url` | Wrong base URL or path prefix (the classic GitHub Pages subpath bug) | strong-agent | S | `verify.html-parse` |
| `check.meta` | Title, description, canonical, `lang`, viewport | free-agent | S | `verify.html-parse` |
| `check.social` | Open Graph and Twitter card tags, image size | free-agent | S | `check.meta` |
| `check.headings` | Heading order and a single `h1` | free-agent | XS | `verify.html-parse` |
| `check.names` | Accessible names: form labels, button text, and link text | free-agent | S | `verify.html-parse` |
| `check.images` | Missing `alt`, missing dimensions, oversized images | free-agent | S | `verify.html-parse` |
| `check.a11y` | Accessibility with axe-core (rendered), mapped to report findings | strong-agent | M | `spike.browser` |
| `check.lighthouse` | Lighthouse budgets (performance, SEO, best practices), opt-in | strong-agent | M | `spike.browser` |
| `check.rtl` | RTL correctness: `dir`, mixed-direction text, physical CSS properties | strong-agent | M | `verify.html-parse` |
| `check.sitemap-robots` | `sitemap.xml` and `robots.txt` validity and consistency | free-agent | S | `verify.html-parse` |
| `check.security-headers` | Mixed content, `target=_blank` without `rel`, inline-script CSP hints | free-agent | S | `verify.html-parse` |

### Exit criteria
- [ ] Every check fires on its broken fixture and stays silent on all clean fixtures.
- [ ] Each check has a docs page with its ID, rationale, and fix examples.

## Epic: Agent-readability checks
<!-- seaworthy-roadmap-key: E-agent-readability -->
> **Epic** · **Phase:** Phase 1 → Phase 2 · **Track:** verify

### Outcome
Verify answers "can agents and AI search read this site?" by checking conformance to existing standards. This is the AI-native layer, built on standards rather than invented formats.

### Scope
- `llms.txt` and `llms-full.txt` per the public proposal
- Markdown alternates (`<link rel="alternate" type="text/markdown">`)
- schema.org JSON-LD validity per page type
- AI crawler rules in `robots.txt` match the site's stated intent
- Content is in the HTML (not only rendered by client-side JS)

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `readability.spec` | `spec/agent-readability/v1.md`: which standards, which rules, which check IDs | strong-agent | M | `spike.prior-art` |
| `check.llms-txt` | `llms.txt` exists, follows the proposal, and links resolve | free-agent | S | `readability.spec` |
| `check.md-alternates` | Markdown alternates exist and match page content | strong-agent | S | `readability.spec` |
| `check.jsonld` | JSON-LD parses and has required schema.org fields per type | free-agent | S | `readability.spec` |
| `check.ai-robots` | AI crawler directives are explicit and consistent | free-agent | S | `check.sitemap-robots` |
| `check.ssr-content` | Main content present without JavaScript | strong-agent | S | `verify.html-parse` |
| `readability.score` | Agent-readability summary score in the report | strong-agent | S | `check.llms-txt` |
| `readability.content-signals` | Content Signals and AIPREF `Content-Usage` lines in robots.txt are well-formed when present (draft standard: warning at most) | free-agent | S | `readability.spec` |
| `readability.agent-skills-index` | `/.well-known/agent-skills/index.json` is valid and every listed skill exists, when present | free-agent | S | `readability.spec` |
| `readability.api-catalog` | `/.well-known/api-catalog` (RFC 9727) is valid linkset JSON and its links resolve, when present | free-agent | S | `readability.spec` |
| `readability.mcp-card` | MCP Server Card is valid JSON with required fields, at the paths the current draft uses, when present | free-agent | S | `readability.spec` |
| `readability.a2a-card` | A2A agent card at `/.well-known/agent-card.json` matches the 1.0 schema, when present | free-agent | S | `readability.spec` |
| `readability.markdown-negotiation` | Opt-in, network: the deployed page answers `Accept: text/markdown` with Markdown | strong-agent | S | `readability.spec`, `check.links-external` |
| `readability.severity-policy` | Document and test severities: llms.txt and draft standards are notes or warnings, never errors | free-agent | XS | `readability.spec` |

### Exit criteria
- [ ] Running verify on a popular docs site gives a correct, explainable agent-readability score.

---

## Epic: Static accessibility pack
<!-- seaworthy-roadmap-key: E-a11y-static -->
> **Epic** · **Phase:** Phase 1 — Verify engine and check pack v1 (2026-11-02 → 2026-11-29) · **Track:** verify

### Outcome
The accessibility rules that need no browser, built on the shared graph: the bulk of what makes AI-built sites fail WCAG Level A. Each rule is one small task with a fixture.

### Scope
- Rules from WCAG 2.2 Level A and AA that can be decided from HTML alone
- Severity follows the conformance level: Level A failures are errors

### Non-goals
- Rules that need layout or color: those run in a browser (`check.a11y`, `E-rendered-layout`).

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `a11y.duplicate-id` | Duplicate `id` values on a page (break labels, anchors, and ARIA references) | free-agent | S | `verify.html-parse` |
| `a11y.aria-attributes` | ARIA attributes that do not exist, are misspelled, or have invalid values | free-agent | M | `verify.html-parse` |
| `a11y.aria-roles` | Unknown `role` values and roles not allowed on the element | free-agent | S | `verify.html-parse` |
| `a11y.aria-references` | `aria-labelledby`, `aria-describedby`, and `aria-controls` that point at ids that do not exist | free-agent | S | `verify.html-parse` |
| `a11y.hidden-focusable` | `aria-hidden="true"` on an element that is or contains something focusable | free-agent | S | `verify.html-parse` |
| `a11y.tabindex` | `tabindex` greater than 0, which breaks the natural focus order | free-agent | XS | `verify.html-parse` |
| `a11y.iframe-title` | `<iframe>` without a title | free-agent | XS | `verify.html-parse` |
| `a11y.table-headers` | Data tables with no header cells, and `headers` attributes pointing nowhere | free-agent | S | `verify.html-parse` |
| `a11y.autocomplete` | Invalid `autocomplete` tokens on personal-data fields (WCAG 1.3.5) | free-agent | S | `verify.html-parse` |
| `a11y.lang-parts` | `lang` on inner elements must be a valid language code (WCAG 3.1.2) | free-agent | XS | `verify.html-parse` |
| `a11y.skip-link` | Pages with navigation before the main content have a working skip link | free-agent | S | `verify.html-parse` |
| `a11y.landmarks` | Exactly one `<main>` (or role=main) per page; no content-bearing page without it | free-agent | S | `verify.html-parse` |
| `a11y.empty-headings` | Headings with no text | free-agent | XS | `verify.html-parse` |
| `a11y.radio-groups` | Radio buttons and checkbox groups without a `fieldset` and `legend` or a group label | free-agent | S | `verify.html-parse` |
| `a11y.media-captions` | `<video>` without a captions track (WCAG 1.2.2) and autoplaying media with sound | free-agent | S | `verify.html-parse` |

### Exit criteria
- [ ] Every rule has a broken fixture and a docs page that names its WCAG success criterion.
- [ ] The clean fixtures still produce no findings.


## Epic: HTML conformance without Java
<!-- seaworthy-roadmap-key: E-html -->
> **Epic** · **Phase:** Phase 1 — Verify engine and check pack v1 (2026-11-02 → 2026-11-29) · **Track:** verify

### Outcome
Catch the HTML mistakes that change how browsers and assistive technology read a page, using the parser's own error reporting plus a few targeted rules, with no Java dependency.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `html.parse-errors` | Report the HTML parser's own errors (stray end tags, bad nesting, duplicate attributes) as findings with exact positions | strong-agent | M | `spike.html-conformance` |
| `html.doctype` | Missing or non-standard doctype (quirks mode changes layout) | free-agent | XS | `verify.html-parse` |
| `html.charset` | Missing character encoding, or declared after the first 1,024 bytes | free-agent | XS | `verify.html-parse` |
| `html.nesting` | Content models the parser accepts but browsers mishandle: interactive inside interactive, block inside `<p>`, `<a>` inside `<a>` | free-agent | M | `verify.html-parse` |
| `html.obsolete` | Obsolete elements and attributes (`<center>`, `<font>`, `<marquee>`, `align`, `bgcolor`) | free-agent | S | `verify.html-parse` |
| `html.meta-refresh` | `<meta http-equiv="refresh">` with a delay, which moves people before they can read (WCAG 2.2.1) | free-agent | XS | `verify.html-parse` |
| `html.inline-handlers` | Inline event handlers and `javascript:` URLs that block a strict Content Security Policy | free-agent | S | `verify.html-parse` |
| `html.docs` | Docs page comparing Seaworthy's HTML checks with the Nu Html Checker: what each covers | free-agent | S | `html.parse-errors` |

### Exit criteria
- [ ] Parse errors carry exact line and column.
- [ ] A docs page says honestly what the Nu Html Checker covers that Seaworthy does not.


# Phase 2 — Agent interface: MCP, Skills, Action (2026-11-30 → 2026-12-20)

## Epic: MCP server
<!-- seaworthy-roadmap-key: E-mcp -->
> **Epic** · **Phase:** Phase 2 — Agent interface (2026-11-30 → 2026-12-20) · **Track:** verify

### Outcome
Any MCP-capable agent can verify a site, understand each finding, and confirm its fix, all through tools that return structured results.

### Scope
- Tools: `verify_site`, `verify_changed`, `explain_finding`, `list_checks`, `get_config_schema`, `create_baseline`
- Resources: check catalog, spec documents
- stdio transport; `server.json` for the MCP Registry

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `mcp.server` | MCP server skeleton, stdio transport | strong-agent | S | `verify.cli` |
| `mcp.verify` | `verify_site` and `verify_changed` tools returning report JSON | strong-agent | S | `mcp.server` |
| `mcp.explain` | `explain_finding`: fix hint, docs link, before/after example | free-agent | S | `mcp.verify` |
| `mcp.catalog` | `list_checks` and check catalog resource | free-agent | S | `mcp.server` |
| `mcp.config` | `get_config_schema` and `create_baseline` | free-agent | S | `verify.baseline` |
| `mcp.server-json` | `server.json` metadata for the MCP Registry | free-agent | XS | `mcp.server` |
| `mcp.tests` | End-to-end tests: break a fixture, verify, fix, verify clean | strong-agent | M | `mcp.verify` |
| `mcp.fix-preview` | `fix_preview` tool: the unified diff of every edit, without writing files | strong-agent | S | `mcp.verify` |
| `mcp.diff-reports` | `diff_reports` tool: what is new and what was fixed between two runs | free-agent | S | `mcp.verify` |
| `mcp.prompts` | MCP prompts for the common workflows: fix everything, adopt on an existing site, make a site agent-ready | free-agent | S | `mcp.server` |
| `mcp.progress` | Progress notifications for long runs (large sites, rendered checks) | strong-agent | S | `mcp.verify` |
| `mcp.docs-resources` | Every check's docs page as an MCP resource | free-agent | XS | `mcp.catalog` |
| `mcp.http-transport` | Local Streamable HTTP transport in addition to stdio | strong-agent | M | `mcp.server` |

### Exit criteria
- [ ] An agent introduces a broken link, finds it with `verify_site`, fixes it, and gets a clean report, all through MCP.

## Epic: Agent Skills and instruction files
<!-- seaworthy-roadmap-key: E-skills -->
> **Epic** · **Phase:** Phase 2 — Agent interface (2026-11-30 → 2026-12-20) · **Track:** verify

### Outcome
Agents run verify before they say "done", without being told, because the instructions travel with the tool and the project.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `skills.verify-loop` | Agent Skill: the verify-and-fix loop (`skills/seaworthy-verify/SKILL.md`) | strong-agent | M | `mcp.verify` |
| `skills.adopt` | Agent Skill: adopt verify in an existing site (baseline, CI, badge) | strong-agent | S | `verify.baseline` |
| `skills.init-agents` | `seaworthy init --agents`: adds verify instructions to `AGENTS.md` / `CLAUDE.md` in any repo | strong-agent | S | `skills.verify-loop` |
| `skills.other-tools` | Equivalent rules for other agent tools (Cursor, Copilot instructions) | free-agent | S | `skills.verify-loop` |
| `skills.plugin` | Claude Code plugin bundling skills and MCP server | strong-agent | S | `skills.verify-loop` |
| `skills.evals` | Trigger and outcome evals for the Skills, run in CI (like Evergreen's skill evals) | strong-agent | M | `skills.verify-loop` |
| `skills.a11y-fix` | Agent Skill: fix accessibility findings well (real alt text, visible labels), not just silence them | strong-agent | S | `skills.verify-loop` |
| `skills.agent-ready` | Agent Skill: make a site agent-ready using the agent-readability findings | free-agent | S | `skills.verify-loop` |
| `skills.codex-plugin` | Codex plugin bundling the Skills and the MCP server | strong-agent | S | `skills.plugin` |

### Exit criteria
- [ ] A fresh agent session in a repo with `seaworthy init --agents` runs verify after editing the site, unprompted.

## Epic: GitHub Action and verified badge
<!-- seaworthy-roadmap-key: E-action -->
> **Epic** · **Phase:** Phase 2 — Agent interface (2026-11-30 → 2026-12-20) · **Track:** verify

### Outcome
One step in any workflow verifies a site on every PR. The badge is the main growth loop: every verified repo advertises Seaworthy.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `action.core` | `action.yml`: run verify, upload SARIF, fail on threshold | strong-agent | S | `verify.sarif` |
| `action.pr-comment` | PR comment with new and fixed findings | strong-agent | S | `verify.markdown` |
| `action.badge` | Badge endpoint and README snippet | strong-agent | S | `brand.badge` |
| `action.marketplace` | Publish to GitHub Marketplace | maintainer | XS | `action.core` |
| `action.annotations` | Inline annotations on pull requests for findings in tracked files | strong-agent | S | `action.core` |
| `action.job-summary` | Job summary with counts, top findings, and the badge | free-agent | S | `action.core` |
| `action.cache` | Cache `.seaworthy/` and the browser between runs | free-agent | S | `action.core` |
| `action.multi-site` | Verify several sites in one repository (monorepos) | free-agent | S | `action.core` |

### Exit criteria
- [ ] A repo adds one workflow step and gets SARIF findings, a PR comment, and a badge.

---

## Epic: Agent-friendly output
<!-- seaworthy-roadmap-key: E-agent-output -->
> **Epic** · **Phase:** Phase 2 — Agent interface: MCP, Skills, Action (2026-11-30 → 2026-12-20) · **Track:** verify

### Outcome
Output that costs an agent as few tokens as possible and tells it what to do first.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `agent.format-llm` | `--format llm`: compact output sized for an agent's context window, with the fix first | strong-agent | M | `verify.markdown` |
| `agent.fix-prompts` | A ready-to-paste prompt per finding and per report, in every output format | free-agent | S | `verify.report-schema` |
| `agent.explain-cli` | `seaworthy explain <check-id>`: the docs page in the terminal | free-agent | S | `mcp.catalog` |
| `agent.ndjson` | `--format ndjson`: one finding per line, streamed as checks finish | strong-agent | S | `verify.report-schema` |

### Exit criteria
- [ ] `--format llm` uses at least 50% fewer tokens than `--format json` on the fixtures, measured in a test.


# Phase 3 — Integrations, benchmark, docs, private beta (2026-12-21 → 2027-01-17)

## Epic: Framework and host integrations
<!-- seaworthy-roadmap-key: E-integrations -->
> **Epic** · **Phase:** Phase 3 — Integrations, benchmark, docs, private beta (2026-12-21 → 2027-01-17) · **Track:** verify

### Outcome
Verify fits into whatever stack a site already uses. Each integration is a recipe with a tested example, not a fork.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `int.jekyll` | Jekyll recipe and example | free-agent | S | `verify.cli` |
| `int.astro` | Astro integration (runs after build) and example | strong-agent | S | `verify.cli` |
| `int.docusaurus` | Docusaurus plugin and example | strong-agent | S | `verify.cli` |
| `int.vitepress` | VitePress recipe and example | free-agent | S | `verify.cli` |
| `int.hugo` | Hugo recipe and example | free-agent | S | `verify.cli` |
| `int.next-export` | Next.js static export recipe | free-agent | S | `verify.cli` |
| `int.mkdocs` | MkDocs recipe | free-agent | S | `verify.cli` |
| `int.ci-hosts` | Recipes for GitLab CI, Netlify, Vercel, Cloudflare Pages | free-agent | S | `action.core` |
| `spec.source-map` | Source-map contract: a published file that says which source file and line produced each page and section, for themes and generators to emit (`spec/source-map/v0`) | strong-agent | M | `verify.report-schema` |
| `int.source-map` | Map findings from built files back to source files, reading the source-map contract and, where it is absent, what the generator exposes (permalinks, front matter) | strong-agent | M | `spec.source-map` |
| `int.conformance` | Each example builds and verifies in CI | strong-agent | M | `int.astro` |
| `int.eleventy` | Eleventy recipe and example | free-agent | S | `verify.cli` |
| `int.gatsby` | Gatsby recipe and example | free-agent | S | `verify.cli` |
| `int.nuxt` | Nuxt static generation recipe and example | free-agent | S | `verify.cli` |
| `int.sveltekit` | SvelteKit static adapter recipe and example | free-agent | S | `verify.cli` |
| `int.zola` | Zola recipe and example | free-agent | S | `verify.cli` |
| `int.pages-workflow` | Drop-in step for the official GitHub Pages deploy workflow | free-agent | S | `action.core` |

### Exit criteria
- [ ] At least six generators and four hosts have tested recipes.

## Epic: Agent success benchmark
<!-- seaworthy-roadmap-key: E-agent-bench -->
> **Epic** · **Phase:** Phase 3 → Phase 6 (reruns every release) · **Track:** verify

### Outcome
A public, reproducible measure of how much better agents ship sites with Seaworthy. This is the proof that verify does something agents can't do alone, and it stays relevant as models improve.

### Scope
- Task suite: fix seeded bugs, add a page without breaking links, make a site agent-readable, add an RTL page, migrate a base URL
- Run several agents with and without Seaworthy tools
- Published results page

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `bench.tasks` | Define 10 tasks with machine-checkable success criteria | strong-agent | M | `verify.fixtures` |
| `bench.runner` | Runner that executes tasks and scores them | strong-agent | M | `bench.tasks` |
| `bench.baseline` | Baseline: agents without Seaworthy tools | maintainer | S | `bench.runner` |
| `bench.results` | Results page, regenerated per release | free-agent | S | `bench.baseline` |
| `bench.discovery` | Cold-prompt task: does an agent find Seaworthy from public sources alone? | strong-agent | S | `bench.runner` |
| `bench.corpus` | Pin 50 real public sites (docs, blogs, stores) as a shared corpus with hand-checked ground truth for a sample | strong-agent | M | `bench.tasks` |
| `bench.competitors` | Run squirrelscan, lychee, pa11y, and Seaworthy on the corpus; publish findings, misses, and false positives honestly | strong-agent | M | `bench.corpus`, `spike.competitors` |
| `bench.precision` | Measure precision per check on the corpus; any check below 0.95 is fixed or downgraded before launch | strong-agent | M | `bench.corpus` |
| `bench.agents-matrix` | Run the agent tasks with Claude Code, Codex, and Cursor | maintainer | M | `bench.runner` |
| `bench.tokens` | Measure tokens per fix loop for json, markdown, and llm output | free-agent | S | `agent.format-llm`, `bench.runner` |

### Exit criteria
- [ ] Results published and reproducible with one command.

## Epic: Docs site and playbooks
<!-- seaworthy-roadmap-key: E-docs -->
> **Epic** · **Phase:** Phase 3 — Integrations, benchmark, docs, private beta (2026-12-21 → 2027-01-17)

### Outcome
Docs that an agent or a person can act on in under two minutes. The docs site passes its own verify.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `docs.site` | Docs site, built with any generator (the theme project's, once it is ready) | strong-agent | M | none |
| `docs.quickstart` | Quickstart: one command, first report, first fix | free-agent | S | `docs.site` |
| `docs.checks` | Generated reference page per check from the check catalog | strong-agent | S | `mcp.catalog` |
| `docs.agent-playbook` | Playbook: verify from an agent (MCP, Skill, CLI) | free-agent | S | `skills.verify-loop` |
| `docs.adopt` | Playbook: adopt verify in a large existing site | free-agent | S | `verify.baseline` |
| `docs.llms` | `llms.txt` and Markdown alternates for the docs site (dogfood) | free-agent | XS | `check.llms-txt` |
| `docs.rules-catalog` | Generated, searchable catalog of every check with severity, standard, and examples | strong-agent | M | `docs.checks` |
| `docs.tutorial` | Tutorial: an agent builds a site, verifies it, and fixes it, start to finish | free-agent | S | `docs.agent-playbook` |
| `docs.compare` | Comparison page against squirrelscan, Cloudflare Agent Readiness, lychee, and pa11y, linking the benchmark | strong-agent | S | `bench.competitors` |
| `docs.faq` | FAQ: built output vs source, false positives, privacy, offline use | free-agent | S | `docs.site` |
| `docs.persian` | Persian docs landing page and quickstart | free-agent | S | `docs.quickstart` |
| `docs.accessibility-law` | Guide: what automated checks can and cannot prove for WCAG 2.2 and the European Accessibility Act | strong-agent | S | `docs.site` |

### Exit criteria
- [ ] Docs site has a clean verify report and an agent-readability score of 100.

## Epic: Auto-discoverability for agents and humans
<!-- seaworthy-roadmap-key: E-discovery -->
> **Epic** · **Phase:** Phase 3 → Phase 4 · **Track:** verify

### Outcome
Seaworthy is findable wherever agents and developers look, without anyone knowing its name first.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `discovery.mcp-registry` | Publish to the MCP Registry | maintainer | S | `mcp.server-json` |
| `discovery.marketplaces` | Submit the plugin to agent marketplaces | maintainer | S | `skills.plugin` |
| `discovery.npm-meta` | npm keywords, README sections, and description tuned for search | free-agent | XS | none |
| `discovery.awesome` | Submit to awesome lists (static sites, a11y, MCP, agents) | free-agent | S | `release.publish` |
| `discovery.integrations-listing` | List in framework integration directories (Astro, Docusaurus) | maintainer | S | `int.astro` |
| `discovery.skills-directories` | List the Skills in public skills directories | maintainer | S | `skills.plugin` |
| `discovery.mcp-directories` | List the MCP server in public MCP directories | maintainer | S | `mcp.server-json` |
| `discovery.own-well-known` | Seaworthy's own site publishes an Agent Skills index and MCP card, and passes its own agent checks | free-agent | S | `readability.agent-skills-index` |

### Exit criteria
- [ ] Listed in the MCP Registry, two agent marketplaces, and GitHub Marketplace.
- [ ] The cold-prompt benchmark task finds Seaworthy.

## Epic: Private beta
<!-- seaworthy-roadmap-key: E-beta -->
> **Epic** · **Phase:** Phase 3 — Integrations, benchmark, docs, private beta (2026-12-21 → 2027-01-17)

### Outcome
Real users on real sites find the false positives and rough edges before launch, so launch day shows a tool that is right.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `beta.recruit` | Recruit 15 beta users across Jekyll, Astro, Docusaurus, Hugo, and agent-first users | maintainer | S | `docs.quickstart` |
| `beta.feedback` | Feedback form and triage board | free-agent | XS | none |
| `beta.false-positives` | Track false positives per check; fix each as its own task | strong-agent | M | `beta.feedback` |
| `beta.case-studies` | Three written case studies from beta users, with before and after numbers | maintainer | M | `beta.recruit` |
| `beta.issue-forms` | Issue forms for false positives and missing checks that capture a minimal reproduction | free-agent | XS | `beta.feedback` |

### Exit criteria
- [ ] 15 beta repos running the Action; no check with a known false positive at launch.

---

## Epic: Developer experience
<!-- seaworthy-roadmap-key: E-dx -->
> **Epic** · **Phase:** Phase 3 — Integrations, benchmark, docs, private beta (2026-12-21 → 2027-01-17) · **Track:** verify

### Outcome
Getting started takes one command, errors explain themselves, and the tool behaves on every OS.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `dx.init` | `seaworthy init`: create a config, a CI workflow, and a baseline in one step, for people and agents | strong-agent | M | `verify.config`, `action.core` |
| `dx.base-path-detect` | Detect `basePath` from Jekyll, Astro, Docusaurus, Hugo, and VitePress configs | strong-agent | S | `check.base-url` |
| `dx.color` | Colored terminal output when attached to a TTY; `NO_COLOR` respected | free-agent | XS | `verify.pretty` |
| `dx.errors-audit` | Audit every error message: says what happened and what to do next | free-agent | S | `verify.cli` |
| `dx.config-validate` | `seaworthy config check`: validate a config without running checks | free-agent | XS | `verify.config` |
| `dx.windows` | Windows paths, line endings, and long paths covered by tests | free-agent | S | `verify.cli` |
| `dx.offline` | Prove the default run makes no network requests (test fails on any socket) | strong-agent | S | `verify.cli` |

### Exit criteria
- [ ] A new user goes from zero to a passing CI run with `seaworthy init` and one commit.


# Phase 4 — Launch wave 1: verify (2027-01-18 → 2027-02-07)

## Epic: Verify v0.1 release readiness
<!-- seaworthy-roadmap-key: E-release -->
> **Epic** · **Phase:** Phase 4 — Launch wave 1 (2027-01-18 → 2027-02-07) · **Track:** verify

### Outcome
Verify 0.1 is published on every channel, with frozen contracts, a README that convinces in ten seconds, and performance that holds on large sites.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `release.contract-freeze` | Freeze report schema v1 and check IDs | maintainer | S | `verify.report-schema` |
| `release.changelog` | `CHANGELOG.md` and release notes | free-agent | S | none |
| `release.publish` | Publish npm packages, MCP server, Action | maintainer | S | `release.changelog` |
| `release.smoke` | Smoke-test published packages after every release | free-agent | S | `release.publish` |
| `release.readme` | README: 30-second GIF, one-line install, badge, benchmark numbers | strong-agent | S | `bench.results` |
| `release.perf` | Performance: verify a 1,000-page site in under 30 s (static checks) | strong-agent | M | `verify.html-parse` |
| `release.notice` | `NOTICE` file listing third-party licenses (axe-core is MPL-2.0) | free-agent | XS | `release.changelog` |
| `release.sbom` | Publish an SBOM with every release | free-agent | S | `release.publish` |
| `release.install-budget` | CI fails when a cold `npx` install exceeds the ADR 0004 budget | strong-agent | S | `release.publish` |
| `release.startup-budget` | CI fails when `seaworthy --version` startup exceeds 150 ms | free-agent | S | `verify.cli` |

### Exit criteria
- [ ] `verify 0.1.0` published on npm, MCP Registry, and GitHub Marketplace, and smoke-tested.

## Epic: Launch wave 1
<!-- seaworthy-roadmap-key: E-launch-1 -->
> **Epic** · **Phase:** Phase 4 — Launch wave 1 (2027-01-18 → 2027-02-07)

### Outcome
Developers and agent users see verify catch real bugs on real sites.

### Scope
- 60-second demo video: an agent breaks a site, verify catches it, the agent fixes it
- "We verified the top 100 docs sites" post with aggregate, anonymized results
- Show HN, Reddit (r/webdev, r/javascript, r/ClaudeAI, r/LocalLLaMA), X, dev.to, Persian developer communities

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `launch1.video` | Record the agent demo video | maintainer | M | `mcp.tests` |
| `launch1.top100` | Run verify on 100 public docs sites; write up aggregate findings | strong-agent | M | `release.perf` |
| `launch1.kit` | Launch kit in `brand/launch-1/` | strong-agent | S | `brand.kit` |
| `launch1.posts` | Draft posts per channel | strong-agent | S | `launch1.kit` |
| `launch1.day` | Launch day: post and respond | maintainer | M | `launch1.posts` |
| `launch1.response-week` | One week of fast issue response | maintainer | M | `launch1.day` |
| `launch1.state-report` | "State of agent-built sites": what the corpus shows, with methods and limits | strong-agent | M | `bench.corpus` |
| `launch1.compare-post` | Post: how Seaworthy differs, linking the benchmark | strong-agent | S | `docs.compare` |
| `launch1.accessibility-post` | Post: checking agent-built sites against WCAG 2.2, honest about automated limits | strong-agent | S | `docs.accessibility-law` |
| `launch1.product-hunt` | Product Hunt launch | maintainer | S | `launch1.kit` |
| `launch1.newsletters` | Pitch to accessibility, frontend, and AI tooling newsletters | maintainer | S | `launch1.kit` |
| `launch1.talks` | Submit talk proposals to two conferences | maintainer | S | `launch1.kit` |
| `launch1.demo-repo` | Public demo repository: a broken site and the agent's fix pull requests | strong-agent | S | `mcp.tests` |

### Exit criteria
- [ ] Launched on at least four channels; every launch-week issue answered within 24 hours.

---

# Phase 5 — Launch wave 2: live sites and the agent loop (2027-02-08 → 2027-03-07)

Wave 2 extends Seaworthy past the deploy: the same checks, plus hosting checks, on the live site; site-level quality; rendered layout checks; and a faster loop for agents. The reference theme is now its own project ([ADR 0009](docs/adr/0009-theme-split-and-position.md)).

## Epic: Live-site verification
<!-- seaworthy-roadmap-key: E-live -->
> **Epic** · **Phase:** Phase 5 — Launch wave 2: live sites and the agent loop (2027-02-08 → 2027-03-07) · **Track:** verify

### Outcome
`seaworthy verify https://example.com` checks the deployed site with the same checks and report, and compares it with the build folder to catch what broke in deployment.

### Scope
- Same origin only
- Opt-in network, like `links.external`

### Non-goals
- Logging in to sites, or filling forms.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `live.fetch` | Fetch pages over HTTP into the same site graph the static checks use | strong-agent | M | `spike.crawler` |
| `live.crawl` | Crawl from a start URL through links and sitemaps: same origin, depth and page caps | strong-agent | M | `live.fetch` |
| `live.robots` | Respect robots.txt and crawl-delay; identify as Seaworthy | free-agent | S | `live.crawl` |
| `live.rate-limits` | Per-host concurrency, retries with backoff, and a total time budget | strong-agent | S | `live.crawl` |
| `live.cli` | `seaworthy verify https://example.com` | strong-agent | S | `live.crawl` |
| `live.report` | Reports for live runs: URL root, URL locations, schema and SARIF updated | strong-agent | S | `live.cli` |
| `live.deploy-diff` | Compare a build folder with the deployed site: files never deployed, stale pages, base-path breaks | strong-agent | M | `live.cli` |
| `live.headers-option` | Extra request headers for preview deployments behind protection | free-agent | S | `live.cli` |
| `live.preview-urls` | Action input to verify Netlify, Vercel, and Cloudflare Pages preview URLs | strong-agent | S | `live.cli`, `action.core` |
| `live.fixtures` | Live fixtures served from a local HTTP server in tests | free-agent | S | `live.fetch` |

### Exit criteria
- [ ] A live run of the docs site matches the build-folder run except for findings that only exist after deploy.
- [ ] Crawling respects robots.txt and the rate limits by default.


## Epic: Hosting checks
<!-- seaworthy-roadmap-key: E-hosting -->
> **Epic** · **Phase:** Phase 5 — Launch wave 2: live sites and the agent loop (2027-02-08 → 2027-03-07) · **Track:** verify

### Outcome
Problems that exist only on a server: status codes, redirects, security headers, compression, caching, and content types.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `hosting.soft-404` | Missing pages must answer 404, not 200 with an error page | free-agent | S | `live.cli` |
| `hosting.https-redirect` | HTTP redirects to HTTPS | free-agent | XS | `live.cli` |
| `hosting.redirect-chains` | Redirect chains longer than one hop, and redirect loops | free-agent | S | `live.cli` |
| `hosting.hsts` | HSTS present with a sensible max-age | free-agent | XS | `live.cli` |
| `hosting.csp` | Content Security Policy present and not trivially bypassed (`unsafe-inline` scripts, `*`) | strong-agent | S | `live.cli` |
| `hosting.compression` | Text responses are compressed (gzip or brotli) | free-agent | XS | `live.cli` |
| `hosting.cache` | Hashed assets are cacheable for a long time; HTML is not cached forever | free-agent | S | `live.cli` |
| `hosting.content-type` | Responses have the right MIME type (JavaScript served as text/plain breaks pages) | free-agent | S | `live.cli` |
| `hosting.headers-files` | Validate `_headers` and `_redirects` files in the build (Netlify, Cloudflare Pages) | free-agent | S | `verify.html-parse` |

### Exit criteria
- [ ] Every hosting check has a live fixture.


## Epic: Site-level quality
<!-- seaworthy-roadmap-key: E-site-quality -->
> **Epic** · **Phase:** Phase 5 — Launch wave 2: live sites and the agent loop (2027-02-08 → 2027-03-07) · **Track:** verify

### Outcome
Problems no single page shows: orphans, duplicates, empty pages, and weight budgets.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `quality.orphans` | Pages no other page links to | free-agent | S | `verify.html-parse` |
| `quality.duplicate-titles` | The same title on several pages | free-agent | XS | `check.meta` |
| `quality.duplicate-descriptions` | The same meta description on several pages | free-agent | XS | `check.meta` |
| `quality.empty-pages` | Pages with no main text | free-agent | S | `verify.html-parse` |
| `quality.not-found-page` | The build has a 404 page and it is a real page | free-agent | XS | `verify.html-parse` |
| `quality.page-weight` | Per-page weight budget for HTML, CSS, JavaScript, images, and fonts, with no browser | strong-agent | M | `verify.html-parse` |
| `quality.font-count` | Too many font files on one page | free-agent | XS | `quality.page-weight` |
| `quality.redirect-stubs` | Chains and loops of meta-refresh redirect pages | free-agent | S | `html.meta-refresh` |
| `quality.canonical-consistency` | Canonical URLs point at pages that exist and do not point at each other in circles | free-agent | S | `check.meta` |

### Exit criteria
- [ ] Every check has a broken fixture and a docs page.


## Epic: The agent loop
<!-- seaworthy-roadmap-key: E-agent-loop -->
> **Epic** · **Phase:** Phase 5 — Launch wave 2: live sites and the agent loop (2027-02-08 → 2027-03-07) · **Track:** verify

### Outcome
Verify, fix, verify again, as fast and cheaply as possible, for agents and for people reviewing their work.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `loop.diff` | `seaworthy diff before.json after.json`: new, fixed, and unchanged findings | strong-agent | S | `verify.report-schema` |
| `loop.fix-dry-run` | `seaworthy fix --dry-run`: every edit as one unified diff; Seaworthy still writes no files | strong-agent | M | `verify.report-schema` |
| `loop.watch` | `--watch`: verify again whenever the build folder changes, reporting only what changed | strong-agent | M | `verify.changed` |
| `loop.html-report` | `--format html`: one self-contained page for people, with filters | strong-agent | M | `verify.report-schema` |
| `loop.history` | Keep recent runs in `.seaworthy/history` for diffs and trends | free-agent | S | `loop.diff` |
| `loop.new-only` | `--new-only`: report only findings that were not there in the last run | free-agent | S | `loop.history` |
| `loop.prompt-export` | Export all findings as one prompt an agent can work through in order | free-agent | S | `agent.fix-prompts` |
| `loop.mcp-watch` | MCP tool that waits for the next build and returns its report | strong-agent | S | `loop.watch`, `mcp.verify` |
| `loop.docs` | Docs: the fastest verify-and-fix loop for agents, with measured timings | free-agent | S | `loop.watch` |

### Exit criteria
- [ ] On the fixtures, `--watch` reports a fix within 2 seconds of the rebuild.


## Epic: Rendered layout checks
<!-- seaworthy-roadmap-key: E-rendered-layout -->
> **Epic** · **Phase:** Phase 5 — Launch wave 2: live sites and the agent loop (2027-02-08 → 2027-03-07) · **Track:** verify

### Outcome
Checks that need a real browser at real screen sizes: the page that breaks on a phone, the button too small to tap, the focus nobody can see.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `layout.viewports` | Run rendered checks at phone, tablet, and desktop widths | strong-agent | M | `check.a11y` |
| `layout.horizontal-overflow` | Pages that scroll sideways on a phone | strong-agent | S | `layout.viewports` |
| `layout.target-size` | Touch targets smaller than 24×24 px (WCAG 2.5.8) | strong-agent | S | `layout.viewports` |
| `layout.focus-visible` | Focusable elements with no visible focus indicator (WCAG 2.4.7) | strong-agent | M | `layout.viewports` |
| `layout.text-clipping` | Text cut off by its container | strong-agent | M | `layout.viewports` |
| `layout.reflow` | Content that does not reflow at 320 CSS px (WCAG 1.4.10) | strong-agent | S | `layout.viewports` |
| `layout.screenshots` | Save a screenshot crop for each rendered finding, referenced from the report | strong-agent | S | `layout.viewports` |
| `layout.fixtures` | Rendered fixtures with known layout problems, run in CI with a preinstalled browser | free-agent | S | `layout.viewports` |
| `readability.webmcp` | Experimental: tools a page registers through WebMCP are well-formed and their handlers respond, in a real browser (draft standard: note at most) | strong-agent | M | `layout.viewports` |

### Exit criteria
- [ ] Rendered fixtures run in CI.
- [ ] Each rendered finding carries a selector and, optionally, a screenshot.


## Epic: Launch wave 2
<!-- seaworthy-roadmap-key: E-launch-2 -->
> **Epic** · **Phase:** Phase 5 — Launch wave 2: live sites and the agent loop (2027-02-08 → 2027-03-07)

### Outcome
A second launch: "Seaworthy now verifies the live site too", with a report on deployed sites and a demo of the faster agent loop.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `launch2.readme-fa` | Persian README and docs landing page | free-agent | S | `release.readme` |
| `launch2.posts` | Launch posts: live-site verification and the agent loop, with before and after examples | strong-agent | S | `brand.kit` |
| `launch2.day` | Launch day | maintainer | M | `launch2.posts` |
| `launch2.live-report` | Verify 100 deployed docs sites live; publish aggregate, anonymized findings | strong-agent | M | `live.cli` |
| `launch2.video` | Demo video: an agent deploys, Seaworthy catches a deploy-only break, the agent fixes it | maintainer | M | `live.deploy-diff` |
| `launch2.theme-consumer` | The theme project verifies every pull request with the Seaworthy Action and shows the badge | maintainer | S | `action.core` |
| `int.theme-fixture` | The theme's starter sites run as clean fixtures in Seaworthy's CI, so both projects catch regressions in each other | free-agent | S | `verify.fixtures` |

### Exit criteria
- [ ] `verify 0.2.0` published with live-site verification.
- [ ] Launched on at least four channels.

---

# Phase 6 — Extensions, spec 0.9, community (2027-03-08 → 2027-04-18)

## Epic: Extension API v1
<!-- seaworthy-roadmap-key: E-extensions -->
> **Epic** · **Phase:** Phase 6 — Extensions, spec 0.9, community (2027-03-08 → 2027-04-18) · **Track:** verify

### Outcome
Anyone can publish a check pack without forking Seaworthy. This is what lets the project grow for years while the core stays small.

### Scope
- External checks through the same check API built-in checks use
- Check packs as npm packages with a manifest and `spec:` compatibility range
- Graceful degradation: an incompatible pack warns and is skipped
- Rule presets (`extends`) as a second extension point

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `ext.spec` | `spec/extensions/v1.md` and manifest schema | strong-agent | M | `release.contract-freeze` |
| `ext.loader` | Load check packs from config | strong-agent | M | `ext.spec` |
| `ext.template` | Check pack starter repo with fixtures and tests | free-agent | S | `ext.loader` |
| `ext.add` | `seaworthy add <pack>` | strong-agent | S | `ext.loader` |
| `ext.first-packs` | First official packs: i18n/hreflang, docs-quality, performance budgets (one task each) | free-agent | S | `ext.loader` |
| `ext.mcp` | `list_packs` and `add_pack` MCP tools | free-agent | S | `ext.add` |
| `ext.rule-presets` | `"extends": "seaworthy:recommended"`, `strict`, and `a11y` presets | strong-agent | M | `ext.spec` |
| `ext.sdk-docs` | Guide: write, test, and publish a check pack | free-agent | S | `ext.template` |
| `ext.registry` | Public list of community check packs, submitted by pull request | free-agent | S | `ext.loader` |
| `ext.types` | Published TypeScript types for the check API | free-agent | S | `ext.spec` |

### Exit criteria
- [ ] An external repo publishes a check pack that works with one command.

## Epic: Open spec 0.9 and conformance
<!-- seaworthy-roadmap-key: E-spec -->
> **Epic** · **Phase:** Phase 6 — Extensions, spec 0.9, community (2027-03-08 → 2027-04-18) · **Track:** verify

### Outcome
A public draft spec that other tools and themes implement and test against. This is the path to "ecosystem standard" in months 7 to 12.

### Scope
- One spec site: report format, check ID registry, agent-readability rules, extension API
- Conformance levels: **Readable** (agent-readability), **Verified** (no errors), **Hardened** (budgets and a11y AA)
- Report format usable by other tools: they can emit Seaworthy reports and get the badge, PR comments, and MCP for free

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `spec.site` | Spec site with versioned sections | strong-agent | M | `ext.spec` |
| `spec.check-registry` | Public check ID registry with stable IDs and namespaces | strong-agent | S | `spec.site` |
| `spec.levels` | Conformance levels and their tests | strong-agent | M | `spec.site` |
| `spec.badges` | Conformance-level badges | free-agent | S | `spec.levels` |
| `spec.outreach` | Invite three tool or theme maintainers to review and implement | maintainer | S | `spec.site` |

### Exit criteria
- [ ] Spec 0.9 published; at least one tool or theme outside this repo emits or passes it.

## Epic: Growth loops and showcase
<!-- seaworthy-roadmap-key: E-growth -->
> **Epic** · **Phase:** Phase 5 → Phase 6

### Outcome
Every verified site makes the next user more likely: public usage counts, a showcase, and a monthly report that gives people a reason to share.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `growth.usage-count` | Public count of repos using the Action and the badge | strong-agent | S | `action.badge` |
| `growth.showcase` | Showcase of verified sites, submissions by PR | free-agent | S | `docs.site` |
| `growth.leaderboard` | Monthly "agent-readability of top docs sites" report | strong-agent | M | `launch1.top100` |
| `growth.newsletter` | Release notes digest | maintainer | XS | none |
| `growth.badge-wall` | Wall of repositories showing the badge, refreshed weekly | free-agent | S | `growth.usage-count` |
| `growth.integrations-gallery` | Gallery of verified example sites per framework | free-agent | S | `int.conformance` |

### Exit criteria
- [ ] Monthly report published twice; showcase has 50 sites.

## Epic: Governance and community
<!-- seaworthy-roadmap-key: E-governance -->
> **Epic** · **Phase:** Phase 5 → Phase 6

### Outcome
A process that lets the community change contracts safely and lets contributors become owners, which a standard needs.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `gov.rfc` | RFC process for contract changes (`rfcs/`) | maintainer | S | none |
| `gov.maintainers` | Maintainer and area-owner model in `GOVERNANCE.md` | maintainer | S | none |
| `gov.discussions` | GitHub Discussions categories and templates | free-agent | XS | none |
| `gov.recognition` | Contributor recognition | free-agent | XS | none |

### Exit criteria
- [ ] At least one contract change goes through the RFC process.

## Epic: Security, performance, and reliability hardening
<!-- seaworthy-roadmap-key: E-hardening -->
> **Epic** · **Phase:** Phase 4 → Phase 6

### Outcome
Seaworthy is safe to run on untrusted sites, fast on large ones, correct on every OS, and its releases can be verified.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `harden.supply-chain` | Signed releases, npm provenance, pinned Actions | maintainer | S | `release.publish` |
| `harden.sandbox` | Check packs run without file-write or network access unless declared | strong-agent | M | `ext.loader` |
| `harden.large-sites` | 10,000-page fixture; memory and time budgets in CI | strong-agent | M | `release.perf` |
| `harden.windows` | Windows path and line-ending correctness | free-agent | S | `foundation.ci` |

### Exit criteria
- [ ] Provenance on every release; large-site budgets enforced in CI.

---

## Epic: Markdown sources
<!-- seaworthy-roadmap-key: E-markdown-sources -->
> **Epic** · **Phase:** Phase 6 — Extensions, spec 0.9, community (2027-03-08 → 2027-04-18) · **Track:** verify

### Outcome
Many repositories have no built site but do have a README and docs in Markdown. Checking their links and anchors brings Seaworthy to every repository.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `md.graph` | Read Markdown files into a graph of headings and links (GitHub-flavored) | strong-agent | M | `spike.markdown-sources` |
| `md.links` | Relative links between Markdown files that point at missing files | free-agent | S | `md.graph` |
| `md.anchors` | Heading anchors that do not exist, using GitHub's slug rules | free-agent | S | `md.graph` |
| `md.images` | Images in Markdown that point at missing files, and images with no alt text | free-agent | S | `md.graph` |
| `md.external` | Opt-in external link checking for Markdown, sharing `links.external` | free-agent | S | `md.graph`, `check.links-external` |
| `md.cli` | `seaworthy verify --markdown README.md docs/` | strong-agent | S | `md.graph` |
| `md.action` | Action input for Markdown sources | free-agent | XS | `md.cli`, `action.core` |

### Exit criteria
- [ ] `seaworthy verify --markdown` passes on this repository's own docs.


## Epic: International sites
<!-- seaworthy-roadmap-key: E-i18n-pack -->
> **Epic** · **Phase:** Phase 6 — Extensions, spec 0.9, community (2027-03-08 → 2027-04-18) · **Track:** verify

### Outcome
Multilingual and right-to-left sites: language alternates, direction, and translation coverage.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `i18n.hreflang` | `hreflang` links are reciprocal and point at pages that exist | free-agent | S | `verify.html-parse` |
| `i18n.x-default` | Multilingual sites declare an `x-default` | free-agent | XS | `i18n.hreflang` |
| `i18n.dir` | Right-to-left languages declare `dir="rtl"` | free-agent | XS | `check.rtl` |
| `i18n.parity` | Every page exists in every language the site declares, or is listed as untranslated | strong-agent | S | `i18n.hreflang` |
| `i18n.switcher` | Language switcher links point at the same page in the other language | free-agent | S | `i18n.hreflang` |

### Exit criteria
- [ ] Every check has a broken fixture, including a Persian one.


## Epic: Trends
<!-- seaworthy-roadmap-key: E-trends -->
> **Epic** · **Phase:** Phase 6 — Extensions, spec 0.9, community (2027-03-08 → 2027-04-18) · **Track:** verify

### Outcome
Show whether a site is getting better or worse over time, without a hosted service.

### Tasks
| Key | Task | Lane | Size | Depends |
|---|---|---|---|---|
| `trends.store` | Keep summary numbers per run for trends | free-agent | S | `loop.history` |
| `trends.chart` | Trend chart in the HTML report | free-agent | S | `trends.store`, `loop.html-report` |
| `trends.pr-comment` | PR comment shows the trend over the last runs | free-agent | S | `trends.store`, `action.pr-comment` |
| `trends.export` | Export history as CSV and JSON | free-agent | XS | `trends.store` |

### Exit criteria
- [ ] The HTML report shows the last ten runs.


# Metrics

Stars are an outcome we cannot schedule. These are the leading indicators we track every phase.

| Metric | End of Phase 4 (wave 1) | End of Phase 6 (month 6) | Month 12 target |
|---|---|---|---|
| Weekly npm downloads (verify) | 200 | 2,000 | 15,000 |
| Repos running the Action or showing the badge | 30 | 300 | 3,000 |
| Generators with tested recipes | 6 | 13 | 16 |
| Built-in checks | 40 | 110 | 150 |
| External contributors | 10 | 40 | 150 |
| Community check packs | 0 | 5 | 30 |
| Agent benchmark: pass rate gain with Seaworthy | measured | +30 points | published per release |
| Tools or themes implementing the spec | 0 | 1 | 10 |

# After month 6: the path to a standard (months 7 to 12)

| Months | Focus |
|---|---|
| 7–8 | Spec 1.0 through the RFC process; more generators; community-led check packs |
| 9–10 | Optional hosted dashboard for teams (history, trends); IDE integration; more agent protocols |
| 11–12 | Spec 1.0 final; conformance program; `verify 1.0`; a third launch |

# Long-term extensibility

Built to take years of features without a rewrite:

- **New web standards and AI crawler rules** arrive as checks or check packs.
- **New frameworks and hosts** arrive as recipes tested in CI.
- **New agent protocols** arrive as thin wrappers over the same CLI and report contract the MCP server uses.
- **New kinds of sites** (docs, stores, apps) arrive as check packs and presets, not core changes.
- **Breaking changes** are rare, versioned, decided by RFC, and shipped with a migration note.

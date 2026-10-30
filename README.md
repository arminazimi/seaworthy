<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/exports/banner-dark.png">
    <img alt="Seaworthy: verified before it sails." src="brand/exports/banner-light.png" width="100%">
  </picture>
</p>

# Seaworthy

**Ship sites agents can trust.**

Seaworthy verifies websites for agents. One command checks any built static site, from any framework and on any host, and returns a versioned report that a coding agent can act on: every finding has a stable ID, an exact location, and a fix hint.

```bash
npx seaworthy verify ./dist
```

> **Status: pre-alpha.** Nothing is published yet: `@seaworthy/verify` has no npm release, and an
> unrelated project holds the `seaworthy` name on npm today, so the `npx` line above is what a
> released Seaworthy will look like — running it does not run this tool. The verify engine and the CLI
> do run from a built clone of this repository: see [Run it today](#run-it-today). This repository is
> being built in public, task by task. See the [roadmap](ROADMAP.md).

## What it verifies today

The built-in checks live in `packages/verify/src/checks/`. Every check has a stable ID, a severity,
and a page in [`docs/checks/`](docs/checks/); every finding carries a location — the file, with the
line and column where the check can pin one — and a fix hint. A run reads the built output only: no
browser and no network unless the run opts in. A check that needs a number only the site knows, such
as the page-weight budget, stays silent until that option is set.

| Checks | What they report |
|---|---|
| `a11y.*`, `names.*`, `headings.*`, `images.alt`, `rtl.bidi` | Accessibility against named WCAG success criteria: ARIA attributes, roles and references, accessible names for links, buttons, form fields, iframes, and tables, focus order and hidden focusables, landmarks, skip links, media captions, heading order and levels, alt text, mirrored right-to-left pages |
| `links.*`, `assets.missing`, `md.links` | Internal links to a page or anchor the build does not contain, a base path that does not match where the site is deployed, broken external links, a page loading a file that is not there, dead links inside Markdown |
| `html.*` | What the parser and the HTML Standard reject or browsers mishandle: parse errors, bad nesting, obsolete elements and attributes, a missing doctype, a late character encoding declaration, meta-refresh moves and redirect chains, inline handlers a strict Content Security Policy blocks |
| `meta.*`, `social.*` | Titles and descriptions (missing or duplicated), canonical URLs and their cycles and dead targets, declared language, viewport and zoom, Open Graph and Twitter cards, preview image URLs and sizes |
| `sitemap.entries`, `robots.*` | A sitemap that lists pages the build does not contain, a `Sitemap:` line that points at a missing sitemap, rules that block every crawler from the whole site |
| `readability.*` | Whether agents and AI search can read the site: `llms.txt`, a Markdown alternate per page, Markdown content negotiation, JSON-LD with the fields schema.org consumers need, content that only exists after JavaScript runs, robots rules and content signals for AI crawlers, the Agent Skills index, MCP and A2A server cards, an API catalog |
| `i18n.*` | `hreflang` alternate sets that are not reciprocal or point at pages the build does not serve, and a page that declares no `x-default` or more than one |
| `quality.*`, `images.dimensions`, `images.size` | Pages with no main text, pages no other page links to, a missing or unusable 404 page, pages over their per-asset weight budget, pages pulling in too many font files, images with no declared size or over the image budget |
| `hosting.*`, `security.*` | Malformed `_headers` and `_redirects` for Netlify and Cloudflare Pages and rules naming paths the build does not serve, resources loaded over plain HTTP, `target="_blank"` without `rel="noopener"` |

## Run it today

The packages are not on npm yet, so run the CLI from a clone of this repository:

```bash
git clone https://github.com/arminazimi/seaworthy.git
cd seaworthy
npm ci && npm run build
node packages/verify/dist/src/cli.js verify path/to/your/build-folder
```

Add `--format json` (or `markdown`, `sarif`, `llm`, `prompt`, `html`, `ndjson`) for machine-readable
output, `--out <file>` to write the report to a file, and `--fail-on warning` to choose the severity
that fails the run. `--help` lists every option. One report, every surface: the composite Action in
[`action.yml`](action.yml) and the MCP server in [`packages/mcp`](packages/mcp) are thin adapters over
this CLI and this API and own no checks of their own.

`seaworthy verify` exits:

| Code | Meaning |
|---|---|
| 0 | no findings at or above `--fail-on` (`error` by default) |
| 1 | findings at or above `--fail-on` |
| 2 | usage error: a bad option, a missing folder, or a config file `seaworthy config check` rejects |
| 4 | a check or the engine crashed; the report says which |
| 130 | interrupted with Ctrl-C during `verify --watch` |

A report cap (`--max-findings`) never changes the exit code: it is decided from every finding, capped
or not. Checks that need a browser (`--rendered`) or the network (`--network`) are opt-in and say so.

## Contracts

Everything a consumer reads is versioned under [`spec/`](spec/), so a report or a config written
against an older build still means the same thing:

| Contract | Where | Status |
|---|---|---|
| The report every output format renders | [`spec/report/v0.schema.json`](spec/report/v0.schema.json) | Draft `spec: 0`. `npm test` validates the engine's output and every fixture's expected report against it |
| `seaworthy.config.json` | [`spec/config/v0.schema.json`](spec/config/v0.schema.json) | Draft `spec: 0`. Explained in [docs/configuration.md](docs/configuration.md) |
| What a site publishes to be readable by agents | [`spec/agent-readability/v1.md`](spec/agent-readability/v1.md) | Draft v1 |

Check IDs are `area.rule` and stay permanent once released. Contracts change only additively; anything
else waits for an accepted RFC ([CONTRIBUTING.md](CONTRIBUTING.md)), with the reasoning in
[docs/adr/](docs/adr/). Both schemas are generated — from `spec/report/fragments/` and
`spec/config/fragments/` by `npm run schema:build` — so a new field or option is a new fragment, never
a hand edit of a shared file. Each check's rule, consequence, and fix are in its own page under
[`docs/checks/`](docs/checks/), and `npm test` fails a built-in check that has none.

## Why

Coding agents now build and edit websites all day. They say "done" when the code compiles, not when the site works. Broken links, a wrong base URL, missing alt text, a page agents can't read: these ship every day because nothing checks the built output.

Seaworthy is that check. It is built for the loop agents already run: change, verify, read the findings, fix, verify again.

## What it will do

- **Verify, don't advise.** Every check passes or fails with a location and a fix hint. No vague scores without reasons.
- **Any framework.** Seaworthy reads the built site (HTML and assets), so it works with Jekyll, Astro, Docusaurus, Hugo, VitePress, Next.js static export, MkDocs, or plain HTML.
- **Agent-native.** The same checks through a CLI, an MCP server, Agent Skills, and a GitHub Action, always with machine-readable output.
- **Agent-readable sites.** Checks that agents and AI search can read your site, built on existing standards: `llms.txt`, schema.org, Markdown alternates.
- **Adoptable today.** A baseline file lets a site with hundreds of existing issues adopt Seaworthy and fail only on new ones.
- **Extensible for years.** Check packs, presets, and integrations arrive through a versioned extension API.

Seaworthy checks the build folder before deploy, and from the second launch wave also the live site after it. An editorial, RTL-ready reference theme that passes every check is being built as a separate project.

## Roadmap

| Phase | When | What |
|---|---|---|
| 0 | Oct 2026 | Foundations and feasibility spikes |
| 1 | Nov 2026 | Verify engine and first checks |
| 2 | Dec 2026 | MCP server, Agent Skills, GitHub Action |
| 3 | Jan 2027 | Framework integrations, agent benchmark, private beta |
| 4 | Feb 2027 | **Launch: Seaworthy verify 0.1** |
| 5 | Mar 2027 | **Launch: live-site verification and the agent loop** |
| 6 | Apr 2027 | Extension API and open spec 0.9 |

Full detail, with every epic and task: [ROADMAP.md](ROADMAP.md).

## Contributing

Work is split into small issues with lanes for newcomers, experienced contributors, and coding agents. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

## License

[Apache-2.0](LICENSE)

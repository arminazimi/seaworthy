# Specifications

Versioned contracts: the report format, check IDs, agent-readability rules, config schema, and extension API. Each changes only through the RFC process once frozen.

| Spec | Status | Where |
| --- | --- | --- |
| Report | Draft (`spec: 0`), freezes as `spec: 1` at `release.contract-freeze` | [`report/v0.schema.json`](report/v0.schema.json) |
| Config | Draft (`spec: 0`) | [`config/v0.schema.json`](config/v0.schema.json) |
| Agent readability | Draft v1 | [`agent-readability/v1.md`](agent-readability/v1.md) |

The schemas are built, not hand-edited: `config/v0.schema.json` and `report/v0.schema.json` assemble from per-feature fragments under [`config/fragments/`](config/fragments/) and [`report/fragments/`](report/fragments/), so parallel PRs add a file instead of editing the same lines. Change a fragment and run `npm run schema:build`; `npm run check:schema` fails when a built schema is out of date.

The report schema is checked by `npm test`: the engine's output is validated against it, and so is every fixture's expected report. Design background: [ADR 0006](../docs/adr/0006-check-model.md).

## Additive check IDs

- `a11y.axe`: an `error`, `warning`, or `note` per axe-core violation on the rendered page, only under `--rendered`, with axe's rule ID, impact-mapped severity, and the offending element's selector and snippet. Rules the static checks already cover are disabled in axe so one page problem is one finding. See the [check contract](../docs/checks/a11y.axe.md).
- `a11y.iframe-title`: an `error` for an iframe with an absent, empty or whitespace-only `title`. See the [check contract](../docs/checks/a11y.iframe-title.md).
- `html.charset`: an `error` for a page with no character encoding declaration, or one that ends after the first 1,024 bytes. See the [check contract](../docs/checks/html.charset.md).
- `html.meta-refresh`: a `warning` for `<meta http-equiv="refresh">` with a delay greater than 0 seconds, which moves people before they can read (WCAG 2.2.1). See the [check contract](../docs/checks/html.meta-refresh.md).
- `html.redirect-chain`: a `warning` for a redirect page that lands on another redirect page (a chain), reported at the chain's start with the final destination, and an `error` for redirect pages that revisit a page along the way (a loop). See the [check contract](../docs/checks/html.redirect-chain.md).
- `meta.duplicate-description`: a `warning` that groups pages whose meta description is the same text, with one finding per duplicated description. See the [check contract](../docs/checks/meta.duplicate-description.md).
- `social.twitter-card`: a `note` for a page with no `twitter:card`, and a `warning` for an orphaned Twitter tag, an unknown card type, or a card with no image. See the [check contract](../docs/checks/social.twitter-card.md).
- `social.image-size`: a `warning` for a local social preview image below the platform minimum dimensions or over the 5 MB limit. See the [check contract](../docs/checks/social.image-size.md).
- `html.doctype`: a `warning` for a page with no doctype, or a non-standard one that puts the browser in quirks mode. See the [check contract](../docs/checks/html.doctype.md).
- `html.parse-errors`: a `warning` for errors the HTML parser itself reports, such as stray end tags, bad nesting and duplicate attributes. See the [check contract](../docs/checks/html.parse-errors.md).
- `html.inline-handlers`: a `note` for inline event handlers and `javascript:` URLs, which a strict Content Security Policy blocks. See the [check contract](../docs/checks/html.inline-handlers.md).
- `html.nesting`: a `warning` for content nested outside its parent's content model: interactive inside interactive, block inside `<p>`, `<a>` inside `<a>`. See the [check contract](../docs/checks/html.nesting.md).
- `quality.orphans`: a `warning` for a page that no other page links to. See the [check contract](../docs/checks/quality.orphans.md).
- `quality.not-found-page`: a `warning` for a missing 404 page, or one that is empty or only redirects. See the [check contract](../docs/checks/quality.not-found-page.md).
- `quality.page-weight`: a `warning` per page and asset kind (HTML, CSS, JavaScript, images, fonts) whose weight is over the budget configured in `checks."quality.page-weight".options.budgets`. No budget, no findings: the check is off until a site opts in, and buckets left unset keep documented defaults. Sizes come from the built output's file system; no browser, no network. See the [check contract](../docs/checks/quality.page-weight.md).
- `quality.font-count`: a `warning` per page that pulls in more distinct font files (`.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`) than `checks."quality.font-count".options.max` allows, default 6. Fonts are counted from the page's linked stylesheets and inline `<style>` blocks, resolved against the CSS's own path, deduplicated by site path, and only when the built site serves the file — a missing font is `assets.missing`'s finding, not this one's. No browser, no network. See the [check contract](../docs/checks/quality.font-count.md).
- `quality.empty-pages`: a `warning` for a page whose HTML has no main text outside the navigation, header and footer. See the [check contract](../docs/checks/quality.empty-pages.md).
- `meta.duplicate-titles`: a `warning` for the same `<title>` on two or more pages. See the [check contract](../docs/checks/meta.duplicate-titles.md).
- `meta.canonical-target`: a `warning` for a canonical link that points at a URL the built site does not serve. See the [check contract](../docs/checks/meta.canonical-target.md).
- `meta.canonical-cycle`: a `warning` for canonical links that point at each other in a circle. See the [check contract](../docs/checks/meta.canonical-cycle.md).
- `hosting.headers`: a `warning` for a malformed `_headers` line, or headers set on a path the built site does not serve. See the [check contract](../docs/checks/hosting.headers.md).
- `hosting.redirects`: an `error` for a malformed `_redirects` line, or a redirect to a path the built site does not serve. See the [check contract](../docs/checks/hosting.redirects.md).
- `i18n.hreflang`: a `warning` for a `rel="alternate" hreflang=...` entry that points at a page the built site does not serve, or whose target page declares no `hreflang` alternate for the declaring page's language back to it (`x-default` entries are out of scope, covered by `i18n.x-default`). See the [check contract](../docs/checks/i18n.hreflang.md).
- `i18n.parity`: a `warning` for a language that the pages of one hreflang cluster declare between them (`x-default` is not a language) but that no page of the cluster serves, listed at the first declaring page; a language declared only outside the build is never demanded offline, and an intentional gap can be listed under `checks."i18n.parity".options.untranslated`. See the [check contract](../docs/checks/i18n.parity.md).
- `i18n.x-default`: a `warning` for a page of a multilingual site (two or more declared languages) that takes part in an hreflang set and declares no `x-default` entry, or that declares more than one. See the [check contract](../docs/checks/i18n.x-default.md).
- `i18n.switcher`: a `warning` for a visible `<a>` that carries an `hreflang` attribute — the standard language-switcher markup — and lands on any page other than the one the same page declares as its `rel="alternate" hreflang=...` target for that language (another page, its own current page, outside the built site, or nowhere); `<link>` entries belong to `i18n.hreflang` and `x-default` is not a language, so neither is reported here. See the [check contract](../docs/checks/i18n.switcher.md).
- `md.links`: an `error` for a link in a Markdown file that resolves, the way GitHub resolves it, to no Markdown file in the graph built over the verified root; external, ignored, and fragment-only links are skipped. See the [check contract](../docs/checks/md.links.md).
- `md.anchors`: an `error` for a link in a Markdown file whose `#fragment` matches no heading anchor of the Markdown file it resolves to, using GitHub's slug rules compared without regard to case; a link whose target file is missing is left to `md.links`, so one dead link is one finding. See the [check contract](../docs/checks/md.anchors.md).
- `md.images`: an `error` for an image in a Markdown file that resolves to no file in the verified root, and for an image with no alt text — which in Markdown sources means an `<img>` written as raw HTML without an `alt` attribute, since `![](src)` renders `alt=""` and is deliberate decoration. External, protocol-relative, and `data:` sources skip the file rule and keep the alt rule; `role="presentation"`, `aria-hidden="true"`, `aria-label`, and `aria-labelledby` exempt an image from it, as in `images.alt`. See the [check contract](../docs/checks/md.images.md).
- `layout.text-clipped`: a `warning` per rendered box that hides its own text — `scrollWidth`/`scrollHeight` past the box's `clientWidth`/`clientHeight` with `overflow: hidden` or `clip`, and the box's text measured reaching outside it — only under `--rendered`, with the clipped element's selector, the axis, and how many CSS px are cut. `html` and `body` are never the clipped element, so a page that scrolls sideways stays `layout.horizontal-overflow`'s finding, and an ellipsis the author asked for with `text-overflow` stays a design choice. See the [check contract](../docs/checks/layout.text-clipped.md).

## Additive report fields

- `findings[n].prompt` and the report's `prompt`: optional ready-to-paste fix prompts for agents, generated by `buildReport` from each finding's data alone (check ID, location, fix hint) and identical in every output format. They appear whenever the report has findings.

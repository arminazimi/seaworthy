# Seaworthy's HTML checks and the Nu Html Checker

The [Nu Html Checker](https://validator.w3.org/nu/) (v.Nu) validates one document at a time against the HTML Standard: whether the markup conforms. Seaworthy verifies a built site: whether a person or an agent can read it, reach what it points at, and act on it. The two jobs overlap where a spec violation is also the mistake that changes what a browser builds. This page says where each tool stands, and what neither one proves.

Up front: Seaworthy is not a validator, and nothing here suggests dropping Nu. [ADR 0013](../adr/0013-html-conformance.md), which decided to build the native checks on parse5 and a small rule set, kept the Nu Html Checker optional on purpose.

## What Nu covers that Seaworthy does not

Nu is a conformance checker. Against the HTML Standard's element and attribute tables, it decides questions Seaworthy's checks deliberately leave open:

- **Element nesting and permitted content, in full.** Every element's content model: what may be its child, its descendant, its parent. Seaworthy's [`html.nesting`](html.nesting.md) carries three rules only (see below); Nu carries them all.
- **Attribute syntax and allowed values per element.** Whether an attribute name is legal on that element at all, and whether its value matches the grammar the standard gives it. Seaworthy checks only a few required or malformed values of its own.
- **Required and forbidden elements.** For example the order of a table's children, or a `<caption>` after the table body.
- **DOCTYPE and content-type problems** beyond the mode the browser ends up in.

The prototype comparison recorded in [ADR 0013](../adr/0013-html-conformance.md) states the same boundary from the other side: the native rules do not validate attribute names per element, attribute value grammars beyond the few rules built, CSS inside `style` attributes, or the order of table children, and in that comparison Nu found exactly those on documents the rules passed (an unknown attribute, invalid CSS in `style`, a `<td>` directly in `<tbody>`, a `<caption>` after the table body). Where markup is legal HTML but still hurts readers or agents, Nu stays silent and Seaworthy reports: a `<meta http-equiv="refresh">` redirect is conforming, and WCAG 2.2.1 still fails it.

## What each Seaworthy HTML-structure check proves

The `html.*` checks (`packages/verify/src/checks/html.ts`) all run offline on the built files, on the parse5 tree plus the source text. Each line says what the finding proves, and what it deliberately does not.

| Check | Default severity | What it proves | What it does not prove |
| --- | --- | --- | --- |
| [`html.doctype`](html.doctype.md) | warning | The page starts with a doctype a browser can act on — `<!doctype html>`, or its legacy-compat form — or it says which mode the browser will use instead (quirks or limited-quirks). | That the rest of the document conforms to anything. |
| [`html.charset`](html.charset.md) | error | The page declares its encoding inside the document, completely within the first 1,024 bytes (or leads with a byte order mark). | Which encoding is actually correct: Seaworthy reads built files offline, so what the server sends in a header is out of reach; the fix hint only suggests UTF-8 after confirming the file's bytes decode as UTF-8. |
| [`html.parse-errors`](html.parse-errors.md) | warning (`error` for duplicate attributes) | The HTML parser itself rejected the source: a parse5 error with its position, a stray end tag that closed nothing, or a non-void element with no end tag where one is required. | Conformance. Most violations of the element and attribute tables are not parse errors — the parser accepts them silently — so a page with no findings here is not a valid page. Nu is the tool for that question. |
| [`html.nesting`](html.nesting.md) | warning | One of three specific content-model rules held markup the parser rewrites: interactive inside interactive (`<a>`, `<button>`, `<label>`), a block element inside `<p>`, or `<a>` inside `<a>` and `<button>` inside `<button>`. These are where the document a browser builds differs from the document that was written. | Every other content-model violation. An `<li>` outside a list or a `<td>` outside a row parses cleanly and is Nu's call, not this check's. |
| [`html.obsolete`](html.obsolete.md) | note | The page uses one of the obsolete elements or presentational attributes listed in `html-data.ts` from HTML Standard §16.2, each with its CSS or markup replacement as the fix hint. | That the page is otherwise conforming — only the table's names are examined, SVG content is skipped, and notes never gate a build by default. |
| [`html.inline-handlers`](html.inline-handlers.md) | note | The markup contains an inline `on*` event handler or a `javascript:` URL in an attribute that gets followed — precisely what a strict Content Security Policy cannot allow. The finding exists because the behavior breaks the day the CSP lands, not today. | What the handler code does: Seaworthy never executes the page. And Nu reports none of this, because inline handlers are legal HTML. |
| [`html.meta-refresh`](html.meta-refresh.md) | warning | The page moves the reader away after a delay of more than zero seconds, read with the standard's refresh algorithm — a WCAG 2.2.1 problem whoever wrote it. | That the destination is wrong (`links.internal` and `links.external` cover it). An immediate (0-second) redirect is not reported here: it is not a time limit. |
| [`html.redirect-chain`](html.redirect-chain.md) | warning | A refresh page hands off to another refresh page (a chain) or bounces between pages forever (a loop), by following the redirects across the built site the way a browser would. | Anything about the pages' conformance — and this question is one no document-by-document validator can answer, because a chain exists only across files. |

## Where they agree

Stray end tags, unclosed elements, obsolete elements and attributes, duplicate ids, doctype and encoding problems: Nu reports these as spec violations, and Seaworthy reports the same markup through `html.parse-errors`, `html.obsolete`, `html.doctype`, `html.charset`, and [`a11y.duplicate-id`](a11y.duplicate-id.md) as broken behavior — the tree a browser builds and an agent reads is not the one the source says. The overlap is deliberate. The severities differ on purpose: Seaworthy sizes findings by consequence (an obsolete `<font>` is a note because browsers still render it; a duplicate attribute is an error because the second value is dead and an agent editing it changes nothing), while Nu sizes them by the spec.

## What neither tool answers

Nu validates the document it is handed. It does not know whether the page is reachable from the rest of the site, whether an internal link's target or fragment exists (`links.internal`), whether a referenced script, stylesheet, or image is in the built output (`assets.missing`), or what the page looks like after its JavaScript has run — Seaworthy answers the last one only in opt-in `--rendered` mode, where a browser renders each page and `a11y.axe` checks the result, and `readability.ssr-content` warns when content appears only after scripting. `links.external` and the `hosting.*` checks are likewise opt-in with `--network`, because they leave the machine.

And no tool on this page reads the words: `images.alt` requires the `alt` attribute, which the standard and Nu also require, but whether the alternative text is meaningful is a judgment neither makes.

## Running both in one pipeline

They are two commands on the same built folder, in the same CI job, each allowed to fail the build on its own terms. How to install Nu: the project's own README at [validator/validator](https://github.com/validator/validator) documents running the released `vnu.jar` with `java -jar vnu.jar` over files, a directory, or URLs (Java is required), shipping an npm package named `vnu-jar` that provides the jar, and offering a container image; Nu's own site hosts a web service at [validator.w3.org/nu](https://validator.w3.org/nu/). Check that README for the current way to get it rather than a version number copied from a doc page.

```sh
npm ci
npm install --no-save github:arminazimi/seaworthy#<commit>   # pre-alpha: not on npm yet; goes after npm ci, which wipes it
java -jar vnu.jar dist/                                      # conformance, document by document
npx seaworthy verify dist                                    # the built site, site by site
```

`seaworthy verify` exits 0 with no findings, 1 when a finding reaches the failing severity (`--fail-on error|warning|note|none`, default `error`), 2 on a usage error, and 4 when a check or the engine crashed. So the obsolete-markup notes and the parse-error warnings from the table above report themselves without blocking the job by default, while Nu's verdict on the same pages is yours to wire in as strict as you want.

## What is planned

[ADR 0013](../adr/0013-html-conformance.md) decision 4 sketches an optional extension that runs the Nu Html Checker when Java is present and maps its messages to a single `html.nu` check ID. It does not exist yet: nothing in the repository refers to Nu, and no check needs Java. If it ships, it will be opt-in and this page will say so.

## Related

- [docs/checks/README.md](README.md) — the one-page-per-check index this page sits beside
- [ADR 0013: HTML conformance is built in Node from parse5 and a small rule set](../adr/0013-html-conformance.md) — the measured comparison behind the boundary above
- [ADR 0001: Verify is the core product](../adr/0001-verify-first.md) — why Seaworthy verifies built output rather than linting source

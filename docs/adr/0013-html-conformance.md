# 0013. HTML conformance is built in Node from parse5 and a small rule set; the Nu Html Checker stays optional

**Status:** Accepted (2026-10-18)

## Context

The roadmap's `E-html` epic promises to catch the HTML mistakes that change how browsers and assistive technology read a page "using the parser's own error reporting plus a few targeted rules, with no Java dependency". The reference tool is the W3C Nu Html Checker (`vnu.jar`), which needs Java. Issue #214 asks whether the Node-only approach is good enough to build, and what it will not cover.

Questions:

1. How much of what the Nu checker reports does parse5's own error reporting find?
2. How much more does a small set of rules add, and does it flag things Nu accepts?
3. What does each cost in time and install size?

## Method

A throwaway prototype (not in the repository): `parse5` with `onParseError` and source positions, plus about 20 small rules over the tree and the source text. Compared with Nu Html Checker 26.10.12 (`vnu.jar`, OpenJDK 27) on two sets:

- **A corpus of 48 small documents** written for this spike: one valid control, 44 with one mistake each, and 3 where the markup is odd but conforming (for example a `<tr>` directly in a `<table>`, `target="blank"`, a repeated `<h1>`). Nu reported errors in 36 of them, only warnings in 5, and nothing in 7.
- **The 58 HTML pages in `fixtures/`**, which the rules were not written against.

The rules were written after the corpus, from the HTML Standard. So the corpus number below overstates how well the rules would do on unseen mistakes; the second set is the better evidence.

## Results

### What each approach finds (corpus, 36 documents where Nu reports errors)

| Approach | Documents flagged | Share |
| --- | ---: | ---: |
| parse5 parse errors alone | 6 | 17% |
| parse5 errors plus about 20 rules | 32 | 89% |

parse5 reports tokenizer-level problems and a missing doctype: duplicate attributes, bad character references, an unquoted attribute value containing a quote, end of file inside a tag, a trailing `/` on a non-void tag. It reports nothing for the most common real mistakes: a stray end tag, an unclosed `<div>` or `<span>`, `<a>` inside `<a>`, a block element inside `<p>` closed by `</p>`, `<li>` outside a list, a cell outside a row, a form inside a form.

The rules that closed the gap, by what they look at:

- **Source against tree:** an end tag in the source that closed no element (stray end tag); a non-void element with no end tag where one is required (unclosed element). Optional end tags (`p`, `li`, `td`, and so on) are excluded.
- **Content model of a few elements:** `li` outside `ul`/`ol`/`menu`, other children of a list, `td`/`th` outside `tr`, interactive content inside `button`, `a` inside `a`, headings and `p` inside phrasing content, a form inside a form, more than one visible `main`.
- **Obsolete things:** the obsolete elements and presentational attributes (`center`, `font`, `marquee`, `align`, `bgcolor`, `border` on `img`, and similar).
- **Required and malformed values:** `alt` on `img`, a non-empty `title`, `type` on `input`, ids that are empty or contain spaces or repeat, boolean attributes with a value other than their name, non-numeric `tabindex`, whitespace in `href`, a URL that does not parse, a `label for` with no matching id.

### Accuracy

| Measure | Result |
| --- | --- |
| Corpus: documents Nu accepts that the rules flag (the 7 clean ones) | 0 |
| Corpus: Nu errors missed by parse5 and rules together | 4 of 36: a `<td>` directly in `<tbody>`, an unknown attribute, invalid CSS in `style`, a `<caption>` after the table body |
| Fixture pages: both flag | 10 |
| Fixture pages: both report nothing | 38 |
| Fixture pages: only the rules flag | 0 |
| Fixture pages: only Nu flags | 10 |

The 10 pages where only Nu flags are all classes Seaworthy already covers with its own checks or will cover: invalid `aria-*` names and values, `role`, `autocomplete`, language codes, `headers` on table cells, heading level skips, and a `<link>` element in `<body>`. None is an HTML structure problem that the rules above miss.

### Cost

| | Nu Html Checker | parse5 and rules |
| --- | --- | --- |
| 300 documents | 1.7 s | 26 ms |
| One document | 0.85 s (mostly JVM start) | under 1 ms |
| Install | OpenJDK 377 MB, `vnu.jar` 32 MB | none beyond parse5, which is already a dependency |
| Runs where | needs Java on the machine | anywhere Node runs |

## Decision

1. **Build it natively.** Ship the `E-html` checks on parse5 plus rules, with no Java. The result is within reach: most Nu errors on realistic documents are found, none of the documents Nu accepts were flagged, and it is about 65 times faster in a batch and has no install cost.
2. **`html.parse-errors` must say what it covers.** parse5's error reporting is narrow (tokenizer errors and a missing doctype). The task keeps its key, but its scope changes: report parse5's errors with exact positions (`startLine` and `startCol` are on each error), and add the stray-end-tag and unclosed-element rules, which are what people actually run into. `html.nesting` carries the content-model rules.
3. **Severity follows consequence.** Mistakes that change how a browser builds the page (unclosed element, stray end tag, nested `a`, form inside form) are warnings by default, because the page still renders; duplicate attributes and invalid structure that breaks assistive technology are errors; obsolete elements and attributes are notes.
4. **The Nu Html Checker stays out of the core.** An optional extension that runs `vnu` when Java is present can follow in Phase 6, mapping its messages to a single `html.nu` check ID. It would be the place for what the native rules do not cover.
5. **What the docs page (`html.docs`) must say honestly:** the native checks do not validate attribute names per element (needs the HTML Standard's element and attribute tables), attribute value grammars beyond the few listed, CSS inside `style`, or the order of table children. Those are where Nu still finds more.
6. **Keep the corpus.** The 48 documents become `fixtures/html-corpus/`, one folder per document, each with an expected result written by reading it. The comparison with Nu is a script that is run by hand, not in CI, so CI needs no Java.

## Consequences

- `html.parse-errors` and `html.nesting` are larger than the roadmap's M sizing suggests once the stray-end-tag and unclosed-element rules are in them; they can be split into one task per rule when the epic starts.
- The rules examine the source text as well as the tree (for stray end tags). Positions come from parse5's source locations; they have to be tested on CRLF files and on end tags inside `<script>`, `<style>`, and comments, which the prototype removed by blanking those ranges.
- Optional end tags are a source of false positives: the `p`, `li`, `dt`, `dd`, `tr`, `td`, `th`, `thead`, `tbody`, `tfoot`, `option`, `optgroup`, `colgroup`, `rt`, `rp`, and `caption` elements may omit their end tag. Each rule that looks at end tags needs a fixture for that.
- Java and the Nu checker were installed with Homebrew and npm for this spike only. They are not a dependency of the project and nothing in the repository refers to them.

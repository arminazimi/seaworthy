# html.parse-errors

The HTML parser (parse5) reports an error in a page, or an end tag or missing end tag the parser had to fix up by hand.

## Why it matters

Browsers recover from almost any markup, so a page with parse errors still renders — but "recover" means the browser guessed. The guessed structure can swallow content, drop the second copy of a duplicate attribute even when the values differ, or place stray text somewhere the author never intended. Agents that read the page get a different tree from the one the author wrote, so every listener and agent benefits when the document parses cleanly.

## What it checks

Three kinds of finding, each with an exact line and column:

- **Error the parser reports.** Any error parse5 raises while building the tree, such as duplicate attributes, a file that ends inside a tag, or an end tag with attributes. There are a few dozen codes; the finding repeats the code and, for the common ones, explains it in one line. Positions are the ones the parser itself puts on the error. Duplicate attributes are `error`; every other parse error is `warning`.
- **Stray end tag.** An end tag in the source that closed nothing: the matching element had already ended or none was open any more, so the parser could not use the token. A `</br>` is special: the parser instead inserts a `<br>` element, so the fix hint says to write `<br>`.
- **Element with no end tag where one is required.** The parser kept everything after the start tag inside the element until a parent's end tag closed it or the file ended. End tags the standard lets authors omit (`p`, `li`, `td`, `tr`, `option`, and the others) are never reported here, and neither are void elements or the formatting elements the parser restructures out of place. Foreign (`SVG`, MathML) content is left to its own end-tag rules.

A missing `<!doctype html>` is not reported by this check; `html.doctype` covers it. Tag-shaped text inside a `<script>`, `<style>`, or other raw-text element, inside a comment, or inside an attribute value is content, so the end-tag rules never search there. At most 1,000 parser errors are reported for one page, so a pathological file cannot flood a report.

## How to fix

```html
<!-- before -->
<div id="ad" id="anchor">Two id attributes.</div>
<div>The second div is never closed,
  <p>a paragraph inside it</p>
</nav>

<!-- after -->
<div id="ad">One id attribute.</div>
<div>Both divs closed,
  <p>a paragraph inside it</p>
</div>
```

Close every element that requires an end tag, delete end tags that close nothing, and give each attribute on an element a distinct name. Agents can apply the fix to the source file; the finding points at the built output.

## Options

None.

## Standards

- [HTML Standard §13.2.2 Parse errors](https://html.spec.whatwg.org/multipage/parsing.html#parse-errors)
- [HTML Standard §12.2.5.2 The rules for parsing tokens in HTML content](https://html.spec.whatwg.org/multipage/parsing.html#tokenizer)

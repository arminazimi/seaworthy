# md.images

An image in a Markdown source points at a file that is not in the verified root, or is written without alt text.

## Why it matters

An image with no `alt` is read out as its file name ("Q1 underscore chart dot png"), so a person who cannot see it gets nothing and a search engine cannot index what it shows. An image whose file is gone renders as a broken placeholder, and in the middle of the paragraph that was supposed to explain the thing. Both mistakes are cheapest to see in the Markdown source: a `.md` that never reaches the build — a README on the host, a draft folder, a docs tree a generator only partly copies — is invisible to the HTML checks, so `images.alt` and `assets.missing` cannot catch it there.

## What it checks

Every Markdown file (`*.md`, `*.markdown`) under the verified root is read into the Markdown graph, and each image in it is checked in two ways. An HTML-only site with no Markdown files reports nothing, and the check never uses the network: a remote image is judged on its markup alone.

**The file it points at must exist.** An image written as `![alt](src)` or `![alt][ref]`, or as a raw HTML `<img src="src">`, with a relative or `/root`-absolute `src` is resolved the way the site serves it, against every file in the verified root — images, scripts, HTML, everything. Not there, it is an `error`, one finding per image, located at the Markdown line. Skipped: `http(s:)` and `//host` sources, `data:` and other ignored schemes, an empty `src`, and an `<img>` with no `src` attribute at all.

**The image must say what it shows.** A missing alt is an `error`, the same severity and the same exemptions `images.alt` uses in built HTML: an image with `role="presentation"` or `role="none"`, `aria-hidden="true"`, or an `aria-label` / `aria-labelledby` is not reported. One image can be reported twice when it is both broken and undescribed — two findings, one per rule, on the same line.

Where the two syntaxes differ matters, so the boundary is explicit:

- Markdown image syntax always carries its alt text: `![Chart](chart.png)` has it, and `![](chart.png)` renders `alt=""`, which is how an author says "purely decorative". A decorative image passes, and so does whitespace-only alt (`![ ](chart.png)`) — `images.alt` likewise passes an `<img>` whose `alt` attribute exists but is blank. **No `![...]()` image is ever reported for missing alt**: the syntax has no way to leave it out.
- A raw HTML `<img>` inside a Markdown file is the case where alt really goes missing, and that is what this check reports: `<img src="chart.png">` has no `alt` attribute, so the built page will read out the file name.
- A Markdown link wrapped around an image, `[![alt](logo.png)](https://example.com)`, counts as one image: its `src` and its alt are checked here, and the link around it is `md.links`' or `links.internal`'s business. A linked image with empty alt passes, as it does in HTML.
- Reference-style images (`![Logo][logo]` with `[logo]: img/logo.png`) are checked at the line that uses them; the missing path in the definition is named in the message.

Not scanned, because a reader never sees them as images: fenced and indented code blocks, code spans, HTML comments, and YAML front matter. `![...]()` images are taken straight from the shared Markdown graph, so they follow the same parse `md.links` uses; the raw-tag scan applies the same code rules to the source line by line. `<img srcset>` candidates and SVG `<image>` elements are left to `assets.missing`, which reads the built page — as it does for every image once the site is built, so one image can be reported in the source and in the output.

The location is `{ file, line }` of the Markdown source, with no column guessed, so a fix lands in the source rather than in built output.

## How to fix

```markdown
<!-- before: the file moved, and the photo has no alt -->
![Q1 chart](charts/q1.png)
<img src="img/photo.png" width="600">

<!-- after: an existing file, and words a screen reader can use -->
![Q1 chart: signups doubled between March and June](img/q1.png)
<img src="img/photo.png" width="600" alt="The team at the March launch">
```

When a `src` points at a missing file and exactly one file in the site has that basename (compared ignoring case), the report carries an exact text edit that repoints the image, keeping the relative or root-absolute style of the original and any `?`/`#` suffix. Two same-named files, or none, means no suggestion: never an invented path. The alt fix adds `alt="<describe the image>"` when the tag is on one line and unique there, and says so in the report — **replace the placeholder with text that describes what the image conveys in context**. Describe the information, not the pixels, and use `![](src)` or `alt=""` when the image is only decoration.

## Options

None.

## Standards

- [WCAG 1.1.1 Non-text Content](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html) — the alt rule. The missing-file rule comes from no standard, only from a link that lands on nothing.

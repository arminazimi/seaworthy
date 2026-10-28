# html.meta-refresh

A page moves itself after a delay, before people can finish reading.

## Why it matters

A timed `<meta http-equiv="refresh">` takes control away from the reader. Someone who needs more time to decode text, track a line, or use a screen reader can lose the page mid-sentence, and the new page may not say why they arrived. WCAG 2.2.1 requires that people can turn off, adjust, or extend a time limit that the content sets. A refresh the reader cannot control is a failure of that criterion.

## What it checks

Every page is scanned for `<meta http-equiv="refresh">` (the value is case-insensitive). The `content` value is read with the HTML refresh algorithm: a non-negative integer, then an optional separator (`;`, `,`, or whitespace), then an optional destination. The destination can be a URL or `url=` followed by a URL; `url=` is only required for conforming markup, so `content="5, /next.html"` and `content="5; url=/next.html"` both work. Quotes around the URL are stripped, and a `javascript:` URL is ignored.

- A delay greater than 0 is reported, with or without a destination. A delayed redirect and a delayed reload both move the reader.
- A delay of 0 is not reported. An immediate redirect is not a time limit, although it is still worth checking whether the destination is announced.
- A missing or malformed `content` value is not reported, because browsers ignore a refresh they cannot parse. Examples are `content="soon"`, `content="+5"`, `content="0.5"`, and `content="5."` (no separator after the delay).

Each finding points at the `content` attribute. The check suggests a fix but does not edit the page, because removing a timed redirect is a content decision.

**Redirect stubs.** A page is a *redirect stub* when its only job is to hand people to another address: it has an immediate redirect (`delay` 0 with a destination), or a refresh with a destination whose page shows no readable text beyond at most scripts and styles. The content checks — `meta.*`, `headings.*`, `a11y.landmarks`, `social.*`, `readability.ssr-content` — skip stubs, because they have nothing to check. A delayed refresh on a page people can still read, and a delayed reload without a destination, do not make the page a stub.

## How to fix

Remove the timed refresh and let the reader choose when to move:

```html
<!-- before -->
<meta http-equiv="refresh" content="5; url=/new-page.html">

<!-- after -->
<p>This page has moved to <a href="/new-page.html">the new page</a>.</p>
```

If the page exists only to redirect and has no content to read, redirect immediately or at the server instead:

```html
<meta http-equiv="refresh" content="0; url=/new-page.html">
```

## Options

None.

## Standards

- [WCAG 2.2.1 Timing Adjustable](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html)
- [F40: Failure of Success Criterion 2.2.1 due to using meta refresh with a time-out](https://www.w3.org/WAI/WCAG22/Techniques/failures/F40)
- [F41: Failure of Success Criterion 2.2.1 due to using meta refresh to reload the page](https://www.w3.org/WAI/WCAG22/Techniques/failures/F41)

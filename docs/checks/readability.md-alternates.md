# readability.md-alternates

A page points to a Markdown copy of itself that is missing, is not Markdown, or is a different document.

## Why it matters

A clean Markdown copy of a page is the cheapest thing a site can offer an AI tool: no navigation, scripts, or layout, just the content. Pages advertise it with `<link rel="alternate" type="text/markdown" href="...">`, and the llms.txt proposal describes the same idea. The link is only useful if the file exists and holds what the page says. A dead link wastes the agent's request; a stale or unrelated copy is worse, because the agent trusts it.

## What it checks

For every page with a `rel="alternate"` link of type `text/markdown`, pointing into this site:

- **No `href`** (warning).
- **The file is not in the built site** (warning).
- **The file is an HTML page** (warning), usually a fallback.
- **The copy looks like a different document** (warning): the share of the page's words (four or more letters or digits, taken from `<main>`, or `<body>` if there is none, without scripts and styles) that also appear in the Markdown is below 50%. Pages with fewer than 20 such words are not compared.

Pages without an alternate are not reported: Markdown copies are optional. Links to other sites are not followed. The word comparison works for any script, including Arabic and Persian.

## How to fix

```html
<link rel="alternate" type="text/markdown" href="/docs/guide.md">
```

Build the copy from the same source as the page, so they cannot drift apart. If the page is generated from Markdown, publish that Markdown (without front matter) next to the page. There is no automatic edit, because the report cannot produce the copy.

## Options

None.

## Standards

- [llms.txt proposal: Markdown versions of pages](https://llmstxt.org/) (informal)
- [Agent-readability spec](../../spec/agent-readability/v1.md)

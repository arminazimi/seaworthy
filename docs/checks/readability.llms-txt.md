# readability.llms-txt

`/llms.txt` is missing, or it does not follow the llms.txt proposal.

## Why it matters

`llms.txt` is a Markdown file at the site root that gives AI tools a short guide to what the site is and which pages matter. It is an informal proposal, not a standard, and few AI systems read it today. It is cheap to add and easy to get wrong: a missing title, list entries without links, links to pages that no longer exist, or an error page saved under that name all make it useless or misleading. For that reason an absent file is only a note, and a present but broken file is a warning. This check never reports an error.

## What it checks

- **Missing** (note): the site has no `llms.txt`.
- **Empty** (warning).
- **Not Markdown** (warning): the file is an HTML page, usually a server fallback.
- **No H1** (warning): the first non-empty line must be `# Name`. This is the only required element of the proposal.
- **List item that is not a link** (warning): under an H2 section, entries must be `- [Title](url)` or `- [Title](url): notes`.
- **Link to a page that is not in the site** (warning): internal links are resolved against the built output, including the site's base path.
- **`llms-full.txt`** (warning), when present: empty, or an HTML page.

Links to other sites are not followed. List items before the first H2 section are ordinary prose and are not checked.

## How to fix

```markdown
# Example Docs

> Guides and reference for Example, a tool that does one thing.

## Guides

- [Getting started](/docs/start.md): install and first run
- [Configuration](/docs/config.md): every option

## Optional

- [Changelog](/CHANGELOG.md)
```

Serve it at `/llms.txt`. Per-page Markdown copies, linked as above, make the file much more useful; see [`readability.md-alternates`](readability.md-alternates.md). There is no automatic edit, because the report cannot know what your key pages are.

## Options

None. Raising "missing" to a warning is reserved for a later version of the config.

## Standards

- [llms.txt proposal](https://llmstxt.org/) (informal)
- [Agent-readability spec](../../spec/agent-readability/v1.md)

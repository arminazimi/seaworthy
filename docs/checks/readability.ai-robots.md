# readability.ai-robots

`robots.txt` rules for AI crawlers contradict each other, name a crawler that does not exist, or shut out the crawlers that would read the site's `llms.txt`.

## Why it matters

Sites now use `robots.txt` to say which AI crawlers may read them: block the ones that train models, allow the ones that fetch a page because a person asked an AI tool about it. Mistakes here are silent. A misspelled crawler name matches nothing, so the rules under it never apply. A group with both `Disallow: /` and `Allow: /` is read differently by different crawlers. And a site that publishes `llms.txt` for AI tools while blocking every crawler that fetches pages for them has made the file unreachable.

## What it checks

- **Contradiction** (warning): a group that names a known AI crawler has `Disallow: /` and `Allow: /` (or the same path in both), or `Disallow: /` together with an empty `Disallow:`.
- **Misspelled crawler** (warning): a `User-agent` that is not a known crawler (AI or common search and social ones) but is within two edits of a known AI crawler, such as `ClaudBot` or `GPT-Bot`.
- **Guide with no readers** (warning): the site has `llms.txt` or `llms-full.txt`, and every crawler that fetches pages for AI answers (`OAI-SearchBot`, `ChatGPT-User`, `Claude-User`, `Claude-SearchBot`, `PerplexityBot`, `Perplexity-User`, `DuckAssistBot`, `MistralAI-User`, `Meta-ExternalFetcher`) is fully blocked, by its own group or by `User-agent: *` with `Disallow: /`.

Blocking training crawlers (`GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`, and similar) is a legitimate choice and is never reported. A site without `robots.txt` is not reported. The crawler lists are in the check's source and are updated in minor releases.

## How to fix

```text
# Block model training, allow answers that cite the site
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: *
Disallow: /private/
```

Use the exact name each vendor publishes; names are matched without regard to case. There is no automatic edit, because whether to allow a crawler is your decision.

## Options

None.

## Standards

- [RFC 9309: Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309)
- [Agent-readability spec](../../spec/agent-readability/v1.md)

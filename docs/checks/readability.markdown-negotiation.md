# readability.markdown-negotiation

A deployed page does not answer a request for `Accept: text/markdown` with Markdown.

## Why it matters

AI agents prefer clean text. Some of them ask a page for Markdown directly with the HTTP header `Accept: text/markdown`, and a site that supports this (Cloudflare calls it "Markdown for Agents") returns the page's content without navigation, scripts, or layout. A site that ignores the header sends the whole HTML page, which costs the agent time and context. This is a property of the deployed site and its host, not of the built files, so the check is opt-in and needs the network.

## What it checks

Run with `--network`. The check asks the deployed site, for the home page first and then up to four more pages (`pages` option, default 5):

- **Not Markdown** (warning): the response is successful but its `Content-Type` is not `text/markdown`.
- **No `Vary: Accept`** (note): Markdown came back but the response does not say it depends on the `Accept` header, so a cache may mix up what it serves to browsers and agents.
- **Could not reach it** (note): the request failed. The check does not turn a site that is not deployed into a finding on the page.
- **No address** (note): the check needs the deployed address and the home page has no absolute canonical link to take it from.

Pages that answer 404 or an error are skipped, because a page that is not deployed is a different problem. Findings carry the built file's path so a fix can be traced, but they describe the deployed site (`appliesTo` is still `built-output`, which is the file the page comes from).

## Options

```json
{
  "checks": {
    "readability.markdown-negotiation": {
      "options": { "baseUrl": "https://example.com", "pages": 5, "timeoutMs": 10000 }
    }
  }
}
```

`baseUrl` is the deployed address, including any path the site lives under. When it is not set, the check uses the origin of the home page's canonical link plus the site's base path.

## How to fix

Make the host or a middleware return Markdown when the request prefers it, with `Content-Type: text/markdown` and `Vary: Accept`. On Cloudflare this is a setting (Markdown for Agents). Elsewhere it is a small rule in your edge or server code that serves the page's `.md` copy; see [`readability.md-alternates`](readability.md-alternates.md) for producing the copies. There is no automatic edit.

## Standards

- [Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents) (vendor documentation)
- [HTTP content negotiation, RFC 9110 section 12](https://www.rfc-editor.org/rfc/rfc9110#name-content-negotiation)
- [Agent-readability spec](../../spec/agent-readability/v1.md)

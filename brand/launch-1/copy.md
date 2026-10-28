# Copy

The blocks a launch post is built from. Each one is exact: paste it, do not rewrite it.

## Names

| Slot | Text |
| --- | --- |
| Product name | `Seaworthy` |
| Tagline | Ship sites agents can trust. |
| Secondary line | Verified before it sails. |
| Descriptor | Verifies websites for agents. |

Never write `Seaworthy AI`, `Seaworthy Scanner`, or any other variant. The tagline is the line that
goes everywhere; the secondary line belongs on banners and launch art, never in place of it.

## The one-liner

> Seaworthy verifies websites for agents. One command checks any built static site and returns a
> versioned report: every finding has a stable check ID, an exact location, and a fix hint.

## The command

```bash
npx seaworthy verify ./dist
```

Lead with the command or the result, never with the pitch.

## What it does

- **Reads the built site.** HTML and assets, so it works with any framework, on any host.
- **Checks what agents and AI search need to read the site.** Built on existing standards: WCAG,
  `llms.txt`, schema.org, Markdown alternates.
- **Reports, never edits.** Every finding names its check, its location, and a fix hint. Seaworthy
  never touches your files.
- **Runs where the agent runs.** CLI, MCP server, GitHub Action, and Agent Skills, all producing the
  same machine-readable report.

## What it does not do

- It does not score the site. There is no grade; there are findings with locations.
- It does not edit your files. It reports and suggests.
- It does not read your source. It reads the build output.
- It does not use the network by default. The checks that need it are opt-in and say so.

## Words to avoid

Skip `AI-powered`, `seamless`, `unlock`, `supercharge`, and `looks good`. Write a count, a
location, or a pass instead. The full voice rules are in
[`../BRAND_GUIDE.md`](../BRAND_GUIDE.md#voice).

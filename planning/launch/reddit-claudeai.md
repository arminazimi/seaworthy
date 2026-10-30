# r/ClaudeAI — launch draft (#129)

**This is a draft for review, not a post to send.** Before publishing: run the loop yourself with
Claude Code (or whichever agent you describe) on a real site and replace the pasted finding and
prompt with your actual run's output; check the subreddit's rules and the link target. Do not keep
any sentence about the agent's behavior that you did not observe. Owner: `launch1.posts`.

## Format limits

- Reddit title plus body; no character count is set for this channel in the kit, so the constraint
  is in words: the body shows the loop step by step and stays scannable, and the subreddit's rules
  on self-promotion apply.
- The kit's shape for this channel: the agent loop — an agent builds a site, Seaworthy reports a
  finding, the agent fixes it.

## Hook (title)

> I'm building a verifier whose output is made for the agent loop — every finding carries a file,
> a line, and a ready-to-use fix prompt (pre-alpha, built in public)

## Body

The pattern this subreddit knows well: Claude builds or edits a site, says "done", and the built
output has a link to a page that was renamed last week. The compile step passes; nothing checks
the artifact. Seaworthy is that check, pre-alpha and in public, and its report is shaped for the
loop rather than for a human reading a dashboard.

The loop, with real output from the repo's test fixture (151 pages, 78 checks):

1. The agent builds the site.
2. Verify the built folder:
   `node packages/verify/dist/src/cli.js verify ./dist`
   Exit code 1 means findings at or above the failing severity; 0 means clean; 2 is a usage error;
   4 means a check crashed and says so instead of guessing.
3. The agent reads `--format json`. One finding, verbatim:

```json
{
  "checkId": "links.internal",
  "severity": "error",
  "message": "Link to /pricing points to a page that does not exist in the built site.",
  "location": { "file": "a11y-hidden-focusable/site/index.html", "line": 10, "column": 41 },
  "fix": { "kind": "manual", "summary": "Point the link at an existing page, or add the missing page." }
}
```

4. Every finding also carries a `prompt` field — text written to hand to a coding agent. From the
   same run: "Fix this Seaworthy finding. Check links.internal (error) at … Link to /pricing
   points to a page that does not exist in the built site. … apply the same fix in the source
   that generates it, rebuild, then re-run seaworthy verify to confirm the finding is gone."
5. The agent fixes, rebuilds, re-runs. A baseline file (`--baseline`) means a site that already
   has findings only fails on new ones.

For MCP: the repo includes the server under `packages/mcp` (runnable from source, tools
`list_checks`, `verify_site`, `verify_changed`); it is not published yet. The Agent Skills the
roadmap describes are planned (epic E-skills), not shipped — do not say otherwise.

Honest limits: nothing is on npm, there is no release or version to quote, and no benchmark
numbers exist. Checks never touch the network unless the run opts in (`--network`). Seaworthy
reports and never edits — the fix stays the agent's (or your) decision.

## Call to action

Read the repository: https://github.com/arminazimi/seaworthy — clone, `npm ci && npm run build`,
wire the CLI or the in-repo MCP server into your agent's loop, and open an issue for every finding
the agent could not act on. That feedback is the point of building pre-alpha in public.

## Asset

[`brand/exports/social-preview-dark.png`](../../brand/exports/social-preview-dark.png) as the post
preview; if the loop gets screenshots of real runs, those carry the post.

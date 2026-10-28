# Channels

Where the launch goes, what shape each post takes, and which asset it uses. The drafts themselves
are `launch1.posts`; this is the plan they follow.

The Reddit posts are four posts, one per subreddit: r/webdev, r/javascript, r/ClaudeAI, and
r/LocalLLaMA. Reddit shows a post to a wide audience, so each one says what was found and links
the repository; none of them asks for a signup.

Platform rules change. The columns below are what we control: the shape of the post, the assets it
uses, and the roadmap task that owns it. Check each platform's own rules before posting.

| Channel | Owner | Shape | Assets |
| --- | --- | --- | --- |
| Show HN | `launch1.posts` | A title that names the problem, then a post that shows a real run: the command, the report, one finding with its location | [Social preview](../exports/social-preview-dark.png) |
| r/webdev | `launch1.posts` | A screenshot or a short clip of the output, not the pitch; say which framework the site was built with | [Social preview](../exports/social-preview-dark.png) |
| r/javascript | `launch1.posts` | The same run, written for people who ship front ends: what it found and what it cost to fix | [Social preview](../exports/social-preview-dark.png) |
| r/ClaudeAI | `launch1.posts` | The agent loop: an agent builds a site, Seaworthy reports a finding, the agent fixes it | [Social preview](../exports/social-preview-dark.png) |
| r/LocalLLaMA | `launch1.posts` | The same loop, with the model and the prompt it ran with | [Social preview](../exports/social-preview-dark.png) |
| X | `launch1.posts` | One post under 280 characters, then a thread with the run | [Social preview](../exports/social-preview-dark.png) |
| dev.to | `launch1.posts` | A full post: the site that was checked, the findings with their locations, and the fix | [Social preview](../exports/social-preview-dark.png), [banner](../exports/banner-dark.png) |
| Persian developer communities | `launch1.posts` | The same post in Persian, for the Telegram and Discord groups; keep the command, the check IDs, and the file names untranslated | [Social preview](../exports/social-preview-dark.png) |
| Product Hunt | `launch1.product-hunt` | A gallery: logo, tagline, and the first comment, which explains what it is and shows the report | [Marketplace logo](../exports/marketplace-logo-dark.png), [social preview](../exports/social-preview-dark.png) |
| newsletters | `launch1.newsletters` | A pitch to an editor: one paragraph on what it is, one on who it is for, one link | [Social preview](../exports/social-preview-dark.png) |
| talk proposals | `launch1.talks` | A proposal with an abstract, a live demo, and one takeaway a listener can use the same day | [Banner](../exports/banner-dark.png) |

## The same four rules everywhere

1. **Lead with the command or the result.** `npx seaworthy verify ./dist`, then what it found.
2. **Show one real finding.** A check ID, a location, and the fix. A number beats an adjective.
3. **One link, and it is the repository.** Everything else is a comment.
4. **Say nothing the facts table does not allow.** No numbers we have not published, no "the only
   tool that", no roadmap dates as promises.

## Timing

- Product Hunt opens launches at 00:01 Pacific. The maker's first comment is part of the launch, so
  it is written and posted at the same minute, not after.
- Every channel points at the same repository, the same command, and the same assets, so a reader
  who finds the launch on one channel finds the same thing on the others.
- The response week (`launch1.response-week`) starts the day the posts go out. Answer every
  launch-week issue within 24 hours; that is the launch's promise to the people who tried it.

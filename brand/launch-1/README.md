# Launch kit: wave 1

Everything a launch-day post needs for Seaworthy verify 0.1, in one folder: the copy, the claims we
may make, the assets, the channels, and the checklist.

This is the kit, not the posts. The per-channel drafts are `launch1.posts`; the launch day itself
is `launch1.day`.

## What is in here

| File | What |
| --- | --- |
| [`copy.md`](copy.md) | The copy blocks: tagline, one-liner, install line, what it does and does not do |
| [`facts.md`](facts.md) | Every claim we may make, the file that proves it, and when it is true |
| [`assets.md`](assets.md) | Which brand asset goes on which surface |
| [`channels.md`](channels.md) | The channel plan: format, assets, and the roadmap task that owns each |
| [`checklist.md`](checklist.md) | The pre-flight, launch-day, and response-week checklist |

## Two rules

1. **Every claim traces to [`facts.md`](facts.md).** If a number or a promise is not in the facts
   table with a source, it does not get published.
2. **Every asset path is a real file.** The kit points at the brand assets; it never copies them, so
   nothing here can drift from [`../assets`](../assets) and [`../exports`](../exports).

The voice, the logo, and the palette live in [`../BRAND_GUIDE.md`](../BRAND_GUIDE.md). The kit
never restates them; it points at them.

## Before you use it

The facts table has a status column. Anything marked "after the release" is not true until
`release.publish` runs: the packages are not on npm yet, and the Action is not in the Marketplace
yet. This kit is written for launch day, not for today.

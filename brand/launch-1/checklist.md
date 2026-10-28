# Checklist

The launch day, in order. Every step names the roadmap task that owns it, so nothing here is a
duplicate of work tracked elsewhere.

## Before launch day

- [ ] `release.publish` is done. `npm view @seaworthy/verify version` returns the released version,
      the MCP server is published, and the Action is in the Marketplace.
- [ ] The README describes the released version, and the pre-alpha status line is gone.
- [ ] `npm run check` is green on the release commit.
- [ ] The demo video is published (`launch1.video`) and the demo repository is public
      (`launch1.demo-repo`).
- [ ] The benchmark numbers are published (`bench.results`) if the posts will cite them. If they are
      not, the claims in [`facts.md`](facts.md) that are still locked stay locked.
- [ ] The per-channel drafts are reviewed (`launch1.posts`): every claim traces to a row in
      [`facts.md`](facts.md), and every asset path in [`assets.md`](assets.md) resolves.
- [ ] The assets are the current exports: `npm run build:brand` and `npm run export:brand` are green.
- [ ] The badge renders on a verified repository (`docs/badge.md`).
- [ ] Someone owns the inbox for the launch week, and knows the 24-hour promise.

## Launch day

- [ ] Show HN goes up first. The other channels link it.
- [ ] The Reddit posts go up one at a time, each in its own subreddit, each checked against that
      subreddit's rules.
- [ ] The X post and its thread go up.
- [ ] The dev.to post is published, with the cover image and the tags.
- [ ] The Persian community posts go up, with the command and the check IDs left untranslated.
- [ ] The Product Hunt launch opens at 00:01 Pacific, with the maker's first comment posted at the
      same minute.
- [ ] The newsletter pitches are sent (`launch1.newsletters`).
- [ ] Every post and every asset used is written down, so a correction can find the same place.

## The response week

- [ ] Every launch-week issue is answered within 24 hours.
- [ ] Every comment on the launch posts gets a reply.
- [ ] What readers got wrong is logged as an issue, not as a deleted message. A false positive found
      during launch week is a bug report with a launch attached.
- [ ] A wrong number in a post is corrected in place, with the correction visible. The post stays
      up; the numbers do not stay wrong.

## If the launch is wrong somewhere

Correct it where it was said, say what was wrong, and open the issue. A launch that is corrected
loudly is worth more than a launch that hides its mistakes.

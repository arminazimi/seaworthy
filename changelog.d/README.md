# Changelog fragments

Each pull request adds one file here instead of editing `CHANGELOG.md`, so two open PRs never conflict on the changelog.

- Name it `<issue>.<section>.md`, where `<section>` is `added`, `changed`, or `fixed`: `263.added.md`.
- The file holds the entry text only, one paragraph, no leading `- `. End it with the issue number, as `(#263)`.
- Do not edit `CHANGELOG.md` in a PR. `npm run changelog:fold` moves the fragments into its `## Unreleased` section and deletes them; maintainers run it before a release.

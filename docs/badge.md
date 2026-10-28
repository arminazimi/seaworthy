# Status badge

`seaworthy verify` writes a JSON report; `seaworthy-badge` (in `@seaworthy/action`) turns that
report into the Seaworthy status badge SVG. There is no hosted endpoint and no signup: the badge is
a plain SVG file your repository commits, and GitHub serves it from the commit — the same approach
every shields-style README badge uses.

## States and colors

The badge reads only the report's `summary.bySeverity` counts and the `errors` array of crashed
checks. The mapping is the same scheme as the CLI gate (`seaworthy verify` with default
`--fail-on error`):

| Report                                | Badge state  | Color                        |
| ------------------------------------- | ------------ | ---------------------------- |
| only notes, or nothing at all         | `passing`    | teal (`seaTeal`)             |
| one or more `warning` findings        | `warnings`   | amber (`signalAmber`)        |
| one or more `error` findings or crashes | `failing`  | red (`alertRed`), count = errors |

The count shown in the failing and warning states is that severity's count. The SVG is a pure
function of the report: the same report always produces byte-identical output, so a rerun in CI
never dirties the working tree (`packages/action/src/badge-svg.ts` is the one source;
`tools/brand/badge.mjs` re-exports it). The report JSON is untrusted input — it is parsed, never
evaluated; a malformed report is rejected with a message naming the offending field, exit code 2.

## Add it to a repository

1. Run verify with a JSON report, then the badge, in the workflow that builds the site. The Seaworthy
   packages are not on npm yet, so the workflow checks out this repository at a pinned ref (any
   commit of `main` you trust; pin a full SHA so the tools cannot drift), installs and builds it, and
   then runs the two CLIs from that build:

   ```yaml
   - uses: actions/checkout@v4
     with: { repository: arminazimi/seaworthy, ref: <TRUSTED-SHA>, path: seawoorthy, persist-credentials: false }
   - uses: actions/setup-node@v4
     with: { node-version: 22, cache: npm, cache-dependency-path: seawoorthy/package-lock.json }
   - run: npm ci && npm run build
     working-directory: seaworthy
   - run: node seaworthy/node_modules/@seaworthy/verify/dist/src/cli.js verify --format json --out seaworthy-report.json
     continue-on-error: true # the badge must still be written when the gate fails
   - run: node seaworthy/packages/action/dist/src/badge-cli.js --report seaworthy-report.json --out seaworthy-badge.svg
   - run: |
       git config user.name seaworthy-bot
       git config user.email seaworthy-bot@users.noreply.github.com
       git add seaworthy-badge.svg
       git commit -m "chore: refresh seaworthy badge" || true
       git push
   ```

   `seaworthy-badge` itself never fails because the site has findings: it exits 0 with the badge
   for any readable report, so the badge step does not need `continue-on-error` of its own. Keep
   the gate strict by not adding `continue-on-error` to the `verify` step itself.

2. Paste the snippet into your README, substituting `OWNER`, `REPO`, and `BRANCH`:

[![seaworthy verified](https://raw.githubusercontent.com/OWNER/REPO/BRANCH/seaworthy-badge.svg)](https://github.com/arminazimi/seaworthy)

The snippet is also printed by `seaworthy-badge --readme`, and the one source for the wording and
artwork is `packages/action/src/badge-svg.ts` (`README_SNIPPET`, `badgeForReport`), which
`tools/brand/badge.mjs` re-exports; the tests pin both against this document.

## Status

Pre-alpha (Phase 2, action epic #9). The GitHub Action that runs this for you — instead of the
manual workflow above — is tracked by the action epic; `packages/action/src/index.ts` is a
placeholder until then.

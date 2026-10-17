## Goal
Decide how rendered checks (axe-core accessibility, Lighthouse) get a browser, and what Seaworthy does when no browser is available.

## Agent brief

**Files**
- `docs/adr/NNNN-headless-browser.md` (new)
- `docs/adr/README.md` (add the row)

**Steps**
1. Compare at least two ways to get a headless browser: Playwright-managed Chromium, and a system Chrome found through a known path or an environment variable.
2. Measure download size, CI time added on GitHub-hosted runners, and time to run axe on a 20-page fixture.
3. Define the fallback: which checks still run statically without a browser, and how the report says a rendered check was skipped (never silently).
4. Write the ADR with the measurements, the decision, and the skip behavior.

**Do not**
- Do not add browser dependencies to `packages/verify` yet.
- Do not make any check depend on the network.

## Done when
- [ ] The ADR picks one approach and defines the "browser unavailable" behavior.
- [ ] The report field for skipped checks is described well enough for `verify.report-schema` to use.

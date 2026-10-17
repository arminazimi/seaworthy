## Goal
Know what already exists so Seaworthy reuses good pieces and is clearly different from existing tools.

## Agent brief

**Files**
- `docs/adr/NNNN-prior-art.md` (new)
- `docs/adr/README.md` (add the row)

**Steps**
1. Review at least: html-proofer, lychee, linkinator, pa11y, axe-core CLI, Lighthouse CI, webhint, and any tool that checks `llms.txt`.
2. For each, record: what it checks, output format (JSON, SARIF?), license, maintenance status, and whether agents can use it well (stable IDs, locations, fix hints).
3. Decide per capability: reuse as a library, wrap, or build. Check that licenses are compatible with Apache-2.0.
4. Write one paragraph on how Seaworthy is different, for the README and launch posts.

**Do not**
- Do not add dependencies yet; record candidates only.

## Done when
- [ ] The ADR has a comparison table and a reuse/wrap/build decision per capability.
- [ ] Every library marked "reuse" has a license compatible with Apache-2.0.

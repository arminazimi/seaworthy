# 0008. SARIF locations are repository-relative

**Status:** Accepted (2026-10-17)

## Context

ADR 0006 mapped finding locations to SARIF `artifactLocation.uri` with `uriBaseId: "SITE_ROOT"`. Implementing `verify.sarif` and checking it against GitHub's documented behavior showed a better mapping. GitHub code scanning resolves `uri` relative to the repository root, and annotates a file only when that path exists in the repository. A `SITE_ROOT` base id gives GitHub nothing to resolve, so results would never attach to a file.

Many sites do commit their built output (a `docs/` folder served by GitHub Pages is common), and in CI `seaworthy verify` normally runs at the repository root.

## Decision

- `artifactLocation.uri` is the report root joined with the finding's file, for example `dist/index.html`, with forward slashes. When the root is `.`, it is the file alone. There is no `uriBaseId` and no `originalUriBaseIds`.
- The same rule applies to the `uri` of fix replacements.
- Findings without a line get `region.startLine: 1`, because code scanning needs a line.
- SARIF `fixes` are emitted only when the edit's `find` text is on the stated line of the source; the region is computed from its position there. Otherwise the fix is omitted rather than guessed.

## Consequences

- If the built folder is not tracked in git, alerts appear in the Security tab but not inline on a pull request. This is the same limit as ADR 0006's source-mapping risk; task `int.source-map` addresses it.
- Where `verify` runs from decides what the paths mean. The Action should run at the repository root and say so in its docs.
- Output is checked against the official SARIF 2.1.0 schema in `npm test` (schema from `@microsoft/jest-sarif`, validated with ajv 6 because the schema is draft-04). This replaces the "not validated" caveat in ADR 0006.

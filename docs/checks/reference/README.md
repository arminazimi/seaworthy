# docs/checks/reference

Generated per-check reference pages, one per check in the catalog, named `<check-id>.md`.

Do not edit these pages by hand. Each one is assembled by `tools/gen-check-reference.mjs` from two
sources, and every fact keeps its single home:

- the check's metadata (`meta(...)` in `packages/verify/src/checks/`, or the suppression checks in
  `packages/verify/src/suppress.ts`) provides the ID, title, default severity, needs with their
  opt-in flags, standards, and source module;
- the prose page in `docs/checks/` (one level up) is embedded below that header, verbatim.

Regenerate with `npm run build && npm run reference:build`. `npm run check` runs the generator in
`--check` mode and fails when a page drifts from its sources, when a catalog check has no page, or
when a page no longer belongs to the catalog.

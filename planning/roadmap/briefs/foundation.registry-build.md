## Goal
Adding a check edits no shared file: the registries are written during `npm run build` and ignored by git, so 20 check pull requests merge in any order.

## Files

**Edit**
- `tools/gen-registries.mjs`
- `package.json`
- `.gitignore`
- `AGENTS.md`
- `packages/verify/src/checks/registry.ts`
- `packages/verify/src/formats/registry.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Change the generator to scan source files (`export const <name>: Check` and factory exports) so it can run before `tsc`, then run it as the first build step.
2. Delete the committed `registry.ts` files and add them to `.gitignore`.
3. Keep the ID-sorted order and the `--check` mode for CI.
4. Update the shared-files table in AGENTS.md: registries are now neither committed nor edited.

## Done when
- [ ] Two branches that each add a check merge with no conflict (show it in the pull request).
- [ ] A fresh clone builds and tests with no extra step.
- [ ] `npm run check` passes.

## Goal
The Action takes `profile`, `languages`, `pseudo-rtl`, and `min-score`, and fails when the score drops below `min-score`.

## Files

**Edit**
- `action.yml`
- `docs/action.md`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Defaults keep current users unaffected except the profile change, which is documented.

## Done when
- [ ] A test workflow in the pull request shows the comment.
- [ ] `npm run check` passes.

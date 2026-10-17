# Agent briefs

One file per task: `<task-key>.md`, for example `spike.runtime.md`. The build merges it into the task's issue in place of the generic "no brief yet" section, and removes the `status: needs-brief` label.

A brief has these sections, in this order:

````markdown
## Goal
One sentence: what exists when this is done.

## Agent brief

**Files**
- `path/to/file`

**Steps**
1. ...

**Do not**
- Do not expand scope beyond this issue; open a follow-up instead.

**Run**
```bash
npm ci
npm run check
```

## Done when
- [ ] ...
````

Do not add "Depends on"; the build adds it from `ROADMAP.md`. Write briefs just in time, one phase ahead of the work.

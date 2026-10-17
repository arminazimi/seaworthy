# Configuration

Seaworthy works with no config. Add `seaworthy.config.json` in the folder you run it from when you need to change what runs, what fails, or what to accept. It is plain JSON, so an agent can edit it safely, and editors can autocomplete it from the [schema](../spec/config/v0.schema.json).

```json
{
  "$schema": "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  "root": "dist",
  "failOn": "warning",
  "ignore": ["drafts/**", "404.html"],
  "checks": {
    "images.alt": "warning",
    "a11y.*": "off",
    "a11y.color-contrast": { "severity": "error" }
  },
  "baseline": "seaworthy-baseline.json"
}
```

## Options

| Key | Meaning |
| --- | --- |
| `root` | The built site folder. Default: the first of `dist`, `build`, `out`, `public`, `_site`, `site` that exists. |
| `failOn` | Exit 1 when a finding has at least this severity: `error` (default), `warning`, `note`, or `none`. `--fail-on` overrides it. |
| `rendered`, `network` | Turn on checks that need a browser or the network. Off by default. |
| `ignore` | Site-relative globs (`*`, `**`, `?`). Findings in matching files are dropped. |
| `checks` | Per-check settings by check ID or prefix such as `a11y.*`: `"off"`, a severity, or `{ "off", "severity", "options" }`. An exact ID beats a prefix, and a longer prefix beats a shorter one, regardless of order. |
| `baseline` | A baseline file to apply on every run. |
| `suppressions` | Findings to accept on purpose; see below. |

Errors name the key, the value, and the allowed values, and suggest the closest match for a typo. All problems are listed at once.

## Suppressions

Use a suppression when a finding is real but you have decided to live with it. Every suppression needs a **reason**, and may have an **expiry**. The finding disappears from `findings` but stays listed under `suppressed` with its reason, so nothing is hidden.

In the config, give a `check` and a `file` (path or glob) or a `fingerprint` (copy it from a report):

```json
"suppressions": [
  { "check": "links.internal", "file": "blog/archive/**", "reason": "Old posts link to retired pages", "expires": "2027-06-01" },
  { "check": "images.alt", "fingerprint": "49a8e22b9ca20dc3", "reason": "Decorative sprite" }
]
```

Or in the built HTML, covering the comment's own line and the next:

```html
<!-- seaworthy-ignore images.alt a11y.*: decorative sprite, tracked in #123 until 2027-03-01 -->
<img src="/sprite.png">
```

A suppression with no reason, an unknown check ID, or an impossible date is a `suppress.invalid` error. After its expiry date a suppression stops applying and is reported as `suppress.expired`, so the finding comes back.

## Adopting on an existing site

A baseline records today's findings so only **new** ones fail:

```bash
npx seaworthy verify --update-baseline seaworthy-baseline.json   # record, exit 0
npx seaworthy verify --baseline seaworthy-baseline.json          # fail only on new findings
```

The baseline stores fingerprints with counts, not line numbers, so it survives edits that move a finding. Fixed problems show up as `baselineStale` in the summary; run `--update-baseline` again to prune them. Commit the baseline file.

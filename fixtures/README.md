# Fixtures

Built sites with **ground truth**: for each, the exact findings Seaworthy must report. They keep checks honest in both directions: no false positives on clean sites, no misses on broken ones.

```text
fixtures/
  clean/<name>/        every built-in check must report nothing
    site/              the built site
    expected.json      { "findings": [] }
  broken/<name>/       the findings listed in expected.json, exactly
    site/
    expected.json
    fixture.json       optional: { "checks": ["links.internal"], "config": { ... } }
```

## expected.json

```json
{
  "description": "One link to a page that does not exist, and one to a missing anchor",
  "findings": [
    { "check": "links.internal", "file": "index.html", "line": 5, "column": 46 },
    { "check": "links.internal", "file": "index.html", "line": 5, "column": 88 }
  ]
}
```

Findings are listed in report order (file, line, column, check). `line` and `column` are optional and compared only when given. A fixture passes only when the list matches **exactly**: nothing missing, nothing extra.

## fixture.json

- `checks`: run only these check IDs. Broken fixtures should set it, so adding a new check elsewhere never changes an old fixture. Clean fixtures run every check.
- `config`: a seaworthy config object, for fixtures about config, suppressions, or ignored files.

## Rules the tests enforce

- Every fixture's report validates against `spec/report/v0.schema.json`, and its SARIF validates against the official schema.
- Every built-in check that needs no browser or network has at least one broken fixture that triggers it.
- Every broken fixture reports at least one finding.

## Adding a fixture

1. Put a small built site in `site/`. Keep it to a few pages and write the HTML by hand, the way a generator would emit it.
2. Print what Seaworthy reports now: `node tools/fixture.mjs fixtures/broken/<name>`.
3. **Check each finding by reading the site**, and write `expected.json` from what is truly wrong, not by pasting the output. A fixture copied from the tool's own output proves nothing.
4. Run `npm test`.

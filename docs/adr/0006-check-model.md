# 0006. One check API, one site graph, one report

**Status:** Accepted (2026-10-17)

## Context

Seaworthy has two kinds of checks: **static** checks that read parsed HTML and the file tree, and **rendered** checks that need a real browser (ADR 0005). They must share one API, one report format, and one way to name and locate problems, so that the CLI, MCP server, GitHub Action, baseline, and SARIF output all work the same for both. External check packs (Phase 6) will implement the same API, so what we publish now is hard to change later.

## Method

A throwaway prototype (about 150 lines of JavaScript, not in the repository) with one shared site graph, three checks, one report, and a SARIF conversion, run against a 3-page fixture with four seeded problems. The checks were chosen to cover both kinds and all three location styles:

| Check | Kind | Location style |
| --- | --- | --- |
| `links.internal` | static, uses the file tree | exact line and column from the HTML parser |
| `images.alt` | static | exact line and column |
| `a11y.color-contrast` | rendered (axe-core in Chrome) | CSS selector and snippet, best-effort line |

The prototype found all four seeded problems. Reported line and column positions matched the source text exactly for the static checks. It also exposed one bug in the prototype itself: an `images.alt` fix computed from a numeric column landed after the closing `>` instead of before it. That drove the decision on edits below.

## Decision

### Check API (`spec: 0`)

```ts
type Severity = "error" | "warning" | "note";            // SARIF levels, no custom scale
type Needs = "html" | "files" | "browser" | "network";   // "browser" and "network" are opt-in

interface CheckMeta {
  id: string;            // "area.rule": lowercase, dots and hyphens, stable forever
  title: string;
  severity: Severity;    // the default; users can override it in config
  needs: Needs[];
  docs: string;          // URL of the check's docs page
  standards: string[];   // for example ["WCAG 1.4.3"]
}

interface Check {
  meta: CheckMeta;
  run(ctx: CheckContext): AsyncIterable<FindingDraft>;
}

interface CheckContext {
  site: SiteGraph;                   // built once, read-only
  config: Readonly<CheckConfig>;
  browser?: BrowserSession;          // present only for checks that need "browser"
  signal: AbortSignal;
}
```

- **One site graph per run.** It holds the page map (URL, file, source, parsed tree with source positions, element IDs), the file list, and the link and asset references. Static checks are pure functions of the graph and can run concurrently. Rendered checks share one browser session (ADR 0005).
- **Check IDs are permanent and namespaced.** `links.internal`, `images.alt`, `meta.canonical`. Axe rules keep their axe name under `a11y.`, for example `a11y.color-contrast`. Renaming an ID is a breaking change; retiring one leaves an alias.
- **Checks never throw into the run.** The engine catches exceptions and lists them under `errors` in the report, so one broken check cannot hide the others.

### Finding

```ts
interface Finding {
  checkId: string;
  severity: Severity;
  message: string;
  location: {
    file: string;              // relative to the site root, forward slashes
    line?: number;             // 1-based
    column?: number;           // 1-based, in UTF-16 code units
    approximateLine?: boolean; // true when the line was found by searching for the snippet
    selector?: string;         // CSS selector, for rendered checks
    snippet?: string;
  };
  fix: {
    kind: "edit" | "manual";
    summary: string;           // what to change and why, in one or two sentences
    edits: Edit[];             // empty when kind is "manual"
    appliesTo: "built-output"; // see the source-mapping consequence below
  };
  fingerprint: string;
}

interface Edit {
  file: string;
  line: number;
  action: "replace";
  find: string;                // exact text on that line
  replace: string;
  needsInput?: boolean;        // a human or agent must supply content, such as alt text
}
```

- **Edits are text-anchored, not column-anchored.** Insert and delete are expressed as `replace` of an exact string on a line. This is simpler to apply, survives small drift, and fixes the off-by-one the prototype hit. The SARIF converter computes columns from the `find` text.
- **The fingerprint identifies a finding without its line number.** It is the first 16 hex characters of `sha256(checkId, file, key)`, where `key` is a stable identity such as the `href`, the image `src`, or the CSS selector. Edits above a finding do not change it. `verify.baseline` stores fingerprints, so a baselined finding stays baselined as the page changes. Two findings with the same fingerprint are counted, so a baseline can say "3 of these".

### Report (`spec: 0`)

```json
{
  "spec": 0,
  "tool": { "name": "seaworthy", "version": "0.0.0-prototype" },
  "root": "dist",
  "summary": { "pages": 3, "findings": 3, "bySeverity": { "error": 3 } },
  "checks": [
    { "id": "links.internal", "title": "Internal link points to a missing page or anchor", "severity": "error", "needs": ["html", "files"], "docs": "https://github.com/arminazimi/seaworthy/blob/main/docs/checks/links.internal.md", "standards": [] },
    { "id": "images.alt", "title": "Image has no alt attribute", "severity": "error", "needs": ["html"], "docs": "https://github.com/arminazimi/seaworthy/blob/main/docs/checks/images.alt.md", "standards": ["WCAG 1.1.1"] },
    { "id": "a11y.color-contrast", "title": "Text does not have enough contrast", "severity": "error", "needs": ["html", "browser"], "docs": "https://github.com/arminazimi/seaworthy/blob/main/docs/checks/a11y.color-contrast.md", "standards": ["WCAG 1.4.3"] }
  ],
  "findings": [
    {
      "checkId": "links.internal",
      "severity": "error",
      "message": "Link to /docs/guid.html points to a page that does not exist in the built site.",
      "location": { "file": "index.html", "line": 5, "column": 46 },
      "fix": {
        "kind": "edit",
        "summary": "Point the link at an existing page (closest match: /docs/guide.html), or add the missing page.",
        "edits": [{ "file": "index.html", "line": 5, "action": "replace", "find": "/docs/guid.html", "replace": "/docs/guide.html" }],
        "appliesTo": "built-output"
      },
      "fingerprint": "d6062a0613274944"
    },
    {
      "checkId": "images.alt",
      "severity": "error",
      "message": "<img src=\"/logo.png\"> has no alt attribute.",
      "location": { "file": "index.html", "line": 8, "column": 1 },
      "fix": {
        "kind": "edit",
        "summary": "Add alt text that describes the image, or alt=\"\" if it is purely decorative.",
        "edits": [{ "file": "index.html", "line": 8, "action": "replace", "find": "<img src=\"/logo.png\">", "replace": "<img src=\"/logo.png\" alt=\"<describe the image>\">", "needsInput": true }],
        "appliesTo": "built-output"
      },
      "fingerprint": "49a8e22b9ca20dc3"
    },
    {
      "checkId": "a11y.color-contrast",
      "severity": "error",
      "message": "Text contrast is 1.91:1; needs 4.5:1.",
      "location": { "file": "index.html", "line": 9, "approximateLine": true, "selector": "p", "snippet": "<p class=\"muted\">Low contrast footer-ish text.</p>" },
      "fix": {
        "kind": "manual",
        "summary": "Change the text or background color so contrast is at least 4.5:1 (now 1.91:1). Foreground #bbbbbb, background #ffffff.",
        "edits": [],
        "appliesTo": "built-output"
      },
      "fingerprint": "9e8c443a21eb07cd"
    }
  ],
  "skipped": [],
  "errors": []
}
```

(The sample is the prototype's output, trimmed to one finding per check. The `images.alt` edit was rewritten by hand into the decided `find` and `replace` form, because the prototype still used a numeric column.)

- **Reports are deterministic.** Findings sort by file, line, then check ID; keys have a fixed order; there are no timestamps or absolute paths unless `--timings` is passed. Two runs on the same site produce byte-identical reports, so they diff cleanly and tests can compare them.
- **`skipped`** lists checks that could not run, with a reason and a hint (ADR 0005). **`errors`** lists checks that crashed. Neither is a site finding.
- **Exit codes:** `0` no findings at or above the failing severity, `1` findings, `2` usage error, `4` internal error in the engine or a check.

### SARIF mapping

| Report | SARIF 2.1.0 |
| --- | --- |
| `checks[]` | `runs[0].tool.driver.rules[]`: `id`, `name`, `shortDescription.text` (title), `helpUri` (docs), `defaultConfiguration.level` (severity), `properties.tags` (standards) |
| `findings[]` | `runs[0].results[]`: `ruleId`, `level`, `message.text` |
| `location` | `locations[0].physicalLocation`: `artifactLocation.uri` with `uriBaseId: "SITE_ROOT"`, and `region.startLine` and `startColumn` when present |
| `fingerprint` | `partialFingerprints["seaworthy/v1"]` |
| `fix.summary`, `selector` | `properties.fixSummary`, `properties.selector` |
| `fix.edits` | `fixes[]` with `artifactChanges[].replacements[]` (`deletedRegion` computed from `find`, `insertedContent.text`) |
| `skipped[]` | `invocations[0].toolExecutionNotifications[]` at level `note` |

The prototype produced this mapping for all four findings, each with a unique fingerprint and one with a SARIF `fixes` entry. It was **not validated against the official SARIF schema**; `verify.sarif` must add that validation as a test.

## Consequences

- **Findings point at built output, and agents edit source.** This is the largest open risk. `fix.appliesTo: "built-output"` says so explicitly, and `fix.summary` must read correctly as advice for source files. For SARIF, GitHub code scanning can only annotate files in the repository, and `dist/` usually is not tracked, so alerts appear in the Security tab but not inline on a pull request. A new task, `int.source-map`, maps findings back to source files where the generator exposes it (permalinks, front matter, source maps); until then the agent does the translation.
- **The model is cheap for static checks and costly for rendered ones.** Static checks cost one parse per page, shared. A rendered finding has no exact line, so its line is best-effort and marked `approximateLine`; the selector and snippet are the reliable locators.
- **Public contracts to freeze.** Check IDs, the finding shape, the fingerprint recipe, and the report layout become versioned contracts at `release.contract-freeze`. The fingerprint recipe is the one most costly to change, because it invalidates every user's baseline.
- **Tasks this unblocks:** `verify.report-schema` (JSON Schema from the types above), `verify.check-api`, `verify.html-parse` (the site graph), `verify.sarif`, `verify.baseline`.
- **Not decided here:** parallelism limits, how config overrides severity per path, and the exact `skipped` and `errors` shapes beyond the samples. They belong to `verify.check-api` and `verify.report-schema`.

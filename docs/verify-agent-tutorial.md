# Tutorial: an agent builds a site, verifies it, and fixes it

A start-to-finish walkthrough of one loop: an agent writes a small static site,
runs Seaworthy against the built output, reads the report, applies the fix hints
at the source, and re-verifies until clean. Every command and every line of
output below is real — taken from a run against a scratch folder on a pre-alpha
build. This is the narrative version of the loop the [agent
loop](agent-loop.md) specifies and the [verify-from-agent
playbook](verify-from-agent-playbook.md) helps you route (MCP vs. Skill vs.
CLI); here we just drive the CLI from a shell.

Prerequisites: Node.js 22+. Seaworthy is pre-alpha and not on npm; this run
uses a built checkout and invokes `node packages/verify/dist/src/cli.js`
directly (the [playbook's install section](verify-from-agent-playbook.md#install-pre-alpha-honesty)
covers the alternatives). In the transcript, `$ CLI` stands for that command
and the working directory is the site folder.

## Step 1 — the agent builds a tiny site

No framework, no install: the "build" is the agent writing HTML into `dist/`.
Here is the page it ships — a one-page kayak site:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kestrel Kayaks</title>
<meta name="description" content="Kestrel Kayaks builds small, sea-ready kayaks in Bergen.">
<link rel="canonical" href="https://kestrel.example/">
</head>
<body>
<header><a href="#main">Skip to content</a><h1>Kestrel Kayaks</h1></header>
<main id="main">
<h2>Built for the fjords</h2>
<p>Every hull is hand-laid and tested off Bergen before it ships.</p>
<img src="kayak.jpg">
<h2>Models</h2>
<h4>FdF</h4>
<p>A fold-down kayak for train and sea.</p>
<h2>Contact</h2>
<p>Email <a href="mailto:hello@kestrel.example">hello@kestrel.example</a> or visit us at <a href="dock.html">the dock</a>.</p>
</main>
<footer><p>&copy; Kestrel Kayaks</p></footer>
</body>
</html>
```

It looks fine to the agent. It is not fine.

## Step 2 — verify

`verify` with no folder takes the first existing of `dist`, `build`, `out`,
`public`, `_site`, `site`; `--format llm` is the compact agent-readable
reading. Exit codes: `0` clean, `1` findings at or above the failing severity
(default `error`), `2` usage error, `4` engine crash.

```console
$ cd /tmp/agent-site-demo
$ CLI verify --format llm; echo "exit=$?"
seaworthy llm dist: 10 findings in 3 files (4 errors, 3 warnings, 3 notes), 1 page, 88 checks
index.html
  Set lang on <html> to the language of the page, such as lang="en". Screen readers choose their voice and pronunciation from it. | meta.lang error | index.html:2:1 | The <html> element has no lang attribute.
  Add alt text that describes what the image shows, or alt="" if it is purely decorative. Without the attribute, screen readers read out the file name. | images.alt error | index.html:15:1 | <img src="kayak.jpg"> has no alt attribute.
  Add /kayak.jpg to the build, or point src at a file that exists. | assets.missing error | index.html:15:6 | <img> loads kayak.jpg, which is not in the built site.
  Point the link at an existing page, or add the missing page. | links.internal error | index.html:20:93 | Link to dock.html points to a page that does not exist in the built site.
  …
```

(Shown here: the four errors from `index.html`; the run also reported
`quality.not-found-page` (warning), `images.dimensions` and `headings.order`
(warnings), `social.open-graph`, `social.twitter-card` and `readability.llms-txt`
(notes), plus `skipped …` lines for the rendered and network checks, which are
off by default. The full first report is in `report-original.json`, step 3.)

`exit=1`. The default gate is `--fail-on error`; all four errors are real bugs
the agent wrote: no `lang`, no `alt`, an image and a page that were never
built.

## Step 3 — read the report as JSON

For the machine-readable contract, `--format json --out` writes a versioned
report. Each finding carries its check ID, severity, location, and a `fix`
hint the agent can act on directly:

```console
$ CLI verify --format json --out report-original.json; echo "exit=$?"
seaworthy: 10 findings …; json report written to report-original.json
exit=1
```

(`…` marks the abbreviated severity counts in `--out`'s one-line summary.)

```json
{
  "checkId": "assets.missing",
  "severity": "error",
  "message": "<img> loads kayak.jpg, which is not in the built site.",
  "location": { "file": "index.html", "line": 15, "column": 6 },
  "fix": {
    "kind": "manual",
    "summary": "Add /kayak.jpg to the build, or point src at a file that exists.",
    "edits": [],
    "appliesTo": "built-output"
  },
  "fingerprint": "67e803be6374d321"
}
```

(One finding from `report-original.json`, pretty-printed; the top level has
`spec`, `summary`, `checks`, `findings`, `skipped`.) The loop rule from
[agent-loop.md](agent-loop.md): fix at the source, not in the built folder —
here the scratch `dist/` *is* the source, so the agent edits it directly; with
a generator, it would edit templates and rebuild.

## Step 4 — apply the fix hints

One editing pass, hint by hint:

| Finding | Fix the agent applied |
| --- | --- |
| `meta.lang` error | `<html>` → `<html lang="en">` |
| `images.alt` error | `alt="A red Kestrel kayak on the water off a Bergen quay"` |
| `images.dimensions` warning | `width="1200" height="600"` on the same `<img>` |
| `assets.missing` error | built a real `dist/kayak.jpg` (a 1×1 placeholder — see step 5) |
| `links.internal` error | wrote the promised `dist/dock.html` |
| `headings.order` warning | the skipped-level `<h4>FdF</h4>` → `<h3>` |
| `quality.not-found-page` warning | wrote `dist/404.html` linking home |
| `social.open-graph`, `social.twitter-card` notes | added `og:*` and `twitter:*` tags with an absolute image URL |
| `readability.llms-txt` note | added `dist/llms.txt` per llmstxt.org |

## Step 5 — re-verify: the placeholder gets caught

```console
$ CLI verify --format llm 2>&1 | grep -v '^skipped'; echo "exit=$?"
seaworthy llm dist: 6 findings in 3 files (6 warnings), 3 pages, 88 checks
index.html
  Use an image at least 600×315; 1200×630 is the recommended size. … | social.image-size warning | index.html:11:27 | og:image is 1×1, smaller than the 600×315 minimum for a large link preview.
  …
readability: 100/100 (2 of 2 applicable checks clean)
exit=0
```

The errors are gone (so `exit=0` at the default gate), and the readability
score went 50 → 100. But nine findings became six warnings of one kind: the
engine read the actual pixels of the placeholder and says `og:image is 1×1`.
Checks see built output, and they check it — the agent's fix was accepted, its
quality was not. The fix hint says what size to use:

```console
$ sips -z 630 1200 dist/kayak.jpg          # a real site ships a real photo; this scratch build resamples
```

## Step 6 — clean, at the strictest offline gate

```console
$ CLI verify --fail-on note --format llm 2>&1 | grep -v '^skipped'; echo "exit=$?"
seaworthy llm dist: 0 findings in 0 files, 3 pages, 88 checks
readability: 100/100 (2 of 2 applicable checks clean)
exit=0
$ CLI verify --fail-on note --format json --out report-final.json; echo "exit=$?"
seaworthy: no findings; json report written to report-final.json
exit=0
```

`--fail-on note` exits 1 on *any* finding, so this is as clean as an offline
run can be. The whole loop the agent ran was six commands: build, verify, read
the report, fix, re-verify, gate. To keep it that way, put
`verify --fail-on error --format json --out …` plus the exit code into CI —
or run `seaworthy init`, which writes the config, an empty baseline, and a CI
workflow in one step.

## What this did not cover

- **Rendered and network checks** — the `skipped …` lines mean checks like
  `a11y.axe`, the `layout.*` family, and `links.external` were off; opt in
  with `--rendered` (needs Chrome/Chromium/Edge) and `--network`.
- **MCP and Skills** — this tutorial drove the CLI from a shell; when to use
  `verify_site`/`fix_preview` or the shipped skills instead is the
  [verify-from-agent playbook](verify-from-agent-playbook.md).
- **Adopting an existing site** — starting from a thousand findings needs a
  baseline, not a rewrite; see the [adoption playbook](adoption-playbook.md)
  (`--fail-on none`, `--update-baseline`, `--new-only`).
- **Configuration** — `seaworthy.config.json`, ignore rules, and `basePath`
  are in the [configuration docs](configuration.md).
- **Incremental re-verify** — `--changed`, `--watch`, `diff`, and `history`
  are specified in [agent-loop.md](agent-loop.md).

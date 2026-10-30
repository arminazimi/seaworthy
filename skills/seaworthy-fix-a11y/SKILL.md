---
name: seaworthy-fix-a11y
description: Fix Seaworthy accessibility findings well - real alt text, visible labels, honest ARIA - instead of silencing them with aria-hidden, role="presentation", empty alt, or placeholder labels. Use when a verify run reports images.alt, names.*, a11y.*, or headings.* findings and the fix must actually help a screen reader user, when a fix "makes the finding go away" without changing what a person experiences, or when the user asks to "fix the accessibility issues". Running the loop is the seaworthy-verify skill's job; this is the fix-quality layer that says what a good fix is per finding.
---

# Fix accessibility findings well, do not launder them

One fact up front, read out of the check source: Seaworthy's accessibility checks verify **presence** - an `alt` attribute exists, a control has some name, a heading has some text, an ARIA reference resolves. No check can read your page and know whether that name is *true*. Every finding therefore has a variant of "fix" that turns the report green and leaves the user exactly as blocked as before. This skill is what each of those looks like, which fixes are legitimate, and how to tell them apart.

The loop itself - build, `verify --format llm`, `--changed`, `--watch`, exit codes - is the `seaworthy-verify` skill's job; parking existing debt and CI is `seaworthy-adopt`'s. Neither is run here.

## The test that decides every case

Ask: **does a person using a screen reader, keyboard, or voice control get more out of this page than before?**

- Yes - it is a real fix, even when it adds an attribute like `aria-hidden`.
- No, it only removed what the checker (or assistive technology) sees - you laundered the finding. The user is still blocked, and the report now says nothing about it.

The same attribute can be either, and no static checker can tell you which:

```html
<img src="/divider.png" alt="">            <!-- legitimate: decoration -->
<img src="/chart.png" alt="">              <!-- laundering: the finding is gone, the data is too -->
<button aria-label="Save draft">💾</button> <!-- legitimate: real name on an icon-only control -->
<button aria-label="x">💾</button>          <!-- laundering: presence satisfied, meaning zero -->
```

## What each check actually reports, and its laundering path

All of this is what the checks on this base do - nothing is implied beyond it.

### `images.alt` - fires only on a *missing* `alt` attribute

Any `alt` clears it, including `alt=""` and `alt="x"`; and an `<img>` carrying `role="presentation"`, `role="none"`, `aria-hidden="true"`, or a non-empty `aria-label`/`aria-labelledby` is exempted by design (the check assumes you meant a screen reader to skip it). The report's offered edit inserts `alt="<describe the image>"` and is flagged as needing input.

- **Legitimate:** `alt=""` on genuinely decorative images - patterns, dividers, spacers - and on images whose information is already in adjacent text. Real text on informative ones: say what the image *conveys in context* ("Signups doubled between March and June"), not "image of a chart".
- **Laundering:** emptying or hiding an informative image; shipping the `<describe the image>` placeholder. No default run - and no `--rendered` run either, see below - can catch any of these. You are the only judge of informative-vs-decorative.

### `names.label`, `names.button`, `names.link` - any non-empty name counts

A field passes with a `<label for>` matching its `id`, a wrapping `<label>`, `aria-label`, `title`, or `aria-labelledby` pointing at an id that exists; a button or link also passes on contained text, an image inside with non-empty `alt`, or an SVG `<title>`. None of it judges the name's meaning. The offered edit inserts `aria-label="<describe it>"` - also needs-input.

- **Legitimate:** a visible `<label for>` for every field (voice control needs the visible text to match the name); `aria-label` on genuinely icon-only controls; link names that say where the link goes, not "click here".
- **Laundering:** `aria-label="."` or `"button"`; an empty `<label></label>` wrapped around a field (it passes the presence test); a `title="x"` stapled on. One sub-case is guarded: `aria-labelledby` pointing at a **missing id** is reported by `a11y.aria-references` - the dangling reference is not a free pass.

### `a11y.empty-headings` and `headings.h1`

`a11y.empty-headings` (warning) skips any heading - or ancestor - carrying `aria-hidden="true"` or `hidden`, and accepts a non-empty `aria-label`/`aria-labelledby` as "content". `headings.h1` counts only visible `h1`s, so hidden/`aria-hidden` ones drop out of the count.

- **Legitimate:** write the heading (or delete the element and use CSS margin for the spacing you wanted from it).
- **Laundering:** `aria-hidden="true"` on the empty heading or `aria-label="."`. On `headings.h1`: aria-hiding a duplicate `h1` silences the report, but an `h1` hidden from assistive technology is no longer the page title - fix the template that emits two.

### `a11y.hidden-focusable` - the one check that pushes back on `aria-hidden`

This is the only a11y check that catches an `aria-hidden` abuse: an `aria-hidden="true"` element that is, or contains, something keyboard-reachable (link with `href`, enabled button, input other than `type=hidden`, select, textarea, `summary`, `contenteditable`, `tabindex` >= 0). It is the exception that proves the rule: for *static* content - paragraphs, headings, images, iframes, video - there is nothing focusable, so hiding it with `aria-hidden` slips past every check.

- **Legitimate fixes, exactly as the finding documents:** remove `aria-hidden` when the content should be used; or make it unreachable for everyone with `hidden`/`inert` (or CSS `display:none`/`visibility:hidden`), or `tabindex="-1"` on the focusables - the check accepts that because keyboard users no longer land there. Hiding honestly is not laundering; the user and the report agree on what is gone.
- **Not a fix:** `role="presentation"` does not stop focus and does not help here; nor does moving the region's link into a different page.

### `a11y.iframe-title` and `a11y.media-captions`

An iframe needs a non-empty `title`, `aria-label`, or `aria-labelledby` pointing at an element with text; the check skips frames that are hidden, `aria-hidden`, or `role="presentation"`/`none`. A visible `<video>` with sound needs a `<track kind="captions|subtitles" src>`; media inside `aria-hidden` or `hidden` is skipped, and a `muted` video is skipped (silence has nothing to caption).

- **Legitimate:** a `title` that names the embedded content ("Office location map"); a real WebVTT file; `muted` (with `loop`/`playsinline`) on a genuinely silent background loop.
- **Laundering:** `aria-hidden` or `role="presentation"` on an embed or video the sighted user still sees - you told the checker, and assistive technology, that content your visitors are looking at does not exist. Neither check judges caption or title quality; write them for the person who needs them.

## What Seaworthy cannot see - never claim it can

- No a11y check reads meaning: a green report after your fixes proves *names exist and are well-formed*, not that they are true.
- `a11y.axe` runs only under `--rendered` (offline default; every run lists the checks it skipped). And even there, the rules overlapping the static checks - image alt, button/link names, ARIA attributes, heading order, `<html lang>` - are disabled so one problem stays one finding. **A laundered alt or name is therefore green under `--rendered` too.** What the rendered run adds is what static parsing cannot know: computed color contrast and target size, at phone/tablet/desktop widths.
- Never write in a PR, commit message, or report that the site "passed accessibility" because the findings cleared. State what cleared, and that name quality was reviewed by you, not the tool.

## Using the fix machinery honestly

- `seaworthy fix --dry-run` deliberately refuses every needs-input edit - placeholders like `<describe the image>` and `aria-label="<describe it>"` are listed on stderr as `needs input: the edit inserts content only a person can supply`. The tool will not fake a name for you; do not do it on the tool's behalf. Safe edits (rename a misspelled `aria-lable`, set `tabindex="0"`, fix value case) *are* offered as exact edits - apply them.
- Audit before declaring done, on the rebuilt output:
  ```bash
  grep -rE "describe the image|<describe it>" dist            # placeholders you pasted instead of wrote
  git diff -- dist | grep -E 'aria-hidden|role="(presentation|none)"' # each one: which user was told to stop looking?
  ```
  For every hit, answer for the finding it silenced: was the content really decorative / really unreachable? If not, undo and fix for real.
- Then re-verify the full way (`seaworthy verify --format llm --changed`, or no `--changed` before shipping) - and do the presence check the machine cannot: open the page's accessibility inspector and read the **list of links** and **list of headings** the way a screen reader user hears them. A column of "link, link, link" or a blank heading entry means the finding is green and unfixed.
- If a finding genuinely does not apply to your site, record the disagreement where a human can review and shrink it - the baseline (`--update-baseline`, per `seaworthy-adopt`) - not in markup tricks that hide it from users too.

## Rules of the road

- Fix the source that generates the HTML (template, front matter, component), rebuild, re-verify - the built file is evidence, not the edit surface.
- Prefer the fix that adds *content* (alt text, a visible label, a heading) over the fix that adds an *attribute* (`aria-*`, `role`, `hidden`) - when both clear the finding, only one helps the user.
- One honest fix per finding beats one clever fix per check ID: the point of the stable ID is `docs/checks/<id>.md` - it states exactly what the check does and does not see; read it before choosing.
- `aria-hidden="true"` deserves a default ban in your fixes: it is legitimate only for decoration the sighted user also does not interact with, or for regions you make unreachable for everyone (see `a11y.hidden-focusable` above). If you cannot say which user it *helps*, do not add it.

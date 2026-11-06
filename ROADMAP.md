# Roadmap: v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17)

> **Seaworthy** · *Right-to-left and multilingual websites, verified.*
>
> One command checks any built site or live URL for the mistakes that break Persian, Arabic, Hebrew, and Urdu pages, and returns a
> report where every finding has a stable ID, an exact location, and a fix an agent can apply.

This file is the source of truth for planned work. `planning/roadmap/build.mjs` turns it and `planning/roadmap/briefs/` into GitHub issues;
`planning/roadmap/apply.mjs` syncs them. Each task is one issue and one pull request.

## Direction

Decided on 2026-11-06 (ADR 0014 records it):

1. **RTL and multilingual quality is the product.** No maintained open-source tool tests right-to-left websites in CI; agent-readiness
   checking is crowded. Seaworthy's engine, report, MCP server, and Action are reused as they are.
2. **The default profile is `rtl`.** Existing checks stay available with `--profile all`; `readability.*` is frozen.
3. **Languages first:** Persian, Arabic, Hebrew, and Urdu.
4. **Trust over volume:** every check has a clean fixture in each language and a false-positive budget measured on real pages.

## Milestones

| Milestone | Dates | Focus | Release |
|---|---|---|---|
| v0.1.0 | 2026-11-09 → 2027-01-17 | RTL and multilingual quality | **0.1.0** |

The milestone closes when every epic's exit criteria are met, not on its date.

## Labels

`roadmap`, `type: epic` or `type: task` plus a kind (`type: check`, `type: fixture`, …), `lane:` (`strong-agent`, `free-agent`,
`maintainer`), `size:` (`XS` under an hour, `S` a few hours, `M` about a day), `priority:` (`P0` critical path to `P3` nice to have),
and `area:`. `status: ready` marks a task whose dependencies are all closed.

## Order, waves, and working twenty at a time

Every task issue shows its **Priority**, its **Wave** (1 + the deepest wave among its dependencies; wave 1 can start on day one), and its
**Order** (its place in one execution order, 1 to 103: dependencies first, then priority, then position in this file).

Rules that let up to 20 tasks run at once and merge in any order:

1. **One module per check.** A check is a new file in `packages/verify/src/checks/` plus its own test, docs page, and fixture folder.
2. **No committed registry.** After `foundation.registry-build`, the check registry is generated during the build.
3. **Shared helpers first.** Script detection, RTL scope, the CSS model, the isolation fix, and the logical-CSS rewrite live in
   `packages/verify/src/rtl/` and are built before the checks that use them.
4. **Fixtures are read-only** except the one a task creates.
5. **Each brief lists the files it may create or edit.** Two tasks that edit the same file are chained by a dependency; the build warns
   about any pair that is not.
6. **Limits:** at most 20 tasks in progress, at most 5 per epic. Take the ready task with the lowest Order number first.

---

# v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17)

## Epic: Foundations for the RTL focus
<!-- seaworthy-roadmap-key: E-foundation -->
> **Epic** · **Phase:** v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17) · **Priority:** P0

### Outcome
The decision to focus Seaworthy on right-to-left and multilingual quality is written down, check IDs have one taxonomy, adding a check no longer touches a shared file, and every RTL check shares one script detector, one RTL scope resolver, one CSS model, and one clean fixture per language. After this epic, up to 20 check tasks can run at once.

### Scope
- Two ADRs
- Build-time registry
- Shared modules in `packages/verify/src/rtl/`
- Clean fixtures for Persian, Arabic, Hebrew, and Urdu
- The `rtl` profile

### Non-goals
- Any new check

### Tasks
| Key | Task | Lane | Size | Priority | Depends |
|---|---|---|---|---|---|
| `adr.rtl-focus` | ADR 0014: Seaworthy checks right-to-left and multilingual quality | strong-agent | S | P0 | none |
| `adr.rtl-ids` | ADR 0015: check ID taxonomy, severities, and language scope for RTL checks | strong-agent | S | P0 | none |
| `foundation.registry-build` | Generate the check and format registries at build time, not in git | strong-agent | M | P0 | none |
| `foundation.script-detect` | Shared text module: scripts, language guess, and text runs with positions | strong-agent | M | P0 | none |
| `foundation.rtl-scope` | RTL scope: which pages and elements are right-to-left | strong-agent | S | P0 | `foundation.script-detect` |
| `foundation.css-model` | Shared CSS model with positions for the stylesheets a page uses | strong-agent | M | P0 | none |
| `foundation.fixtures` | Clean fixtures in Persian, Arabic, Hebrew, and Urdu | strong-agent | M | P0 | none |
| `foundation.profile` | Profiles: `rtl` by default, `all` for everything | strong-agent | S | P0 | none |
| `foundation.name` | Decide the product name and npm package | maintainer | S | P1 | `adr.rtl-focus` |

### Exit criteria
- [ ] ADR 0014 (RTL focus) and ADR 0015 (check taxonomy) are accepted.
- [ ] `packages/verify/src/checks/registry.ts` is generated during `npm run build` and not committed; two pull requests that each add a check merge with no conflict.
- [ ] `packages/verify/src/rtl/` exports script detection, language guessing, RTL scope, and the CSS model, each with tests above 90% line coverage.
- [ ] `fixtures/clean/rtl-fa`, `rtl-ar`, `rtl-he`, and `rtl-ur` exist, are correct by hand review from a native reader, and every built-in check reports nothing on them.
- [ ] `seaworthy verify` runs the `rtl` profile by default; `--profile all` runs every check.

---

## Epic: Document and element direction
<!-- seaworthy-roadmap-key: E-direction -->
> **Epic** · **Phase:** v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17) · **Priority:** P0

### Outcome
Seaworthy finds every place where a page or element has the wrong direction or language: RTL pages without `dir`, mismatched `lang` and `dir`, RTL text with no language, form fields that type the wrong way, code shown backwards, and locale metadata that says LTR.

### Scope
- Checks `rtl.dir.*`, split from the old `rtl.bidi` plus new ones

### Non-goals
- Text inside a correctly marked element (E-bidi)

### Tasks
| Key | Task | Lane | Size | Priority | Depends |
|---|---|---|---|---|---|
| `dir.split` | Split `rtl.bidi` into `rtl.dir.missing`, `rtl.bidi.mixed-text`, and `rtl.css.physical-property` | strong-agent | M | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `foundation.css-model` |
| `dir.lang-mismatch` | rtl.dir.lang-mismatch: `lang` and `dir` disagree | free-agent | S | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `dir.content-mismatch` | rtl.dir.content-mismatch: page text is RTL but the page says LTR | strong-agent | S | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `dir.lang-fragment` | rtl.dir.lang-fragment: RTL text without its own language | strong-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `dir.inputs` | rtl.dir.inputs: text fields that do not follow what the user types | free-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `dir.ltr-fields` | rtl.dir.ltr-fields: email, URL, phone, and number fields shown right-to-left | free-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `dir.css-direction` | rtl.dir.css-direction: direction set only in CSS | strong-agent | S | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `dir.code-blocks` | rtl.dir.code-blocks: code shown right-to-left | free-agent | S | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `dir.locale-meta` | rtl.dir.locale-meta: locale metadata does not match an RTL page | free-agent | S | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `dir.svg-text` | rtl.dir.svg-text: SVG text without direction | free-agent | XS | P3 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |

### Exit criteria
- [ ] Every `rtl.dir.*` check in this epic is built, documented, and passes its broken fixture and every clean fixture.
- [ ] The old `rtl.bidi` ID still works as a deprecated alias and prints which new IDs replace it.
- [ ] On the four clean RTL fixtures the epic's checks report nothing.

---

## Epic: Bidirectional text
<!-- seaworthy-roadmap-key: E-bidi -->
> **Epic** · **Phase:** v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17) · **Priority:** P0

### Outcome
Seaworthy finds mixed-direction text that displays in the wrong order inside right-to-left content: numbers, URLs, emails, inline code, trailing punctuation, brackets, attribute text, and broken or dangerous bidi control characters, and offers a safe isolation fix.

### Scope
- Checks `rtl.bidi.*`
- A shared isolation fix used by the checks

### Non-goals
- Direction of whole elements (E-direction)

### Tasks
| Key | Task | Lane | Size | Priority | Depends |
|---|---|---|---|---|---|
| `bidi.isolate-fix` | Shared fix: isolate a text run in its own direction | strong-agent | S | P0 | `foundation.script-detect` |
| `bidi.numbers` | rtl.bidi.numbers: numbers that change order next to RTL text | strong-agent | S | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `bidi.isolate-fix` |
| `bidi.urls` | rtl.bidi.urls: URLs, emails, and paths that display scrambled | free-agent | S | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `bidi.isolate-fix` |
| `bidi.inline-code` | rtl.bidi.inline-code: inline code, keys, and commands inside RTL text | free-agent | S | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `bidi.isolate-fix` |
| `bidi.trailing-punct` | rtl.bidi.trailing-punct: punctuation that jumps to the wrong end | strong-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `bidi.isolate-fix` |
| `bidi.brackets` | rtl.bidi.brackets: brackets that pair or mirror wrongly | strong-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `bidi.isolate-fix` |
| `bidi.controls` | rtl.bidi.controls: unbalanced bidi control characters | free-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `bidi.isolate-fix` |
| `bidi.trojan` | rtl.bidi.trojan: bidi overrides inside code (Trojan Source) | free-agent | XS | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `bidi.stray-marks` | rtl.bidi.stray-marks: redundant LRM and RLM marks | free-agent | XS | P3 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `bidi.attributes` | rtl.bidi.attributes: mixed text in alt, title, placeholder, and aria-label | strong-agent | S | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `bidi.isolate-fix` |

### Exit criteria
- [ ] Every `rtl.bidi.*` check in this epic is built, documented, and passes its broken fixture and every clean fixture.
- [ ] Each finding about an unisolated run carries an `Edit` that wraps it in `<bdi>` or `<span dir="ltr">`, produced by the shared fix.
- [ ] `rtl.bidi.trojan` is an error by default and documents CVE-2021-42574.

---

## Epic: Styles that break in right-to-left
<!-- seaworthy-roadmap-key: E-css -->
> **Epic** · **Phase:** v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17) · **Priority:** P0

### Outcome
Seaworthy finds CSS that does not mirror or does not suit Arabic-script and Hebrew text: physical values, transforms, background positions, asymmetric shorthands, radii, letter spacing and Latin-only styles on joined scripts, missing fonts for the page's script, and line heights that clip marks, and offers safe rewrites to logical CSS.

### Scope
- Checks `rtl.css.*` on the stylesheets RTL pages use
- A logical-CSS rewrite used by the checks

### Non-goals
- Rendered checks (E-rendered)

### Tasks
| Key | Task | Lane | Size | Priority | Depends |
|---|---|---|---|---|---|
| `css.logical-fix` | Shared rewrite: physical CSS to logical CSS | strong-agent | S | P0 | `foundation.css-model` |
| `css.physical-values` | rtl.css.physical-values: `left` and `right` keywords | free-agent | S | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `foundation.css-model`, `css.logical-fix` |
| `css.transforms` | rtl.css.transforms: transforms that do not mirror | strong-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `foundation.css-model`, `css.logical-fix` |
| `css.background-position` | rtl.css.background-position: backgrounds placed on a physical side | free-agent | XS | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `foundation.css-model`, `css.logical-fix` |
| `css.shorthands` | rtl.css.shorthands: four-value shorthands with different sides | free-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `foundation.css-model`, `css.logical-fix` |
| `css.border-radius` | rtl.css.border-radius: radii on one physical corner | free-agent | XS | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `foundation.css-model`, `css.logical-fix` |
| `css.letter-spacing` | rtl.css.letter-spacing: letter spacing on joined scripts | strong-agent | S | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `foundation.css-model`, `css.logical-fix` |
| `css.latin-styles` | rtl.css.latin-styles: italic, uppercase, and small caps on RTL scripts | free-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `foundation.css-model`, `css.logical-fix` |
| `css.font-coverage` | rtl.css.font-coverage: no font in the stack covers the page's script | strong-agent | S | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `foundation.css-model`, `css.logical-fix` |
| `css.line-height` | rtl.css.line-height: line height too tight for Arabic-script marks | free-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `foundation.css-model`, `css.logical-fix` |

### Exit criteria
- [ ] Every `rtl.css.*` check in this epic is built, documented, and passes its broken fixture and every clean fixture.
- [ ] Where a logical equivalent exists, the finding carries an `Edit` produced by the shared rewrite, and applying all edits to the broken fixtures makes the checks pass.
- [ ] A stylesheet shared by 500 pages is parsed and reported once (tested for time).

---

## Epic: Persian typography
<!-- seaworthy-roadmap-key: E-persian -->
> **Epic** · **Phase:** v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17) · **Priority:** P1

### Outcome
Seaworthy checks Persian text the way a careful Persian editor would: Arabic letters in place of Persian ones, missing and misused ZWNJ, digits from the wrong script, Latin punctuation and quotes, spacing around punctuation, and kashida, with safe automatic fixes for the unambiguous cases.

### Scope
- Checks `rtl.fa.*` on text the language guesser or `lang` marks as Persian

### Non-goals
- Spelling and grammar

### Tasks
| Key | Task | Lane | Size | Priority | Depends |
|---|---|---|---|---|---|
| `fa.arabic-letters` | rtl.fa.arabic-letters: Arabic ي and ك in Persian text | free-agent | S | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `fa.zwnj-missing` | rtl.fa.zwnj-missing: missing half-space (ZWNJ) | strong-agent | S | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `fa.zwnj-misuse` | rtl.fa.zwnj-misuse: ZWNJ in the wrong place | free-agent | XS | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `fa.digits` | rtl.fa.digits: Arabic-Indic digits in Persian text | free-agent | XS | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `fa.mixed-digits` | rtl.fa.mixed-digits: one number written in two digit scripts | free-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `fa.punctuation` | rtl.fa.punctuation: Latin comma, semicolon, and question mark | free-agent | XS | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `fa.quotes` | rtl.fa.quotes: English quotes in Persian text | free-agent | XS | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `fa.spacing` | rtl.fa.spacing: spaces around punctuation | free-agent | S | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `fa.kashida` | rtl.fa.kashida: kashida (ـ) used for stretching | free-agent | XS | P3 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `fa.fix-pack` | Safe automatic fixes for Persian text | strong-agent | S | P2 | `fa.arabic-letters`, `fa.digits`, `fa.zwnj-misuse`, `fa.punctuation` |
| `fa.corpus` | Measure false positives on 50 real Persian pages | maintainer | M | P2 | `fa.zwnj-missing`, `fa.mixed-digits`, `fa.spacing` |

### Exit criteria
- [ ] Every `rtl.fa.*` check in this epic is built, documented in Persian and English, and passes its broken fixture and every clean fixture.
- [ ] On a corpus of 50 real Persian pages (listed in the pull request of `fa.corpus`), each check's false-positive rate is under 2%, reviewed by a Persian reader.
- [ ] The fix pack rewrites letters and digits without changing any URL, code, or attribute value (tested).

---

## Epic: Arabic, Hebrew, and Urdu typography
<!-- seaworthy-roadmap-key: E-arabic-hebrew-urdu -->
> **Epic** · **Phase:** v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17) · **Priority:** P2

### Outcome
The most common typography errors in Arabic, Hebrew, and Urdu are caught: tatweel, inconsistent digits, Latin punctuation, Persian letters in Arabic, Hebrew quotation and hyphen marks, and Urdu letter forms and fonts.

### Scope
- Checks `rtl.ar.*`, `rtl.he.*`, `rtl.ur.*`

### Non-goals
- Spelling, grammar, and diacritics correctness

### Tasks
| Key | Task | Lane | Size | Priority | Depends |
|---|---|---|---|---|---|
| `ar.tatweel` | rtl.ar.tatweel: tatweel used for stretching | free-agent | XS | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `ar.punctuation` | rtl.ar.punctuation: Latin comma, semicolon, and question mark | free-agent | XS | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `ar.digits` | rtl.ar.digits: digit scripts mixed on one page | free-agent | S | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `ar.persian-letters` | rtl.ar.persian-letters: Persian ی and ک in Arabic text | free-agent | XS | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `he.gershayim` | rtl.he.gershayim: ASCII quotes used as gershayim and geresh | free-agent | S | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `he.maqaf` | rtl.he.maqaf: hyphen used instead of maqaf | free-agent | XS | P3 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `ur.letters` | rtl.ur.letters: Arabic letter forms in Urdu text | strong-agent | S | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `ur.nastaliq-font` | rtl.ur.nastaliq-font: Urdu without a Nastaliq-capable font | strong-agent | S | P3 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |

### Exit criteria
- [ ] Every check in this epic is built, documented, and passes its broken fixture and every clean fixture.
- [ ] A native reader of each language reviewed its checks' docs and fixtures (named in the pull requests).

---

## Epic: Rendered right-to-left checks
<!-- seaworthy-roadmap-key: E-rendered -->
> **Epic** · **Phase:** v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17) · **Priority:** P1

### Outcome
With a local Chrome, Seaworthy renders RTL pages and finds what static analysis cannot: icons pointing the wrong way, overflow and overlap that appear only in RTL, clipped diacritics, missing glyphs and wrong fallback fonts, scrollers that start at the wrong end, and layouts that do not mirror.

### Scope
- Checks `rtl.render.*` on the existing rendered-check support (ADR 0005)

### Non-goals
- Downloading a browser

### Tasks
| Key | Task | Lane | Size | Priority | Depends |
|---|---|---|---|---|---|
| `render.harness` | Rendered RTL harness: boxes, fonts, and LTR/RTL pairs | strong-agent | M | P0 | `foundation.rtl-scope` |
| `render.mirrored-icons` | rtl.render.mirrored-icons: directional icons that do not mirror | strong-agent | M | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `render.harness` |
| `render.overflow` | rtl.render.overflow: horizontal scroll that appears only in RTL | strong-agent | S | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `render.harness` |
| `render.overlap` | rtl.render.overlap: text that overlaps other elements in RTL | strong-agent | M | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `render.harness` |
| `render.clipped-marks` | rtl.render.clipped-marks: diacritics and tall glyphs clipped | strong-agent | M | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `render.harness` |
| `render.missing-glyphs` | rtl.render.missing-glyphs: characters with no glyph (tofu) | strong-agent | M | P0 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `render.harness` |
| `render.fallback-font` | rtl.render.fallback-font: RTL text rendered in an unintended fallback font | strong-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `render.harness` |
| `render.scroll-start` | rtl.render.scroll-start: carousels and scrollers that start at the wrong end | strong-agent | S | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `render.harness` |
| `render.mirror-diff` | rtl.render.mirror-diff: layout that does not mirror | strong-agent | M | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope`, `render.harness` |

### Exit criteria
- [ ] Every `rtl.render.*` check in this epic is built, documented, and passes its broken fixture and every clean fixture with a local Chrome.
- [ ] Without a browser, rendered checks are skipped with one clear message and the run still passes.
- [ ] Rendered checks on the four clean fixtures finish in under 30 seconds in CI.

---

## Epic: Pseudo-RTL: find RTL bugs before translating
<!-- seaworthy-roadmap-key: E-pseudo -->
> **Epic** · **Phase:** v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17) · **Priority:** P1

### Outcome
`seaworthy pseudo-rtl` turns any LTR built site into a pseudo right-to-left copy (direction flipped, text in RTL characters, optional expansion) and runs the CSS and rendered checks on it, mapping every finding back to the original files, so teams see what will break before they pay for translation.

### Scope
- A transform, a command, finding mapping, screenshots, a fixture, and a guide

### Non-goals
- Machine translation

### Tasks
| Key | Task | Lane | Size | Priority | Depends |
|---|---|---|---|---|---|
| `pseudo.transform` | Transform a built LTR site into pseudo-RTL | strong-agent | M | P0 | `foundation.script-detect` |
| `pseudo.expand` | Text expansion option for pseudo-RTL | free-agent | S | P2 | `pseudo.transform` |
| `pseudo.cli` | `seaworthy pseudo-rtl` command | strong-agent | S | P0 | `pseudo.transform`, `foundation.profile` |
| `pseudo.map-findings` | Map pseudo-RTL findings back to the original source | strong-agent | S | P0 | `pseudo.transform` |
| `pseudo.fixture` | A real-looking LTR site that breaks under pseudo-RTL | free-agent | S | P1 | `pseudo.cli`, `pseudo.map-findings` |
| `pseudo.screenshots` | Side-by-side LTR and pseudo-RTL screenshots in the HTML report | strong-agent | S | P2 | `pseudo.cli`, `render.harness`, `report.html-rtl` |
| `pseudo.guide` | Guide: find RTL bugs before you translate | free-agent | S | P2 | `pseudo.cli` |

### Exit criteria
- [ ] `seaworthy pseudo-rtl ./dist` reports findings with locations in the original LTR source files.
- [ ] The pseudo-RTL fixture produces exactly its expected findings.
- [ ] The guide shows the full flow on a real open-source site.

---

## Epic: Multilingual checks for RTL sites
<!-- seaworthy-roadmap-key: E-i18n -->
> **Epic** · **Phase:** v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17) · **Priority:** P2

### Outcome
Seaworthy finds the multilingual mistakes RTL sites make most: whole sentences left untranslated, alt and label text in the wrong language, web fonts whose `unicode-range` misses the page's characters, and invalid language codes.

### Scope
- New `i18n.*` checks; the existing `i18n.hreflang`, `i18n.parity`, `i18n.switcher`, and `i18n.x-default` stay as they are

### Non-goals
- Translation quality

### Tasks
| Key | Task | Lane | Size | Priority | Depends |
|---|---|---|---|---|---|
| `i18n.untranslated-text` | i18n.untranslated-text: sentences left in another language | strong-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `i18n.untranslated-attributes` | i18n.untranslated-attributes: alt, labels, and titles in the wrong language | free-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `i18n.unicode-range` | i18n.unicode-range: web fonts that do not cover the page's characters | strong-agent | S | P1 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `i18n.lang-codes` | i18n.lang-codes: invalid or outdated language codes | free-agent | XS | P2 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |
| `i18n.direction-links` | i18n.direction-links: language switcher links without direction | free-agent | XS | P3 | `adr.rtl-ids`, `foundation.registry-build`, `foundation.script-detect`, `foundation.rtl-scope` |

### Exit criteria
- [ ] Every check in this epic is built, documented, and passes its broken fixture and every clean fixture.
- [ ] The `rtl` profile includes these checks and the four existing `i18n.*` checks.

---

## Epic: RTL score and reports
<!-- seaworthy-roadmap-key: E-report -->
> **Epic** · **Phase:** v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17) · **Priority:** P1

### Outcome
Every run gives an RTL score from 0 to 100 per page and per site, computed by an open, versioned rubric; reports group findings by language; the HTML report shows RTL snippets correctly; SARIF and the Markdown pull request comment carry language tags; and the prompt format tells an agent how to fix RTL issues safely.

### Scope
- The RTL score spec and its computation
- Report fields, HTML, SARIF, Markdown, and prompt output

### Non-goals
- A hosted dashboard

### Tasks
| Key | Task | Lane | Size | Priority | Depends |
|---|---|---|---|---|---|
| `report.rtl-score` | The RTL score: an open rubric and its computation | strong-agent | M | P0 | `adr.rtl-ids`, `foundation.profile` |
| `report.languages` | Group findings by detected language | strong-agent | S | P1 | `report.rtl-score` |
| `report.html-rtl` | HTML report that shows RTL text correctly | strong-agent | S | P1 | `foundation.script-detect` |
| `report.sarif-tags` | Language and script tags in SARIF | free-agent | S | P2 | `adr.rtl-ids` |
| `report.pr-comment` | Pull request comment with the RTL score and top findings per language | strong-agent | S | P1 | `report.languages` |
| `report.prompt-rtl` | Prompt format that teaches an agent to fix RTL issues safely | strong-agent | S | P2 | `bidi.isolate-fix`, `css.logical-fix` |

### Exit criteria
- [ ] `spec/rtl-score/v0.md` defines the rubric (weights per check family and severity), and the score in reports matches it (tested).
- [ ] The JSON report adds `rtlScore` and `languages` additively; the report schema is regenerated and validates every fixture's report.
- [ ] The HTML report renders Persian, Arabic, Hebrew, and Urdu snippets correctly (screenshots in the pull request).
- [ ] The Markdown pull request comment shows the score, its change from the base branch, and the top findings per language.

---

## Epic: Where people run it: CLI, live sites, CI, agents, and tests
<!-- seaworthy-roadmap-key: E-surfaces -->
> **Epic** · **Phase:** v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17) · **Priority:** P1

### Outcome
People run the RTL checks where they work: `seaworthy rtl` on a build or a live URL, the GitHub Action with the score and comment, MCP tools and an Agent Skill for coding agents, a Playwright matcher in end-to-end tests, and a Stylelint plugin for source CSS.

### Scope
- CLI command, live crawl, Action inputs, MCP tools, Skill, Playwright matcher, Stylelint plugin

### Non-goals
- Browser extensions and editor plugins

### Tasks
| Key | Task | Lane | Size | Priority | Depends |
|---|---|---|---|---|---|
| `surface.rtl-command` | `seaworthy rtl`: the RTL checks with a language summary | strong-agent | S | P0 | `foundation.profile`, `report.languages` |
| `surface.crawl` | Check a live site: crawl a URL | strong-agent | M | P1 | `foundation.profile` |
| `surface.action` | GitHub Action inputs for the RTL profile, score, and comment | strong-agent | S | P1 | `report.pr-comment` |
| `surface.mcp` | MCP tools: `rtl_check` and `pseudo_rtl` | strong-agent | S | P1 | `surface.rtl-command`, `pseudo.cli` |
| `surface.skill` | Agent Skill: fix RTL issues | strong-agent | S | P2 | `surface.mcp`, `report.prompt-rtl` |
| `surface.playwright` | Playwright matcher: `expect(page).toPassRtlChecks()` | strong-agent | M | P2 | `render.harness` |
| `surface.stylelint` | Stylelint plugin for RTL CSS rules | strong-agent | M | P2 | `css.logical-fix` |

### Exit criteria
- [ ] `npx @seaworthy/verify rtl https://example.com` checks up to 50 pages of a live site (network is opt-in and said so).
- [ ] The Action posts the score and comment on a pull request in a test repository.
- [ ] An agent using the MCP tools fixes every finding in a broken fixture with no human help (recorded run in the pull request).
- [ ] The Playwright matcher and the Stylelint plugin are published packages with tests.

---

## Epic: Docs, benchmark, and the 0.1.0 release
<!-- seaworthy-roadmap-key: E-docs-launch -->
> **Epic** · **Phase:** v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17) · **Priority:** P2

### Outcome
Seaworthy 0.1.0 is published with a README and guides in English, Persian, and Arabic, a generated rules catalog, and a public benchmark of the top Persian and Arabic websites that gives people a reason to try it.

### Scope
- README, guides, rules catalog, benchmark report, launch post, release

### Non-goals
- A hosted service

### Tasks
| Key | Task | Lane | Size | Priority | Depends |
|---|---|---|---|---|---|
| `docs.readme` | README for the RTL focus | strong-agent | S | P1 | `adr.rtl-focus`, `surface.rtl-command` |
| `docs.guide-fa` | Persian guide | free-agent | S | P2 | `docs.readme` |
| `docs.guide-ar` | Arabic guide | free-agent | S | P3 | `docs.readme` |
| `docs.rules-catalog` | Generated rules catalog by family and language | free-agent | S | P2 | `adr.rtl-ids`, `foundation.registry-build` |
| `docs.benchmark` | Benchmark: RTL quality of the top 100 Persian and Arabic websites | strong-agent | M | P2 | `surface.crawl`, `report.rtl-score` |
| `docs.launch-post` | Launch post in English and Persian | maintainer | S | P3 | `docs.benchmark` |
| `docs.release` | Release 0.1.0 | maintainer | S | P1 | `docs.readme`, `foundation.name`, `surface.action`, `surface.mcp`, `cleanup.agents-md`, `fa.corpus` |

### Exit criteria
- [ ] `@seaworthy/verify` 0.1.0 (or the name chosen in `foundation.name`) is on npm with provenance, and the GitHub release has notes.
- [ ] The README leads with the RTL use case and shows a real before and after.
- [ ] The benchmark report covers at least 100 sites and is published with its method and raw data.
- [ ] Guides exist in English, Persian, and Arabic, each reviewed by a native reader.

---

## Epic: Refocus the repository
<!-- seaworthy-roadmap-key: E-cleanup -->
> **Epic** · **Phase:** v0.1.0 — RTL and multilingual quality (2026-11-09 → 2027-01-17) · **Priority:** P2

### Outcome
The repository describes and defaults to the RTL focus: agent-readability checks are frozen and out of the default profile, Skills and contributor docs match, and old positioning ADRs are superseded.

### Scope
- Profiles, Skills, AGENTS.md, CONTRIBUTING.md, ADR index

### Non-goals
- Deleting existing checks

### Tasks
| Key | Task | Lane | Size | Priority | Depends |
|---|---|---|---|---|---|
| `cleanup.readability-freeze` | Freeze the agent-readability checks | free-agent | XS | P2 | `foundation.profile` |
| `cleanup.skills` | Update the existing Skills for the RTL focus | free-agent | S | P2 | `foundation.profile`, `surface.rtl-command` |
| `cleanup.agents-md` | AGENTS.md and CONTRIBUTING.md for the RTL focus | strong-agent | S | P1 | `foundation.registry-build`, `adr.rtl-ids` |
| `cleanup.adr-index` | Supersede the old positioning ADRs | free-agent | XS | P3 | `adr.rtl-focus` |

### Exit criteria
- [ ] `readability.*` checks are documented as frozen and not in the `rtl` profile.
- [ ] AGENTS.md and CONTRIBUTING.md describe the RTL focus, the build-time registry, and the 20-at-a-time workflow.
- [ ] The existing Skills mention the `rtl` profile.

---

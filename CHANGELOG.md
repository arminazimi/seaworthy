# Changelog

## Unreleased

### Added

- `seaworthy verify --format llm` prints a compact report sized for an agent's context window: one line per finding, grouped by file, with the fix first, then the check ID, severity, location, and a short evidence line; plain text, no color, byte-identical everywhere (#263).
- `i18n.hreflang` reports `rel="alternate" hreflang=...` entries that point at a page the built site does not serve, or whose target page declares no hreflang alternate for the declaring page's language back to it; language values match without regard to case, `x-default` entries are out of scope (the `i18n.x-default` follow-up handles them), and external hreflang URLs are skipped, never fetched (#368).
- Every output format now carries ready-to-paste fix prompts: one per finding and one for the whole report, generated from each finding's data alone (check ID, location, fix hint) so they are identical, deterministic, and free of private run state everywhere (#264).
- `quality.empty-pages` reports pages whose built HTML has no main text — an empty `<main>`, or no text outside the navigation, header, and footer — so an agent that reads it gets only the site frame (#329).
- `html.nesting` reports content models the parser accepts but browsers mishandle: interactive elements inside interactive ones, block elements inside `<p>`, and nested `<a>` or `<button>`, each at the inner element's exact location with a fix hint (#244).
- `hosting.headers` and `hosting.redirects` validate the `_headers` and `_redirects` files of Netlify and Cloudflare Pages: malformed lines, splats and placeholders the hosts cannot match, paths and destinations the built site does not serve, dead duplicate rules, and redirects that answer their own address (#325).
- `npm run check:startup` gates `seaworthy --version` at the 150 ms startup budget from ADR 0004: one warm-up, five timed runs judged on the best run, with settle-delayed retry passes (up to 15 runs) so a loaded CI runner does not flakily fail (#299).
- `html.inline-handlers` reports inline event handlers (`onclick` and every other `on*` attribute) and `javascript:` URLs in navigation and form attributes, which a strict Content Security Policy (`script-src` without `"unsafe-inline"`) blocks (#247).
- `seaworthy diff before.json after.json` compares two report files and prints one JSON object with the counts and finding lists for what is new, fixed, and unchanged (#335).
- `seaworthy config check` validates a config with the same rules `verify` applies, without running any checks, and exits 0 or 2 (#293).
- The CLI colors human output when the stream is an interactive terminal: severity tokens in the pretty report, the `seaworthy:` summary lines, and crash notices get color, `NO_COLOR` turns it off everywhere, and JSON, markdown, SARIF, and report files are never colored (#291).
- `a11y.iframe-title` reports iframes with missing or blank titles, with source locations and a manual fix hint (#232).
- `html.obsolete` reports obsolete elements and presentational attributes (`<center>`, `<font>`, `<marquee>`, `align`, `bgcolor`, and similar) with exact source locations and CSS fix hints (#245).
- `seaworthy verify --timings` prints time per stage and per check to stderr. The report is unchanged, so default output stays deterministic (#216).
- `html.charset` reports pages with no character encoding declaration, or one declared after the first 1,024 bytes, with the exact location and a fix hint (#243).
- `social.twitter-card` reports pages without a usable Twitter card type, and cards that have no image and no Open Graph fallback (#61).
- `social.image-size` reports social preview images below the platform minimum dimensions or over the 5 MB limit, reading only images inside the built site (#61).
- `html.meta-refresh` reports `<meta http-equiv="refresh">` with a delay greater than 0 seconds, which moves people before they can read (WCAG 2.2.1) (#246).
- `html.redirect-chain` follows meta-refresh redirects page by page and reports chains of redirect pages (a warning at the chain's start, naming the final destination) and loops that never land on content (an error) (#333).
- `meta.canonical-target` reports pages whose canonical link resolves, the way a static host serves it (including `basePath`), to no page in the built site (#334).
- `meta.canonical-cycle` reports pages whose canonical links point at each other in a circle of two or more, so no page in the circle has a canonical URL (#334).
- `meta.duplicate-description` groups pages whose `<meta name="description">` is the same text into one finding that names the description and every page carrying it (#328).
- `html.doctype` reports pages with no doctype, or a non-standard one that puts the browser in quirks mode (#242).
- `html.parse-errors` reports the HTML parser's own errors (stray end tags, bad nesting, duplicate attributes) at exact positions (#241).
- `quality.orphans` reports pages that no other page links to (#326).
- `meta.duplicate-titles` groups pages that share the same `<title>` into one finding (#327).
- `quality.not-found-page` reports a missing 404 page, or one that is empty or only redirects (#330).

### Fixed

- Only an immediate redirect (`content="0; url=..."`), or a refresh with a destination whose page has no readable text, now counts as a redirect stub, so content checks such as `meta.title` run on pages whose delayed `<meta http-equiv="refresh">` still shows content (#421).

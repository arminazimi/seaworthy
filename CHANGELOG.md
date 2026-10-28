# Changelog

## Unreleased

### Added

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
- `meta.duplicate-description` groups pages whose `<meta name="description">` is the same text into one finding that names the description and every page carrying it (#328).
### Fixed
- Only an immediate redirect (`content="0; url=..."`), or a refresh with a destination whose page has no readable text, now counts as a redirect stub, so content checks such as `meta.title` run on pages whose delayed `<meta http-equiv="refresh">` still shows content (#421).

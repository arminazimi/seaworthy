# Changelog

## Unreleased

### Added

- Every output format now carries ready-to-paste fix prompts: one per finding and one for the whole report, generated from each finding's data alone (check ID, location, fix hint) so they are identical, deterministic, and free of private run state everywhere (#264).
- `a11y.iframe-title` reports iframes with missing or blank titles, with source locations and a manual fix hint (#232).
- `html.obsolete` reports obsolete elements and presentational attributes (`<center>`, `<font>`, `<marquee>`, `align`, `bgcolor`, and similar) with exact source locations and CSS fix hints (#245).
- `seaworthy verify --timings` prints time per stage and per check to stderr. The report is unchanged, so default output stays deterministic (#216).
- `html.charset` reports pages with no character encoding declaration, or one declared after the first 1,024 bytes, with the exact location and a fix hint (#243).
- `social.twitter-card` reports pages without a usable Twitter card type, and cards that have no image and no Open Graph fallback (#61).
- `social.image-size` reports social preview images below the platform minimum dimensions or over the 5 MB limit, reading only images inside the built site (#61).
- `html.meta-refresh` reports `<meta http-equiv="refresh">` with a delay greater than 0 seconds, which moves people before they can read (WCAG 2.2.1) (#246).

# Changelog

## Unreleased

### Added

- `a11y.iframe-title` reports iframes with missing or blank titles, with source locations and a manual fix hint (#232).
- `html.meta-refresh` reports `<meta http-equiv="refresh">` with a delay greater than 0 seconds, which moves people before they can read (WCAG 2.2.1) (#246).

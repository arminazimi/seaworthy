# headings.h1

A page does not have exactly one `h1`.

## Why it matters

The `h1` names the page. Screen reader users jump to it to find the start of the content, and a page with none (or several) gives them no clear starting point.

## What it checks

Visible `h1` elements per page must be exactly one. Headings with `hidden` or `aria-hidden="true"` are not counted. Redirect stubs (`html.meta-refresh`) are skipped.

## How to fix

Keep one `h1` for the page title and use `h2` and below for sections. When the page has several, report points at the second one.

## Options

None.

## Standards

- [WCAG 1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)

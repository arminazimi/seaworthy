# readability.jsonld

A page's JSON-LD does not parse, does not say what it describes, or leaves out fields that consumers need.

## Why it matters

JSON-LD with the schema.org vocabulary is how a page tells search engines and AI tools, in a form they can rely on, that it is an article by a person on a date, a product with a name, or an organization with a URL. When it is wrong the consumer usually throws the whole block away without telling anyone, so the page looks fine and the markup does nothing. The commonest causes are a trailing comma, a template that prints `null` or an empty string, and a date in a human format.

## What it checks

Every `<script type="application/ld+json">` on every page:

- **Empty** (warning).
- **Does not parse** (warning), with the line and column inside the script when the engine names one.
- **No `@context`** (warning) at the top level.
- **An item without `@type`** (warning). Items are the root, array members, and `@graph` members.
- **A date that is not ISO 8601** (warning) in `datePublished`, `dateModified`, `startDate`, or `endDate`. `2026-10-18` and `2026-10-18T09:30:00Z` are accepted.
- **Recommended fields missing** (note) for the types sites commonly publish: `Article`, `NewsArticle`, `BlogPosting`, `TechArticle` (`headline`, `datePublished`, `author`), `Organization` and `WebSite` (`name`, `url`), `Person`, `Product`, `SoftwareApplication` (`name`), `BreadcrumbList` (`itemListElement`), `FAQPage` (`mainEntity`), `Event` (`name`, `startDate`, `location`), `Course`, and `HowTo`. A field that is empty, `null`, or an empty array counts as missing.

Types not listed are not judged, and the check does not validate against the full schema.org vocabulary or fetch remote contexts. The findings never reach error severity.

## How to fix

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Ship sites agents can trust",
  "datePublished": "2026-10-18",
  "author": { "@type": "Person", "name": "Ada" }
}
</script>
```

Generate the block from the same data as the page (title, date, author) so the two cannot disagree, and run it through a JSON formatter once to catch syntax slips. There is no automatic edit, because the report cannot know the values.

## Options

None.

## Standards

- [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/) (W3C Recommendation)
- [schema.org](https://schema.org/) (vocabulary)
- [Agent-readability spec](../../spec/agent-readability/v1.md)

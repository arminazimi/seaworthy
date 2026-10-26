# Specifications

Versioned contracts: the report format, check IDs, agent-readability rules, config schema, and extension API. Each changes only through the RFC process once frozen.

| Spec | Status | Where |
| --- | --- | --- |
| Report | Draft (`spec: 0`), freezes as `spec: 1` at `release.contract-freeze` | [`report/v0.schema.json`](report/v0.schema.json) |
| Config | Draft (`spec: 0`) | [`config/v0.schema.json`](config/v0.schema.json) |
| Agent readability | Draft v1 | [`agent-readability/v1.md`](agent-readability/v1.md) |

The report schema is checked by `npm test`: the engine's output is validated against it, and so is every fixture's expected report. Design background: [ADR 0006](../docs/adr/0006-check-model.md).

## Additive check IDs

- `a11y.iframe-title`: an `error` for an iframe with an absent, empty or whitespace-only `title`. See the [check contract](../docs/checks/a11y.iframe-title.md).
- `html.charset`: an `error` for a page with no character encoding declaration, or one that ends after the first 1,024 bytes. See the [check contract](../docs/checks/html.charset.md).
- `social.twitter-card`: a `note` for a page with no `twitter:card`, and a `warning` for an orphaned Twitter tag, an unknown card type, or a card with no image. See the [check contract](../docs/checks/social.twitter-card.md).
- `social.image-size`: a `warning` for a local social preview image below the platform minimum dimensions or over the 5 MB limit. See the [check contract](../docs/checks/social.image-size.md).

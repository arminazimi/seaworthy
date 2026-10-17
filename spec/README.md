# Specifications

Versioned contracts: the report format, check IDs, agent-readability rules, config schema, and extension API. Each changes only through the RFC process once frozen.

| Spec | Status | Where |
| --- | --- | --- |
| Report | Draft (`spec: 0`), freezes as `spec: 1` at `release.contract-freeze` | [`report/v0.schema.json`](report/v0.schema.json) |

The report schema is checked by `npm test`: the engine's output is validated against it, and so is every fixture's expected report. Design background: [ADR 0006](../docs/adr/0006-check-model.md).

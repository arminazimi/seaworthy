# 0001. Verify is the core product

**Status:** Accepted (2026-10-17)

## Context

The project started as an idea for a GitHub Pages theme that could outgrow popular themes. The goals that followed were: agent-native, auto-discoverable, an ecosystem standard within a year, and room to add features for years.

A theme alone fits those goals poorly. Its audience is people starting a new site with one generator, a market that is shrinking for Jekyll. Trying it means migrating a site. Themes rarely become standards. And as models improve, building a theme gets easier, so the value of a theme falls.

## Decision

The core product is `seaworthy verify`: a framework-agnostic checker for built static sites that returns a versioned, machine-readable report with locations and fix hints. It ships through a CLI, an MCP server, Agent Skills, and a GitHub Action.

The editorial, RTL-ready theme continues as a tier-2 reference implementation: a site that passes every check. It ships in a second launch wave and never blocks the first.

## Consequences

- Anyone with any static site can try Seaworthy with one command.
- The path to a standard is the report format and check registry, which other tools can emit and consume.
- As agents generate more sites, verification becomes more valuable.
- The brand leads with verification, not visuals. The theme is no longer the first thing people see.
- Two launch waves instead of one: verify in Phase 4, theme in Phase 5.

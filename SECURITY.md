# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/arminazimi/seaworthy/security/advisories/new). Do not open a public issue.

Include what you found, how to reproduce it, and the impact you expect. You will get an acknowledgement within 7 days.

## Scope

Seaworthy parses untrusted site content. These are in scope:

- Code execution, file writes, or network access triggered by a site being verified
- Path traversal outside the folder being verified
- A check pack escaping the permissions it declares
- Supply-chain issues in published packages or the GitHub Action

## Supported versions

Before 1.0, only the latest release gets security fixes.

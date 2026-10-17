## Goal
Design the check model: how static checks (HTML and file graph) and rendered checks (browser) share one API and produce one report.

## Agent brief

**Files**
- `docs/adr/NNNN-check-model.md` (new)
- `docs/adr/README.md` (add the row)

**Steps**
1. Draft the check interface: ID format (`area.name`, stable forever), metadata (title, severity, needs-browser, needs-network, docs URL), and the `run` signature.
2. Draft the finding shape: check ID, severity, file, line and column where available, CSS selector for rendered checks, message, and a `fix` object (what to change, where, example).
3. Show how one site graph (pages, links, assets) is built once and shared by all static checks.
4. Walk through three real checks on paper (internal links, image alt, axe contrast) to prove the model fits all of them.
5. Write the ADR. Include a sample JSON report with one finding from each of the three checks.

**Do not**
- Do not write production code; `verify.check-api` implements this later.
- Do not invent a new severity scale if SARIF's levels fit.

## Done when
- [ ] The ADR contains the interface, the finding shape, and a sample report.
- [ ] The sample report maps cleanly to SARIF (show the mapping).

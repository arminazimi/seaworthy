## Goal
Decide how `seaworthy` is distributed and started (Node package vs. single binary), based on measured install size and cold-start time.

## Agent brief

**Files**
- `docs/adr/NNNN-cli-runtime.md` (new)
- `docs/adr/README.md` (add the row)

**Steps**
1. Measure `npx` cold start for a minimal Node CLI with zero dependencies on macOS, Linux, and Windows (CI runners are fine). Record install size and time to first output.
2. Measure the same for one single-binary option (for example Node's single executable applications or Bun compile). Record size and start time.
3. Compare against what agents need: a first `seaworthy verify` in under 5 seconds on a warm cache, and no global install.
4. Write the ADR: options, numbers, decision, consequences. Delete any throwaway code.

**Do not**
- Do not add dependencies to `packages/verify`.
- Do not change the CLI's behavior; this is research.

## Done when
- [ ] The ADR records the measurements in a table and makes one decision.
- [ ] Spike code is deleted.

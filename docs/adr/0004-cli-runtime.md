# 0004. Ship the CLI as a Node package, not a single binary

**Status:** Accepted (2026-10-17)

## Context

Agents run `seaworthy verify` with no setup, so how the CLI is distributed and started decides the first-run experience. Two options:

1. **A Node package** run with `npx` or installed locally. Requires Node.js 22 or newer, which every Node-based static site toolchain already has.
2. **A single executable** (Node SEA, single executable application) with no Node needed on the machine.

Goal from the roadmap: a first `seaworthy verify` in under 5 seconds with no global install.

## Method

A zero-dependency CLI that prints a version or counts directory entries, built as an npm tarball and as a Node SEA (`node --build-sea`). Run on GitHub-hosted runners (`ubuntu-latest`, `macos-latest` on arm64, `windows-latest`) with Node 22 and Node 26. Each number is the median of 20 runs (startup) or 5 runs with a fresh npm cache each time (`npx` cold start). Raw logs: [run 39051619144](https://github.com/arminazimi/seaworthy/actions/runs/39051619144). The measurement script was throwaway and is not in the repository.

## Results

| OS | Node | Process startup | `npx` cold start (min / median / max) | SEA size (gzipped) | SEA startup |
| --- | --- | ---: | --- | ---: | ---: |
| Linux | 22 | 27 ms | 488 / 494 / 641 ms | n/a | n/a |
| Linux | 26 | 28 ms | 536 / 551 / 627 ms | 151 MB (49 MB) | 27 ms |
| macOS | 22 | 61 ms | 903 / 979 / 1,002 ms | n/a | n/a |
| macOS | 26 | 39 ms | 448 / 461 / 481 ms | 145 MB (45 MB) | 39 ms |
| Windows | 22 | 47 ms | 1,140 / 1,218 / 28,518 ms | n/a | n/a |
| Windows | 26 | 51 ms | 1,119 / 1,137 / 5,752 ms | 105 MB (41 MB) | 50 ms |

The npm tarball for the test CLI is 326 bytes. Node 22 has no `--build-sea`, so SEA was measured on Node 26 only; the executable embeds the Node runtime, so its size tracks the Node binary, not the CLI.

## Decision

Distribute `@seaworthy/verify` as a Node package (`engines.node: ">=22"`), run through `npx seaworthy` or a local install. Do not ship a single executable in v0.1.

- A SEA starts exactly as fast as plain Node (same runtime), so it buys no speed. It costs a 105–151 MB binary per platform (41–49 MB compressed) against a package that is a few kilobytes plus its dependencies.
- Cold `npx` costs about 0.5 to 1.2 seconds with zero dependencies, which leaves most of the 5-second budget for dependencies and the work itself.
- Agents that edit sites already have Node; a binary only helps Node-free environments, which is an unproven need.

## Consequences

- **Budget for the first run.** A cold `npx seaworthy verify` of the real package, excluding any browser download, must finish in under 3 seconds on GitHub-hosted runners; startup of an installed `seaworthy --version` must stay under 150 ms. Dependencies are chosen with this budget in mind (see the prior-art and check-model ADRs). `verify.cli` adds a CI step that fails when the budget is exceeded.
- **Windows is the slow platform.** One Windows run took 28.5 seconds on Node 22 and one 5.8 seconds on Node 26, with the other runs near 1.1 seconds. We could not tell whether this was antivirus scanning, runner variance, or `npx` itself. The budget check should record the maximum as well as the median, and we should watch for it before launch.
- **Limits of this measurement.** The CLI had no dependencies, so real installs will be slower. `npx` re-installs a `file:` tarball on every run, so these numbers say nothing about the warm-cache behavior of a registry package; that must be measured after the first publish. Registry installs also add a network fetch that the tarball test skipped.
- **Revisit** a single binary if users report environments without Node, or if cold-start cost dominates after dependencies are added. A binary can be published later as an optional per-platform package without changing the CLI contract.

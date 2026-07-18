---
tags: [testing, review, refactor]
paths: ["test/**"]
strength: 1
source: "PR#74 (issue #5)"
graduated: false
created: 2026-07-18
---

When a test's job is to prove 'we exercised every X' (every CLI subcommand, every route, every schema field), check where the list of X's comes from. If both the actual set and the expected set are built by mapping over the SAME hardcoded/hand-authored list, the coverage assertion is tautological — it can only compare the list against itself, never detect the live system has an X not on the list. This is invisible from green output or a thorough-looking diff; the flaw is structural, not visible from results. On any refactor/split PR whose test strategy is 'snapshot every X and assert full coverage', trace the expected-list's provenance back to its source, and prefer deriving it from the live object model (introspection over the real system) rather than a hand-maintained list or parsed text output. Caught in PR #74 (fab-cli's cli.ts split): a hand-authored CLI_COMMAND_PATHS array fed both the 'actual' collector and the fixture it was compared against.
Related: [[verify-repo-pollution-claims-empirically]]

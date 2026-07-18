---
tags: [testing, bash, vitest, shims]
paths: ["test/**", "scripts/**"]
strength: 1
source: "PR#89 (TAL-001) test harness"
graduated: false
created: 2026-07-18
---

Testing a bash script from vitest: symlink the REAL script into a temp sandbox at the same relative path ($0-relative cd resolves to sandbox root); prepend fake `git`/`gh` bash shims on PATH that log `"<cmd> $*"` to an invocation log (gives call-order assertions for free) and persist cross-process state in key=value files per repo dir; mirror only the real-tool semantics the script's correctness depends on and say so in a comment; make retry sleeps env-overridable in the script (e.g. TALISHAR_BOOTSTRAP_RETRY_SLEEP=0) instead of mocking sleep.

Related: [[git-remote-repair-set-url-or-add]] [[macos-missing-binary-tests-need-empty-path]]

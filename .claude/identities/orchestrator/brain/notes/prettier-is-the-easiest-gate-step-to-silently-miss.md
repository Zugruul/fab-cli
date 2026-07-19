---
tags: [gate, prettier, verification]
paths: ["**"]
strength: 1
source: "session lessons.jsonl — 2 of 2 recorded gate failures this session were prettier-only"
graduated: false
created: 2026-07-18
---

Across this session's lessons.jsonl gate-failure log, both recorded failures were prettier-only (test/rules-ask.test.ts, test/fabtcg-live-cli.test.ts) — not typecheck/lint/test failures — surfacing only on the ORCHESTRATOR's own gate re-run after a dev agent had already reported 'gate green'. A dev agent's self-reported gate pass can specifically miss the prettier step's own formatting drift (e.g. from a manual edit or merge made after the agent's last real gate run but before push) more often than it misses typecheck/lint/test — prettier failures are silent (no functional symptom) and easy to introduce in a final small edit right before pushing. Always re-run the FULL gate (including format:check) yourself before trusting a 'gate green' claim, never just the test suite.

Related: [[gate-green-can-hide-uncommitted-local-fixes]] [[scoped-green-verification]]

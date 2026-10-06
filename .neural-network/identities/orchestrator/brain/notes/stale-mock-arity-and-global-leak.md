---
tags: [python, testing, gate, mocking]
paths: ["scripts/**", "test/scripts/**"]
strength: 1
source: "PR#73 (issue #72)"
graduated: false
created: 2026-07-17
---

When a Python script function's return-tuple arity changes (e.g. adding a new value), grep every test that monkeypatches that function with a lambda returning a hardcoded tuple — a stale mock silently breaks unpacking in the real caller and gate-reds main with no diff to blame. Also check every test that calls the REAL function (not mocked): if it redirects some module globals to a tempdir (ROOT, NOTES, LINKS) but misses one computed at import time from the original ROOT (like SCHEMA = os.path.join(ROOT, ...)), that global still points at the real repo path and the test silently overwrites production data on every run.
Related: [[gate-red-not-diff-broken]]

---
tags: [migration, refactor, testing]
paths: ["src/**"]
strength: 1
source: "PR#75 (issue #6, FAB-011)"
graduated: false
created: 2026-07-18
---

When a "pure migration, no behavior change" refactor moves a literal value (header string, config constant) into a new shared module, don't trust your own transcription of the old value — verify it against the actual pre-change source with `git show <commit>:<path>`. Caught in PR #75: fab-cli's http.ts consolidation re-typed meta.ts's browser User-Agent and silently drifted the Chrome version (131 instead of the original 124), which a reviewer's guess-based flag (also wrong on the specific number) still correctly pointed at. `git show` settled it exactly. Cheap (~10s) and closes the gap between "looks like the same value" and "is the same value" whenever a migration touches a literal that isn't covered by an existing behavior-preserving test.

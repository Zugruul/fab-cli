---
tags: [tdd, commits, hooks]
paths: ["**"]
strength: 1
source: ""
learned-from: tasks 217+219 hook blocks
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

The red-first board-move hook counts ANY file outside test paths as "implementation" — not just source: package.json/lockfile deps chores (#217) AND jest.config.js (#219) both tripped it, each costing a mid-review history rewrite. The red commit must contain ONLY files under __tests__/ or matching *.test.* (extracted test helpers under __tests__/ are fine — screenRegistry.tsx passed). EVERYTHING else, including test-supporting config (jest.config, eslint config, deps manifests), goes in its own commit AFTER the red commit. Supersedes the narrower deps-chore-commits-must-follow-the-red-commit rule.

---
tags: [gate, vitest, third_party, config]
paths: ["vitest.config.ts", "test/**"]
strength: 1
source: "PR#95 (TAL-010)"
graduated: false
created: 2026-07-18
---

vitest had no config file in fab-cli, so once a task's research touches a vendored third_party/* clone with its own test suite (e.g. third_party/talishar-fe's React/vitest tests), `npm run gate` starts picking those up and failing on missing deps that were never meant to be in fab-cli's node_modules. eslint.config already excluded third_party/** for this exact reason; vitest needed the same treatment (vitest.config.ts with test.exclude: [...configDefaults.exclude, 'third_party/**']). Verify a red gate is actually caused by your diff by stashing your changes and reproducing on the base commit first — this was true pre-existing exposure, not something the doc/test diff itself introduced.

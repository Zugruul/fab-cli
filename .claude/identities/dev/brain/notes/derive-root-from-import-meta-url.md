---
tags: [tests, paths, monorepo]
paths: ["fab-cli/test/helpers/monorepoRoot.ts"]
strength: 1
source: "APP-001 PR#166 review r1"
confidence: direct
graduated: false
created: 2026-08-01
last-touched: 2026-08-01
---

Test helpers locating the repo/monorepo root must derive it from the helper file's own location (join(dirname(fileURLToPath(import.meta.url)),'..',...)), never process.cwd() — cwd varies by invocation (--config from root vs cd into package) and fails as silent wrong-directory ENOENT. APP-001 MONOREPO_ROOT helper.

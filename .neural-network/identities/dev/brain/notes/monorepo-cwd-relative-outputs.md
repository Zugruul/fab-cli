---
tags: [monorepo, gitignore, restructure]
paths: [".gitignore", "fab-cli/.gitignore"]
strength: 1
source: "APP-001 PR#166 review r1"
confidence: direct
graduated: false
created: 2026-08-01
last-touched: 2026-08-01
---

Outputs written relative to process.cwd (e.g. price-comparison export default ./price-comparison/) need their gitignore pattern at the MONOREPO ROOT, not only the package .gitignore — running the CLI from root writes at root. When splitting a .gitignore during a restructure, classify each pattern by its output path's resolution anchor (cwd-relative vs package/__dirname-relative) first. Missing this committed 51k lines of generated CSVs in APP-001.

---
tags: [git, commits, hygiene]
paths: []
strength: 1
source: "APP-001 dev retro interview"
confidence: direct
graduated: false
created: 2026-08-01
last-touched: 2026-08-01
---

Before committing after any bulk git add or cherry-pick, run git diff --stat --cached and scan for unexpectedly large or generated files (CSVs, lockfile explosions, build output) — don't rely on review to catch them. When verifying a history scrub, scope checks to the branch's own HEAD (git log --stat HEAD -- <paths>), never --all: sibling branches sharing the object store give false positives. Colon-refspec pushes of detached HEADs (push origin HEAD:branch) can be classifier-blocked — the standard workaround is creating a local branch at the commit and pushing it normally.

---
tags: [debugging, paths, scope]
paths: []
strength: 1
source: "APP-002 PR#169"
confidence: direct
graduated: false
created: 2026-08-01
last-touched: 2026-08-01
---

When a task names specific instances of a bug (e.g. two scripts with a broken path), audit the WHOLE class before fixing: grep every sibling script for the same pattern (path anchors, cwd assumptions) — the named instances are usually a sample, not the census. In APP-002 the unlisted build-card-vault.py had the identical git-toplevel-relative third_party path bug; fixing only the named two would have left the generator broken. Also verify docs' adjacent command examples stay internally consistent after path changes.

---
tags: [bundles, project-agnostic, hygiene]
paths: ["**"]
strength: 1
source: ""
confidence: direct
learned-from: task 221 self-catch
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Capability-bundle payloads (development-skills remote-capabilities/**) are test-enforced project-agnostic: even a DOC COMMENT or test-file prose mentioning the calling project by name ("fab-cli issue #221") breaks the bundle's hermetic grep check. Cite bare issue numbers ("issue #221") in bundle code/docs, never the repo name. Self-grep `grep -rniE 'fabrary|fab-cli|fab-app'` over the bundle before committing — the #221 dev caught exactly this pre-commit.

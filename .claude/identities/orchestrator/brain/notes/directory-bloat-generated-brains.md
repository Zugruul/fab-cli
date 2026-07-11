---
tags: [brains, directory]
paths: [".claude/identities/**"]
strength: 1
source: "session retro 2026-07-10: card-vault sizing decision"
graduated: false
created: 2026-07-10
---

Do NOT run brain.sh directory in this repo while card-vault holds ~4.9k generated card notes — the regenerator enumerates every note of every role unconditionally and would bloat DIRECTORY.md into an ungreppable wall. Navigate the card layer by recall tags and the card-vault-map hub note instead. If regeneration becomes necessary, post-process the card-vault section to a count + pointer line. Related: [[bulk-corpora-generate-dont-mint]].

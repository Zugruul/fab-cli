---
tags: [review, brains, links, frontmatter]
paths: [".claude/identities/**/brain/notes/*.md"]
strength: 1
source: "talishar brain re-seed (PR#119) round 1 findings"
graduated: false
created: 2026-07-19
---

brain.sh mint auto-registers links.json entries for double-bracket cross-reference syntax
present in a note body AT MINT TIME, but hand-editing an existing note file directly (adding
a new cross-reference to already-minted content, e.g. during a deep-verification pass) does
NOT update links.json — that has to be done manually or the link graph silently desyncs (a
real cross-reference with no corresponding graph edge, so it never gets weighted/traversed
by recall). Same risk applies to a note's source: frontmatter when new file citations are
added to the body by hand-edit rather than a fresh mint. When reviewing a PR that hand-edits
existing brain notes (not just adding new ones via mint), specifically check: does every new
cross-reference in the diff have a matching links.json entry, and does source: reflect every
new citation added to the body?

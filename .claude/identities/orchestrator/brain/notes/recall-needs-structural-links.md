---
tags: [brains, recall, links, generators]
paths: []
strength: 1
source: "loop-feedback 2026-07-11"
graduated: false
created: 2026-07-11
---

Brain recall traverses WIKILINKS, not metadata: knowledge keyed by an entity's ATTRIBUTE (e.g. per-set rulings for a card's source set) is invisible to recall from the entity's note if the connection only exists as frontmatter — a lean identity ask answered correctly from directly-linked notes but missed everything one attribute-hop away. Two fixes, in order of durability: (1) STRUCTURAL — note generators must derive wikilinks from entity attributes to the corresponding context notes at generation time ([[bulk-corpora-generate-dont-mint]] generators should emit them; pair with [[brain-bulk-writes-need-link-reindex]]); (2) PROTOCOL stopgap — a protocol note + ROLE.md rule mandating the extra recall hop explicitly. Ship the protocol immediately, schedule the generator regeneration. Frontmatter alone is never a link.

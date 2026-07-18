---
tags: [review, docs, duplication, quality]
paths: ["docs/**", ".claude/talishar/**", ".claude/identities/**"]
strength: 2
source: "PR#98 (TAL-011) spec-compliance review; reinforced PR#101 (TAL-012) spec-compliance review"
graduated: false
created: 2026-07-18
---

When reviewing a condensed/derivative doc against its source for near-verbatim duplication, check two things independently, not just skim-compare: (a) sentence-level phrasing overlap (near-identical clauses, even reordered, are a red flag) and (b) whether the new doc's section contains information/structure the source doesn't have at all (new lists, checklists, enumerations). High overlap on (a) with genuine net-new content on (b) is a quality nit worth fixing, not a blocker; a section that fails (b) entirely -- pure reorg, zero new value -- is the real red line that should block.

The inverse case matters too, for "originality" checks on charter/role-style documents (ROLE.md, brain identity files): shared ORGANIZATIONAL shape across sibling documents (same section ordering: hard rules → scope → knowledge-flow) is a legitimate, often-sanctioned pattern -- don't flag structural similarity itself as duplication. Instead read the full sibling documents and check whether SENTENCES are reused, not sections; a shared skeleton with 100% novel sentence content is a pass. Do this via a full side-by-side read rather than diff/grep, since near-verbatim phrases can hide behind different section headers and structural similarity alone won't surface them.

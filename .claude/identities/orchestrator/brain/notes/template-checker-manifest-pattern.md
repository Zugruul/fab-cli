---
tags: [brains, validation, templates]
paths: ["scripts/keyword-sync.py"]
strength: 1
source: "session retro 2026-07-10: keyword-sync tooling"
graduated: false
created: 2026-07-10
---

Canonical shared corpora get a STRICT machine-validated note template plus a committed hash manifest: the checker enforces frontmatter shape and cross-field consistency and refuses to propagate malformed notes; the manifest attributes drift (canonical source updated vs a copy drifted), encoding the knowledge-flow hierarchy in tooling rather than convention. Cheap to build (stdlib script), catches whole classes of silent corruption. Applied to the keyword corpus via scripts/keyword-sync.py; reuse for any future shared corpus. See [[shared-corpus-symlink-pattern]].

---
tags: [brains, neural-view, schema, extensibility, shared-tooling]
paths: []
strength: 1
source: "fab-cli card-vault facet filters session"
graduated: false
created: 2026-07-11
---

Prefer a project-declared schema over hardcoding project vocabulary into shared tooling. Card-vault needed rich faceted filtering in neural-view (numeric comparators, enum include/exclude, compound presets). Rather than baking that vocabulary into the shared viewer, the project's own generator script was extended to emit an optional SCHEMA.json (facets + compound shortcuts), and the shared viewer learned to read WHATEVER schema a brain declares — GET /schema/<repo>/<role>, a generic num field on /graph nodes — once, generically. No project-specific code landed in the shared plugin.

Why: keeps the shared tool surface reusable across unrelated projects' brains with zero coupling — the alternative (hardcoding one project's facet names into neural-view) would have made every future project's custom filtering needs a plugin-code change instead of a data change.

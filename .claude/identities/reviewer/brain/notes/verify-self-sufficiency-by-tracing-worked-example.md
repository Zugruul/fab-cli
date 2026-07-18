---
tags: [review, docs, self-sufficiency]
paths: ["docs/**", ".claude/talishar/**", ".claude/identities/**"]
strength: 2
source: "PR#98 (TAL-011) spec-compliance review; reinforced PR#102 (TAL-013) spec-compliance review"
graduated: false
created: 2026-07-18
---

To verify a doc claims 'self-sufficiency' (a reader needs nothing else), don't grep the file for required keywords -- read it top-to-bottom pretending you've never seen the source material, and mentally trace through executing its concrete worked example using nothing but what's on the page. Keyword presence is not the same as the surrounding context/explanation actually being there.

Sharper version of the same test, useful for individual knowledge notes (not just full docs): ask whether the note's prose would SURVIVE with its cited source deleted. A note that names concrete file paths, function names, and line-adjacent WHY-context directly in its own sentences (e.g. "positional format, so parsing breaks if the zero count doesn't match") is real content. A note that would go blank/useless without its citation -- i.e. it's really just "see X for details" wearing a citation as decoration -- is a pointer, not knowledge, even if it superficially "cites a source" per the citation-density check.

For the separate "does this add anything BEYOND the existing source" question: don't diff the new note's prose against the old doc's prose (near-identical wording is expected for legitimately-condensed content, see [[distinguish-paraphrase-condensation-from-copy-paste]]). Instead grep the old doc for the same file/function names the new note cites — if the old doc only NAMES a thing while the new note SHOWS its shape (full class body, verified line-by-line against live source), that's real depth; if both just cite the same path without adding detail, it's padding. One grep + one Read per claim, fast and reliable.

---
tags: [gate, retro, brains, process]
paths: [".claude/identities/**"]
strength: 1
source: "talishar brain re-seed (PR#119) — main was silently red on this test since TAL-032/TAL-033 retro commits"
graduated: false
created: 2026-07-19
---

A brain-note-minting/editing commit (retro notes, taxonomy renames, ad-hoc knowledge-base
edits) changes tracked files just like a code PR, but it's easy to skip re-running the FULL
gate after it since "it's just markdown." This session found a real, silent gate regression
on main that persisted for hours: two brain notes minted during a retro violated a citation-
format test, and nobody caught it because gate was only re-run to verify the CODE PR that
preceded the retro commit, not after the retro commit itself landed. Rule: any commit that
changes tracked files — including pure-markdown identity-brain commits — needs a fresh full
gate run before being trusted as green, not just the code change it was derived from.

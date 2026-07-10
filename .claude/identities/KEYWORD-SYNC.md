# Keyword sync — one canonical keyword corpus, identical in every brain

The keyword notes (`kw-*.md`) and the generated `keywords-index.md` are a SHARED,
CANONICAL corpus. They must be **byte-identical** in every identity brain that
holds them: `judge`, `player`, `card-vault`. The **judge brain is canonical** —
keyword knowledge changes ONLY there (confirmed against the official CR per the
knowledge-flow hard rule), then propagates outward.

Tooling: `scripts/keyword-sync.py` (stdlib python, run from anywhere in the repo).

```
python3 scripts/keyword-sync.py check      # validate template + hash-compare all brains (exit 1 on drift)
python3 scripts/keyword-sync.py sync       # propagate judge -> all brains, regen index, rewrite manifest
python3 scripts/keyword-sync.py index      # regenerate keywords-index.md only
python3 scripts/keyword-sync.py baseline   # rewrite the manifest from judge's current state
```

State: `.claude/identities/keywords.manifest.sha256` — committed last-known-good
hashes of the canonical (judge) corpus. It is what lets `check` tell **where** a
desync happened, not just that one exists.

## The keyword note template (STRICT — validated by `check`, `sync` refuses on violation)

Every `kw-<slug>.md` must match this shape exactly:

```markdown
---
tags: [cr, keyword, <category>]
paths: []
strength: <int>
source: "https://rules.fabtcg.com/txt/latest/en-fab-cr.txt (CR <sec>) — vendored: third_party/fab-rules/en-fab-cr.txt"
graduated: false
created: YYYY-MM-DD
---

**<Name>** — <category> keyword (CR <sec>).

<the rules content: faithful to the CR text for that section; wikilinks to
related [[kw-*]] notes allowed and encouraged>

Index: [[keywords-index]]. When ruling, cite CR <sec>; verify against the vendored artifact.
```

Constraints enforced:
- frontmatter keys exactly `tags, paths, strength, source, graduated, created`, in that order;
- `<category>` ∈ `type` (CR 8.1) | `subtype` (8.2) | `ability` (8.3) | `label` (8.4) | `effect` (8.5) | `token` (8.6) — and it must agree between the tags and the header line;
- the CR section `<sec>` must be identical in `source`, the header line, and the trailer line, and must live under the category's CR chapter;
- token keywords are named `kw-token-<name>` and use category `token`.

## keywords-index.md is GENERATED — never hand-edit

`keyword-sync.py index` (also run by `sync`) rebuilds the index from the kw notes:
one section per CR-chapter category, entries sorted by CR section number, with
per-section counts. The same bytes are written to every brain. If `check` reports
"INDEX stale", regenerate — don't patch it by hand.

## Desync resolution protocol

`check` attributes drift using the manifest:

| Symptom | Meaning | Resolution |
|---|---|---|
| `DIVERGENT <role>/<file>` and NO "canon changed" line | a non-judge brain drifted | Inspect `git diff` on that file. If it's noise/accident: `keyword-sync.py sync` (judge wins). If it contains genuinely NEW knowledge: route it through the judge — the judge verifies it against the vendored CR (`third_party/fab-rules/en-fab-cr.txt`, refresh with `fab-cli rules update-docs`), updates its own note to the template, THEN `sync`. **Never merge player/card-vault text into the judge directly.** |
| `canon changed since baseline: ...` | the judge brain was updated | Expected after a CR bump or new ruling. Verify the changed notes against the vendored CR, then `sync` (propagates + re-baselines). If the judge change was accidental: `git checkout` the judge note, then `check` again. |
| `TEMPLATE ...` | a judge note violates the template | Fix the judge note to the template (content edits go INSIDE the body, between header and trailer), then `sync`. |
| `MISSING` / `EXTRA` | a brain lacks a keyword or invented one | New keywords are minted in the judge brain only (template above), then `sync`. `sync` deletes non-canon `kw-*` files in other brains. |
| `INDEX ... stale` | index out of date with the notes | `keyword-sync.py index` or `sync`. |

## When to run

- `check`: at retro time, before any release of brain knowledge, and before
  answering keyword-precision questions if brains were recently touched.
- `sync`: after ANY judge keyword change — CR version bump (refresh vendored docs,
  diff chapter 8, update judge notes), new set adding keywords, or a confirmed
  ruling folded into a keyword note. Also after creating a new brain that must
  hold the corpus (e.g. card-vault bootstrap: create `notes/`, run `sync`).
- Keyword/brain maintenance commits go directly to main (knowledge-update
  convention, no PR cycle). Commit the notes, the index, AND the manifest together.

## Notes on mechanics

- `sync` byte-copies files, so `strength`/`created` are canonical too — per-brain
  strength divergence on kw notes is treated as drift by design.
- `sync` also adds missing `links.json` edges (mirroring `brain.py mint`:
  weight 0.5) for wikilink targets that exist in the receiving brain; it never
  resets existing edge weights/fires.
- Do NOT `brain.sh mint` over a kw-* slug in a non-judge brain; role-specific
  keyword commentary belongs in separate notes (e.g. `ruling-*`, strategy notes)
  that LINK to the shared [[kw-*]] note.

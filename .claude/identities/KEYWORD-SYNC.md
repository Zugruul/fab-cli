# Keyword corpus — one physical copy, symlinked into every brain

The keyword notes (`kw-*.md`) and the generated `keywords-index.md` are a single
SHARED corpus. It lives **physically** in the card-vault brain
(`.claude/identities/card-vault/brain/notes/`); the judge and player brains hold
**relative symlinks** to those files. All brains therefore read literally the
same bytes — content desync between brains is structurally impossible.

Two distinct roles, do not conflate them:
- **Physical home**: card-vault (where the files are).
- **Editorial authority**: the JUDGE (who may change keyword content, and only
  after confirming against the official CR — the knowledge-flow hard rule).

Tooling: `scripts/keyword-sync.py` (stdlib python, run from anywhere in the repo).

```
python3 scripts/keyword-sync.py check      # template + symlink integrity + manifest attribution (exit 1 on problems)
python3 scripts/keyword-sync.py sync       # regen index, create/fix symlinks in all brains, refresh link edges + manifest
python3 scripts/keyword-sync.py index      # regenerate keywords-index.md only
python3 scripts/keyword-sync.py baseline   # rewrite the manifest from the corpus' current state
```

State: `.claude/identities/keywords.manifest.sha256` — committed last-known-good
hashes of the corpus. Since all brains share one file, the manifest's job is to
catch **unauthorized content changes** (e.g. an accidental write-through) rather
than cross-brain divergence.

## SYMLINK WRITE-THROUGH WARNING (the one real hazard)

Writing to a symlinked path (`brain.sh mint` over a `kw-*` slug, `open(...,"w")`,
`sed -i`, editors) rewrites the SINGLE PHYSICAL FILE that every brain reads.
Therefore:
- NEVER mint or hand-edit a `kw-*` slug or `keywords-index` from the player (or
  any non-judge) context. Role-specific keyword commentary goes in separate
  notes (e.g. `ruling-*`, strategy notes) that LINK to the shared [[kw-*]] note.
- Judge editorial updates edit the note (through the symlink or directly in
  card-vault — same file) following the template below, then run `sync`.
- `check` compares the corpus against the manifest; any change not followed by a
  judge-verified `sync` shows up as "corpus changed since baseline".

## The keyword note template (STRICT — validated by `check`, `sync` refuses on violation)

Every `kw-<slug>.md` must match this shape exactly:

```markdown
---
tags: [cr, keyword, <category>, <keyword-name>]
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
- the 4th tag is the keyword's own name (the slug minus `kw-`, and minus `token-` for tokens) — the direct recall handle;
- `<category>` ∈ `type` (CR 8.1) | `subtype` (8.2) | `ability` (8.3) | `label` (8.4) | `effect` (8.5) | `token` (8.6) — and it must agree between the tags and the header line;
- the CR section `<sec>` must be identical in `source`, the header line, and the trailer line, and must live under the category's CR chapter;
- token keywords are named `kw-token-<name>` and use category `token`.

## keywords-index.md is GENERATED — never hand-edit

`keyword-sync.py index` (also run by `sync`) rebuilds the index from the kw
notes: one section per CR-chapter category, entries sorted by CR section number,
with per-section counts. It is a corpus file like any other — physical in
card-vault, symlinked elsewhere.

## Problem resolution

| `check` symptom | Meaning | Resolution |
|---|---|---|
| `NOT-A-SYMLINK <role>/<file>` | a mirror replaced the symlink with a regular file (drifted copy) | Inspect it. Noise: delete the file, `sync` restores the link. New knowledge: route it through the judge (verify vs vendored CR `third_party/fab-rules/en-fab-cr.txt`, refresh with `fab-cli rules update-docs`; fold into the physical note per the template), delete the stray file, `sync`. `sync` auto-replaces the file with a symlink only when its content is identical; if divergent it refuses. |
| `BAD-TARGET` / `MISSING` / `EXTRA` | broken/missing/stray link | `sync` fixes links; new keywords are created as physical notes in card-vault (judge editorial), then `sync`. |
| `corpus changed since baseline` | the physical files were edited | Expected after a judge-verified update (CR bump, new set, folded ruling): verify vs the vendored CR, then `sync` (re-baselines). Unexpected: `git diff` the corpus, revert or route through the judge. |
| `TEMPLATE ...` | a note violates the template | Fix the physical note (content edits go INSIDE the body, between header and trailer), then `sync`. |
| `INDEX ... stale` | index out of date with the notes | `keyword-sync.py index` or `sync`. |

## When to run

- `check`: at retro time, before releasing brain knowledge, and whenever brains
  were recently touched.
- `sync`: after ANY judge keyword change (CR version bump → refresh vendored
  docs, diff chapter 8, update notes; new set keywords; confirmed rulings), and
  after creating a new brain that must hold the corpus (create its `notes/` dir,
  add it to `MIRRORS` in the script if new, run `sync`).
- Keyword/brain maintenance commits go directly to main (knowledge-update
  convention, no PR cycle). Commit the corpus, the symlinks, AND the manifest together.

## Mechanics notes

- Symlinks are relative (`../../../card-vault/brain/notes/<file>`), so they
  survive clones and checkouts on macOS/Linux. Git tracks them as symlinks.
- `brain.py` recall works transparently through them (verified: seed + hop +
  inject events fire for symlinked notes in mirror brains).
- One physical file means one shared `strength` value for all brains, by design.
- `sync` also adds missing `links.json` edges per brain (mirroring
  `brain.py mint`: weight 0.5, only toward targets existing in that brain; never
  resets existing edge weights/fires). Each brain keeps its OWN link graph —
  only the note files are shared.

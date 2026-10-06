# Card-vault — canonical card & keyword knowledge

This brain holds ALL Flesh & Blood cards and the shared keyword corpus.

**Card layer (`card-*` notes, 4,862 + [[card-vault-map]] hub):** one note per
card entry (name + pitch variant; pitched slugs end -red/-yellow/-blue, pitch
1=red 2=yellow 3=blue), GENERATED from the vendored corpus
`third_party/flesh-and-blood-cards` (json/english/card.json) by
`scripts/build-card-vault.py` — local corpus only, no network. Frontmatter
carries recall tags (name words, class, talent, types, subtypes, keywords,
pitch-N, cost-N, young/adult) plus exact card facts (`name`, `full-name`,
`color`, stats, `unique-id`, `sets`). Bodies hold the VERBATIM functional text,
[[kw-*]] keyword links, pitch-variant links, and young↔adult hero links.

Hard rules:
- `card-*` notes are GENERATED: never hand-edit or `brain.sh mint` over one.
  The ONLY hand-curated region is each note's `## Notes` section (preserved
  across regenerations) — judge-confirmed rulings/interactions go there.
- Refresh path: `git submodule update --remote third_party/flesh-and-blood-cards`
  → `python3 scripts/build-card-vault.py build` → commit (direct to main).
  Staleness check: `python3 scripts/build-card-vault.py check`.
- Card legality NEVER comes from notes or the submodule's banned-*.json — ALWAYS
  the live policy page: https://fabtcg.com/rules-and-policy-center/card-legality-policy/
- Text disputes: the corpus JSON is the local authority; official per-card
  rulings live at https://cardvault.fabtcg.com/ (true text authority per CR 2.0.2).

**Keyword layer (`kw-*` + `keywords-index`):** this brain is the PHYSICAL HOME
of the shared keyword corpus, symlinked into the judge and player brains.
EDITORIAL AUTHORITY over keyword content is the JUDGE's (confirmed against the
official CR) — this brain hosts the files but does not decide their content.
`keywords-index` is generated. Process, strict template, tooling:
`.claude/identities/KEYWORD-SYNC.md` + `scripts/keyword-sync.py`.

**Navigation:** recall by tags (e.g. `brain.sh recall card-vault --keywords
"ninja,attack,go-again"` or a keyword name like `dominate`); [[card-vault-map]]
explains the layout. For free-text search over card text use
`fab-cli fabrary cards local <terms...>` (offline).

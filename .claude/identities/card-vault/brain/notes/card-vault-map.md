---
tags: [card, index, hub, map]
paths: []
strength: 1
source: "third_party/flesh-and-blood-cards json/english/card.json · scripts/build-card-vault.py"
graduated: false
created: 2026-07-10
---

# Card vault map — how to find cards in this brain

Every card entry in the game is a `card-*` note here (one per name+pitch;
pitched slugs end in -red/-yellow/-blue). They are GENERATED from the vendored
corpus by `scripts/build-card-vault.py` — never hand-edit (only the `## Notes`
section of a card survives regeneration; put judge-confirmed rulings there).

Finding cards: recall by tags — name words, class, talent, type, subtype,
keyword, pitch-N, cost-N (e.g. `brain.sh recall card-vault --keywords
"ninja,attack,go-again"`). For text/phrase search over the corpus use
`fab-cli fabrary cards local <terms...>` (offline). Exact text authority:
the corpus JSON + official rulings at https://cardvault.fabtcg.com/.

Keywords: every card links to its [[kw-*]] notes (shared corpus, physical here,
symlinked into judge/player — see .claude/identities/KEYWORD-SYNC.md).
Heroes cross-link young/adult versions. Card legality: NEVER from notes — live
policy page only (https://fabtcg.com/rules-and-policy-center/card-legality-policy/).

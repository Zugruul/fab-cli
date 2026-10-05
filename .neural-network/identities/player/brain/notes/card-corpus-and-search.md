---
tags: [cards, reference, tooling]
paths: []
strength: 1
source: "third_party/flesh-and-blood-cards/json/english/card.json"
graduated: false
created: 2026-07-10
---


The full card corpus lives in third_party/flesh-and-blood-cards/json/english/ (a vendored git submodule). Key files: card.json (~21MB, every card with full fields), card-flattened.json (per-printing rows), keyword.json (80 keyword names), type.json (types/classes/talents/subtypes), ability.json, plus banned-*.json / living-legend-*.json / suspended-*.json (legality snapshots — may be stale; prefer live [[card-legality-pointer]]). ALWAYS read exact card text and stats from here with python3/jq, never from memory — FAB cards are niche and easy to misquote. Example: `python3 -c "import json; [print(c[\"name\"]) for c in json.load(open(...card.json)) if ...]"`. The fab-cli project also queries live card data via AppSync GraphQL (searchCards) — see project CLAUDE.md. This is the ground truth behind [[card-anatomy]], [[classes-and-talents]], and every [[keyword-go-again]]-style keyword note. Hub: [[player-brain-map]].


SEARCH IT VIA THE CLI: `fab-cli fabrary cards local <terms...>` — offline, no auth; name+text by default, `--exact "<Name>"` (the card itself) vs `--text "<phrase>"` (cards MENTIONING it — beware name/subtype/keyword conflation), `--keyword`, `--pitch/--cost/--type`, `--full` for the raw record. NO MATCH exits 1 → fall back to live `fab-cli fabrary cards search` or cardvault.fabtcg.com.

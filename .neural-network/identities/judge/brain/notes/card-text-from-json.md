---
tags: [reference, card-text, data]
paths: []
strength: 1
source: "third_party/flesh-and-blood-cards"
graduated: false
created: 2026-07-10
---

Read card text and printed properties from the vendored dataset, NEVER from memory — misremembered FAB card text produces wrong rulings.

Source of truth for card text: third_party/flesh-and-blood-cards/json/english/card.json (in the fab-cli repo). Related files in that directory cover abilities, printings, artists, and set data.

Judge relevance: TRP §5.10 makes the official text the English text of the latest printing, subject to published errata, and the Head Judge the final authority on interpretation and on overruling erroneous text — see [[head-judge-authority]]. When a ruling depends on exact wording (trigger conditions, "if it hits", prevention amounts), pull the literal text and reason from it with the CR interaction rules: [[triggered-effects-and-ordering]], [[replacement-effect-ordering]], [[layers-and-continuous-effect-staging]].

Card LEGALITY is a separate, live-only lookup — see [[card-legality-live-fetch]]. — TRP §5.10; local card.json.


SEARCH IT VIA THE CLI: `fab-cli fabrary cards local <terms...>` — offline, no auth; name+text by default, `--exact "<Name>"` (the card itself) vs `--text "<phrase>"` (cards MENTIONING it — beware name/subtype/keyword conflation), `--keyword`, `--pitch/--cost/--type`, `--full` for the raw record. NO MATCH exits 1 → fall back to live `fab-cli fabrary cards search` or cardvault.fabtcg.com.

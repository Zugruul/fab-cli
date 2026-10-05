---
tags: [cr, zones, rules]
paths: []
strength: 1
source: "https://rules.fabtcg.com/txt/latest/en-fab-cr.txt (CR 3.0.7-3.0.9)"
graduated: false
created: 2026-07-10
entities: [card:endless-arrow, card:mark-of-the-beast, card:slithering-shadowpede, card:snapdragon-scalers]

---

When a card leaves the arena/stack to a non-arena zone (or goes private outside the arena), it RESETS — becomes a new object with no memory of buffs (CR 3.0.9): Endless Arrow returned to hand loses the go-again Snapdragon Scalers gave it. But history of HOW it became new is kept (Slithering Shadowpede knows it was banished from hand this turn, 3.0.9c). Moves are simultaneous origin→destination; the card's properties are read AS IT LEAVES the origin (Levia checks {p} at origin, 3.0.7a); private→private moves carry NO properties (face-down banish from hand can't satisfy 6+ {p} checks, 3.0.7a). Same-origin-destination = no move at all (Mark of the Beast face-down in banish just flips face-up, 3.0.7b). Triggers/effects that moved a public object keep referencing the new object while it stays public (3.0.9a-b). Links: [[zones-and-visibility]], [[last-known-information]], [[attack-and-defense-reactions]].

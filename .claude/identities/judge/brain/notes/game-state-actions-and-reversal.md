---
tags: [cr, adjudication, gamestate]
paths: []
strength: 1
source: "https://rules.fabtcg.com/txt/latest/en-fab-cr.txt (CR 1.10)"
graduated: false
created: 2026-07-10
---

Before each priority state, game-state actions run in strict order (CR 1.10.2): (1) dead heroes → player loses/draw; (2) all 0-life living objects cleared simultaneously as one event (they "died"); (3) look-at continuous effects begin; (4) state-based triggers fire, then pending triggered-layers go on the stack — multiple owners add theirs in clockwise order from a player chosen by the turn-player (6.6.6b); (5) combat-chain close check. ILLEGAL ACTIONS (1.10.3): reverse to the last legal state; the reversal itself triggers nothing and can't be replaced (1.10.3a-b); if full reversal is impossible, reverse as much as possible (1.10.3c) — this is the CR-side companion to the PPG's [[fixing-game-states]]. Links: [[priority-and-the-stack]], [[game-state-actions-and-death]].

---
tags: [cr, playing, timing]
paths: []
strength: 1
source: "https://rules.fabtcg.com/txt/latest/en-fab-cr.txt (CR 5.1)"
graduated: false
created: 2026-07-10
entities: [card:rewind]

---

Playing a card is 9 ordered steps (CR 5.1.1): Announce (card hits the stack — "next card you play" buffs and cost modifiers begin applying NOW, 5.1.2a) → Declare method+costs (X values, optional additional costs, which alternative-cost/play-effect you're using — only one, 5.1.3c-d) → Declare modes and targets (5.1.4; attacks declare attack-targets here) → Legal-play check (illegal = full rewind, 5.1.5) → Calculate asset-costs in fixed order: set → increase → reduce, floor 0 (5.1.6a; cost reducers apply LAST — they can't go below 0 but increases stack first) → Pay asset-costs (pitch happens here) → Calculate effect-costs → Pay effect-costs → Played; you regain priority (5.1.10). Player leverage: X is declared before paying, targets are locked before opponents can respond, and X=0 is forced when playing "without paying" (5.1.3a). Cards play only from hand or arsenal unless an effect says otherwise (5.1.1a). Links: [[pitching-mechanics-precise]], [[priority-and-passing]], [[abilities-and-functionality]].

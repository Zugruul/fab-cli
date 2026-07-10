---
tags: [cards, anatomy, visual, reference]
paths: [docs/references/card-anatomy/]
strength: 2
source: "annotated examples in docs/references/card-anatomy/ + third_party/flesh-and-blood-cards/json/english/card.json (true text: cardvault, CR 2.0.2; layout semantics: CR ch.2)"
graduated: false
created: 2026-07-10
---

# Card anatomy — visual layout by card type (annotated examples vendored in docs/references/card-anatomy/)

Where each property sits on a physical card (CR ch.2 defines the semantics; images show real examples, each cross-referenced to the card DB in third_party/flesh-and-blood-cards):

- **HERO** (`hero-card-ira.png` — Ira, Crimson Haze; Ninja Hero Young): name top center · card effects in the text box · TYPE BAR at the bottom ("Hero · Ninja") · INTELLECT bottom-left ({i}, = hand refill size) · STARTING LIFE bottom-right ({h}). Heroes have no pitch/cost/power/defense.
- **WEAPON** (`weapon-edge-of-autumn.png` — Edge of Autumn; Ninja Weapon Sword 2H): name top · "Once per Turn Action — [cost]: Attack" activated ability in the text box · DAMAGE (power {p}) bottom-left · type bar bottom ("Ninja Weapon — Sword (2H)"). Weapons stay in the arena; their attacks are attack-proxies.
- **ATTACK ACTION** (`attack-action-torrent-of-tempo.png` — Torrent of Tempo, red): PITCH VALUE top-left (socketed {r} symbols: 1=red/2=yellow/3=blue strip) · COST top-right · card effects text box · POWER {p} bottom-left · DEFENSE {d} bottom-right · type bar bottom ("Ninja Action — Attack"). DB: pitch 1, cost 1, power 5, defense 3.
- **DEFENSE REACTION** (`defense-reaction-springboard-somersault.png` — Springboard Somersault, yellow): same top layout (pitch + cost), NO power, DEFENSE bottom-right (2) · "Generic Defense Reaction" type bar. Playable only in the Reaction Step, incl. from arsenal.
- **INSTANT** (`instant-snag.png` — Snag, blue): pitch top-left, cost top-right, NO power/defense corners (can't attack or defend) · "Generic Instant" type bar. Playable any time you have priority.
- **EQUIPMENT** (`equipment-ironrot-chest.png` — DB name "Ironrot Plate", Generic Equipment Chest): no pitch/cost corners · ability (here Blade Break) in text box · DEFENSE bottom-right (1) · type bar names the equip zone ("Generic Equipment — Chest").
- **SPLIT/MELD CARD** (`melded-null-shock-vertical.png` + `-horizontal.png` — Null // Shock; Wizard Instant // Lightning Instant): two half-faces sharing one card, held vertical in hand, read horizontal; EACH half has its own name, pitch/cost corners, text box, and type bar; the Meld reminder text spans the middle. Play one side (choose at stack time, CR 9.2.3) or both via meld (pay both costs, CR 8.3.38).
- **GAME AREA** (`playmat-zone-layout.png` — official playmat): combat chain strip along the top; player row: HEAD/CHEST/LEGS column on one side, ARMS next to chest; WEAPON – HERO – WEAPON center with ARSENAL below hero; GRAVEYARD/DECK/BANISHED column on the other side with PITCH toward center. A game area = two such layouts facing each other; any mat/no mat is fine as long as the layout is followed (TRP 5.6).

Color strip ↔ pitch: red=1, yellow=2, blue=3 (CR 2.1.2a — associated but independent properties). No printed box = property absent entirely (CR 2.x). True text authority: cardvault.fabtcg.com.

Judge links: [[card-text-from-json]], [[properties-base-vs-modified-rulings]], [[game-layout-rules]], [[keywords-index]], [[doc-map-cr]].

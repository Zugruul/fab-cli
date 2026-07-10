---
tags: [protocol, cards, lookup]
paths: []
strength: 1
source: "session lesson 2026-07-10 (Haze Bending miss) + third_party/flesh-and-blood-cards"
graduated: false
created: 2026-07-10
---

PROTOCOL — resolving an unrecognized game term. Hard-learned failure: a question mentioned "Haze Bending"; the judge correctly EXTRACTED it as a candidate proper name, but only checked its own brain and declared it not-a-thing — it never CONFIRMED whether it was a card. It is a card (Illusionist Action Aura with Spectra). The brain holds rules and keywords, NOT the 4,800+ card names — so a candidate proper name that misses the brain is most likely a CARD NAME and must be confirmed by search, not absence. Steps, ALL before any "not a recognized term" answer: (1) brain recall + [[keywords-index]]/[[glossary-index]]; (2) OFFLINE CARD SEARCH — query third_party/flesh-and-blood-cards/json/english/card.json by name AND functional_text, trying the full phrase AND its parts ("haze bending", then "haze") — no auth, always available; (3) `fab-cli fabrary cards search "<term>"` (fuzzy, also finds partial matches; needs auth) and Card Vault; (4) lore KB if it sounds like story. Only after all four miss may the answer be "unknown — likely not an official term", still offering #ask-a-judge. When confirmed as a card: quote its exact printed text and resolve from text + rules ([[card-text-from-json]], [[keyword-interaction-rulings]]). Links: [[card-anatomy-visual]], [[staying-current-protocol]], [[judge-brain-map]].

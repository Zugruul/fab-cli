---
tags: [phpunit, talishar, testing, isolation]
paths: ["third_party/talishar/tests/**", "third_party/talishar/Classes/CardObjects/**"]
strength: 1
source: "TAL-033 (#117)"
graduated: false
created: 2026-07-19
---

Talishar's Card subclasses call global (non-namespaced) engine functions (AddLayer, Draw,
DiscardRandom, ModifiedPowerValue, Intimidate, ...) whose real implementations live in
`third_party/talishar/CardLogic.php`/`CoreLogic.php` and pull in the whole game engine
(gamestate, DB, session). `third_party/talishar/Classes/Card.php` and `Classes/CardObjects/*.php`
themselves have no require/include and no load-time engine calls, so a card class can be
require_once'd standalone. Define your own test-double versions of only the specific global
functions the target card's hooks call, each guarded by function_exists() (matching
`third_party/talishar/tests/bootstrap.php`'s existing mock convention), BEFORE requiring the card
file — this gives a fast, isolated hook test with zero docker stack, recording call args into a
$GLOBALS array and returning controllable stub values so you can assert real conditional behavior
(not just "was called"). function_exists() makes an accidental real-engine-file collision fail
loudly (fatal redeclare) instead of silently running against stale stubs. Template:
`third_party/talishar/tests/Engine/CardHookTest.php`.

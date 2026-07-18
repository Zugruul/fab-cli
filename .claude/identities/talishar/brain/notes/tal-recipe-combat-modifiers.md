---
tags: [talishar, recipe, combat-modifier, effectpowermodifier]
paths: []
strength: 1
source: "third_party/talishar/Classes/CardObjects/AACCards.php; third_party/talishar/Classes/CardObjects/OMNCards.php"
graduated: false
created: 2026-07-18
---

`CombatEffectActive`/`EffectPowerModifier` (see [[tal-arch-layer-stack-combatchain]] for the
resolution mechanism they feed) are implemented in several distinct real shapes across the
codebase, confirmed by direct code study of `third_party/talishar/Classes/CardObjects/*.php` — not
just the one BUFF/GOAGAIN pattern already covered by [[tal-recipe-base-card]]:

1. **Flat modifier, mode-gated, non-persistent** (Astral Strike's `astral_strike_red`, see
   [[tal-recipe-base-card]]/[[tal-recipe-currentturneffect-suffix]]): `EffectPowerModifier`
   branches on the suffix string and returns a fixed `2` or `0`; `IsCombatEffectPersistent` is not
   overridden, so the effect disappears once its chain link closes.

2. **Flat modifier, always active, persistent** (`nights_embrace_blue`,
   `third_party/talishar/Classes/CardObjects/AACCards.php`): overrides `IsCombatEffectPersistent($mode) { return true;
   }` so the effect survives past its originating chain link, and gates `CombatEffectActive` on an
   external game-state check rather than an internal mode flag:
   ```php
   function CombatEffectActive($parameter = '-', $defendingCard = '', $flicked = false) {
     global $CombatChain;
     return HasStealth($CombatChain->AttackCard()->ID());
   }
   function EffectPowerModifier($param, $attached = false) {
     return 1;
   }
   ```

3. **Flat negative modifier, always active** (`FRAGMENT`,
   `third_party/talishar/Classes/CardObjects/OMNCards.php`) — a
   debuff-style effect with no gating at all:
   ```php
   function CombatEffectActive($parameter = '-', $defendingCard = '', $flicked = false) {
     return true;
   }
   function EffectPowerModifier($param, $attached = false) {
     return -2;
   }
   ```

4. **Dynamic modifier carried through `$param` itself** (`auric_shards_red`,
   `third_party/talishar/Classes/CardObjects/OMNCards.php`) — the modifier amount isn't a fixed literal at all; the
   caller passes the amount as the effect parameter and `EffectPowerModifier` just parses it back
   out:
   ```php
   function EffectPowerModifier($param, $attached = false) {
     return intval($param);
   }
   ```
   (`auric_shards_red`'s `EntersArenaAbility()` calls `$this->baseCard->PlayAbility(4)`, so `4` is
   what eventually flows into `$param` here — the numeric value is chosen at the call site, not
   hardcoded in the modifier hook.)

Takeaway for new cards: pick the shape that matches the rules text before writing the hooks —
"always on for the rest of combat" needs `IsCombatEffectPersistent`, "scales with something"
usually means encoding the scale factor into the `AddCurrentTurnEffect`/layer parameter rather than
hardcoding it in `EffectPowerModifier`, and "only while a mode is active" is the suffixed-ID pattern
in [[tal-recipe-currentturneffect-suffix]].

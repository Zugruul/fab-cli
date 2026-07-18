---
tags: [talishar, architecture, layer-stack, combat-chain]
paths: []
strength: 1
source: "third_party/talishar/Classes/Stack.php; third_party/talishar/CombatChain.php; third_party/talishar/Classes/Card.php; third_party/talishar/Classes/ChainLinks.php"
graduated: false
created: 2026-07-18
---

The **layer stack** (`third_party/talishar/Classes/Stack.php`) is the shared structure everything
resolving — abilities, triggers, attacks — passes through. It wraps the same flat `$layers` array
that `WriteGamestate.php`/`ParseGamestate.php` persist (see [[tal-arch-gamefile-lifecycle]]) behind a
`Stack` class: `FindCardUID`, `FindCardSourceUID`, and friends scan `$layers` in fixed-size strides
of `LayerPieces()` elements per entry. Phase markers pushed onto this stack include `LAYER`,
`PRELAYERS`, `TRIGGER`, `PRETRIGGER`, `ABILITY`, `MELD`, `RESUMETURN`, `ATTACKSTEP`, and
`RESOLUTIONSTEP` — `third_party/talishar/CombatChain.php` lines 2007–2035 define `IsLayerStep()`,
`IsAttackStep()` (`$Stack->FindCardID("ATTACKSTEP")`), `IsResolutionStep()`
(`$Stack->FindCardID("RESOLUTIONSTEP")`), and `AfterDamage()` (true once `RESOLUTIONSTEP` or
`FINALIZECHAINLINK` has been reached) by searching this same stack.

**CombatChain resolution** (`third_party/talishar/CombatChain.php`, ~89KB — the largest
non-generated engine file after `CardLogic.php`/`CardDictionary.php`) computes an attack's
effective power via `LinkBasePower()` (~line 2038): starts from the card's base `PowerValue()`,
then walks `$currentTurnEffects` and every prior chain link in `$ChainLinks`
(`third_party/talishar/Classes/ChainLinks.php`), applying layer continuous buffs/debuffs
card-by-card.

A card opts into this system via two base `Card` class hooks
(`third_party/talishar/Classes/Card.php` lines 106–113):

- **`CombatEffectActive($parameter, $defendingCard, $flicked)`** — whether the effect currently
  applies to the attack on the chain.
- **`EffectPowerModifier($param, $attached)`** — how much power to add when active.

By the base class's default, a layer continuous effect disappears once its chain link closes unless
`IsCombatEffectPersistent()` is overridden to return `true`. Several real, distinct implementation
shapes for these two hooks (flat modifiers, dynamic modifiers, persistent-conditional modifiers) are
catalogued in [[tal-recipe-combat-modifiers]] — this note covers the resolution mechanism they plug
into, not the card-authoring patterns themselves.

---
tags: [card-identification, edition, rarity, foiling, first-edition, unlimited, physical-cards, marvel, cold-foil, rainbow-foil]
paths: []
entities: [card:eye-of-ophidia]
strength: 2
source: "https://managrading.com/a-simple-guide-to-flesh-and-bloods-card-rarities-and-editions/ + the-fab-cube printings dataset"
confidence: direct
learned-from: user directive 2026-08-04; initial visual-rule answer was WRONG and was corrected against the printing dataset
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# Identifying FAB edition, rarity, foiling and border from a physical card

## 0. CHECK THE DATASET FIRST — the visual rules are a fallback, not the primary method

`fab-cli fabrary cards local --exact "<name>" --full` returns `printings[]`
with `edition` and `foiling` codes. This is authoritative and settles most
edition questions outright, because **a card's editions often differ in
foiling, so the printing list tells you which combinations even exist.**

Code legend (verified by enumerating the whole the-fab-cube dataset):

- `edition`: `F` = First, `U` = Unlimited, `A` = Alpha (WTR only), `N` = none
  (post-Uprising sets — ENG/LGS/MST/OMN etc. have no edition distinction)
- `foiling`: `C` = Cold foil, `R` = Rainbow foil, `S` = Standard / non-foil

If the printing list shows only one edition for a given foiling, the foiling
alone determines the edition and no visual inspection is needed.

## 1. WORKED EXAMPLE — and the mistake to not repeat

`Eye of Ophidia`, ARC000, rainbow foil. Printings in the dataset:

| id     | set | edition       | foiling       | artist            |
|--------|-----|---------------|---------------|-------------------|
| ANQ002 | ANQ | N             | S (non-foil)  | Livia Prima       |
| ARC000 | ARC | **F (First)** | **C (Cold)**  | Alexandra Malygina|
| ARC000 | ARC | **U (Unltd)** | **R (Rainbow)**| Alexandra Malygina|

There is **no first-edition rainbow-foil Eye of Ophidia**. First edition
exists only as cold foil; Unlimited only as rainbow foil. So a rainbow-foil
ARC000 is Unlimited, full stop.

**The error made on 2026-08-04:** the article's per-set dot rule was applied
first (Arcane Rising: "no coloured dot = First Edition"), the card's footer
was magnified, no rarity symbol was found, and the card was declared First
Edition. Wrong. **ARC000 prints no rarity symbol in EITHER edition** — the
confirmed 1st-edition cold foils (`ARC000-F`, © 2019) have no symbol either.
The dot rule discriminates nothing for this card, so "no dot" was absence of
evidence read as evidence of absence.

**Generalised lesson: the dot rule only applies to cards that actually print
a rarity symbol.** Before using it, confirm the symbol slot is populated on
at least one known printing of that card. Fabled/promo/special cards
frequently print none. Check the dataset first and the rule becomes a
cross-check rather than the load-bearing step.

Corroborating discriminators for this card, all agreeing on Unlimited:
- collector code `ARC000` vs `ARC000-F` (the `-F` suffix marks the cold-foil
  first-edition printing)
- © **2019** on the 1st-edition cold foil vs © **2020** on the Unlimited
- fabmaster image paths encode it: `2020-ARC/ARC000.png` (first) vs
  `2020-**U**-ARC/**U**-ARC000.png` (unlimited)

## 2. First Edition vs Unlimited — the visual rule, and why it is per-set

Marker is the rarity symbol in the **bottom-left footer**:
`<rarity symbol> <SET><NUMBER> <artist> © <year> Legend Story Studios`.

| Set                     | No coloured dot   | Solid dot         | Coloured (hollow) circle |
|-------------------------|-------------------|-------------------|--------------------------|
| Welcome to Rathe (WTR)  | **First Edition** | Unlimited         | —                        |
| Arcane Rising (ARC)     | **First Edition** | Unlimited         | —                        |
| Crucible of War (CRU)   | —                 | **First Edition** | Unlimited                |
| Monarch (MON)           | —                 | **First Edition** | Unlimited                |
| Tales of Aria (ELE)     | —                 | **First Edition** | Unlimited                |
| Everfest (EVR)          | —                 | **First Edition** | —                        |
| Uprising (UPR)          | —                 | —                 | Unlimited                |

- **WTR/ARC are inverted relative to every later set** — there, the *absence*
  of a dot marks First Edition. Memorising one set's rule and generalising is
  the classic trap.
- **From Uprising onwards the distinction does not exist.** One booster-box
  type; all printings carry solid dots with a letter. For any post-UPR set,
  promo, or Armory/hero-drop product, "1st or Unlimited?" is a malformed
  question — the dataset shows `edition: N`.

## 3. Rarity symbols

Observed directly from the article's chart image:

| Rarity      | Glyph                                     |
|-------------|-------------------------------------------|
| Common      | `C` grey circle                           |
| Token       | `T` grey circle                           |
| Rare        | `R` dark blue circle                      |
| Super Rare  | `S` light purple circle (early sets only) |
| Majestic    | `M` red circle                            |
| Legendary   | `L` orange/amber circle                   |
| Fabled      | orange/amber **diamond**, no letter       |
| Marvel      | blue-violet **triangle**, no letter       |

Fabled and Marvel are the two non-circular glyphs — shape alone identifies
them. **Marvel** is a rarity *and* an alternate-art treatment: alternate art
of a card that is Rare-or-higher in its normal printing, usually cold foiled,
often full-art.

## 4. Foiling

- **Rainbow foil** — rainbow shimmer. One per booster pack, any rarity.
- **Cold foil** — silver/metallic look, clearly distinct from rainbow
  shimmer. Far rarer (~3x rarer than rainbow post-Uprising). Originally
  First-Edition-only, now in all releases.
- **Non-foil** — no treatment.

## 5. White borders

White-bordered printings are **reprints** and the least collectible tier.
Desirability ladder LSS reprints down: cold foil → rainbow foil → non-foil →
white-bordered non-foil.

## 6. Method for reading a footer from a photo

Apply EXIF rotation first, generate a downscaled overview to locate the card,
then crop the footer region and upscale ~5-6x with lanczos. Never judge a
rarity glyph from a full-frame thumbnail — the symbol is a few pixels wide at
that scale and "absent" is indistinguishable from "faint". Even done
correctly, see §1: a correct reading of the glyph can still yield a wrong
edition if the card prints no glyph at all.

## Source and its limits

Article: https://managrading.com/a-simple-guide-to-flesh-and-bloods-card-rarities-and-editions/

Third-party collector guidance, NOT an LSS rules document. Reliable for
physical identification; **not** the authority for legality (live legality
policy) or rules text (Card Vault true text).

**Caution recorded from use:** an automated text extraction of this article
returned rarity colours contradicting its own chart image (claiming Common =
yellow, Fabled = black circle; the chart shows grey and an orange diamond,
and the orange diamond is what appears on real cards). Prefer image evidence
over extracted prose, and prefer the local printing dataset over both.

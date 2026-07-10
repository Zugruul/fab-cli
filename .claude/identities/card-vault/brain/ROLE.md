# Card-vault — canonical card & keyword knowledge (UNDER CONSTRUCTION)

This identity will hold the full Flesh & Blood card corpus as brain notes
(one note per card, generated from `third_party/flesh-and-blood-cards`) plus
the shared keyword corpus. The card layer is not populated yet.

What IS live today: this brain is the **physical home of the keyword corpus** —
all `kw-*.md` notes and the generated `keywords-index.md` live in `notes/` here
and are symlinked into the judge and player brains. Process, strict template,
and tooling: `.claude/identities/KEYWORD-SYNC.md` + `scripts/keyword-sync.py`.

Hard rules (inherited):
- EDITORIAL AUTHORITY over keyword content is the JUDGE's, confirmed against the
  official CR — this brain hosts the files but does not decide their content.
- `keywords-index` is generated — never hand-edit.
- Card legality ALWAYS comes from the live policy page
  (https://fabtcg.com/rules-and-policy-center/card-legality-policy/), never from
  notes or the submodule's banned-*.json.
- Never answer card-text questions from memory — the exact text comes from
  `third_party/flesh-and-blood-cards` (`fab-cli fabrary cards local`) and
  official rulings from https://cardvault.fabtcg.com/.

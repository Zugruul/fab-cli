# Corpus redistribution-rights assessment

SPEC-APP.md §7.10: before any knowledge pack is published, the system SHALL perform and record
a per-source redistribution-rights assessment — what each corpus source is, whose rights it
carries, the applicable policy/permission, and the resulting **shipping mode** (verbatim /
paraphrase / stub). The exporter enforces the recorded mode mechanically
(`pipeline/config/shipping-modes.json`, read by `pipeline/src/export.ts`) — this document is the
human-readable record of *why* each mode was chosen; the config file is the machine-readable
record of *what* is currently enforced. They MUST stay in sync (a source in one config with no
entry in the other loudly fails, see `pipeline/src/shippingModes.ts`).

**Status: this document records an assessment, not a legal opinion or an approval.** None of the
outcomes below have been signed off on by the user. See "Awaiting user sign-off" at the bottom —
**do not treat any mode recorded here as final until the user has explicitly signed off.**

Research basis for the LSS-facing sections: one live fetch of
`https://fabtcg.com/resources/terms-use-licensed-assets/` ("Terms of Use for Game and Studio
Assets and IP", fetched 2026-08-02) — the closest thing fabtcg.com currently publishes to a
general fan-content/community policy. There is no separate document at fabtcg.com specifically
titled "fan content policy"; this Terms of Use page is what the Studio actually publishes and
enforces against. No legal counsel was consulted — none of the interpretation below should be
read as a legal conclusion, only as the best-effort factual summary a non-lawyer engineer can
make from the plain text of the published terms.

## (a) LSS rules documents — CR / TRP / PPG / CPG text

**What it is.** The official Comprehensive Rules, Tournament Rules Policy, Player Participation
Guide, and Casual Procedure Guide documents, vendored verbatim under
`fab-cli/third_party/fab-rules/` (refreshed via `fab-cli rules update-docs` from LSS's own
hosted downloads) and chunked into `kb/rules/` by `fab-cli rules sync`. This is LSS's own
procedural/rules text, not a third party's.

**Whose rights.** Legend Story Studios Limited. Per the fetched Terms of Use page: "All
Intellectual Property (IP) pertaining to the Game and the Studio... are property of the Studio."

**Applicable policy/permission.** The Terms of Use page has a "Flesh and Blood Third Party
Applications" section that names exactly this use case: **"Rules Enforcement Applications"**
— "You may create Third Party Apps that provide rules enforcement functions ('Rules Apps') as
long as the use of assets to create said Rules Apps is compliant with the rest of this
document. You may not directly monetize Rules Apps... without express written permission. You
may indirectly monetize Rules Apps (for example, Patreon and ad-sense)." All Third Party Apps
must carry a non-affiliation disclaimer, and — this is the load-bearing caveat — **"You may not
create Third Party Apps if you are a commercial entity."** The Studio can revoke permission "at
any time, at the sole discretion of the Studio."

Two things this page does *not* address: (1) it speaks in terms of "assets" (art, images,
logos, "content related to the Game" via APIs) and never explicitly names redistributing rules
*document text*, so applying it to CR/TRP/PPG/CPG text is an inference, not an explicit grant;
(2) the underlying game rules/procedures (the rule *facts*, as opposed to the specific
document's wording) are the kind of functional/procedural content that is often not copyrightable
subject matter at all under general copyright law — but that's a legal question this assessment
cannot resolve.

**Shipping mode: verbatim.** Rationale: the CR/TRP/PPG/CPG chunks are short, procedural,
individually cited by document/section with a `source_url` back to the official document (the
existing `kb/rules` design already matches how a "Rules App" would cite its source), and the
Terms of Use's "Rules Enforcement Applications" clause appears to functionally describe this
exact use. This matches the pre-existing default already coded in `pipeline/src/export.ts`
before this assessment (`rules-kb: verbatim`) — this assessment confirms rather than changes
that default.

**Open item requiring user sign-off, not resolved here:** the "not a commercial entity" clause.
Whether the app/pipeline publisher counts as a "commercial entity" for this clause's purposes is
a business/legal question outside this assessment's scope. If it does, this section's mode is
not actually authorized until the Studio grants "express written permission," and the fallback
would need to be paraphrase or stub instead. **This assessment does not answer that question —
the user must.**

## (b) Card Vault true text

**What it is.** Card ability/rules text sourced live from LSS's own official Card Vault API
(`api.cardvault.fabtcg.com`) — the authoritative current wording per fab-cli's CR 2.0.2
convention (`fab-cli fabtcg card`). This is LSS's own published card text, fetched from LSS's
own official endpoint, not a third-party mirror.

**Whose rights.** Legend Story Studios Limited (same IP statement as (a)).

**Applicable policy/permission.** The Terms of Use page's "Flesh and Blood Card Images" section
names "Platforms and Services": "You may use the FAB Card Images for the creation of card
databases, singles websites, and singles marketplaces. You may not monetize these platforms
directly without express permission... Your permission to use the FAB Card Images in this
manner is at the sole discretion of the Studio." Note the literal wording is "Card **Images**,"
not card text — this page never explicitly separates card ability-text redistribution from
card-image redistribution, so applying the "card database" allowance to text-only chunks (no
images shipped) is again an inference. The same "Third Party Applications... not a commercial
entity" clause from (a) applies here too, since a card database is explicitly listed as a
"Service App" example in that section.

**Shipping mode: verbatim.** Rationale: card text/stats (cost, power, defense, pitch, types,
keywords) is largely factual/functional game data already surfaced verbatim across every
existing fab-cli command (`cards search`, `cards show`, `fabtcg card`) without any prior
objection from LSS, and the "card database" Service App category names this exact use pattern.
Matches the pre-existing default (each `<identity>-brain` and `rules-kb` entry already defaulted
to `verbatim`; the card-vault brain notes fall under (c) below rather than this section, since
they are the judge/player/card-vault identities' own distilled notes, not a live Card Vault API
fetch — the pipeline does not currently export a raw live Card Vault fetch as a separate corpus
source, only the identity brain notes that cite it).

**Open item requiring user sign-off, not resolved here:** same "commercial entity" question as
(a), plus whether reproducing card ability text (not just stats) at verbatim scale across an
entire card corpus is within the spirit of a "card database" grant that literally names images.

## (c) Own-authored brain notes (judge / player / card-vault identities)

**What it is.** The judge, player, and card-vault identity brains' notes
(`.claude/identities/{judge,player,card-vault}/brain/notes/*.md`) — interaction rulings,
keyword-definition notes, strategy notes, and card notes, written by the user (project
maintainer) as original analysis and commentary, per the project's own knowledge-flow rules
(judge brain is the rules source of truth, notes cite CR/TRP/PPG sections and Card Vault
rulings per `.claude/identities/KEYWORD-SYNC.md` and the project's CLAUDE.md).

**Whose rights.** The user's own — this is original authored content, not a redistribution of
someone else's copyrighted expression. Individual notes do quote or closely paraphrase short
excerpts from CR/TRP/PPG sections and Card Vault rulings as citations; those excerpts inherit
whichever status sections (a)/(b) above assign to their underlying source, they don't introduce
a new rights question of their own.

**Applicable policy/permission.** None needed for the user's own prose. The nested citations to
LSS rules/card text are covered by (a)/(b) above.

**Shipping mode: verbatim.** Rationale: this is the SPEC-APP.md §7.10-specified default
("own-authored notes ship verbatim") and there is no third-party rights holder to clear —
shipping the user's own analysis verbatim carries no redistribution-rights risk beyond whatever
risk its cited excerpts already carry under (a)/(b).

**Open item for user sign-off:** none beyond confirming the mode choice itself — this section
carries the lowest rights risk of the four.

## (d) legendarystories.net lore prose

**What it is.** Narrative/lore prose (character bios, world/story pages) from
`https://legendarystories.net`, vendored as the `fablore` git submodule
(`fab-cli/third_party/fablore`) and exposed via `fab-cli lore`. Per fab-cli's own CLAUDE.md,
this is explicitly a **third-party** site — its domain, authorship, and hosting are independent
of `fabtcg.com` / Legend Story Studios. It is not covered by the LSS Terms of Use page fetched
for (a)/(b): that page's grants are LSS's own IP terms and say nothing about a third party's own
compiled prose.

**Whose rights.** Two layers: (1) the legendarystories.net site operator/author's own copyright
in their compiled/written prose and page structure; (2) the underlying Flesh & Blood
story/character IP that prose is itself derived from, which is LSS's (per the same IP statement
as (a)/(b) — "characters... stories... are property of the Studio").

**Applicable policy/permission.** No permission has been sought from, or granted by, the
legendarystories.net site operator to redistribute their prose (verbatim or paraphrased) inside
this pipeline's shipped corpus. No outreach has happened yet. The vendored `about.md` lore page
(already in the local corpus, no fetch needed to find this) identifies the site's author as
Nathan Eastwood and states: "Legend Story Studios for giving me their blessing to make this
site." That "blessing" is LSS's own permission for Nathan Eastwood to operate
legendarystories.net at all (an LSS↔Nathan relationship) — it is not, on its own, permission for
a third party (this pipeline) to redistribute Nathan's compiled prose into a different shipped
product. Any outreach for (d)'s permission should go to Nathan Eastwood directly (contact
channels listed on the same `about.md` page: X/Twitter @JumpForRoy, Discord, or the `fablore`
GitHub repo issues), not to LSS.

**Shipping mode: stub** (title + tags + `source_url`; full text fetched on demand and cached at
runtime, mirroring the image-fetch pattern per SPEC-APP.md Invariant 6, per §7.10). This is the
SPEC-APP.md §7.10-specified default ("lore prose ships as stubs" pending assessment) — this
assessment confirms the default rather than upgrading it, precisely because no permission has
been obtained. Full text stays available for pipeline-internal use (Q&A/behavior/DPO dataset
generation, §7.3-§7.9, and stub-chunk embeddings computed from full text at pack-build time per
§7.10) via the parallel `chunks-fulltext.jsonl` output — see "Exporter enforcement" below — it is
simply never shipped as the retrievable/citable text in the primary corpus artifact until a
permission is obtained.

**Open item for user sign-off:** whether to reach out to Nathan Eastwood (legendarystories.net's
author, contact channels above) for explicit permission to ship lore text verbatim/paraphrased,
or to keep this source at stub mode indefinitely. Until that outreach happens (or the user
decides against it), stub is the only defensible mode for this source.

## Exporter enforcement (mechanical, not just documentation)

`pipeline/config/shipping-modes.json` is the committed, machine-readable mirror of the modes
recorded above (source name → mode, using the same source names the corpus snapshot manifest
already uses: `judge-brain`, `player-brain`, `card-vault-brain`, `rules-kb`, `lore`).
`pipeline/src/export.ts` reads this config (via `pipeline/src/shippingModes.ts`) instead of
hardcoding mode strings, and — new as of this assessment — actually enforces it on the chunk set
it emits, not just on the manifest's `shippingMode` label:

- **Primary output (`out/chunks.jsonl`)**: stub-mode sources' chunks keep `chunk_id`, `title`,
  `tags`, and `source` (source URL), but their `text` is replaced with a short stub marker. This
  is the file any downstream knowledge-pack build or runtime distribution reads — a stub-mode
  source therefore genuinely ships no verbatim text in the primary artifact, not just a
  manifest annotation saying so.
- **Parallel output (`out/chunks-fulltext.jsonl`)**: every chunk's real, unmodified text,
  regardless of shipping mode. This file is for pipeline-internal use only — §7.3-§7.9's
  Q&A/behavior/DPO dataset generation needs full source text to generate against even for
  stub-mode sources, and §7.10 requires stub-chunk embeddings to be computed from full text at
  knowledge-pack build time. It is never the thing that ships to a device.
- A source with no entry in `shipping-modes.json` (or a chunk whose derived source doesn't match
  any known source) is a **loud failure** at export time, not a silent verbatim default — see
  `pipeline/src/shippingModes.ts`'s `applyShippingModes`. Shipping unassessed content verbatim
  by default would defeat the point of this whole assessment.
- The corpus snapshot manifest's `contentHash`/`chunkCount` are still computed from the full,
  unmodified chunk set (i.e. from what `chunks-fulltext.jsonl` carries) — a source's shipping
  mode changing (e.g. lore going from stub to verbatim after a future sign-off) is a
  redistribution-policy decision, not new corpus content, and shouldn't fabricate a new content
  hash on its own.

**Known follow-up gap, explicitly out of this task's scope (APP-017 scope was
`pipeline/src/{export,manifest,sources}/**` + config + docs + tests, not the dataset/qa/sampling/
behavior lanes):** `pipeline/src/{qa,sampling,behavior,dataset}/cli.ts` currently all read
`out/chunks.jsonl` directly for full source text during dataset generation. Once this PR ships,
lore chunks in `chunks.jsonl` are stubbed, so those CLIs would generate against stub-marker text
for lore instead of real prose unless they're repointed at `out/chunks-fulltext.jsonl`. That
repointing is real follow-up work for a later task — flagged here so it isn't lost, not silently
fixed by editing those lanes' source under this task.

## User sign-off — RECORDED 2026-08-02

**All four items below were signed off by the user in-session on 2026-08-02** (recorded
verbatim on issue #126). The shipping modes in the table are now cleared-for-release
decisions, no longer best-effort defaults.

1. Commercial-entity question — user: "Not a problem. Already covered."
2. Service-App categories covering rules/card text — user: "Other platforms do
   carddatabase. that is allowed."
3. Nathan Eastwood / lore outreach — user: "His license for what he did is free. We dont
   need to worry on LSS as well. Just do correct attribution of sources and ownership."
   → No outreach required. **Attribution of sources and ownership is a release
   requirement across all shipped corpus content.**
4. Mode table — user: "I signoff on all of those":

   | Source | Mode | Status |
   |---|---|---|
   | `judge-brain` / `player-brain` / `card-vault-brain` (own-authored notes) | verbatim | signed off 2026-08-02 |
   | `rules-kb` (CR/TRP/PPG/CPG) | verbatim | signed off 2026-08-02 |
   | `lore` (legendarystories.net) | stub | signed off 2026-08-02 |

Open follow-up (non-blocking, decided separately if wanted): per answer 3 the lore license
permits use with attribution, so flipping lore from stub to verbatim-with-attribution is
available via a future spec delta; the signed table keeps lore = stub until such a decision.

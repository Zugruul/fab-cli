# fab-cli — Hardening, Rules Knowledge & Coverage Tools Spec

## §1 Overview

fab-cli is a TypeScript CLI (tsx-run, no build step) for the Flesh & Blood TCG: deck/card/meta search via fabrary.net, tournament coverage via fabtcg.com, and a lore knowledge base. This spec covers three thrusts: (a) retrofitting a quality foundation (tests, lint, gate) onto the working codebase; (b) an official **rules knowledge base** with citation-mandatory answers plus advisory **player** and **judge** agent identities; (c) new coverage/analysis features — a live player-follow terminal UI, matchup prep, card rulings, and JSON output. An AI-opponent simulator and a web live-view are research-only in this spec (§12).

**Delivery order: brains > CLI tooling (quality/refactor) > CLI features > everything else.**

## §2 Goals

- G1: A single merge-gating command (`npm run gate`) runs typecheck + lint + format check + unit tests, green on main.
- G2: `src/cli.ts` (40KB) is decomposed into per-namespace command modules with zero behavior change.
- G3: `fab-cli rules` answers FAB rules questions from locally indexed **official** documents with source citations, escalating to the judge Discord when confidence is low.
- G4: Player and judge advisory identities exist with brains seeded by deep research over the rules KB — usable in-session for gameplay and ruling questions.
- G5: `fab-cli fabtcg follow` tracks a player through a live tournament in an auto-updating terminal view.
- G6: Card rulings, matchup prep, and `--json` output extend the existing fabrary surface.

## §3 Non-goals

This spec builds a **CLI toolbox**. The following are deferred decisions — no tasks, no research docs now; we decide what to do when the toolbox is in place:

- **AI opponent / game simulator** — future spec. Reference kept for then: hand-value heuristics discussion https://www.reddit.com/r/FleshandBloodTCG/comments/1478ve0/heuristics_for_card_rates/
- **Web page for live follow** — plain CLI first; a browser view is a later decision.
- **Discord #ask-a-judge search** — v1 only prints the escalation link; channel search is a later decision.
- **Any TUI framework** — commands are plain CLI (chalk/cli-table3), no Ink/blessed.
- **Other TCGs** — no rules, terms, cards, or mechanics from Magic: The Gathering, Pokémon, Yu-Gi-Oh!, One Piece, or any other game may enter the KB, brains, code, or answers. FAB only.
- **Deck legality checker command** — out of scope for v1 (the legality *page* is in the KB; a deck validator is not).
- No CI pipeline, no npm publishing, no build step.

## §4 Glossary / domain

- **CC** — Classic Constructed, the primary competitive format (adult heroes). **SA** — Silver Age (young heroes; the user calls it "Sage"). **LL** — Living Legend: both the *format* (eternal, all heroes) and the *rotation system* (adult heroes retire from CC at 1000 LL points alongside their signature weapon; young heroes formerly retired from Blitz at 500 — Blitz is now singleton and not competitively supported). **UPF** — Ultimate Pit Fight. Limited = draft/sealed.
- **CR** — Comprehensive Rules (https://rules.fabtcg.com/txt/latest/en-fab-cr.txt): full game rules and interactions. Primary source for *player* knowledge.
- **TRP** — Tournament Rules and Policy (https://rules.fabtcg.com/txt/latest/en-fab-trp.txt). Primary source for *judge* knowledge alongside CR.
- **PPG** — Penalty and Procedure Guide (https://rules.fabtcg.com/txt/latest/en-fab-ppg.txt). Judge-focused; players need only enough to recognize a mis-applied penalty, never to rules-lawyer.
- **Casual Procedure Guide** — official guide to running casual tournaments (PDF, vendored in `docs/references/`).
- **Card Legality Policy** — https://fabtcg.com/rules-and-policy-center/card-legality-policy/ — banned cards + LL rotation state. **Changes seasonally; must never be answered from cache** (§10 I2).
- **Card Vault** — https://cardvault.fabtcg.com/ — official card database with per-card rulings.
- **Pitch / arsenal / combat chain / go again / reaction window** — core game concepts per CR; the KB, not this spec, is the reference for their semantics.
- **Talishar** — community web simulator (https://talishar.net/); the primary way to play remains paper.

## §5 Architecture

Existing modules stay: `algolia.ts`, `graphql.ts`, `cognito.ts`, `config.ts`, `display.ts`, `stats.ts`, `meta.ts`, `fabtcg.ts`, `lore.ts`. New/changed:

- `src/commands/*.ts` — Commander registration split per namespace (`fabrary`, `fabtcg`, `cards`, `lore`, `rules`); `cli.ts` shrinks to wiring. (Why: 40KB single file blocks safe parallel work.)
- `src/http.ts` — shared fetch helper: browser headers, retry/backoff, bounded concurrency, and an opt-in TTL file cache (`~/.cache/fab-cli/`). (Why: dedupe logic scattered across modules; the follow poller and WAF etiquette need it.)
- `third_party/flesh-and-blood-cards` — git submodule of https://github.com/the-fab-cube/flesh-and-blood-cards (community-maintained full card database, JSON/CSV). Powers offline card search and card knowledge for the brains. (Why: complete card corpus, versioned, no API dependency — same vendoring pattern as fablore.)
- `src/carddb.ts` — offline card search over the submodule: `fab-cli cards local <query>` with filters mirroring the online `cards search` flags where the data supports them.
- `src/rules.ts` — rules KB following the proven `lore.ts` pattern: sync → chunked markdown + frontmatter (`kb/rules/`, index git-ignored) → search/show with `source_url` citations. Sources: CR, TRP, PPG (txt), Casual Procedure Guide (vendored PDF→text), legality policy (HTML→text, **never cached**).
- `src/follow.ts` — live tournament follow: poll coverage pages on an interval, plain CLI output — initial summary then appended line-per-update (no TUI framework; decided against Ink/ANSI redraw, keeping the chalk/cli-table3 stack).
- `.claude/identities/{player,judge}/brain/` — advisory identity brains (zettel notes citing KB sources), registered in `.claude/project.yaml` `delegation.identities`.
- Tests: vitest, all HTTP mocked via fixtures (`test/fixtures/`).

## §6 Quality foundation (E0, E1)

- 6.1 THE SYSTEM SHALL provide `npm run gate` running typecheck, eslint, prettier check, and vitest unit tests; a non-zero exit from any step fails the gate.
- 6.2 THE SYSTEM SHALL mock all network access in unit tests; WHEN the test suite runs with network disabled THE SYSTEM SHALL still pass.
- 6.3 THE SYSTEM SHALL keep `bin/fab.js` + tsx direct execution working (no build step introduced).
- 6.4 WHEN `cli.ts` is decomposed into `src/commands/*` THE SYSTEM SHALL produce byte-identical `--help` output for every existing command.
- 6.5 Pure computation (stats, meta aggregation, hero/format aliases, similarity) and the fabtcg HTML parsers SHALL each have unit tests against fixtures.

## §7 Rules knowledge base (E2)

- 7.1 WHEN `fab-cli rules sync` runs THE SYSTEM SHALL fetch CR, TRP, and PPG from `rules.fabtcg.com/txt/latest/` and the Card Legality Policy page, storing them chunked-by-section with frontmatter (`title`, `source_url`, `document`, `section`) under `kb/rules/`.
- 7.2 THE SYSTEM SHALL include the vendored Casual Procedure Guide (docs/references/) in the KB with a citation to its provenance.
- 7.2a THE SYSTEM SHALL also ingest official **Rules Reprise / release-notes articles** from fabtcg.com (e.g. https://fabtcg.com/articles/rules-reprise-omens-of-the-third-age-limited/), discovered per set, since they carry rule/keyword changes.
- 7.2b Rules change over time (keywords redefined, interactions altered): every KB chunk's frontmatter SHALL carry `document`, `version`/`fetched_at`; WHEN a re-sync fetches a newer document version THE SYSTEM SHALL replace the superseded chunks (no stale duplicates), and answers SHALL state the version they cite ("as of CR vX.Y").
- 7.3 WHEN `fab-cli rules search <query>` runs THE SYSTEM SHALL return ranked chunks each labeled with document + section + source URL, auto-refreshing sources older than 7 days (TTL overridable via env).
- 7.4 IF a query or `show` touches legality-policy content THEN THE SYSTEM SHALL re-fetch the legality policy live before answering, regardless of TTL (§10 I2).
- 7.5 WHEN `fab-cli rules ask "<question>"` runs THE SYSTEM SHALL print the most relevant KB passages with citations AND always print the escalation line: judge Discord `#ask-a-judge` — https://discord.com/channels/874145774135558164/1020649907314495528 — prominently marked as the authoritative human channel when passages don't settle the question.
- 7.6 WHEN `fab-cli fabrary cards show` displays a card THE SYSTEM SHALL fetch and display that card's official rulings from Card Vault (WHERE none exist, print "no official rulings").
- 7.7 THE SYSTEM SHALL vendor the flesh-and-blood-cards submodule and WHEN `fab-cli cards local <query>` runs THE SYSTEM SHALL search the full card corpus offline (name, text, type, class, pitch, keywords), printing each card's data with its submodule provenance; sync follows the fablore pattern (postinstall init + on-demand update).

## §8 Player & judge identities (E3)

- 8.1 THE SYSTEM SHALL register `player` and `judge` advisory (non-coding) identities in `.claude/project.yaml` with brains under `.claude/identities/<role>/brain/`.
- 8.0 Brain seeding is the FIRST work of this spec (unblocked by other epics): sources are the live official documents (rules.fabtcg.com, fabtcg.com) and the official learn-to-play material (video transcript vendored in docs/references/), with KB cross-links added once E2 lands. The base gameplay loop (intellect/hand refill, pitch economy, action + go again, arsenal, combat chain, reaction windows, first-turn rule) must be covered comprehensively.
- 8.2 The **player** brain SHALL be seeded by deep research over the CR + gameplay resources: turn structure, pitch economy, combat chain, arsenal, first-turn rule, format landscape (CC/SA primary; Blitz singleton legacy; LL eternal), hand-value fundamentals. Focus: playing well; TRP awareness light, PPG only to recognize mis-applied penalties.
- 8.3 The **judge** brain SHALL be seeded by deep research over TRP + PPG + CR + the Casual Procedure Guide: tournament conduct, penalties, procedures, rules Q&A.
- 8.4 Every brain note asserting a game fact SHALL cite its KB source (document + section). Notes about card legality SHALL contain only the *pointer* to the live policy, never the list itself (§10 I2).
- 8.6 Beyond documents, the brains SHALL learn the CARDS: the full corpus is retrievable via the vendored card DB (§7.7) — brains hold pointers into it plus minted notes on **specific hard card interactions** (player: how to leverage them; judge: how to rule them), each citing card identifiers + CR/rulings sources. Card-interaction memory grows continuously; it is never considered "done".
- 8.5 Both identities' ROLE.md SHALL instruct: answer only from KB/live official sources; escalate unsettled questions to `#ask-a-judge`; never import other-TCG concepts.

## §9 Coverage & analysis features (E4, E5)

- 9.1 WHEN `fab-cli fabtcg follow <event> <player>` runs THE SYSTEM SHALL resolve the player (reusing `--search-player` matching), then print a summary: header (event, player, per-format hero), per-round table (round, format, opponent, opposing hero, result), current record, and current standing when available.
- 9.2 WHILE following THE SYSTEM SHALL re-poll coverage on an interval (default 60s, `--interval` flag) and print each new round/standing change as an appended timestamped line (plain CLI output, no screen redraw).
- 9.3 WHEN the event publishes final standings THE SYSTEM SHALL render the final result and exit cleanly; Ctrl-C SHALL also exit cleanly at any time.
- 9.4 THE SYSTEM SHALL route fabtcg polling through the shared HTTP layer with TTL caching so unchanged rounds are not re-parsed and request rate stays polite (≤5 concurrent, backoff on 4xx/5xx).
- 9.5 WHEN `fab-cli fabrary prep --hero <X> --vs <Y>` runs THE SYSTEM SHALL aggregate, from top decks of X with results, the X-vs-Y matchup: win rate + game count, and every available matchup guide for Y (sideboard diffs, turn-order preference, notes), labeled per source deck.
- 9.6 WHERE `--json` is passed on search/top/deck/meta/cards/fabtcg-coverage commands THE SYSTEM SHALL emit machine-readable JSON to stdout with no ANSI/table decoration.

## §10 Invariants

- I1: Never answer a Flesh & Blood rules, lore, or card-legality question from model memory or cached agent notes alone — every game-fact claim must cite a source retrieved from the local KB or a live official page at answer time.
- I2: Card legality (bans, Living Legend rotation) must be re-fetched live from https://fabtcg.com/rules-and-policy-center/card-legality-policy/ every time it is asserted — never served from cache, brain notes, or memory; brain notes may only point at the policy, never enumerate it.
- I3: Never mix content from other card games (Magic: The Gathering, Pokémon TCG, Yu-Gi-Oh!, One Piece TCG, or any other) into FAB code, KB, brains, or answers.
- I4: All merge-gating tests must pass with the network disabled; live HTTP happens only behind explicit user commands, never in the gate.
- I5: Respect upstream services: AppSync GraphQL concurrency ≤4 with retry/backoff (WAF 403s are rate limits, not auth failures — never re-login to fix them); fabtcg.com ≤5 concurrent with browser headers.
- I6: The CLI must keep running via `bin/fab.js` + tsx with no build step; `npm i -g . --force` remains the install path.
- I7: When rules passages do not clearly settle a question, the answer must say so and point to the judge Discord #ask-a-judge channel rather than guess.
- I8: Vendored knowledge submodules (third_party/fablore, third_party/flesh-and-blood-cards) and the rules KB must be kept regularly up to date: refresh before use when older than their TTL (24h default), and commit pin bumps. Stale vendored data must never silently answer a freshness-sensitive question.

## §11 Non-functional & testing strategy

- Merge-gating: `npm run gate` (typecheck + eslint + prettier + vitest, network-free). Advisory: manual live smoke of touched commands (documented per PR).
- Test pyramid: many unit tests on pure logic and parsers with fixtures; thin command-level tests asserting output shape; no e2e against live services in the gate.
- Performance: `rules search` answers offline in <1s after sync; follow polling default 60s; KB sync is the only long-running network operation.
- `kb/rules/` derived index and sync state are git-ignored (rebuildable), mirroring `lore/`.

## §12 Deferred decisions

Formerly research epics — removed from the backlog 2026-07-10 ("focus on CLI first; toolbox now, decide the rest when the time comes"). When the toolbox lands, revisit: web live-follow page, AI opponent simulator (see §3 heuristics reference), Discord #ask-a-judge search.

## §13 Open questions — all resolved 2026-07-10

- Q1 → RESOLVED: reuse the lore indexer pattern (frontmatter markdown + rebuildable JSON index), extended with version metadata (§7.2b).
- Q2 → RESOLVED (revised 2026-07-10): no TUI framework — plain CLI output, summary + appended update lines (§5, §9.2). Ink considered and rejected.
- Q3 → RESOLVED: yes — ingest Rules Reprise / release-notes articles per set (§7.2a); rules evolve, KB supersession required (§7.2b).

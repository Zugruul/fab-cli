# fab-cli backlog — spec: SPEC.md (prefix FAB)

Ranges: E0=001–009, E1=010–019, E2=020–029, E3=030–039, E4=040–049, E5=050–059, infra=090–099.
Build order (brains > cli tooling > cli features > others): E3 (brain seeding) FIRST and unblocked — then E0 → E1 → {E2, E4, E5}. Former E6 research tasks removed (SPEC §12: deferred decisions).
Priority order P0 > P1 > P2. Points ≈ complexity incl. testing. DoD for every task: `npm run gate` green, README/CLAUDE.md updated if the command surface changed, spec §s satisfied.

## E0 — Quality foundation (001–009) — no guard

### FAB-001 · Gate toolchain: vitest + eslint + prettier + `npm run gate` · P0 · 5pt · §6.1 §6.3 §10 I6
Install and configure vitest, eslint (typescript-eslint), prettier. Add npm scripts `typecheck`, `lint`, `format:check`, `test:run`, and `gate` chaining all four. One smoke unit test proves the runner works.
**AC:** `npm run gate` exits 0 on a clean tree; each sub-step failing fails the gate; `fab-cli --help` still runs via tsx with no build step.

### FAB-002 · HTTP mocking harness + fixtures layout · P0 · 3pt · §6.2 §10 I4
Test helper that intercepts fetch (undici MockAgent or msw), `test/fixtures/` conventions for HTML/JSON captures, example test exercising one fabtcg fetch fully offline.
**AC:** example test passes with network disabled (`NODE_OPTIONS`/agent-level block); unmocked requests fail the test loudly.

### FAB-003 · Unit tests: pure computation modules · P0 · 5pt · §6.5
Cover `stats.ts` (win rates, composition, hand probabilities), `meta.ts` aggregation/momentum math, format/hero alias resolution, deck similarity math.
**AC:** each listed area has tests with realistic fixture data; edge cases (0 games, draws, missing sources) covered.

### FAB-004 · Unit tests: fabtcg HTML parsers · P0 · 5pt · §6.5 §6.2
Fixture pages (coverage index, round results, standings, decklist) captured into `test/fixtures/fabtcg/`; tests for pairings parsing, dual-format hero detection, byes, standings parsing.
**AC:** parsers tested offline against real captured HTML; known quirks (R1 byes, dual-format double-count) asserted.

## E1 — CLI decomposition & UX (010–019) — blocked by E0

### FAB-010 · Split `cli.ts` into `src/commands/*` modules · P0 · 5pt · §6.4 §5
One module per namespace (fabrary, fabtcg, cards, lore + future rules), `cli.ts` becomes wiring. Zero behavior change.
**AC:** `--help` output byte-identical for every command (snapshot test); gate green.

### FAB-011 · Shared HTTP layer `src/http.ts` · P0 · 5pt · §5 §9.4 §10 I5
Consolidate fetch: browser headers for fabtcg, retry/backoff, concurrency limits (AppSync ≤4, fabtcg ≤5), opt-in TTL file cache in `~/.cache/fab-cli/`. Migrate `fabtcg.ts` + `meta.ts` onto it.
**AC:** duplicated header/retry code removed; cache hit skips network (tested); WAF-403 backoff behavior preserved and tested.

### FAB-012 · `--json` output flag · P1 · 5pt · §9.6
Global flag; implement for `fabrary search/top/deck`, `meta`, `cards search/show`, `fabtcg events/coverage`.
**AC:** `--json` emits parseable JSON, no ANSI; documented; snapshot tests per command.

## E2 — Rules knowledge base (020–029) — blocked by E1

### FAB-020 · Vendor Casual Procedure Guide + `rules sync` for CR/TRP/PPG/legality · P1 · 5pt · §7.1 §7.2 §7.2b §10 I3
`src/rules.ts` + `rules` namespace. Fetch the three txt documents + legality policy page; chunk by section into `kb/rules/` with frontmatter (`title`, `source_url`, `document`, `section`, `version`/`fetched_at`). Convert the vendored Casual Procedure Guide PDF (docs/references/) to KB pages. Re-sync replaces superseded chunks (no stale duplicates).
**AC:** `fab-cli rules sync` populates `kb/rules/`; every chunk has a resolvable `source_url` + version metadata; re-running sync after a doc version bump leaves no stale chunks; index git-ignored; no non-FAB content.

### FAB-021 · `rules search` / `rules show` with citations + TTL refresh · P1 · 5pt · §7.3 §7.4 §10 I1 I2
Ranked search over the KB printing document + section + source URL; auto-resync when stale (7d TTL, env-overridable); legality-policy content always re-fetched live regardless of TTL.
**AC:** offline search <1s post-sync; stale KB triggers refresh; a legality query provably hits the network every time (tested via mock call counts).

### FAB-022 · `rules ask "<question>"` with Discord escalation · P1 · 5pt · §7.5 §10 I1 I7
Retrieval-composed answer: top passages with citations, then always the escalation footer to judge Discord #ask-a-judge (link in §7.5), highlighted when passages don't clearly settle the question.
**AC:** answers contain only KB-sourced text + citations; escalation link always present; low-relevance queries visibly recommend asking a judge.

### FAB-024 · Rules Reprise / release-notes ingestion · P1 · 5pt · §7.2a §7.2b
Discover per-set Rules Reprise + release-notes articles on fabtcg.com (WP API/article listing), ingest into the KB with citations and set association; they carry keyword/rule changes so supersession metadata matters.
**AC:** `rules sync` picks up Rules Reprise articles (e.g. Omens of the Third Age); chunks cite article URLs; `rules search` surfaces them alongside CR/TRP/PPG hits.

### FAB-025 · Vendor flesh-and-blood-cards submodule + `cards local` offline search · P1 · 5pt · §7.7 §5
Add https://github.com/the-fab-cube/flesh-and-blood-cards as `third_party/flesh-and-blood-cards` (fablore vendoring pattern: postinstall init, on-demand update). `src/carddb.ts` + `fab-cli cards local <query>` searching name/text/type/class/pitch/keywords offline.
**AC:** full-corpus search works offline; filters match online `cards search` flags where data supports them; submodule pin committed; fixture-tested parser over the submodule's JSON.

### FAB-023 · Card rulings in `cards show` (Card Vault) · P1 · 5pt · §7.6
Fetch official rulings for the displayed card from cardvault.fabtcg.com; render dated rulings list; "no official rulings" when empty.
**AC:** rulings shown with source URL; offline/fixture-tested parser; graceful fallback when card not found on Card Vault.

## E3 — Player & judge identities (030–039) — FIRST, no guard

### FAB-030 · Register advisory identities + ROLE.md protocols · P0 · 2pt · §8.1 §8.5 §10 I1 I2 I3 I7
`player` and `judge` in `.claude/project.yaml` delegation.identities (non-coding, no models needed for commits); brain scaffolds `.claude/identities/{player,judge}/brain/`; ROLE.md encoding: cite-or-silence, live legality re-fetch, no other TCGs, Discord escalation.
**AC:** `board.sh config` still VALID; ROLE.md states all four invariants verbatim or stronger.

### FAB-031 · Deep-research seed: player brain · P0 · 8pt · §8.0 §8.2 §8.4
Research over live official docs (CR primary, rules.fabtcg.com) + fabtcg.com gameplay pages + the vendored learn-to-play transcript: base gameplay loop (intellect/hand refill, pitch economy, action + go again, arsenal, combat chain + reaction windows, first-turn rule), format landscape, hand-value fundamentals. Mint cited zettel notes with [[synapse]] links; legality notes are pointers only.
**AC:** every note cites document+section; zero other-TCG terminology; a spot-check question ("how does the reaction window work?") is answerable from notes' citations alone.

### FAB-032 · Deep-research seed: judge brain · P0 · 8pt · §8.0 §8.3 §8.4
Same protocol over live TRP + PPG + CR + vendored Casual Procedure Guide: tournament conduct, penalty categories, procedures, common rulings.
**AC:** as FAB-031; penalty knowledge cites PPG sections; casual-event procedure cites the vendored guide.

### FAB-033 · Seed hard card-interaction memories (player + judge) · P1 · 5pt · §8.6 §8.4
Using the vendored card DB (§7.7) + CR + Card Vault rulings: mint notes on specific hard card interactions — player notes on leveraging them, judge notes on ruling them — each citing card identifiers + sources. Ongoing capability; this task seeds the first comprehensive batch.
**AC:** ≥20 interaction notes per brain, all cited; zero other-TCG content; [[links]] connect interactions to the base-mechanics notes.

## E4 — Live follow CLI (040–049) — blocked by E1

### FAB-040 · `fabtcg follow <event> <player>`: resolution + summary output · P1 · 5pt · §9.1 §5
Resolve player via existing search-player matching; plain CLI summary (chalk/cli-table3): header (event, player, per-format heroes), per-round table, current record, standing when available. Single-shot output first (no loop yet).
**AC:** summary renders correctly from fixtures incl. dual-format events; unknown player → helpful candidates list.

### FAB-041 · Live polling loop + appended updates · P1 · 5pt · §9.2 §9.3 §9.4
`--interval` (default 60s) polling through the cached HTTP layer; each new round/standing change printed as an appended timestamped line; final-standings detection ends the session; clean Ctrl-C.
**AC:** unchanged poll causes no re-parse (cache hit tested) and prints nothing; new rounds print once each; exits cleanly on final standings and on SIGINT.

## E5 — Fabrary analysis (050–059) — blocked by E1

### FAB-050 · `fabrary prep --hero X --vs Y` matchup prep sheet · P2 · 5pt · §9.5
Aggregate from top X decks with results: X-vs-Y win rate + games, and each deck's Y matchup guide (sideboard diff, turn order, notes), labeled per source deck.
**AC:** output covers ≥ the data `deck --matchup` exposes today, aggregated across decks; heroes without data explain why; fixtures-tested.

## Former E6 — removed 2026-07-10
Research docs (web live-follow page, AI simulator, Discord search) deleted from the board: SPEC §12 records them as deferred decisions to revisit once the CLI toolbox is done.

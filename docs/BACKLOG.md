# fab-cli backlog — spec: SPEC.md (prefix FAB)

Ranges: E0=001–009, E1=010–019, E2=020–029, E3=030–039, E4=040–049, E5=050–059, E6=060–069, infra=090–099.
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

### FAB-023 · Card rulings in `cards show` (Card Vault) · P1 · 5pt · §7.6
Fetch official rulings for the displayed card from cardvault.fabtcg.com; render dated rulings list; "no official rulings" when empty.
**AC:** rulings shown with source URL; offline/fixture-tested parser; graceful fallback when card not found on Card Vault.

## E3 — Player & judge identities (030–039) — blocked by E2

### FAB-030 · Register advisory identities + ROLE.md protocols · P1 · 2pt · §8.1 §8.5 §10 I1 I2 I3 I7
`player` and `judge` in `.claude/project.yaml` delegation.identities (non-coding, no models needed for commits); brain scaffolds `.claude/identities/{player,judge}/brain/`; ROLE.md encoding: cite-or-silence, live legality re-fetch, no other TCGs, Discord escalation.
**AC:** `board.sh config` still VALID; ROLE.md states all four invariants verbatim or stronger.

### FAB-031 · Deep-research seed: player brain · P1 · 8pt · §8.2 §8.4
Research over the synced KB (CR primary) + fabtcg.com gameplay pages: turn structure, pitch economy, combat chain, arsenal, first-turn rule, format landscape, hand-value fundamentals. Mint cited zettel notes; legality notes are pointers only.
**AC:** every note cites document+section; zero other-TCG terminology; a spot-check question ("how does the reaction window work?") is answerable from notes' citations alone.

### FAB-032 · Deep-research seed: judge brain · P1 · 8pt · §8.3 §8.4
Same protocol over TRP + PPG + CR + Casual Procedure Guide: tournament conduct, penalty categories, procedures, common rulings.
**AC:** as FAB-031; penalty knowledge cites PPG sections; casual-event procedure cites the vendored guide.

## E4 — Live follow TUI (040–049) — blocked by E1

### FAB-040 · `fabtcg follow <event> <player>`: resolution + Ink dashboard render · P1 · 5pt · §9.1 §5
Resolve player via existing search-player matching; Ink (React TUI) dashboard: header (event, player, per-format heroes), per-round table, current record, standing when available. Single-shot render first (no loop yet).
**AC:** dashboard renders correctly from fixtures incl. dual-format events; unknown player → helpful candidates list.

### FAB-041 · Live polling loop + in-place redraw · P1 · 5pt · §9.2 §9.3 §9.4
`--interval` (default 60s) polling through the cached HTTP layer; Ink state-driven re-render; new-round highlight; final-standings detection ends the session; clean Ctrl-C.
**AC:** unchanged poll causes no re-parse (cache hit tested); render updates in place; exits cleanly on final standings and on SIGINT.

## E5 — Fabrary analysis (050–059) — blocked by E1

### FAB-050 · `fabrary prep --hero X --vs Y` matchup prep sheet · P2 · 5pt · §9.5
Aggregate from top X decks with results: X-vs-Y win rate + games, and each deck's Y matchup guide (sideboard diff, turn order, notes), labeled per source deck.
**AC:** output covers ≥ the data `deck --matchup` exposes today, aggregated across decks; heroes without data explain why; fixtures-tested.

## E6 — Research docs (060–069) — no guard

### FAB-060 · Design doc: web live-follow page · P2 · 3pt · §12.1
Approach/stack for a dynamically updating browser page reusing the follow data layer. → `docs/design/live-follow-web.md`.
**AC:** doc compares ≥2 approaches, recommends one, lists spec-delta requirements for a future epic.

### FAB-061 · Design doc: AI opponent simulator · P2 · 5pt · §12.2 §3
Survey hand-value/card-rate heuristics (incl. the Reddit thread in §3), matchup-value modeling, engine scope. → `docs/design/simulator.md`.
**AC:** doc defines simulator MVP scope, heuristic candidates with sources, and what a future spec must decide.

### FAB-062 · Design doc: Discord #ask-a-judge search · P2 · 2pt · §12.3
API/auth/ToS options for searching the judge channel (e.g. two-card interaction lookups). → `docs/design/discord-judge-search.md`.
**AC:** doc covers Discord API constraints, auth model, ToS risk, and a recommended path.

# fab-cli — Talishar Development Aid Spec

## §1 Overview

Talishar (https://talishar.net/) is the open-source, community-run web client for playing Flesh & Blood online: a PHP game engine (`Talishar/Talishar`), a React SPA (`Talishar/Talishar-FE`), and a card-image pipeline (`Talishar/CardImages`). fab-cli already holds deep FAB knowledge — card-vault/judge/player brains, the vendored the-fab-cube card DB (the *same* dataset Talishar's card-code generator consumes), official rules, and Card Vault true-text access. This spec turns that knowledge into development aid for Talishar: vendored working copies of the three repos wired to the user's forks, a **talishar identity brain** that knows the engine architecture and the card-implementation recipe, a **/talishar-implement-card** pipeline that takes a newly announced card from research dossier to a PR-ready branch on the fork, a **/talishar-fork-sync** maintenance skill, a deep architecture document, and a latency/bug/DX audit. We are contributors, not maintainers: everything lands as upstream-friendly branches on `Zugruul/*` forks, and a human creates every upstream PR.

**Delivery order: vendoring & fork plumbing > architecture doc + brain > card pipeline > audit.**

## §2 Goals

- G1: The three Talishar repos are vendored under `third_party/` as gitignored clones with `origin` = the user's fork and `upstream` = the Talishar org repo, reproducible on a fresh checkout via one bootstrap script.
- G2: `/talishar-fork-sync` keeps the forks synced with upstream (fast-forward main, rebase open branches, divergence report) in one invocation.
- G3: `docs/TALISHAR-ARCHITECTURE.md` explains the full system — engine request pipeline, DecisionQueue/Await model, ClassState, card recipe, FE SSE state flow, image pipeline, local dev — with every claim citing a vendored file path or upstream PR.
- G4: A `talishar` advisory identity brain answers architecture and "how do I implement card X" questions from cited notes, linking to card-vault notes for card facts instead of duplicating them.
- G5: `/talishar-implement-card <card>` produces a research dossier, a working implementation branch pushed to the fork, processed card images, and a prepared PR title/body following upstream conventions — stopping short of PR creation.
- G6: A latency/performance/bug/DX audit document ranks concrete findings; the top findings are filed as board tasks.

## §3 Non-goals

- **No hosted instance** — we never run or deploy a public Talishar server; the docker stack is local-dev only.
- **No engine rewrite** — no porting the PHP engine, no websocket rearchitecture, no framework adoption; changes stay incremental and mergeable upstream.
- **No PR automation against Talishar org repos** — tooling never opens, marks ready, or merges PRs there; drafts are prepared as text, the human creates the PR (§10 I1).
- **No card-image redistribution** — copyrighted card images are never committed to fab-cli; processing is transient, output goes only to fork branches/pipelines that upstream already uses.
- **No FaB3D / data-doll vendoring** — only the three web-play repos; the C# 3D client and the Go side-project are out of scope.
- **No CLI namespace** — this spec ships skills, scripts, docs, and a brain; no new `fab-cli talishar` command surface in v1.

## §4 Glossary / domain

- **Engine / BE** — `Talishar/Talishar`, the PHP monolith serving game logic via ~45 REST endpoints in `APIs/`.
- **FE** — `Talishar/Talishar-FE`, Vite + React 18 + Redux Toolkit SPA (talishar.net).
- **CardImages** — `Talishar/CardImages`, scripts that download, resize, square-crop, and upload card images consumed by FE/BE via `images.talishar.net`.
- **GameFile** — flat whitespace-delimited text file `/Games/{gameName}/GameFile.txt` holding a game's entire state; parsed by `ParseGamestate.php`, written by `WriteGamestate.php`. MySQL holds only accounts/lobbies; Redis + APCu cache hot state.
- **DecisionQueue (DQ)** — the engine's asynchronous player-choice mechanism (`DecisionQueue/`): queued operations that run after the surrounding synchronous code.
- **Await** — the modern DQ wrapper (`AwaitEffects.php`, functions ending `Await`) passing state via the global `$dqVars` array instead of legacy `$lastResult` chaining.
- **Layer stack** — pending triggers/effects resolved via `AddLayer(...)`; combat resolves through `CombatChain.php`.
- **ClassState** — per-player, per-turn counters (`$CS_*` constants in `Constants.php`) tracked in the GameFile; adding one touches Constants.php + `MenuFiles/StartHelper.php` + the increment site (the "3-file dance").
- **Card ID** — Talishar's card identifier: lowercase underscored name + pitch-color suffix (e.g. `astral_strike_red`); the implementing PHP class name equals the card ID. Cards are also referenced by set code + number (e.g. OMN145).
- **Card recipe** — the standard implementation pattern: generated stats + a `Card` subclass in `Classes/CardObjects/{SET}Cards.php` (§5, §8).
- **zzCardCodeGenerator.php** — generator that pulls card stats/types/keywords from the the-fab-cube dataset into `GeneratedCode/`; stats are generated, behavior is hand-written.
- **SSE channel** — `GetUpdateSSE.php`, the Server-Sent Events endpoint pushing full game state (+ `typing`, `presence`, `hb` heartbeat events) to the FE's `EventSource` in `GameStateHandler.tsx`.
- **True text** — the authoritative current card wording per Card Vault (cardvault.fabtcg.com), CR 2.0.2.
- **Fork contract** — `origin` = `Zugruul/<repo>` (push target), `upstream` = `Talishar/<repo>` (fetch-only). Forks of FE/CardImages are created on demand via `gh repo fork`.

## §5 Architecture

New fab-cli-side pieces (no changes to existing `src/` modules):

- `third_party/talishar/`, `third_party/talishar-fe/`, `third_party/talishar-cardimages/` — gitignored full clones (a third vendoring pattern beside submodules and committed dirs — gitignored because they are mutable working copies we push branches from, not pinned knowledge). Sibling layout is load-bearing: the BE docker-compose mounts `../Talishar-FE` and `../CardImages`.
- `scripts/talishar-bootstrap.sh` — idempotent: clones missing repos from the forks (creating forks via `gh repo fork Talishar/<repo> --clone=false` when absent), sets/repairs the remote contract, reports status.
- `.claude/skills/talishar-fork-sync/SKILL.md` — fork maintenance skill (§6).
- `.claude/skills/talishar-implement-card/SKILL.md` — card pipeline skill (§8).
- `docs/TALISHAR-ARCHITECTURE.md` — the deep architecture document (§7).
- `.claude/talishar/*.md` — curated per-topic working references (architecture, card recipe, decision queue, frontend, dev stack, contributing) loaded by sessions doing Talishar work (§7.5).
- `.claude/identities/talishar/brain/` — advisory identity brain (§7), registered in `.claude/project.yaml` `delegation.identities` (no models — advisory role).

Upstream facts the design builds on (verified 2026-07-18 against the repos and merged PRs #1370/#1369): request pipeline ProcessInput → ParseGamestate → GameLogic/CardLogic → WriteGamestate → GetNextTurn/BuildGameState; card behavior lives in `Classes/CardObjects/{SET}Cards.php` classes with hooks `PlayAbility`/`SpecificLogic`/`ProcessTrigger`/`CombatEffectActive`/`EffectPowerModifier`/`IsPlayRestricted`/`PayAdditionalCosts` reached via `GetClass()`; FE consumes SSE with exponential-backoff reconnect and a 45s staleness watchdog; local dev = BE `bash start.sh` (docker compose, Apache/PHP on **8080** — the README's 8000 is stale, `.env.template` confirms 8080) + FE `npm run dev` (5173, Vite proxy `/api`→8080); upstream ships its own `CLAUDE.md` + `New Developer Guide.md` and routinely merges fork PRs (`feat:`/`fix:` + Summary + Test plan; coordination on Discord).

## §6 Vendoring & fork plumbing (E0)

- 6.1 WHEN `scripts/talishar-bootstrap.sh` runs on a checkout missing any of the three clones THE SYSTEM SHALL clone each missing repo from `Zugruul/<repo>` into `third_party/{talishar,talishar-fe,talishar-cardimages}` and add an `upstream` remote pointing at the `Talishar/<repo>` org repo.
- 6.1a IF a `Zugruul/<repo>` fork does not exist yet THEN THE SYSTEM SHALL create it via `gh repo fork Talishar/<repo> --clone=false` before cloning.
- 6.2 THE SYSTEM SHALL keep `origin` pointing at the user's fork in every vendored clone; WHEN the bootstrap or fork-sync skill detects `origin` pointing at a `Talishar/` URL THE SYSTEM SHALL repair the remotes and report the repair (§10 I2).
- 6.3 THE SYSTEM SHALL gitignore `third_party/talishar*` entirely; `git status` in fab-cli stays clean regardless of state inside the clones.
- 6.4 WHEN the bootstrap script runs on an already-bootstrapped checkout THE SYSTEM SHALL make no changes and exit 0 with a per-repo status line (idempotence).
- 6.5 WHEN `/talishar-fork-sync` is invoked THE SYSTEM SHALL, per vendored repo: fetch `upstream`, fast-forward the fork's default branch to `upstream/main` (local + push to `origin`), and print a divergence report (ahead/behind counts, open local branches and their base distance).
- 6.5a IF the fork's default branch has diverged from upstream (non-fast-forward) THEN THE SYSTEM SHALL stop for that repo and report the divergence rather than force-push (§10 I2).
- 6.5b WHERE open feature branches exist THE SYSTEM SHALL offer to rebase each onto the updated main, reporting conflicts instead of resolving them silently.
- 6.6 THE SYSTEM SHALL document the vendoring layout, fork contract, and both skills in CLAUDE.md and README.md.

## §7 Architecture doc + talishar brain (E1)

- 7.1 THE SYSTEM SHALL provide `docs/TALISHAR-ARCHITECTURE.md` covering at minimum: engine request pipeline; GameFile state format and lifecycle; DecisionQueue/Await async model; layer stack + CombatChain resolution; ClassState mechanism (3-file dance); the card recipe (§8.3) with a worked example from a real merged PR; the API surface overview (`APIs/`); FE state flow (SSE → ParseGameState.ts → GameSlice) including reconnect/watchdog behavior; card-image pipeline (CardImages scripts + FE `generate-cards` + CDN naming); local dev stack (ports, compose services, sibling mounts, Xdebug); upstream contribution conventions.
- 7.1a Every architectural claim in the document SHALL cite a vendored file path (e.g. `third_party/talishar/AwaitEffects.php`) or an upstream PR/issue number; claims that cannot be grounded that way are omitted.
- 7.1b The document SHALL record known-stale upstream docs it corrects (e.g. the README port 8000 vs actual 8080) so future readers trust the doc over the README.
- 7.2 THE SYSTEM SHALL scaffold `.claude/identities/talishar/brain/` (notes/, ROLE.md, links.json, .activation.jsonl) and register the `talishar` advisory identity in `.claude/project.yaml` `delegation.identities` (plus-addressed email template, no models).
- 7.2a ROLE.md SHALL encode: the brain covers Talishar engine/architecture/tooling knowledge only; card facts and keyword rules are reached by linking to card-vault notes via the entity index, never duplicated; upstream code is the ground truth — WHEN a note conflicts with current vendored code THE NOTE is updated, not trusted; the fork contract and no-upstream-PR invariants verbatim.
- 7.3 WHEN the brain is seeded THE SYSTEM SHALL mint kind-prefixed notes (`tal-arch-*` architecture, `tal-recipe-*` implementation patterns, `tal-dev-*` dev-environment/tooling) from the architecture document, each with frontmatter per house convention (tags, strength, source citing vendored path or PR, created) and `[[wikilinks]]` between related notes.
- 7.3a Notes about specific cards' Talishar implementations SHALL reference the card via `card:<slug>` entities resolving to card-vault anchors; the talishar brain SHALL NOT be added to the keyword-sync MIRRORS list (§10 I5).
- 7.4 A spot-check question ("how do I add a card that needs a new per-turn counter?") SHALL be answerable from brain notes' citations alone, naming the three files of the ClassState dance.
- 7.5 THE SYSTEM SHALL maintain a curated reference-doc set under `.claude/talishar/` — one focused markdown file per load-bearing topic, at minimum: `architecture.md` (engine pipeline + state model), `card-recipe.md` (the full implementation recipe with worked PR examples), `decision-queue.md` (DQ/Await/layer-stack semantics), `frontend.md` (SSE state flow, ParseGameState, reconnect behavior), `dev-stack.md` (bootstrap, compose services, ports, Xdebug, gotchas), `contributing.md` (fork contract, PR conventions, Discord coordination). These are the always-loadable working references for sessions doing Talishar work; `docs/TALISHAR-ARCHITECTURE.md` is the long-form narrative that links to them.
- 7.5a Each `.claude/talishar/*.md` file SHALL follow the same citation rule as 7.1a (vendored paths / PR numbers) and state its last-verified date against upstream.
- 7.6 Brain seeding SHALL be maximal, not minimal: cover every §7.1 topic plus the recipe variations observed in merged card PRs (modal cards, ClassState counters, CurrentTurnEffect suffixes, windup archetype, combat modifiers), the API endpoint map, and the FE data models — the brain is seeded from the architecture doc AND direct study of the vendored code, and grows continuously thereafter (never "done", mirroring FAB-033's model).

## §8 Card implementation pipeline (E2)

The `/talishar-implement-card <card name or set-code>` skill runs four phases; each phase's output feeds the next and is preserved so a run can resume.

- 8.1 **Dossier.** WHEN the skill starts THE SYSTEM SHALL assemble a research dossier: live Card Vault true text + rulings (`fab-cli fabtcg card`), the-fab-cube stats from `third_party/flesh-and-blood-cards` (the same dataset Talishar's generator consumes), fabrary card data where it adds context, talishar-brain recall of matching implementation patterns (similar existing cards found by keyword/archetype in the vendored engine), and the card's official image reference.
- 8.1a IF the card is not yet present in the the-fab-cube dataset (newly announced) THEN THE SYSTEM SHALL record the gap in the dossier and derive stats from Card Vault/official spoilers, flagging that `zzCardCodeGenerator.php` output must be regenerated once the dataset catches up.
- 8.2 WHEN implementation starts THE SYSTEM SHALL create a branch on the vendored engine clone (named per upstream convention, e.g. `feat/{card_id}`), based on freshly synced `upstream/main` (running the §6.5 sync first).
- 8.3 THE SYSTEM SHALL implement the card per the recipe: regenerate/extend generated stats via `zzCardCodeGenerator.php` where applicable; add `class {card_id} extends Card` in `Classes/CardObjects/{SET}Cards.php` implementing only the hooks the card needs; touch `Constants.php`/`MenuFiles/StartHelper.php`/ability files only when the card needs new ClassState or engine hooks; behavior derived from the dossier's true text, never from remembered card text (§10 I4).
- 8.4 **Images.** WHERE the card's images are missing from the pipeline THE SYSTEM SHALL run the CardImages scripts (`downloadImages.js` resize + square-crop; `generateTranslatedCollections.js` for reprints) and the FE `npm run generate-cards` card-list refresh on branches of those clones, keeping all image artifacts out of fab-cli (§10 I3).
- 8.5 **Validation.** WHEN the implementation compiles (`php -l` on touched files) THE SYSTEM SHALL bring up the local docker stack, start a game using the card via the FE or API endpoints, exercise the implemented hooks (play, triggers, modifiers), and record the observed behavior in the dossier as the Test plan.
- 8.6 **Hand-off.** WHEN validation passes THE SYSTEM SHALL push the branch to `origin` (the fork) and emit a prepared PR title (`feat: {Card Name} ({SET}{number})`) and body (Summary + Test plan per upstream convention, dossier-cited) as text for the user to create the PR; THE SYSTEM SHALL NOT open, mark ready, or otherwise create any PR on Talishar org repos (§10 I1).
- 8.7 IF any phase fails (card unresolvable, engine pattern unknown, stack fails to start, behavior mismatch) THEN THE SYSTEM SHALL stop at that phase with the dossier updated to describe the blocker — never push a branch whose validation did not run.

## §9 Latency, bug & DX audit (E3)

- 9.1 THE SYSTEM SHALL produce `docs/TALISHAR-AUDIT.md`: a performance/latency audit of the vendored code covering at minimum the SSE update path (full-gamestate payload size vs board complexity, serialization cost in `BuildGameState.php`), gamestate caching (APCu/Redis usage), Apache/SSE tuning (`apache-performance.conf`), FE parse/render cost (`ParseGameState.ts` → Redux), and file-I/O of the GameFile cycle.
- 9.1a Each finding SHALL state: evidence (file paths, measurements from the local stack where obtainable), user-visible impact, an upstream-friendly fix sketch, and an effort/impact rank.
- 9.2 THE SYSTEM SHALL triage upstream issue history for recurring bug classes (e.g. closed BE #501 SSE disconnect, #183 lag double-activation, FE #98 reload freeze) and include a bug-scan section listing reproducible suspects found in the vendored code.
- 9.3 THE SYSTEM SHALL include a DX section: friction in local setup, test coverage gaps, stale docs — each with a concrete improvement proposal.
- 9.4 WHEN the audit is accepted THE SYSTEM SHALL file the top-ranked findings as individual board tasks (via the create-inbound flow) so fixes proceed as normal spec-workflow tasks.
- 9.5 Audit measurements requiring the running stack are user-invoked sessions; nothing in the gate depends on them (§10 I6).

## §10 Invariants

- I1: Never open, mark ready, approve, or merge pull requests on Talishar org repositories; tooling pushes branches only to the user's forks and prepares PR title/body as text — a human creates every upstream PR.
- I2: In every vendored Talishar clone, `origin` must be the user's fork and `upstream` the Talishar org repo, fetch-only; nothing is ever pushed to `upstream`, and a diverged fork main is reported, never force-pushed.
- I3: `third_party/talishar*` clones are gitignored; their contents — especially copyrighted card images — are never committed to fab-cli. Image processing is transient and its outputs go only to branches of the Talishar-side repos.
- I4: Card behavior implementations are derived from live Card Vault true text plus the-fab-cube stats and the CR at implementation time — never from remembered card text.
- I5: The talishar brain links to card-vault entities for card/keyword facts and is never added to the keyword-sync MIRRORS list; engine knowledge lives in the talishar brain only.
- I6: All merge-gating tests pass with the network disabled and without the vendored clones present; running the Talishar docker stack or hitting talishar.net/images.talishar.net is only ever user-invoked, never in the gate.
- I7: Upstream contributions stay incremental and convention-following (feat:/fix: titles, Summary + Test plan bodies, coordination via the Talishar Discord for large changes); no engine rewrite.

## §11 Non-functional & testing strategy

- Merge-gating: the existing `npm run gate` — this spec's shell/skill/doc artifacts must not break it, and must not make it require network or the vendored clones (§10 I6). Bootstrap and fork-sync scripts get bats-style or fixture-based tests only where cheap; their real verification is the recorded idempotent run.
- Advisory verification per task: bootstrap run on a clean clone; fork-sync run against the live forks; card pipeline validated end-to-end on one real card (TAL-023).
- Etiquette: ≤2 concurrent requests against talishar.net/images.talishar.net; CardImages downloads only for cards being implemented, never bulk mirroring.
- The architecture doc and audit are living documents: refreshed when upstream moves significantly (checked during `/talishar-fork-sync` runs via changelog of pulled commits).

## §12 Open questions

- Q1 — Should the card pipeline also prepare FE-side changes (cardList refresh) as a branch on the FE fork in the same run, or only when the set is new? Owner: user. Default: same run, only when `generate-cards` output actually changes.
- Q2 — Does the user want a `fab-cli talishar` CLI namespace later (e.g. `talishar status`, `talishar sync`)? Owner: user. Default: no — skills + scripts suffice for v1 (§3); revisit after E2 lands.
- Q3 — data-doll (Go) purpose and relevance. Owner: user (ask on Talishar Discord). Default: ignored until it matters to a task.

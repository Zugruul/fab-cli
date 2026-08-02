# fab-cli backlog — spec: SPEC-TALISHAR.md (prefix TAL)

Ranges: E0=001–009, E1=010–019, E2=020–029, E3=030–039, infra=090–099.
Build order (foundation first): E0 → E1 → {E2, E3}.
Priority order P0 > P1 > P2. Points ≈ complexity incl. testing. DoD for every task: `npm run gate` green (offline, without vendored clones — §10 I6), README/CLAUDE.md updated if the surface changed, spec §s satisfied.

## E0 — Vendoring & fork plumbing (001–009) — no guard

### TAL-001 · Gitignored Talishar clones + `scripts/talishar-bootstrap.sh` · P0 · 3pt · §5 §6.1 §6.1a §6.2 §6.3 §6.4 §10 I2 I3
Add `third_party/talishar*` to `.gitignore`. Idempotent bootstrap script: clone missing repos (`Talishar`, `Talishar-FE`, `CardImages`) from `Zugruul/*` forks into `third_party/{talishar,talishar-fe,talishar-cardimages}` (sibling layout — BE compose mounts `../Talishar-FE` and `../CardImages`), creating absent forks via `gh repo fork Talishar/<repo> --clone=false`; set `origin`=fork / `upstream`=org, repairing and reporting a wrong `origin`; per-repo status lines; second run makes no changes and exits 0.
**AC:** fresh checkout → one script run yields all three clones with correct remotes; rerun is a no-op exit 0; `git status` in fab-cli clean throughout; gate green with and without the clones present.

### TAL-002 · `/talishar-fork-sync` skill · P0 · 3pt · §6.5 §6.5a §6.5b §10 I1 I2
`.claude/skills/talishar-fork-sync/SKILL.md`: per vendored repo fetch `upstream`, fast-forward fork main (local + push to `origin`), divergence report (ahead/behind, open branches + base distance); diverged main → stop and report, never force-push; offer per-branch rebase onto updated main, surfacing conflicts unresolved. Notes significant upstream movement as a prompt to refresh the architecture doc/references (§11).
**AC:** run against live forks fast-forwards a stale main and prints the report; a simulated diverged main is reported, not force-pushed; nothing is ever pushed to `upstream` (skill text forbids it and commands push only to `origin`).

### TAL-003 · Document the Talishar surface in CLAUDE.md + README · P1 · 1pt · §6.6
Vendoring layout, fork contract, both skills, `.claude/talishar/` references — added to CLAUDE.md (agent-facing) and README.md (user-facing).
**AC:** a newcomer can bootstrap and sync from the docs alone; gate green.

## E1 — Architecture doc + talishar brain (010–019) — blocked by E0

### TAL-010 · `docs/TALISHAR-ARCHITECTURE.md` deep architecture document · P0 · 5pt · §7.1 §7.1a §7.1b
Long-form narrative from direct study of the vendored code: engine request pipeline, GameFile format/lifecycle, DQ/Await, layer stack + CombatChain, ClassState 3-file dance, card recipe with a worked example from a real merged PR (#1370 pattern), `APIs/` surface overview, FE SSE state flow + reconnect/watchdog, card-image pipeline, local dev stack (compose services, ports — correcting the stale README 8000→8080), contribution conventions. Every claim cites a vendored path or PR/issue number; corrected stale upstream docs are recorded.
**AC:** all §7.1 topics covered; spot-checked citations resolve to real files/PRs; no uncited architectural claims.

### TAL-011 · `.claude/talishar/*.md` curated reference set · P0 · 3pt · §7.5 §7.5a
Per-topic working references: `architecture.md`, `card-recipe.md`, `decision-queue.md`, `frontend.md`, `dev-stack.md`, `contributing.md` — each cited per 7.1a and stamped with a last-verified-against-upstream date; `docs/TALISHAR-ARCHITECTURE.md` links to them.
**AC:** all six files exist, cited and dated; card-recipe.md alone is sufficient to hand-implement a simple card (the #1369 shape).

### TAL-012 · Register `talishar` identity + brain scaffold + ROLE.md · P0 · 2pt · §7.2 §7.2a §10 I1 I2 I5
Scaffold `.claude/identities/talishar/brain/{notes/,ROLE.md,links.json,.activation.jsonl}`; register advisory identity in `project.yaml` `delegation.identities` (plus-addressed email, no models). ROLE.md encodes: engine/architecture/tooling knowledge only; card/keyword facts via entity links to card-vault, never duplicated; vendored code is ground truth (conflicting note → update note); fork contract + no-upstream-PR invariants verbatim.
**AC:** `board.sh config` VALID; ROLE.md states I1, I2, I5 verbatim or stronger; brain dirs match house layout.

### TAL-013 · Maximal brain seeding · P0 · 5pt · §7.3 §7.3a §7.4 §7.6
Mint `tal-arch-*` / `tal-recipe-*` / `tal-dev-*` notes from the architecture doc, the `.claude/talishar/` references, AND direct code study: every §7.1 topic, recipe variations from merged PRs (modal cards, ClassState counters, CurrentTurnEffect suffixes, windup archetype, combat modifiers), API endpoint map, FE data models. House frontmatter + `[[wikilinks]]`; card-specific notes carry `card:<slug>` entities resolving to card-vault anchors; talishar NOT added to keyword-sync MIRRORS. Ongoing capability; this seeds the first comprehensive batch.
**AC:** §7.4 spot-check (per-turn-counter card question) answerable from notes' citations alone naming the three ClassState files; every note cites a vendored path or PR; entity-index refresh includes the new notes; zero keyword-corpus duplication.

## E2 — Card implementation pipeline (020–029) — blocked by E1

### TAL-020 · `/talishar-implement-card`: dossier phase · P0 · 5pt · §8.1 §8.1a §10 I4
Skill scaffold + research phase: live Card Vault true text + rulings (`fab-cli fabtcg card`), the-fab-cube stats, fabrary context, brain recall of similar implemented cards/archetypes in the vendored engine, official image reference. Newly announced cards missing from the-fab-cube: record the gap, derive stats from Card Vault/spoilers, flag generator regeneration. Dossier persisted so later phases/resumes consume it.
**AC:** dossier for a known card cites Card Vault + dataset + ≥1 similar existing implementation; dossier for a not-yet-released card records the dataset gap; no card text from model memory.

### TAL-021 · `/talishar-implement-card`: implementation phase · P0 · 5pt · §8.2 §8.3 §10 I2 I4
Branch `feat/{card_id}` off freshly synced `upstream/main` (runs §6.5 sync first); implement per recipe: `zzCardCodeGenerator.php` stats where applicable, `Card` subclass in `Classes/CardObjects/{SET}Cards.php` with only the needed hooks, ClassState/engine-hook files touched only when required; behavior derived from the dossier's true text.
**AC:** a modal-or-simpler card implemented on a branch matching the merged-PR diff shape (#1370/#1369); `php -l` clean on touched files; diff contains no unrelated changes.

### TAL-022 · `/talishar-implement-card`: image pipeline step · P1 · 3pt · §8.4 §10 I3
Where images are missing: CardImages `downloadImages.js` (resize + square crop), `generateTranslatedCollections.js` for reprints, FE `npm run generate-cards` refresh — all on branches of those clones; nothing lands in fab-cli. Per Q1 default: FE branch only when `generate-cards` output actually changes.
**AC:** processed images + refreshed cardList exist on the respective fork branches for a test card; zero image artifacts under the fab-cli tree; ≤2 concurrent CDN requests.

### TAL-023 · `/talishar-implement-card`: validation + hand-off, end-to-end run · P0 · 3pt · §8.5 §8.6 §8.7 §10 I1
Bring up the docker stack, play the card in a real game (FE or API), exercise implemented hooks, record observed behavior as the Test plan; push branch to `origin`; emit prepared PR title (`feat: {Card Name} ({SET}{number})`) + body (Summary + Test plan) as text. Any phase failure stops with the dossier describing the blocker — an unvalidated branch is never pushed. Run the whole pipeline end-to-end on one real recently announced card.
**AC:** end-to-end run produced a pushed, validated fork branch + prepared PR text; no PR exists on any Talishar org repo; failure injection (e.g. stack down) stops before push.

## E3 — Latency, bug & DX audit (030–039) — blocked by E1

### TAL-030 · Latency/performance audit → `docs/TALISHAR-AUDIT.md` · P1 · 5pt · §9.1 §9.1a §9.5 §10 I6
Audit the SSE update path (payload size vs board complexity, `BuildGameState.php` serialization), APCu/Redis gamestate caching, `apache-performance.conf` SSE/gzip tuning, FE `ParseGameState.ts`→Redux cost, GameFile I/O cycle. Findings: evidence (paths + local-stack measurements where obtainable), user impact, upstream-friendly fix sketch, effort/impact rank. Stack measurements are user-invoked sessions.
**AC:** every audited area has ≥1 evidence-backed finding or an explicit "no issue found"; findings ranked; nothing added to the gate.

### TAL-031 · Bug + DX scan, findings filed as tasks · P1 · 3pt · §9.2 §9.3 §9.4
Triage upstream issue history for recurring bug classes (BE #501 SSE disconnect, #183 lag double-activation, FE #98 reload freeze as seeds); scan vendored code for reproducible suspects; DX section (setup friction, test gaps, stale docs) with concrete proposals. File top-ranked findings as board tasks via create-inbound.
**AC:** audit doc gains bug-scan + DX sections; top findings exist as board tasks linking back to the audit; each filed task is independently actionable.

## EI — Infra reserve (090–099)

(reserved)

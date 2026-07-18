# Design — talishar/E1: Architecture doc + talishar brain

Grounded in: SPEC-TALISHAR.md §5, §7.1–§7.6, §10 I2–I5, §11.

## Components

- `docs/TALISHAR-ARCHITECTURE.md` (TAL-010) — long-form narrative document covering: engine request
  pipeline; `GameFile` state format/lifecycle; DecisionQueue/Await async model; layer stack +
  CombatChain resolution; `ClassState` 3-file dance; card recipe with a worked merged-PR example
  (#1370/#1369 pattern); `APIs/` surface overview; FE SSE state flow (→ `ParseGameState.ts` →
  `GameSlice`) including reconnect/watchdog; card-image pipeline; local dev stack (ports, compose
  services, sibling mounts, Xdebug — correcting the stale README 8000→8080); upstream contribution
  conventions. Every architectural claim cites a vendored path or PR/issue number (§7.1a); §7.1b
  stale-doc corrections get their own callout.
- `.claude/talishar/*.md` (TAL-011, this epic's next task, not built by TAL-010) — six curated
  per-topic reference files that link back to and from the architecture doc.
- `test/talishar-architecture-doc.test.ts` (TAL-010) — structural/citation-format assertions on the
  architecture doc, network-free and clone-free per §10 I6 (see Key sequences).
- `.claude/identities/talishar/brain/` (TAL-012/TAL-013, later tasks in this epic) — out of scope
  for TAL-010; the architecture doc is their primary seeding source, so TAL-010's headings and
  citations are written to be directly mintable into `tal-arch-*` notes later.

## Data models

None new — this is a documentation task. The only structural contract is the document's own section
shape (see Interfaces).

## Interfaces / contracts

- `docs/TALISHAR-ARCHITECTURE.md` uses `##`-level headings, one per §7.1 topic, in the order listed
  in §7.1, so later tasks (TAL-011 extraction, TAL-013 brain seeding) can address sections by name.
- Every architectural claim (a sentence asserting how the engine/FE/tooling behaves) is followed by
  or contains an inline citation: a vendored path in backticks (e.g.
  `` `third_party/talishar/Classes/AwaitEffects.php` ``) or an upstream PR/issue reference (e.g.
  `Talishar/Talishar#1370`). A claim with neither is a spec violation (§7.1a) and is omitted rather
  than left uncited.
- A dedicated "Known stale upstream docs" subsection lists every correction the document makes to
  upstream's own docs (README, `New Developer Guide.md`), each with what upstream says vs. the
  verified-true value and how it was verified (§7.1b).
- The worked card-recipe example names concrete files touched by a real merged PR (the #1370/#1369
  shape referenced in SPEC §5's "Upstream facts" line) — file paths + hook names, not a generic
  recipe with no ground truth.
- `test/talishar-architecture-doc.test.ts` MUST pass with `third_party/talishar*` absent and network
  disabled (§10 I6): it asserts document structure (required headings present, in the required
  order) and citation *format* (every paragraph-level claim has a backtick-path or PR-number
  citation pattern) — it does NOT stat any `third_party/talishar*` file, since those clones are
  gitignored working copies that may not exist in a gate run.

## Key sequences

1. Study phase (not committed): read the vendored clones directly —
   `third_party/talishar/{Classes,APIs,AI}` for engine/API surface,
   `third_party/talishar-fe/src` for FE state flow, `third_party/talishar-cardimages` for the image
   pipeline, `docker-compose.yml`/`.env.template`/`start.sh` for the dev stack, and `gh api` or
   `git log` on the fork/upstream remotes for the #1370/#1369 PR diffs that anchor the card-recipe
   worked example.
2. Write `docs/TALISHAR-ARCHITECTURE.md` section by section per §7.1's topic list, citing as you go
   (§7.1a) — no claim is written first and cited later.
3. Write the "Known stale upstream docs" subsection (§7.1b) from concrete diffs observed in step 1
   (e.g. README port claim vs. `.env.template`'s actual `8080`).
4. Write `test/talishar-architecture-doc.test.ts` FIRST against the *planned* heading list (red),
   then the doc content makes it pass (green) — i.e. TDD applies to the structural/citation-format
   test, not to the prose itself, which has no meaningful "failing behavior" to red against. This is
   the doc-task analogue of TDD used by prior doc-only tasks in this repo (e.g. TAL-003 style, scaled
   up with an actual automated check here because TAL-010's AC is checkable: "spot-checked citations
   resolve to real files/PRs; no uncited architectural claims").
5. `npm run gate` green with the clones still present locally (developer's own sanity check) AND
   with a mental/actual check that the test doesn't silently depend on `third_party/talishar*`
   existing (§10 I6) — the gate must also pass on a fresh checkout that never ran the bootstrap
   script.

## Decisions

- **TDD is applied to a structural/citation-format checker, not the prose.** A pure "does this
  markdown file exist" test would be nearly worthless; a citation-format + required-headings test is
  the closest meaningful red→green cycle for a documentation deliverable and directly encodes the
  task's own AC ("no uncited architectural claims").
- **The test never touches `third_party/talishar*` on disk.** Per §10 I6, gating tests must pass
  without the vendored clones present. Verifying that a *cited path actually exists in the clone* is
  a human/dev-agent-time spot-check (the AC's "spot-checked citations resolve to real files"), not a
  CI assertion — the test enforces *format*, the dev agent's own research enforces *truth* at
  write-time.
- **TAL-011's `.claude/talishar/*.md` files are explicitly out of scope for TAL-010.** They are a
  separate P0 task in the same epic; TAL-010 only needs to leave natural link anchors (stable
  heading names) for them to point at later.
- **TAL-012/TAL-013 (brain scaffold + seeding) are also out of scope.** TAL-010 is the seeding
  *source*, not the seeding itself.

## TAL-011 — `.claude/talishar/*.md` curated reference set

Grounded in: SPEC-TALISHAR.md §7.5, §7.5a.

### Components

- `.claude/talishar/architecture.md` — engine pipeline + state model (condensed from
  `docs/TALISHAR-ARCHITECTURE.md`'s Engine Request Pipeline, GameFile, DecisionQueue/Await, Layer
  Stack/CombatChain, and ClassState sections).
- `.claude/talishar/card-recipe.md` — the full implementation recipe with worked PR examples
  (condensed from the architecture doc's Card Recipe section, PR #1370/#1369).
- `.claude/talishar/decision-queue.md` — DQ/Await/layer-stack semantics in more operational depth
  than the architecture doc's overview (a working reference, not a narrative).
- `.claude/talishar/frontend.md` — SSE state flow, `ParseGameState.ts`, reconnect/watchdog
  behavior.
- `.claude/talishar/dev-stack.md` — bootstrap, compose services, ports, Xdebug, known gotchas.
- `.claude/talishar/contributing.md` — fork contract, PR conventions (`feat:`/`fix:` + Summary/Test
  plan), Discord coordination, and the I1/I2 no-upstream-PR invariants verbatim.

### Interfaces / contracts

- Each file opens with a frontmatter-free header line stating **"Last verified against upstream:
  <date>"** (§7.5a) — the same citation rule as §7.1a applies throughout the body (vendored path or
  PR/issue number per claim).
- `docs/TALISHAR-ARCHITECTURE.md` gains a short "Curated references" section (or inline links from
  each `##` heading) pointing at the matching `.claude/talishar/*.md` file, so the long-form doc and
  the working references are mutually linked, not two disconnected copies.
- `card-recipe.md` is held to a concrete acceptance bar: **AC — alone, without consulting the
  architecture doc, it must be sufficient to hand-implement a simple card matching the `#1369` shape**
  (a modal card gated on a ClassState counter). That means it needs the full `Card` class skeleton,
  the ClassState 3-file dance file list, the `CurrentTurnEffect` suffix pattern, and the
  `PlayAbility`/`SpecificLogic`/`ProcessTrigger`/`CombatEffectActive`/`EffectPowerModifier` hook
  signatures inline — not just a pointer back to the architecture doc.
- Content is **condensed and reorganized for quick lookup during active Talishar work**, not a
  verbatim copy-paste of the architecture doc's prose — duplication of exact paragraphs across the
  two documents is a smell the reviewer should flag.

### Key sequences

1. Re-read `docs/TALISHAR-ARCHITECTURE.md` (already merged, TAL-010) as the primary source; pull
   its relevant sections + citations into each of the six files, reorganized for the topic's own
   working-reference shape (e.g. `card-recipe.md` leads with the class skeleton and hook list, not
   with pipeline narrative).
2. Where a working reference needs *more* operational detail than the narrative doc provides (e.g.
   `decision-queue.md` wanting the exact DQ verb list, `dev-stack.md` wanting the literal
   `docker-compose.yml` service names), go back to the vendored clone directly rather than
   inventing detail not present in either source.
3. TDD shape mirrors TAL-010: write a structural test first (six files exist, each has a
   "Last verified against upstream" date line and citation-format density, `card-recipe.md`
   specifically contains the required hook-signature list) — red before the six files exist, green
   after. Same §10 I6 constraint: no test may touch `third_party/talishar*` on disk.
4. Add the architecture doc → curated-reference cross-links as a small diff to
   `docs/TALISHAR-ARCHITECTURE.md` itself (not a new file).

### Decisions

- **Condensation, not duplication.** The two artifacts serve different purposes (long-form
  narrative with full argument vs. quick-lookup working reference); a reviewer should treat
  near-verbatim paragraph copies as a quality issue even though nothing in §7.5 strictly forbids it.
- **`card-recipe.md`'s self-sufficiency bar is the task's real acceptance test**, not a nice-to-have
  — TAL-013 (brain seeding) and any future card-implementation work (E2) will load this file alone
  in a fresh session, so it cannot assume the reader also has the architecture doc open.

## TAL-012 — Register `talishar` identity + brain scaffold + ROLE.md

Grounded in: SPEC-TALISHAR.md §7.2, §7.2a, §10 I1, I2, I5.

### Components

- `.claude/identities/talishar/brain/notes/` — empty at scaffold time (TAL-013 seeds it); matches
  the house layout already used by `dev`/`reviewer`/`player`/`judge`.
- `.claude/identities/talishar/brain/ROLE.md` — advisory-identity charter, modeled on
  `.claude/identities/player/brain/ROLE.md`'s shape (hard rules up top, knowledge-flow rules,
  lookup order) but scoped to Talishar engine/architecture/tooling knowledge only.
- `.claude/identities/talishar/brain/links.json` — empty link graph (`{}` or the house-convention
  empty-state shape — match whatever `player`'s/`judge`'s freshly-scaffolded shape would be;
  inspect an existing brain's file for the exact empty-state JSON before writing it by hand).
- `.claude/identities/talishar/brain/.activation.jsonl` — empty file (append-only recall log,
  starts empty).
- `.claude/project.yaml` `delegation.identities.talishar` — new entry, same shape as the existing
  `player`/`judge` entries (name + email template, **no `models` key** — advisory role, never
  spawned as a dev/reviewer subagent with its own model budget).

### Interfaces / contracts

- `delegation.identities.talishar` entry: `name: "Talishar Agent - {name}"`,
  `email: "{local}+talishar_agent@{domain}"` — exact same template mechanics as `player`/`judge`,
  substituted the same way at commit-identity resolution time. No `models` field (the schema
  already tolerates this — `player`/`judge` are the precedent).
- ROLE.md MUST contain, verbatim or in strictly stronger language, all of:
  - I1: "Never open, mark ready, approve, or merge pull requests on Talishar org repositories;
    tooling pushes branches only to the user's forks and prepares PR title/body as text — a human
    creates every upstream PR."
  - I2: "In every vendored Talishar clone, `origin` must be the user's fork and `upstream` the
    Talishar org repo, fetch-only; nothing is ever pushed to `upstream`, and a diverged fork main
    is reported, never force-pushed."
  - I5: "The talishar brain links to card-vault entities for card/keyword facts and is never added
    to the keyword-sync MIRRORS list; engine knowledge lives in the talishar brain only."
  (These are pasted verbatim from `.claude/project.yaml` `specs.talishar.invariants` — TAL-012's
  job is to make sure the brain's own charter states them too, not just the spec.)
- ROLE.md additionally encodes (§7.2a, paraphrased is fine here, these aren't invariant IDs):
  the brain covers Talishar engine/architecture/tooling knowledge only; card/keyword facts are
  reached by linking to card-vault entities via the entity index, never duplicated locally;
  vendored code (`third_party/talishar*`) is ground truth — when a note conflicts with current
  vendored code, the NOTE is updated, not trusted.
- `board.sh config` must report `VALID` after the `.claude/project.yaml` edit (the AC's literal
  check) — run it after editing, don't just eyeball the YAML.

### Key sequences

1. Scaffold the four brain paths (empty `notes/`, `ROLE.md`, `links.json`, `.activation.jsonl`) —
   inspect `player`'s or `judge`'s brain for the exact house-convention shape of an empty
   `links.json`/`.activation.jsonl` before hand-writing them, don't guess the schema.
2. Write ROLE.md: hard invariants (I1/I2/I5 verbatim) first, then the knowledge-scope and
   knowledge-flow rules (§7.2a), following the player ROLE.md's organizational pattern but with
   Talishar-specific content — this is a NEW charter, not a copy of the player's.
3. Add the `delegation.identities.talishar` entry to `.claude/project.yaml`.
4. TDD: write a structural test first (asserting the four brain files/dirs exist, ROLE.md contains
   the three invariant strings — or a close paraphrase check if verbatim is too brittle — and the
   YAML has the new identity entry with no `models` key) — red before the scaffold exists, green
   after. Then run `board.sh config` to confirm `VALID` (this is a manual/dev-agent-time check
   alongside the automated test, not something the automated test needs to re-implement by parsing
   YAML itself if a schema validator already exists at `scripts/validate-config.py` or similar —
   check for one before hand-rolling YAML parsing in the test).

### Decisions

- **No `models` key, matching `player`/`judge`.** This identity is advisory-only — it never gets
  spawned via `Agent`/`identity.sh dev|reviewer` with a model budget; it exists so brain notes and
  commit attribution have a home, not so it runs as a subagent role.
- **ROLE.md is a new document, not a copy of player's/judge's**, even though it follows the same
  organizational shape (hard rules → scope → knowledge-flow). The content is entirely different
  (engine/tooling vs. gameplay/rules knowledge).

## TAL-013 — Maximal brain seeding

Grounded in: SPEC-TALISHAR.md §7.3, §7.3a, §7.4, §7.6.

### Components

- `.claude/identities/talishar/brain/notes/tal-arch-*.md` — architecture notes (engine pipeline,
  GameFile, DecisionQueue/Await, layer stack/CombatChain, ClassState, API surface, FE state flow,
  card-image pipeline, dev stack, contribution conventions — every §7.1 topic gets at least one
  note).
- `.claude/identities/talishar/brain/notes/tal-recipe-*.md` — implementation-pattern notes: the
  base card recipe, modal cards, ClassState counters, `CurrentTurnEffect` suffixes, the windup
  dual-mode archetype, combat modifiers — each a distinct recipe VARIATION, not a re-statement of
  the base recipe.
- `.claude/identities/talishar/brain/notes/tal-dev-*.md` — dev-environment/tooling notes (bootstrap,
  compose services/ports, Xdebug, fork-sync workflow, gotchas).
- `.claude/identities/talishar/brain/links.json` — populated with `[[wikilink]]`-derived edges
  between the new notes (regenerated by `brain.py directory`/link-graph tooling, same as any other
  role's brain).
- `.claude/identities/entity-index.json` — refreshed to include any `card:<slug>` entities declared
  by card-specific notes (per §7.3a), via the existing `backfill-entities.py`/entity-index refresh
  tooling — NOT a new mechanism.

### Data models

Same house note format as every other hand-owned brain (`player`, `judge`, the FAB-033 `ci-*`
notes are the closest precedent — see that PR's `judge/brain/notes/ci-*.md` for the exact
frontmatter shape):

```
---
tags: [<topic tags>]
paths: []
strength: 1
source: "<vendored path or PR/issue number>"
graduated: false
created: <YYYY-MM-DD>
---

<note body, ending with [[wikilinks]] to related notes>
```

Card-specific notes (if any recipe-variation note is anchored to a specific real card, e.g. the
Astral Strike/Voltbound Duality worked examples) additionally declare `entities: [card:<slug>]` in
frontmatter, resolving to the card-vault brain's existing per-card notes — per §7.3a, card facts
are NEVER duplicated here, only linked.

### Interfaces / contracts

- Kind prefixes are load-bearing and MUST be used consistently: `tal-arch-*` (how the engine
  works), `tal-recipe-*` (how to build something), `tal-dev-*` (how to run/develop it). A note that
  doesn't fit one of these three kinds either doesn't belong in this seeding pass or needs the kind
  taxonomy revisited with the human first — don't invent a fourth prefix silently.
- Every note cites a vendored path (backticked, e.g. `` `third_party/talishar/Classes/ClassState.php` ``)
  or an upstream PR/issue number — same citation discipline as TAL-010/011, carried into the brain.
- §7.4's spot-check is the task's real acceptance bar: given the question "how do I add a card that
  needs a new per-turn counter?", the brain's OWN notes (via `brain.sh recall talishar --keywords
  "..."` or equivalent) must surface enough to name `Constants.php`, `MenuFiles/StartHelper.php`,
  and the specific incrementing call site (the three files of the ClassState dance) — not just
  point back to `docs/TALISHAR-ARCHITECTURE.md`/`card-recipe.md` by reference. The knowledge has to
  actually live in the brain notes' own text+citations.
- §7.3a: the talishar brain is explicitly NEVER added to `scripts/keyword-sync.py`'s MIRRORS list
  — verify this by grep, don't just avoid it by omission (a future note referencing a keyword
  should link `[[kw-*]]` to the card-vault-owned keyword note, never copy keyword text locally).
- Entity-index refresh: if any note declares `entities: [card:<slug>]`, the entity-index refresh
  step must run and the new entity must resolve to a real card-vault anchor (not `null`) — verify
  with `python3 scripts/backfill-entities.py --check` or equivalent, don't just declare the entity
  and assume it resolves.

### Key sequences

1. Read `docs/TALISHAR-ARCHITECTURE.md` and all six `.claude/talishar/*.md` files in full (both
   already merged — this task's primary distillation source).
2. For topics needing MORE than what those two sources already contain (§7.6's "AND direct code
   study" — specifically the recipe variations: ClassState counters beyond the one worked example
   already in `card-recipe.md`, the windup archetype's `$archetype` object shape, combat modifiers,
   the FE data models beyond what `frontend.md` covers, the full API endpoint map beyond
   `architecture.md`'s overview) — go back to the vendored clones directly and study real code, not
   just re-derive from the already-condensed references.
3. Mint one note per topic/variation (not one giant note) — kind-prefixed, cited, wikilinked to
   related notes (including cross-links to existing card-vault/keyword notes where a talishar
   recipe touches a real keyword, e.g. `[[kw-go-again]]` if a `CurrentTurnEffect` suffix example
   involves Go Again).
4. Regenerate `links.json`/`DIRECTORY.md` and, if any card entities were declared, the entity
   index.
5. TDD shape: write the §7.4 spot-check as an automated-as-possible test BEFORE minting — e.g. a
   test that runs `brain.sh recall talishar --keywords "per-turn counter ClassState"` (or reads the
   brain notes directly) and asserts the three ClassState-dance file paths appear in the recalled
   text. Red before the relevant `tal-arch-classstate`/`tal-recipe-classstate-counter` notes exist,
   green after. This is the doc-task TDD pattern from TAL-010/011, applied to brain content instead
   of a `.md` reference file.
6. Verify no MIRRORS-list addition (grep `scripts/keyword-sync.py` for `talishar`, expect zero
   hits) and that any declared card entities resolve.

### Decisions

- **"Maximal, not minimal" (§7.6) is interpreted as "every §7.1 topic plus every named recipe
  variation," not "as many notes as possible."** A large flat pile of thin notes would satisfy a
  naive reading of "maximal" while failing the real bar (the §7.4 spot-check, which needs DEPTH on
  the ClassState topic specifically, not just breadth). Prioritize depth on ClassState/recipe
  variations since that's the one AC-tested topic; breadth on the rest.
- **This is the FIRST comprehensive batch, not a closed set** (§7.6: "grows continuously
  thereafter, never done, mirroring FAB-033's model"). The task's own scope is bounded (§7.1 topics
  + named recipe variations + API/FE maps), but future retros on E2/E3 tasks are expected to keep
  adding `tal-*` notes — this task doesn't need to anticipate every future card pattern.
- **Follows the FAB-033 precedent**: a dev agent hand-writes note files directly (Write tool, house
  frontmatter), commits with the dev identity, goes through the normal two-pass review + merge
  flow — NOT a special orchestrator-only minting path. Brain-note PRs are still ordinary PRs.

## Out of scope for this epic-task

- Card implementation pipeline (E2) and the latency/DX audit (E3) — both blocked on this epic being
  Deployed and unrelated to the architecture doc's content beyond citing the same vendored code.
- Ongoing brain growth beyond this first comprehensive batch — TAL-013 seeds it; later tasks/retros
  keep growing it, per §7.6.

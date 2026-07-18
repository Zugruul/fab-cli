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

## Out of scope for this epic-task

- `talishar` identity/brain scaffold (TAL-012) and brain note minting (TAL-013) — still out of scope
  for TAL-011; TAL-011 produces reference material those tasks consume, it doesn't touch
  `.claude/identities/`.
- Card implementation pipeline (E2) and the latency/DX audit (E3) — both blocked on this epic being
  Deployed and unrelated to the architecture doc's content beyond citing the same vendored code.

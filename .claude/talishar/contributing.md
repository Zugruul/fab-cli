# Contributing to Talishar (Upstream)

Last verified against upstream: 2026-07-18

Working reference for the fork contract, PR conventions, and coordination norms when preparing
Talishar contributions from fab-cli's vendored clones.

## Fork contract

In every vendored clone (`third_party/talishar`, `third_party/talishar-fe`,
`third_party/talishar-cardimages`):

- `origin` = the user's fork, `git@github.com:Zugruul/<repo>.git` (push target).
- `upstream` = the official org repo, `https://github.com/Talishar/<repo>.git` (**fetch-only** —
  nothing is ever pushed here).

`scripts/talishar-bootstrap.sh` sets this up on a fresh checkout (creating the fork via `gh repo
fork Talishar/<repo> --clone=false` if it doesn't exist yet) and auto-repairs a wrong `origin` (one
pointing at `Talishar/` instead of `Zugruul/`) on already-bootstrapped clones. The
`/talishar-fork-sync` skill (`scripts/talishar-fork-sync.sh`) fetches both remotes and
fast-forwards the fork's `main` to `upstream/main` when there's no divergence — see that skill's
report-line prefixes (`ok:`/`synced:`/`diverged:`/`branch:`/`rebased:`/`conflict:`/`error:`) for
what each run outcome means.

## Hard invariants — verbatim (§10 I1/I2 of `SPEC-TALISHAR.md`)

> **I1**: Never open, mark ready, approve, or merge pull requests on Talishar org repositories;
> tooling pushes branches only to the user's forks and prepares PR title/body as text — a human
> creates every upstream PR.

> **I2**: In every vendored Talishar clone, `origin` must be the user's fork and `upstream` the
> Talishar org repo, fetch-only; nothing is ever pushed to `upstream`, and a diverged fork main is
> reported, never force-pushed.

These are non-negotiable. Any tooling or session working with the vendored clones — this includes
future card-implementation sessions (E2, `SPEC-TALISHAR.md` §8) — only ever:

1. Pushes a feature branch to `origin` (the fork).
2. Prepares PR title/body text for a human to paste into a manually-created PR.
3. Reads upstream PRs/issues read-only (`gh pr view`, `gh pr diff`, `gh issue view`) — never acts on
   them.

If a fork's `main` has diverged from `upstream/main` (non-fast-forward), that is reported and
surfaced to a human — never force-pushed, never resolved automatically.

## PR conventions observed upstream

Two real merged PRs anchor the observed convention:
`Talishar/Talishar#1370` ("feat: implement Astral Strike card (OMN145)") and
`Talishar/Talishar#1369` ("feat: implement Voltbound Duality (OMN077/078/079)"), both authored by
`brenoos` and reviewed/approved by `Pgibby8`, both with a `## Summary` section listing the card's
rules text and implementation notes in bullet form, plus a test-plan-style description of how the
change was validated.

`feat:`/`fix:` title prefixes are a **strong convention for card-implementation PRs specifically**
(matching `#1370`/`#1369`) — not an enforced repo-wide rule. A sample of the ten most recently
merged PRs at research time (`gh pr list --repo Talishar/Talishar --state merged --limit 10`)
included un-prefixed titles like "Fix Spitfire's +1 cog prompt being skipped after declining a
wager" and "Standardize Cog tap/untap handling across Mechanologist cards" alongside strictly
prefixed ones.

**Prepared PR body shape** (per `SPEC-TALISHAR.md` §8.6, for the card-implementation pipeline):
title `feat: {Card Name} ({SET}{number})`; body with `## Summary` (rules text + implementation
notes) and `## Test plan` (what was exercised locally — see `dev-stack.md` for bringing up the
stack to validate against), dossier-cited (Card Vault true text, the-fab-cube stats, CR at
implementation time — §10 I4, never remembered card text).

## No formal CONTRIBUTING.md upstream

`` `third_party/talishar/README.md` `` directs contributors and bug reporters to the project
Discord for coordination. There is no `CONTRIBUTING.md` and no PR template
(`` `third_party/talishar/.github/` `` contains only `FUNDING.yml` and `dependabot.yml`) — process
conventions live in the community/Discord and in `` `third_party/talishar/CLAUDE.md` `` /
`` `third_party/talishar/New Developer Guide.md` `` rather than a formal contributing doc.

## Coordination norms

- Large or architecturally significant changes: coordinate on the Talishar Discord before opening a
  PR (`SPEC-TALISHAR.md` §10 I7 — "Upstream contributions stay incremental and
  convention-following... coordination via the Talishar Discord for large changes; no engine
  rewrite").
- Small, incremental, convention-following changes (a single card implementation, a targeted bug
  fix) don't require pre-coordination — the two worked examples (`#1370`, `#1369`) are exactly this
  shape.
- Etiquette toward upstream infra: ≤2 concurrent requests against `talishar.net`/
  `images.talishar.net`; CardImages downloads only for cards actively being implemented, never bulk
  mirroring (`SPEC-TALISHAR.md` §11).

## Curated reference set

Sibling files: `architecture.md`, `card-recipe.md`, `decision-queue.md`, `frontend.md`,
`dev-stack.md`. Long-form narrative: `docs/TALISHAR-ARCHITECTURE.md`'s "Upstream Contribution
Conventions" section.

---
tags: [talishar, architecture, contribution, upstream-pr]
paths: []
strength: 1
source: "Talishar/Talishar#1370; Talishar/Talishar#1369; third_party/talishar/.github/; third_party/talishar/README.md"
graduated: false
created: 2026-07-18
---

Two real merged PRs anchor the observed upstream convention: `Talishar/Talishar#1370` ("feat:
implement Astral Strike card (OMN145)") and `Talishar/Talishar#1369` ("feat: implement Voltbound
Duality (OMN077/078/079)"), both authored by `brenoos`, both approved by `Pgibby8`, both structured
as a `## Summary` section (rules text + implementation notes, in bullets) followed by a description
of how the change was validated locally.

Don't over-generalize the `feat:`/`fix:` prefix: it's a strong convention for card-implementation
PRs specifically (matching both worked examples), but not enforced repo-wide — the ten most recently
merged PRs at research time (`gh pr list --repo Talishar/Talishar --state merged --limit 10`)
included un-prefixed titles too ("Fix Spitfire's +1 cog prompt being skipped after declining a
wager", "Standardize Cog tap/untap handling across Mechanologist cards").

There is no formal `CONTRIBUTING.md` upstream — `third_party/talishar/.github/` holds only
`FUNDING.yml` and `dependabot.yml` (no PR template either), and
`third_party/talishar/README.md` just directs contributors/bug-reporters to the project Discord.
Large or architecturally significant changes should coordinate on that Discord first; small,
incremental, convention-following changes (a single card implementation, a targeted bug fix) — like
both worked examples — don't require pre-coordination.

**Hard invariants for any tooling built on the vendored clones (never violate)**: never open, mark
ready, approve, or merge a PR on a `Talishar/*` org repo — only push a feature branch to the user's
fork and prepare PR title/body text for a human to paste in; a fork's `main` that has diverged from
`upstream/main` gets reported, never force-pushed. Full fork-contract mechanics in
[[tal-dev-bootstrap]] and [[tal-dev-fork-sync]].

**Prepared PR body shape**: title `feat: {Card Name} ({SET}{number})`; body with `## Summary`
(rules text + implementation notes) and `## Test plan` (what was exercised locally against the dev
stack — see [[tal-arch-dev-stack]]), dossier-cited (Card Vault true text, the-fab-cube stats, and
the current CR at implementation time — never remembered card text).

---
tags: [talishar, dev-tooling, bootstrap, fork-contract]
paths: [scripts/talishar-bootstrap.sh]
strength: 1
source: "scripts/talishar-bootstrap.sh; CLAUDE.md (Talishar section)"
graduated: false
created: 2026-07-18
---

`bash scripts/talishar-bootstrap.sh` is idempotent and requires `git` + `gh` on `PATH`. On a
checkout missing any of the three vendored clones (`third_party/talishar`,
`third_party/talishar-fe`, `third_party/talishar-cardimages`), it clones each from the user's fork and
adds the `upstream` remote — creating the fork first via `gh repo fork Talishar/<repo>
--clone=false` if it doesn't exist yet (retrying the post-fork clone a few times, since GitHub
provisions forks asynchronously).

For clones that already exist, it verifies the `origin`/`upstream` remote contract — `origin` must
be `git@github.com:Zugruul/<repo>.git` (the user's fork, push target), `upstream` must be
`https://github.com/Talishar/<repo>.git` (fetch-only) — and repairs (`repaired: ...`) or confirms
(`ok: ...`) it. A wrong `origin` (e.g. pointing at `Talishar/` instead of `Zugruul/`) is
auto-repaired. A clean rerun on an already-bootstrapped checkout makes no changes and exits 0. A
clone directory that exists but isn't a git repo is left alone and reported as an `error:` line
(exit 1) rather than touched.

This sets up the fork contract described in [[tal-arch-contribution-conventions]]'s hard invariants
— nothing is ever pushed to `upstream`. Run [[tal-dev-fork-sync]] after bootstrapping (or before any
new card-implementation session) to catch up the fork's `main` with upstream.

---
tags: [talishar, dev-tooling, fork-sync]
paths: [scripts/talishar-fork-sync.sh]
strength: 1
source: "scripts/talishar-fork-sync.sh; .claude/skills/talishar-fork-sync/SKILL.md"
graduated: false
created: 2026-07-18
---

`bash scripts/talishar-fork-sync.sh` (or `--rebase-branches` to also rebase local feature branches)
fetches both remotes and fast-forwards each fork's `main` to `upstream/main` — locally, then pushed
to `origin` — when there's no divergence, for each of `third_party/talishar`,
`third_party/talishar-fe`, `third_party/talishar-cardimages` (skipping any not yet bootstrapped,
see [[tal-dev-bootstrap]]).

Report-line prefixes to recognize:

- `upstream: N new commit(s) on main since fork tip (<dir>)` — how far behind before this run.
- `ok: <dir> main up to date with upstream/main` — nothing to do.
- `synced: <dir> main fast-forwarded N commit(s), pushed to origin` — the happy path.
- `diverged: <dir> main is X ahead / Y behind upstream/main — resolve manually, no push` — **stop
  and surface to a human**; this fork state is never force-pushed (hard invariant, see
  [[tal-arch-contribution-conventions]]).
- `branch: <dir>/<name> is X ahead / Y behind main` — printed for every local feature branch
  regardless of `--rebase-branches`.
- `rebased: <dir>/<name> onto updated main (local only, not pushed)` — with `--rebase-branches`;
  intentionally not pushed, since rewriting shared history is a human call.
- `conflict: <dir>/<name> could not be rebased onto main (aborted, not pushed)` — rebase hit a
  conflict, `git rebase --abort` ran automatically, never resolved silently.
- `error: <dir> <step> failed — skipping, check manually` — one repo's failure never aborts the
  rest of the run.

Exits non-zero if any repo diverged, any rebase conflicted, or any repo errored — treat that as
"needs human attention," not a bug to route around. Run this before starting any Talishar
card-implementation session.

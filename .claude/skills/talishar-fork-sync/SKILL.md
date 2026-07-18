---
name: talishar-fork-sync
description: Fast-forward the vendored Talishar/Talishar-FE/CardImages forks to upstream and report divergence/rebase status. Use when the user says "sync the talishar fork(s)", "update talishar from upstream", "pull upstream talishar changes", or before starting a Talishar card-implementation session (per §6.5 of SPEC-TALISHAR.md).
---

# talishar-fork-sync

Keeps the three vendored Talishar working copies (`third_party/talishar`,
`third_party/talishar-fe`, `third_party/talishar-cardimages`) current with their
upstream `Talishar/<repo>` org repos, without ever pushing to `upstream` or
force-pushing anywhere. See `scripts/talishar-fork-sync.sh` for the mechanics and
SPEC-TALISHAR.md §6.5/§6.5a/§6.5b for the requirements this implements.

## Standing invariants (never violate these — SPEC-TALISHAR.md §10 I1/I2)

- **I1 — never open, mark ready, approve, or merge pull requests on Talishar org
  repositories.** This skill only fast-forwards and pushes to the user's own fork
  (`origin`); it never creates or touches a PR on `Talishar/<repo>`.
- **I2 — `upstream` is fetch-only.** Nothing is ever pushed to `upstream`. A fork
  `main` that has diverged from `upstream/main` (non-fast-forward) is **reported**,
  never force-pushed. If you ever find yourself reaching for `--force` or `push
  upstream`, stop — that means the situation needs a human decision, not automation.

## Steps

1. **Bootstrap first if the clones are missing.** If `third_party/talishar{,​-fe,​-cardimages}`
   don't exist yet, run `bash scripts/talishar-bootstrap.sh` first (it clones from the
   user's forks, creating them via `gh repo fork` if needed, and sets up the
   `origin`/`upstream` remote contract). `talishar-fork-sync.sh` skips any repo that
   isn't present yet with a `skip:` notice rather than failing the whole run.

2. **Run the sync:**
   ```bash
   bash scripts/talishar-fork-sync.sh
   ```
   Add `--rebase-branches` to also attempt rebasing every local feature branch onto
   the freshly-synced `main` in each repo:
   ```bash
   bash scripts/talishar-fork-sync.sh --rebase-branches
   ```

3. **Read the report.** Output lines are prefixed for easy scanning:
   - `skip: <dir> not present — run scripts/talishar-bootstrap.sh first` — repo not
     cloned yet; the other repos are still processed.
   - `upstream: N new commit(s) on main since fork tip (<dir>)` — how far behind
     upstream the fork was before this run. A large or growing N across sessions
     means `docs/TALISHAR-ARCHITECTURE.md` (§11) may be going stale — worth a re-read.
   - `ok: <dir> main up to date with upstream/main` — nothing to do.
   - `synced: <dir> main fast-forwarded N commit(s), pushed to origin` — the fork's
     `main` was fast-forwarded locally and pushed to the user's fork. Happy path.
   - `diverged: <dir> main is X ahead / Y behind upstream/main — resolve manually, no push`
     — **STOP and surface this to the human.** The fork's `main` has commits upstream
     doesn't have (or was rewritten), so a fast-forward isn't possible. Never force-push
     to reconcile it automatically — that's a human decision about which history wins.
   - `branch: <dir>/<name> is X ahead / Y behind main` — status of a local feature
     branch relative to the (now-synced) `main`, printed for every branch regardless
     of `--rebase-branches`.
   - `rebased: <dir>/<name> onto updated main (local only, not pushed)` — rebase
     succeeded locally. It is intentionally **not** pushed automatically (a rebase
     rewrites history; force-pushing it to `origin` is a human call, especially if
     anyone else might have the old branch tip).
   - `conflict: <dir>/<name> could not be rebased onto main (aborted, not pushed)`
     — the rebase hit a conflict, the script ran `git rebase --abort` to leave the
     branch exactly as it was, and reported it. **Never resolve the conflict
     silently or automatically** — surface it and let a human (or a dedicated,
     explicitly-requested follow-up) resolve it by hand.
   - `error: <dir> <step> failed — skipping, check manually` — a git call for that
     repo failed transiently (e.g. a rejected push, a failed merge, or even `git
     rebase --abort` itself). That repo is skipped from that point on, but the run
     continues with the remaining repos — one repo's failure never aborts the whole
     sync or hides the others' reports. Investigate the named repo/step by hand
     before re-running.

4. The script exits non-zero if any repo diverged, any rebase hit a conflict, or
   any repo hit an `error:` — treat a non-zero exit as "needs human attention,"
   not a bug to route around.

## What this skill does NOT do

- It does not open, approve, or merge any PR — upstream or fork-side.
- It does not push rebased feature branches anywhere (rebase is local-only by
  design; pushing a rewritten branch is left to a human/explicit follow-up).
- It does not resolve `diverged:` or `conflict:` reports — those are always
  surfaced, never auto-resolved.
- It does not touch the network beyond `git fetch`/`git push origin` on the three
  vendored clones — no PR creation, no issue filing, no Discord coordination (that's
  a human task per §10 I7 when a divergence needs discussion).

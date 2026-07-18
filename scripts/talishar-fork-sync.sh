#!/usr/bin/env bash
# Fork maintenance for the vendored Talishar working copies.
#
# For each of the three sibling clones under third_party/ (talishar,
# talishar-fe, talishar-cardimages — see scripts/talishar-bootstrap.sh),
# fetches both remotes and fast-forwards the fork's main to upstream/main
# when possible, reporting anything it can't safely do automatically.
#
# Standing invariants (SPEC-TALISHAR.md §10):
#   I1: Never open, mark ready, approve, or merge pull requests on Talishar
#       org repositories; tooling pushes branches only to the user's forks
#       and prepares PR title/body as text — a human creates every upstream PR.
#   I2: In every vendored Talishar clone, origin must be the user's fork and
#       upstream the Talishar org repo, fetch-only; nothing is ever pushed to
#       upstream, and a diverged fork main is reported, never force-pushed.
#
# This script NEVER pushes to `upstream` and NEVER force-pushes anywhere.
#
# Usage: talishar-fork-sync.sh [--rebase-branches]
#   --rebase-branches   attempt `git rebase main <branch>` for every local
#                        feature branch after main is synced; conflicts abort
#                        the rebase and are reported, never resolved silently.
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  echo "talishar-fork-sync: required command 'git' not found on PATH" >&2
  exit 1
fi

rebase_branches=false
for arg in "$@"; do
  case "$arg" in
    --rebase-branches) rebase_branches=true ;;
    *)
      echo "talishar-fork-sync: unknown argument '$arg'" >&2
      exit 1
      ;;
  esac
done

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
third_party="$root_dir/third_party"

# repo-name:local-dir pairs, mirroring scripts/talishar-bootstrap.sh
repos=(
  "Talishar:talishar"
  "Talishar-FE:talishar-fe"
  "CardImages:talishar-cardimages"
)

had_diverged=false
had_conflict=false
had_error=false

# Parses a tab-separated `git rev-list --left-right --count A...B` result
# into two vars. Left = commits only reachable from A (ahead), right =
# commits only reachable from B (behind).
parse_counts() {
  local raw="$1"
  ahead_out="$(printf '%s' "$raw" | cut -f1)"
  behind_out="$(printf '%s' "$raw" | cut -f2)"
}

# Does all the git work for one repo. Every git call that can transiently
# fail (a flaky push, a rejected merge, ...) is explicitly guarded with
# `|| return 1` rather than left to `set -e`: this function is always
# invoked as the condition of an `if`, and bash disables errexit for the
# entire body of a compound command/function executed in such a context —
# so an unguarded failing command here would silently fall through to the
# next line instead of aborting the repo, not skip it. `step` (deliberately
# not `local`) records the last attempted action so the caller can report
# which one failed.
sync_one_repo() {
  local dir="$1"

  step="fetch upstream"
  git -C "$dir" fetch upstream || return 1
  step="fetch origin"
  git -C "$dir" fetch origin || return 1

  step="rev-list main...upstream/main"
  local counts
  counts="$(git -C "$dir" rev-list --left-right --count main...upstream/main)" || return 1
  parse_counts "$counts"
  local ahead_main="$ahead_out" behind_main="$behind_out"

  echo "upstream: $behind_main new commit(s) on main since fork tip ($dir)"

  if [ "$behind_main" -eq 0 ]; then
    echo "ok: $dir main up to date with upstream/main"
  elif [ "$ahead_main" -eq 0 ]; then
    step="rev-parse HEAD"
    local current_branch
    current_branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD)" || return 1
    if [ "$current_branch" = "main" ]; then
      step="merge --ff-only"
      git -C "$dir" merge --ff-only upstream/main || return 1
    else
      # Update the local main ref without switching the checked-out branch.
      step="fetch . upstream/main:main"
      git -C "$dir" fetch . upstream/main:main || return 1
    fi
    step="push origin main"
    git -C "$dir" push origin main || return 1
    echo "synced: $dir main fast-forwarded $behind_main commit(s), pushed to origin"
  else
    echo "diverged: $dir main is $ahead_main ahead / $behind_main behind upstream/main — resolve manually, no push"
    had_diverged=true
  fi

  step="branch --format"
  local branches
  branches="$(git -C "$dir" branch --format='%(refname:short)')" || return 1
  while IFS= read -r branch; do
    [ -z "$branch" ] && continue
    [ "$branch" = "main" ] && continue

    step="rev-list $branch...main"
    counts="$(git -C "$dir" rev-list --left-right --count "$branch...main")" || return 1
    parse_counts "$counts"
    echo "branch: $dir/$branch is $ahead_out ahead / $behind_out behind main"

    if [ "$rebase_branches" = true ]; then
      if git -C "$dir" rebase main "$branch"; then
        echo "rebased: $dir/$branch onto updated main (local only, not pushed)"
      else
        step="rebase --abort ($branch)"
        git -C "$dir" rebase --abort || return 1
        echo "conflict: $dir/$branch could not be rebased onto main (aborted, not pushed)"
        had_conflict=true
      fi
    fi
  done <<< "$branches"

  return 0
}

for entry in "${repos[@]}"; do
  repo_name="${entry%%:*}"
  local_name="${entry##*:}"
  dir="$third_party/$local_name"

  if [ ! -e "$dir/.git" ]; then
    echo "skip: $dir not present — run scripts/talishar-bootstrap.sh first"
    continue
  fi

  step=""
  if ! sync_one_repo "$dir"; then
    echo "error: $dir $step failed — skipping, check manually"
    had_error=true
    continue
  fi
done

if [ "$had_diverged" = true ] || [ "$had_conflict" = true ] || [ "$had_error" = true ]; then
  exit 1
fi

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

# Parses a tab-separated `git rev-list --left-right --count A...B` result
# into two vars. Left = commits only reachable from A (ahead), right =
# commits only reachable from B (behind).
parse_counts() {
  local raw="$1"
  ahead_out="$(printf '%s' "$raw" | cut -f1)"
  behind_out="$(printf '%s' "$raw" | cut -f2)"
}

for entry in "${repos[@]}"; do
  repo_name="${entry%%:*}"
  local_name="${entry##*:}"
  dir="$third_party/$local_name"

  if [ ! -e "$dir/.git" ]; then
    echo "skip: $dir not present — run scripts/talishar-bootstrap.sh first"
    continue
  fi

  git -C "$dir" fetch upstream
  git -C "$dir" fetch origin

  parse_counts "$(git -C "$dir" rev-list --left-right --count main...upstream/main)"
  ahead_main="$ahead_out"
  behind_main="$behind_out"

  echo "upstream: $behind_main new commit(s) on main since fork tip ($dir)"

  if [ "$behind_main" -eq 0 ]; then
    echo "ok: $dir main up to date with upstream/main"
  elif [ "$ahead_main" -eq 0 ]; then
    current_branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
    if [ "$current_branch" = "main" ]; then
      git -C "$dir" merge --ff-only upstream/main
    else
      # Update the local main ref without switching the checked-out branch.
      git -C "$dir" fetch . upstream/main:main
    fi
    git -C "$dir" push origin main
    echo "synced: $dir main fast-forwarded $behind_main commit(s), pushed to origin"
  else
    echo "diverged: $dir main is $ahead_main ahead / $behind_main behind upstream/main — resolve manually, no push"
    had_diverged=true
  fi

  branches="$(git -C "$dir" branch --format='%(refname:short)')"
  while IFS= read -r branch; do
    [ -z "$branch" ] && continue
    [ "$branch" = "main" ] && continue

    parse_counts "$(git -C "$dir" rev-list --left-right --count "$branch...main")"
    echo "branch: $dir/$branch is $ahead_out ahead / $behind_out behind main"

    if [ "$rebase_branches" = true ]; then
      if git -C "$dir" rebase main "$branch"; then
        echo "rebased: $dir/$branch onto updated main (local only, not pushed)"
      else
        git -C "$dir" rebase --abort
        echo "conflict: $dir/$branch could not be rebased onto main (aborted, not pushed)"
        had_conflict=true
      fi
    fi
  done <<< "$branches"
done

if [ "$had_diverged" = true ] || [ "$had_conflict" = true ]; then
  exit 1
fi

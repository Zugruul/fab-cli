#!/usr/bin/env bash
# Idempotent bootstrap for vendored Talishar working copies.
#
# Clones three repos as siblings under third_party/ — this layout matters:
# the Talishar backend's docker-compose expects ../Talishar-FE and
# ../CardImages next to the backend checkout, so all three MUST remain
# direct siblings of one another under third_party/. Do not nest or rename.
#
# Contract per repo (invariants I2/I3, SPEC-TALISHAR.md §6.1-6.4):
#   - origin   = the user's fork (git@github.com:Zugruul/<repo>.git)
#   - upstream = the official org, fetch-only (https://github.com/Talishar/<repo>.git)
#   - never push to upstream; this script never pushes anywhere.
#
# Safe to re-run: verifies the remote contract on every invocation and only
# touches a repo when something is missing or wrong.
set -euo pipefail

for bin in git gh; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "talishar-bootstrap: required command '$bin' not found on PATH" >&2
    exit 1
  fi
done

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
third_party="$root_dir/third_party"
mkdir -p "$third_party"

FORK_OWNER="Zugruul"
UPSTREAM_OWNER="Talishar"

# Seconds to wait between clone retries after a fresh fork (GitHub
# provisions forks asynchronously, so an immediate clone can 404 for a
# few seconds). Overridable so tests don't have to sleep for real.
RETRY_SLEEP="${TALISHAR_BOOTSTRAP_RETRY_SLEEP:-3}"

# repo-name:local-dir pairs, kept as siblings under third_party/
repos=(
  "Talishar:talishar"
  "Talishar-FE:talishar-fe"
  "CardImages:talishar-cardimages"
)

had_error=false

for entry in "${repos[@]}"; do
  repo_name="${entry%%:*}"
  local_name="${entry##*:}"
  dir="$third_party/$local_name"
  fork_full="$FORK_OWNER/$repo_name"
  upstream_full="$UPSTREAM_OWNER/$repo_name"
  origin_url="git@github.com:${fork_full}.git"
  upstream_url="https://github.com/${UPSTREAM_OWNER}/${repo_name}.git"

  if [ ! -d "$dir" ]; then
    status="cloned"
    freshly_forked=false
    if ! gh repo view "$fork_full" >/dev/null 2>&1; then
      gh repo fork "$upstream_full" --clone=false
      status="forked+cloned"
      freshly_forked=true
    fi

    if [ "$freshly_forked" = true ]; then
      cloned=false
      for attempt in 1 2 3; do
        if git clone "$origin_url" "$dir"; then
          cloned=true
          break
        fi
        rm -rf "$dir"
        if [ "$attempt" -lt 3 ]; then
          echo "talishar-bootstrap: clone of freshly forked $origin_url failed (attempt $attempt/3), retrying in ${RETRY_SLEEP}s..." >&2
          sleep "$RETRY_SLEEP"
        fi
      done
      if [ "$cloned" != true ]; then
        echo "talishar-bootstrap: failed to clone $origin_url after 3 attempts" >&2
        exit 1
      fi
    else
      git clone "$origin_url" "$dir"
    fi

    git -C "$dir" remote add upstream "$upstream_url"
    echo "${status}: $dir (origin=$origin_url upstream=$upstream_url)"
    continue
  fi

  if [ ! -e "$dir/.git" ]; then
    echo "talishar-bootstrap: $dir exists but is not a git repository (no .git) — leaving it alone, fix or remove it manually" >&2
    echo "error: $dir is not a git repository — skipped"
    had_error=true
    continue
  fi

  repaired=false

  current_origin="$(git -C "$dir" remote get-url origin 2>/dev/null || true)"
  if [ "$current_origin" != "$origin_url" ]; then
    # set-url can't create a remote that doesn't exist yet (e.g. an
    # interrupted clone left with no origin at all) — fall back to add.
    git -C "$dir" remote set-url origin "$origin_url" 2>/dev/null \
      || git -C "$dir" remote add origin "$origin_url"
    repaired=true
  fi

  current_upstream="$(git -C "$dir" remote get-url upstream 2>/dev/null || true)"
  if [ "$current_upstream" != "$upstream_url" ]; then
    git -C "$dir" remote set-url upstream "$upstream_url" 2>/dev/null \
      || git -C "$dir" remote add upstream "$upstream_url"
    repaired=true
  fi

  if [ "$repaired" = true ]; then
    echo "repaired: $dir (origin=$origin_url upstream=$upstream_url)"
  else
    echo "ok: $dir (origin=$origin_url upstream=$upstream_url)"
  fi
done

if [ "$had_error" = true ]; then
  exit 1
fi

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

# repo-name:local-dir pairs, kept as siblings under third_party/
repos=(
  "Talishar:talishar"
  "Talishar-FE:talishar-fe"
  "CardImages:talishar-cardimages"
)

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
    if ! gh repo view "$fork_full" >/dev/null 2>&1; then
      gh repo fork "$upstream_full" --clone=false
      status="forked+cloned"
    fi
    git clone "$origin_url" "$dir"
    git -C "$dir" remote add upstream "$upstream_url"
    echo "${status}: $dir (origin=$origin_url upstream=$upstream_url)"
    continue
  fi

  repaired=false

  current_origin="$(git -C "$dir" remote get-url origin 2>/dev/null || true)"
  if [ "$current_origin" != "$origin_url" ]; then
    git -C "$dir" remote set-url origin "$origin_url"
    repaired=true
  fi

  if ! git -C "$dir" remote get-url upstream >/dev/null 2>&1; then
    git -C "$dir" remote add upstream "$upstream_url"
    repaired=true
  fi

  if [ "$repaired" = true ]; then
    echo "repaired: $dir (origin=$origin_url upstream=$upstream_url)"
  else
    echo "ok: $dir (origin=$origin_url upstream=$upstream_url)"
  fi
done

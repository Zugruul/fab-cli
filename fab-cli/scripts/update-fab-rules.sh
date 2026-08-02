#!/usr/bin/env bash
# Refresh the vendored official FAB rules documents in third_party/fab-rules/.
# These are verification artifacts: the identity brains are the source of truth
# for answering; these copies are what answers get double-checked against.
# Card legality is deliberately NOT vendored — it must always be fetched live:
# https://fabtcg.com/rules-and-policy-center/card-legality-policy/
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)/third_party/fab-rules"
mkdir -p "$dir"
base="https://rules.fabtcg.com/txt/latest"
{
  echo "# Vendored FAB rules documents — refreshed $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for doc in en-fab-cr en-fab-trp en-fab-ppg; do
    curl -fsS "$base/$doc.txt" -o "$dir/$doc.txt"
    lm=$(curl -fsSI "$base/$doc.txt" | grep -i '^last-modified:' | cut -d' ' -f2- | tr -d '\r' || true)
    echo "$doc.txt  last-modified: ${lm:-unknown}  lines: $(wc -l < "$dir/$doc.txt" | tr -d ' ')"
  done
} > "$dir/VERSIONS.txt"
cat "$dir/VERSIONS.txt"

#!/usr/bin/env bash
# Root "gate" entry point (npm run gate -> this script).
#
# Issue #263: a recorded gate pass is the project's ground truth for
# unlocking board transitions/merges, so its verdict must never depend on a
# stale node_modules/.vite (or .vite-temp) Vitest cache being served instead
# of the current tree — see scripts/clean-vite-cache.mjs for the full
# root-cause writeup. This wrapper clears those caches unconditionally
# before every gate run (cheap — see the issue's PR description for the
# measured cost) so that precondition can never be forgotten, then runs the
# real gate command and, only on failure, appends guidance for telling a
# fabricated failure apart from a real regression before anyone starts
# "fixing" working code.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# Overridable for testing (scripts/gate-hygiene.test.mjs) so gate.sh's own
# ordering/exit-code/guidance behavior can be exercised without running the
# real (expensive) workspace gate. Defaults to the real gate command.
GATE_CMD="${GATE_CMD:-pnpm -r --if-present run gate}"

node "$HERE/clean-vite-cache.mjs" "$ROOT"
clean_rc=$?
if [[ "$clean_rc" -ne 0 ]]; then
    echo "gate.sh: clean-vite-cache.mjs failed (exit $clean_rc) — see its stderr above. Proceeding with the gate run anyway; a failed cache clean should not silently block a gate run, but do check that output." >&2
fi

(cd "$ROOT" && bash -c "$GATE_CMD")
rc=$?

if [[ "$rc" -ne 0 ]]; then
    cat >&2 <<'EOF'

---
Gate failed. Before treating this as a real regression, check the two
discriminators for a fabricated failure (issue #263):
  1. Nondeterminism: re-run the gate on the SAME tree. If the failure count
     or set of failing tests changes between runs, that's nondeterminism,
     not a regression — a real regression fails the same way every time.
  2. Entry-path disagreement: run the failing test file directly, e.g.
     `cd <package> && npx vitest run <file>`, instead of through the gate.
     If direct vitest is green while the gate is red on the identical tree,
     that disagreement points at caching, not at the code.
If either discriminator fires, this may be gate-cache staleness rather than
a real failure — re-run `node scripts/clean-vite-cache.mjs` and try again.
---
EOF
fi

exit "$rc"
